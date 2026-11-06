// 훅이 오류로 멈추면 막지 않고 통과하되, 검사 없이 진행된다고 알린다(사용자 결정 2026-11-06).
// 막으면 그 프로젝트에서 Claude 가 명령도 수정도 못 해 설정 파일조차 고칠 수 없다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RUN = fileURLToPath(new URL('../run.mjs', import.meta.url));

const project = (rules, lang = 'ko') => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-crash-notice-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.writeFileSync(path.join(dir, '.claude', 'harness.json'), JSON.stringify({ lang, rules }));
  return dir;
};

const run = (dir, command) => {
  const r = spawnSync(process.execPath, [RUN], { input: JSON.stringify({ tool_name: 'Bash', cwd: dir, tool_input: { command } }), encoding: 'utf8' });
  assert.equal(r.status, 0);
  return JSON.parse(r.stdout || '{}');
};

test('규칙 하나가 터지면(잘못된 브랜치 이름 꼴) 막지 않고 그 검사 이름을 알린다', () => {
  const dir = project({ 'branch-name': { pattern: '(' } });
  const out = run(dir, 'git checkout -b whatever');
  assert.equal(out.hookSpecificOutput, undefined, '막지 않는다');
  assert.match(out.systemMessage, /branch-name/);
  assert.match(out.systemMessage, /그 훅 없이 진행돼요/);
});

test('다른 규칙이 막을 것을 찾으면 터진 규칙이 있어도 막는다', () => {
  const dir = project({ 'branch-name': { pattern: '(' }, 'git-add-all': true });
  const out = run(dir, 'git checkout -b x && git add -A');
  assert.equal(out.hookSpecificOutput?.permissionDecision, 'deny');
});

test('터진 것이 없으면 알림도 없다', () => {
  const dir = project({ 'branch-name': true }, 'en');
  const out = run(dir, 'git checkout -b feat/login');
  assert.deepEqual(out, {});
});
