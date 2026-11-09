// 아주 큰 대화 기록 시험(npm run test:stress, npm test 에도 든다): 끝낼 때(Stop) 훅 hooks/stop.mjs 를 진입점으로 돌려
// 줄바꿈 없는 10MB·큰 기록·80MB 기록에서 터지지 않고(종료 코드 0, JSON 하나, 오류 알림 없음),
// 사람 메시지가 64MB 밖에 있는 72MB 기록(가장 많이 읽는 경우)에서도 시간 한도 안에 끝나는지 본다. 하나씩 돈다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { HOOK, MB, STACK, packs, gitIn, runEntry, timed, assertFast, idleRun } from '../helpers/hook-proc.mjs';

const STOP = HOOK('stop.mjs');
// 훅 시간 한도(15초)보다 한참 짧아야 한다
const STOP_BUDGET_MS = Number(process.env.HARNESS_STOP_BUDGET_MS || 6000);

const line = (r) => JSON.stringify(r) + '\n';
const prompt = (text = '해 주세요') => line({ type: 'user', message: { role: 'user', content: text }, timestamp: new Date(Date.now() - 60000).toISOString() });
const say = (text) => line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] }, timestamp: new Date().toISOString() });
const bash = (command) => line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } });
const result = (text) => line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: text }] } });
const other = (text) => line({ type: 'attachment', attachment: { text } }); // 읽을 필요가 없는 줄

let tmp;
let home;
let idle;
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-tbig-'));
  home = path.join(tmp, 'home');
  fs.mkdirSync(home);
  const none = path.join(tmp, 'none');
  execFileSync('git', ['init', '-q', none]);
  idle = idleRun(STOP, none);
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const repoWith = (name, rules) => {
  const repo = path.join(tmp, name);
  fs.mkdirSync(repo);
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  gitIn(repo, 'config', 'user.email', 't@example.com');
  gitIn(repo, 'config', 'user.name', 't');
  fs.mkdirSync(path.join(repo, '.claude'));
  fs.writeFileSync(path.join(repo, '.claude', 'harness.json'), JSON.stringify({ lang: 'ko', rules }));
  return repo;
};
const stop = (repo, file, budget) =>
  timed(() => runEntry(STOP, JSON.stringify({ session_id: 's', cwd: repo, transcript_path: file }), { cwd: repo, env: { ...process.env, HOME: home, USERPROFILE: home } }), { idle, budget });
const ok = (r, label, budget) => {
  assert.equal(r.status, 0, `${label}: 종료 코드 ${r.status} ${r.stderr.slice(0, 300)}`);
  assert.doesNotMatch(r.stderr, STACK, `${label}: 오류 흔적 ${r.stderr.slice(0, 300)}`);
  assertFast(r, label, budget);
  const j = JSON.parse(r.stdout);
  assert.equal(j.systemMessage, undefined, `${label}: 오류 알림 ${r.stdout.slice(0, 300)}`);
  return j;
};

test('줄바꿈 없는 10MB·큰 기록·80MB 기록에서 터지지 않는다(모든 훅을 켬)', async () => {
  const repo = repoWith('all', Object.fromEntries(packs.hooks.map((h) => [h.id, true])));
  const write = (name, text) => { const f = path.join(tmp, name); fs.writeFileSync(f, text); return f; };
  const failures = [];
  for (const [label, file] of [
    ['줄바꿈 없는 10MB', write('one-line.jsonl', 'x'.repeat(10 * MB))],
    ['큰 기록', write('big.jsonl', prompt() + say('a '.repeat(2 * MB)) + bash('git commit -m x && '.repeat(5000)) + say('the '.repeat(MB)))],
    ['80MB 기록', write('huge.jsonl', prompt() + say('가'.repeat(1000)).repeat(80000))],
  ]) {
    try {
      ok(await stop(repo, file), `stop · ${label}`);
    } catch (e) {
      failures.push(e.message);
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('아주 큰 기록(사람 메시지가 64MB 밖)에서도 끝낼 때 훅이 금방 끝난다', async (t) => {
  const repo = repoWith('stop3', { 'commit-hash': true, 'answer-lang': true, 'docs-check': true });
  const chunk = (bash('ls') + result('파일 '.repeat(2000)) + say('계속 볼게요 '.repeat(300)) + other('z'.repeat(3000))).repeat(200);
  const f = path.join(tmp, 'huge72.jsonl');
  const fd = fs.openSync(f, 'w');
  fs.writeSync(fd, prompt());
  while (fs.fstatSync(fd).size < 72 * MB) fs.writeSync(fd, chunk);
  fs.writeSync(fd, say('다 했어요'));
  fs.closeSync(fd);
  const r = await stop(repo, f, STOP_BUDGET_MS);
  t.diagnostic(`Stop 72MB 기록: ${r.ms.toFixed(0)}ms (빈 호출을 뺀 값 ${r.net.toFixed(0)}ms)`);
  assert.deepEqual(ok(r, 'Stop 72MB', STOP_BUDGET_MS), {});
});
