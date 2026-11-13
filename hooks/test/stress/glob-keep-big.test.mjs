// 글롭 보호 경로 큰 폴더 시험(npm run test:stress, npm test 에도 든다): packages/p0…p299/dist 처럼 흔한 이름 도구 폴더가
// 300개인 폴더를 지울 때 git 을 폴더마다 부르지 않는지(세 번째 검토 2026-11-12: 폴더마다 부르던 때 26.5초) — 막음·통과가 맞고 시간 한도 안인지.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HOOK, makeRepo, gitIn, runEntry, timed, assertFast, idleRun, spread } from '../helpers/hook-proc.mjs';

const RUN = HOOK('run.mjs');
const N = 300;
const RULES = { 'protected-files': { paths: ['kubeconfig*'] } };
const put = (d, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true });
  fs.writeFileSync(path.join(d, rel), text);
};
let tmp;
const times = [];
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-globkeep-big-')); });
after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

// 무시하는 dist 300개 안에 빌드 결과(kubeconfig-x.js)만. more(d): 사례마다 더 넣는 것
const bigRepo = (name, more = () => {}) => {
  const d = makeRepo(path.join(tmp, name), RULES);
  put(d, '.gitignore', 'dist/\n');
  for (let i = 0; i < N; i++) put(d, `packages/p${i}/dist/kubeconfig-x.js`, 'x\n');
  more(d);
  return d;
};
const CASES = [
  ['pass', '무시하는 dist 300개 안 빌드 결과만', () => {}],
  ['block', '마지막 dist 안 파일은 git 이 추적한다(add -f)', (d) => gitIn(d, 'add', '-f', `packages/p${N - 1}/dist/kubeconfig-x.js`)],
  ['block', 'dist 밖의 진짜 kubeconfig', (d) => put(d, 'packages/p150/kubeconfig.yaml', 'x\n')],
];

describe('글롭 보호 경로 — 큰 폴더 지우기', { concurrency: false }, () => {
  CASES.forEach(([want, why, more], i) => {
    test(`${want}: ${why}`, async () => {
      const d = bigRepo(`r${i}`, more);
      const input = JSON.stringify({ tool_name: 'Bash', cwd: d, tool_input: { command: 'rm -rf packages' } });
      const r = await timed(() => runEntry(RUN, input, { cwd: d }), { idle: idleRun(RUN, tmp) });
      times.push(r.ms);
      const j = JSON.parse(r.stdout || '{}');
      assert.equal(j.systemMessage, undefined, r.stdout);
      assert.equal(j.hookSpecificOutput?.permissionDecision === 'deny', want === 'block', `${why}: ${r.stdout}`);
      assertFast(r, why);
    });
  });
  test('걸린 시간(진단)', (t) => t.diagnostic(spread(times)));
});
