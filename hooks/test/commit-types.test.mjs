// 커밋 형식: 저장소가 이미 쓰는 표준 밖 타입(bench: 등)은 옵션 types 로 받는다(역할극 11 회차, 2026-11-11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitMsg } from '../rules/message.mjs';
import { loadAll, expandCombo } from '../../scripts/lib/catalog.mjs';

const t = (k) => k;
const check = (msg, opts = {}) => commitMsg.check({ cmd: `git commit -m "${msg}"`, shell: 'bash', cwd: process.cwd(), opts, t });

test('types 에 적은 타입은 통과, 적지 않은 타입과 대문자·긴 낱말은 그대로 막는다', () => {
  assert.equal(check('bench: criterion runner', { types: ['bench'] }), null);
  assert.equal(check('bench(engine): faster compaction', { types: ['bench'] }), null);
  assert.equal(check('bench: criterion runner'), 'git.msgConventional');
  assert.equal(check('wip: x', { types: ['bench'] }), 'git.msgConventional');
  assert.equal(check('Bench: x', { types: ['Bench'] }), 'git.msgConventional', '옵션 값도 소문자 낱말만');
  assert.equal(check('feat: x', { types: ['bench'] }), null, '기본 타입은 그대로');
});

test('Go 식 패키지 이름표(runtime: · http:)는 타입으로 세지 않는다(검토 2026-11-11)', async () => {
  const { execFileSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { detect } = await import('../../scripts/detect.mjs');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-gohist-'));
  try {
    const g = (...a) => execFileSync('git', ['-C', d, ...a], { stdio: 'ignore' });
    g('init', '-q');
    fs.writeFileSync(path.join(d, 'go.mod'), 'module x\n');
    for (const [i, s] of ['runtime: fix gc', 'http: add timeout', 'cmd: new flag', 'net: retry', 'runtime: tune', 'docs: readme'].entries()) {
      fs.writeFileSync(path.join(d, `f${i}.go`), 'package x\n');
      g('add', '.');
      g('-c', 'user.name=a', '-c', 'user.email=a@example.com', 'commit', '-q', '-m', s);
    }
    const h = detect(d).history;
    assert.deepEqual(h.extraTypes, []);
    assert.ok(h.conventional < h.subjects / 2, '기록이 conventional 이 아니다');
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('기록의 표준 밖 타입은 커밋 형식 훅의 types 기본값으로', () => {
  const all = loadAll();
  const det = { stack: ['Rust'], kinds: ['backend'], authors: 1, commits: 9, team: false, existing: {}, history: { subjects: 9, conventional: 9, extraTypes: ['bench'], messages: 9, korean: 0, english: 9 } };
  const sel = expandCombo(all, 'team', det);
  if (sel.hooks.includes('commit-msg')) assert.deepEqual(sel.hookOpts['commit-msg'].types, ['bench']);
});
