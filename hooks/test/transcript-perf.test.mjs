// 대화 기록 읽기(hooks/lib/transcript.mjs)의 결과 시험: 여러 덩이로 나눠 읽어도 같은 답인지.
// 72MB 기록을 진입점으로 돌려 시간을 재는 시험은 stress/transcript-big.test.mjs(npm run test:stress).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readTurnTail, humanTurn, finalTexts } from '../lib/transcript.mjs';

const MB = 1024 * 1024;

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
