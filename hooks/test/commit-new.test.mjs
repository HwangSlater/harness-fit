// 커밋이 새로 넣는 .gitignore 파일(git add -f): Claude 의 커밋이면 막고 사람의 커밋은 두기(역할극 16 회차, 2026-11-13).
// git pre-commit 훅은 Claude Code 가 셸에 붙이는 CLAUDECODE 로 둘을 가른다 — 실제 훅 진입점을 두 환경으로 돌려 본다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('../git-pre-commit.mjs', import.meta.url));
let dir;
const g = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
const put = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-commit-new-'));
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@example.com');
  g('config', 'user.name', 't');
  put('.gitignore', 'Config/Secrets.xcconfig\n');
  put('README.md', 'x\n');
  g('add', '.gitignore', 'README.md');
  g('commit', '-q', '-m', 'chore: 시작');
  put('.claude/harness.json', JSON.stringify({ lang: 'en', rules: { 'protected-files': true } }));
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const runHook = (claude) => {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  if (claude !== false) env.CLAUDECODE = claude === true ? '1' : claude;
  return spawnSync(process.execPath, [HOOK], { cwd: dir, env, encoding: 'utf8' });
};

test('git add -f 로 올린 무시 파일: Claude 의 커밋(CLAUDECODE)이면 막고, 사람의 커밋이면 둔다', () => {
  put('Config/Secrets.xcconfig', 'KAKAO_APP_KEY = demo\n');
  g('add', '-f', 'Config/Secrets.xcconfig');
  try {
    const claude = runHook(true);
    assert.equal(claude.status, 1, claude.stderr);
    assert.match(claude.stderr, /Config\/Secrets\.xcconfig is ignored by git \(\.gitignore or exclude file/);
    const human = runHook(false);
    assert.equal(human.status, 0, human.stderr);
  } finally {
    g('reset', '-q', '--', 'Config/Secrets.xcconfig');
  }
});

test('이미 추적 중인 무시 파일을 고친 커밋은 Claude 의 것이어도 둔다', () => {
  put('Config/Secrets.xcconfig', 'KAKAO_APP_KEY = demo\n');
  g('add', '-f', 'Config/Secrets.xcconfig');
  g('commit', '-q', '-n', '-m', 'chore: 틀');
  put('Config/Secrets.xcconfig', 'KAKAO_APP_KEY = demo2\n');
  g('add', '-f', 'Config/Secrets.xcconfig');
  const r = runHook(true);
  assert.equal(r.status, 0, r.stderr);
});

// 다시 검토 2026-11-13: 0·false 를 사람으로 보니 「CLAUDECODE=0 git commit」 이 검사를 피했다 — 있기만 하면 Claude 다
test('CLAUDECODE 가 있으면 값이 0·false·빈 값이어도 Claude 의 커밋으로 막고, 없을 때만 둔다', () => {
  put('cc/claude.cfg', 'x\n');
  fs.appendFileSync(path.join(dir, '.git', 'info', 'exclude'), 'cc/\n');
  g('add', '-f', 'cc/claude.cfg');
  try {
    for (const v of ['0', 'false', 'FALSE', '', 'true']) assert.equal(runHook(v).status, 1, `CLAUDECODE=${v}`);
    assert.equal(runHook(false).status, 0, '없으면 사람');
  } finally {
    g('reset', '-q', '--', 'cc');
  }
});

// 검토 2026-11-13: 「:!x」 같은 pathspec 마법 이름의 새 파일이 있으면 check-ignore 가 128 로 끝나 무시 파일이 지나갔다
// (Windows 는 : 든 파일을 못 만들어 색인에만 넣는다)
test('pathspec 마법 꼴 이름의 새 파일이 섞여도 무시 파일을 막는다', () => {
  put('mg/Secrets.xcconfig', 'KAKAO_APP_KEY = demo3\n');
  fs.appendFileSync(path.join(dir, '.git', 'info', 'exclude'), 'mg/\n');
  g('add', '-f', 'mg/Secrets.xcconfig');
  const blob = g('hash-object', '-w', 'README.md').trim();
  try {
    // Windows 의 git 은 : 든 경로를 막는다(core.protectNTFS) — 이 시험 저장소에서만 끈다
    g('config', 'core.protectNTFS', 'false');
    for (const name of [':!x', ':(glob)y']) g('update-index', '--add', '--cacheinfo', `100644,${blob},${name}`);
    const r = runHook(true);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /mg\/Secrets\.xcconfig/);
    g('reset', '-q', '--', 'mg');
    assert.equal(runHook(true).status, 0, '마법 꼴 이름만 남으면 지나간다(무시 파일이 아님)');
  } finally {
    g('reset', '-q');
    g('config', '--unset', 'core.protectNTFS');
  }
});

// 검토 2026-11-13: 앞 2000개만 보아 새 파일 2100개 뒤의 무시 파일이 지나갔다. 모두 보고, exclude 파일에 적은 것도 무시 파일이다
test('새 파일이 많아도 뒤에 숨긴 무시 파일까지 막는다', () => {
  const many = Array.from({ length: 2100 }, (_, i) => `gen/f${String(i).padStart(4, '0')}.txt`);
  for (const f of many) put(f, 'x\n');
  put('zz/local.secret', 'x\n');
  fs.appendFileSync(path.join(dir, '.git', 'info', 'exclude'), 'zz/local.secret\n');
  g('add', 'gen');
  g('add', '-f', 'zz/local.secret');
  try {
    const r = runHook(true);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /zz\/local\.secret/);
    g('reset', '-q', '--', 'zz/local.secret');
    assert.equal(runHook(true).status, 0, '무시 파일을 내리면 지나간다');
  } finally {
    g('reset', '-q', '--', 'gen', 'zz');
  }
});

test('무시하지 않는 보통 새 파일은 막지 않는다', () => {
  put('Sources/App.swift', 'let x = 1\n');
  g('add', 'Sources/App.swift');
  const r = runHook(true);
  assert.equal(r.status, 0, r.stderr);
});
