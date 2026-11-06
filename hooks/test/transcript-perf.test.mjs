// 대화 기록 읽기(hooks/lib/transcript.mjs)의 빠르기·결과 시험.
// 끝낼 때(Stop) 훅이 기록을 한 번만 읽는지: 사람 메시지가 64MB 밖에 있는 아주 큰 기록(가장 많이 읽는 경우)을
// 진입점(hooks/stop.mjs)으로 돌려 시간을 잰다. 훅 시간 한도(15초)보다 한참 짧아야 한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readTurnTail, humanTurn, finalTexts } from '../lib/transcript.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MB = 1024 * 1024;
const BUDGET_MS = Number(process.env.HARNESS_STOP_BUDGET_MS || 6000);

const line = (r) => JSON.stringify(r) + '\n';
const prompt = (text) => line({ type: 'user', message: { role: 'user', content: text }, timestamp: new Date(Date.now() - 60000).toISOString() });
const say = (text) => line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] }, timestamp: new Date().toISOString() });
const bash = (command) => line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } });
const result = (text) => line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: text }] } });
// 다른 꼴의 기록(요약·첨부 등) — 읽을 필요가 없는 줄
const other = (text) => line({ type: 'attachment', attachment: { text } });

let tmp;
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-tperf-')); });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('여러 덩이로 나눠 읽어도 사람 턴·마지막 답이 같다', () => {
  // 사람 메시지가 끝 4MB 밖에 있어 덩이를 더 읽어야 하는 기록. 줄이 덩이 경계에 걸친다.
  const filler = (say('가'.repeat(3000)) + result('x'.repeat(5000)) + other('y'.repeat(4000))).repeat(Math.ceil((6 * MB) / 20000));
  const f = path.join(tmp, 'chunks.jsonl');
  fs.writeFileSync(f, prompt('옛 질문') + say('옛 답') + prompt('해 주세요') + bash('git commit -m x') + filler + say('중간') + bash('npm test') + say('끝났어요'));
  const tail = readTurnTail(f);
  const turn = humanTurn(tail);
  assert.deepEqual(turn.commands, ['git commit -m x', 'npm test']);
  assert.equal(turn.texts.at(-1).text, '끝났어요');
  assert.ok(!turn.texts.some((x) => x.text === '옛 답'));
  assert.deepEqual(finalTexts(tail), ['끝났어요']);
  // 경로를 그대로 넘겨도 된다
  assert.deepEqual(finalTexts(f), ['끝났어요']);
  assert.deepEqual(humanTurn(f).commands, turn.commands);
});

test('아주 큰 기록(사람 메시지가 64MB 밖)에서도 끝낼 때 훅이 금방 끝난다', async (t) => {
  const repo = path.join(tmp, 'repo');
  const home = path.join(tmp, 'home');
  fs.mkdirSync(home);
  fs.mkdirSync(repo);
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  fs.mkdirSync(path.join(repo, '.claude'));
  fs.writeFileSync(path.join(repo, '.claude', 'harness.json'), JSON.stringify({ lang: 'ko', rules: { 'commit-hash': true, 'answer-lang': true, 'docs-check': true } }));
  const chunk = (bash('ls') + result('파일 '.repeat(2000)) + say('계속 볼게요 '.repeat(300)) + other('z'.repeat(3000))).repeat(200);
  const f = path.join(tmp, 'huge.jsonl');
  const fd = fs.openSync(f, 'w');
  fs.writeSync(fd, prompt('해 주세요'));
  while (fs.fstatSync(fd).size < 72 * MB) fs.writeSync(fd, chunk);
  fs.writeSync(fd, say('다 했어요'));
  fs.closeSync(fd);
  const t0 = performance.now();
  const r = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'hooks', 'stop.mjs')], { cwd: repo, env: { ...process.env, HOME: home, USERPROFILE: home } });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('close', (status) => resolve({ status, out }));
    child.stdin.end(JSON.stringify({ session_id: 's', cwd: repo, transcript_path: f }));
  });
  const ms = performance.now() - t0;
  t.diagnostic(`Stop 72MB 기록: ${ms.toFixed(0)}ms`);
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.out), {});
  assert.ok(ms < BUDGET_MS, `${ms.toFixed(0)}ms (한도 ${BUDGET_MS}ms)`);
});
