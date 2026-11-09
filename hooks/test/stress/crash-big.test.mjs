// 큰 입력 시험(npm run test:stress, npm test 에도 든다): 10MB·50MB 명령·쓰기를 진짜 진입점 hooks/run.mjs 로 하나씩 돌려
// 터지지 않고(종료 코드 0, JSON 하나, 오류 흔적 없음) 기대대로이며 한 번이 시간 한도 안에 끝나는지 본다.
// 하나씩: 10MB 입력을 여럿 함께 돌리면 서로 CPU·메모리를 뺏어 한 번의 시간을 제대로 잴 수 없다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { HOOK, STACK, makeRepo, runEntry, timed, assertFast, idleRun, spread, BUDGET_MS } from '../helpers/hook-proc.mjs';
import { bigCases } from '../crash-cases.mjs';

const RUN = HOOK('run.mjs');
let tmp;
let repo;
let idle;
const times = [];
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-crash-big-'));
  repo = makeRepo(path.join(tmp, 'repo'));
  const none = path.join(tmp, 'none');
  execFileSync('git', ['init', '-q', none]);
  idle = idleRun(RUN, none);
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const outcome = (r, label) => {
  assert.equal(r.status, 0, `${label}: 종료 코드 ${r.status} ${r.stderr.slice(0, 300)}`);
  assert.doesNotMatch(r.stderr, STACK, `${label}: 오류 흔적 ${r.stderr.slice(0, 300)}`);
  const j = JSON.parse(r.stdout);
  assertFast(r, label);
  if (j.hookSpecificOutput?.permissionDecision === 'deny') return 'block';
  if (typeof j.systemMessage === 'string') return 'notice';
  assert.deepEqual(j, {}, `${label}: 막지 않을 때는 {} 만 ${r.stdout.slice(0, 200)}`);
  return 'pass';
};

test('10MB·50MB 명령·쓰기: 터지지 않고 시간 안에', async () => {
  const failures = [];
  for (const [label, stdin, want] of bigCases(repo)) {
    try {
      const raw = JSON.stringify({ cwd: repo, ...stdin });
      const r = await timed(() => runEntry(RUN, raw, { cwd: repo }), { idle });
      times.push(r.ms);
      const got = outcome(r, label);
      if (want !== 'any') assert.equal(got, want, `${label}: ${want} 이어야 함`);
    } catch (e) {
      failures.push(e.message);
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('걸린 시간(진단)', (t) => {
  t.diagnostic(`${spread(times)} budget=${BUDGET_MS}ms`);
  assert.ok(times.length > 0);
});
