// 스킬 받기 시험. 네트워크 대신 fetch 를 바꿔 끼운다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installSkill } from '../lib/install-skill.mjs';

const sources = { githubApi: 'api', rawBase: 'raw' };
const repo = { sha: 'abc', license: 'MIT' };
const ok = (body) => ({ ok: true, status: 200, json: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer });
const stub = (tree, failOn) => (url) => {
  if (url.includes('/git/trees/')) return Promise.resolve(ok(tree));
  if (failOn && url.endsWith(failOn)) return Promise.resolve({ ok: false, status: 502 });
  return Promise.resolve(ok(`내용 ${url}`));
};
const project = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-install-'));
  return { root, dest: (id) => path.join(root, '.claude', 'skills', id) };
};

test('저장소 맨 위의 스킬은 SKILL.md 하나만 받는다(저장소 전체가 아니라)', async () => {
  const { root, dest } = project();
  const real = globalThis.fetch;
  globalThis.fetch = stub({ tree: [{ type: 'blob', path: 'SKILL.md', size: 10 }, { type: 'blob', path: 'src/big.js', size: 10 }, { type: 'blob', path: 'README.md', size: 10 }] });
  try {
    await installSkill({ sources, repo, skill: { id: 'top', repo: 'o/top', path: 'SKILL.md' }, dest: dest('top') });
  } finally {
    globalThis.fetch = real;
  }
  assert.deepEqual(fs.readdirSync(dest('top')).sort(), ['.harness-source.json', 'SKILL.md']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('받다가 실패하면 반쯤 받은 폴더를 남기지 않고, 원래 폴더도 그대로 둔다', async () => {
  const { root, dest } = project();
  fs.mkdirSync(dest('sk'), { recursive: true });
  fs.writeFileSync(path.join(dest('sk'), 'SKILL.md'), '원래 것');
  const real = globalThis.fetch;
  globalThis.fetch = stub({ tree: [{ type: 'blob', path: 'skills/sk/SKILL.md', size: 1 }, { type: 'blob', path: 'skills/sk/ref.md', size: 1 }] }, 'ref.md');
  try {
    await assert.rejects(installSkill({ sources, repo, skill: { id: 'sk', repo: 'o/r', path: 'skills/sk/SKILL.md' }, dest: dest('sk') }), /502/);
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(fs.readFileSync(path.join(dest('sk'), 'SKILL.md'), 'utf8'), '원래 것');
  assert.deepEqual(fs.readdirSync(path.join(root, '.claude', 'skills')), ['sk'], '.claude/skills 안에 임시 폴더가 없다');
  assert.ok(!fs.readdirSync(path.join(root, '.claude')).some((n) => n.startsWith('.harness-tmp')), '임시 폴더는 지운다');
  fs.rmSync(root, { recursive: true, force: true });
});

test('목록이 잘려 온 큰 저장소는 받지 않고 실패로 알린다', async () => {
  const { root, dest } = project();
  const real = globalThis.fetch;
  globalThis.fetch = stub({ truncated: true, tree: [{ type: 'blob', path: 'x/SKILL.md', size: 1 }] });
  try {
    await assert.rejects(installSkill({ sources, repo: { sha: 'def' }, skill: { id: 'x', repo: 'o/big', path: 'x/SKILL.md' }, dest: dest('x') }), /잘림/);
  } finally {
    globalThis.fetch = real;
  }
  fs.rmSync(root, { recursive: true, force: true });
});
