// 스킬 받기 시험. 네트워크 대신 fetch 를 바꿔 끼운다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDir } from './helpers.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { installSkill, setSkillName, reservedNames } from '../lib/install-skill.mjs';
import { loadAll } from '../lib/catalog.mjs';

const sources = { githubApi: 'api', rawBase: 'raw' };
const repo = { sha: 'abc', license: 'MIT' };
const ok = (body) => ({ ok: true, status: 200, json: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer });
const stub = (tree, failOn) => (url) => {
  if (url.includes('/git/trees/')) return Promise.resolve(ok(tree));
  if (failOn && url.endsWith(failOn)) return Promise.resolve({ ok: false, status: 502 });
  return Promise.resolve(ok(`내용 ${url}`));
};
const project = () => {
  const root = tmpDir('harness-install-');
  return { root, dest: (id) => path.join(root, '.claude', 'skills', id) };
};

// 받은 스킬의 name 이 Claude Code 명령과 같으면 그 명령을 대신해 버린다(code.claude.com/docs/en/skills). 폴더 이름(카탈로그 id)으로 맞춘다.
test('SKILL.md 의 name 을 폴더 이름으로 맞춘다: 겹치는 이름(security-review)도 바꾸고, 나머지 글·줄바꿈은 그대로', async () => {
  const { root, dest } = project();
  const md = '---\r\nname: security-review\r\ndescription: 보안 검토\r\n---\r\n\r\n# 본문 name: security-review\r\n';
  const real = globalThis.fetch;
  globalThis.fetch = (url) => Promise.resolve(url.includes('/git/trees/') ? ok({ tree: [{ type: 'blob', path: 'skills/security-review/SKILL.md', size: 10 }] }) : ok(md));
  try {
    await installSkill({ sources, repo, skill: { id: 'sentry-security-review', repo: 'o/sentry', path: 'skills/security-review/SKILL.md' }, dest: dest('sentry-security-review') });
  } finally {
    globalThis.fetch = real;
  }
  const got = fs.readFileSync(path.join(dest('sentry-security-review'), 'SKILL.md'), 'utf8');
  assert.equal(got, md.replace('name: security-review\r\ndesc', 'name: sentry-security-review\r\ndesc'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dest('sentry-security-review'), '.harness-source.json'), 'utf8')).renamedFrom, 'security-review');
  fs.rmSync(root, { recursive: true, force: true });
});

test('name 맞추기: 이미 같거나 머리말·name 이 없으면 그대로, 따옴표 친 이름도 읽는다', () => {
  assert.deepEqual(setSkillName('---\nname: tdd-lite\n---\n', 'tdd-lite'), { text: '---\nname: tdd-lite\n---\n', from: null });
  assert.deepEqual(setSkillName('# 머리말 없음\nname: x\n', 'a'), { text: '# 머리말 없음\nname: x\n', from: null });
  assert.deepEqual(setSkillName('---\ndescription: d\n---\nname: x\n', 'a'), { text: '---\ndescription: d\n---\nname: x\n', from: null });
  assert.deepEqual(setSkillName('---\nname: "tdd"\n---\n', 'tdd-lite'), { text: '---\nname: tdd-lite\n---\n', from: 'tdd' });
});

test('카탈로그 스킬 id 는 Claude Code 명령·번들 스킬 이름과 겹치지 않고, 겹치면 받지 않는다', async () => {
  const names = reservedNames();
  assert.ok(names.has('security-review') && names.has('simplify') && names.has('review'), '명령·번들 스킬·별칭이 목록에 있다');
  assert.deepEqual(loadAll().catalog.skills.map((s) => s.id).filter((id) => names.has(id)), []);
  await assert.rejects(installSkill({ sources, repo, skill: { id: 'simplify', repo: 'o/r', path: 'SKILL.md' }, dest: 'unused' }), /명령과 이름이 같음/);
});


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
