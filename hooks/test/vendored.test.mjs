// harness-fit 이 받아 넣은 스킬 가운데 받은 그대로인 파일은 커밋 때 코드 검사에서 뺀다(역할극 5 회차 2차, 2026-11-11).
// 믿는 것은 이 저장소에 넣기로 한 카탈로그 스킬의 출처 기록뿐(검토 2026-11-11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { withoutVendored } from '../rules/commit.mjs';

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const catalog = JSON.parse(fs.readFileSync(new URL('../../catalog/catalog.json', import.meta.url), 'utf8'));
const repoSha = (repo) => catalog.repos.find((r) => r.repo === repo).sha;
const SKILL = catalog.skills.find((s) => s.id === 'brainstorming');

const setup = ({ name = 'brainstorming', chosen = ['brainstorming'], source = {} } = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-vendored-'));
  const dir = path.join(root, '.claude', 'skills', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'harness.json'), JSON.stringify({ rules: {}, selection: { skills: chosen } }));
  const helper = "el.innerHTML = '<div>' +\n  '</div>';\n";
  fs.writeFileSync(path.join(dir, '.harness-source.json'), JSON.stringify({ repo: SKILL.repo, sha: repoSha(SKILL.repo), files: { 'scripts/helper.js': sha(helper), 'scripts/other.js': sha('원래') }, ...source }));
  const after = {
    [`.claude/skills/${name}/scripts/helper.js`]: helper, // 받은 그대로
    [`.claude/skills/${name}/scripts/other.js`]: '고침', // 받은 뒤 고침
    'src/app.js': 'x.innerHTML = y;\n',
  };
  const files = Object.keys(after);
  return { root, plan: { files, added: new Map(files.map((f) => [f, after[f].split('\n')])), after: (f) => after[f] }, helper };
};
const kept = (o) => withoutVendored(o.plan, o.root).files;

test('받은 그대로인 스킬 파일만 코드 검사에서 빠지고, 고친 파일·다른 파일은 남는다', () => {
  const o = setup();
  try {
    const out = withoutVendored(o.plan, o.root);
    assert.deepEqual(out.files, ['.claude/skills/brainstorming/scripts/other.js', 'src/app.js']);
    assert.deepEqual([...out.added.keys()], out.files);
    assert.equal(withoutVendored(o.plan, null), o.plan, 'root 를 모르면 그대로');
  } finally {
    fs.rmSync(o.root, { recursive: true, force: true });
  }
});

test('출처 기록을 믿지 않는 경우: 카탈로그에 없는 이름, 넣기로 하지 않은 스킬, 저장소·커밋이 다른 기록', () => {
  for (const o of [
    setup({ name: 'my-bypass', chosen: ['my-bypass'] }),
    setup({ chosen: [] }),
    setup({ source: { sha: '0'.repeat(40) } }),
    setup({ source: { repo: 'someone/else' } }),
  ]) {
    try {
      assert.equal(kept(o).length, 3, o.root);
    } finally {
      fs.rmSync(o.root, { recursive: true, force: true });
    }
  }
});

test('autocrlf 로 줄 끝이 바뀌어 들어와도 받은 그대로로 본다', () => {
  const o = setup();
  try {
    const f = '.claude/skills/brainstorming/scripts/helper.js';
    const crlf = o.helper.replace(/\n/g, '\r\n');
    const plan = { ...o.plan, after: (x) => (x === f ? crlf : o.plan.after(x)) };
    assert.ok(!withoutVendored(plan, o.root).files.includes(f));
  } finally {
    fs.rmSync(o.root, { recursive: true, force: true });
  }
});
