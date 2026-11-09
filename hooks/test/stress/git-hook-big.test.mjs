// git pre-commit 훅 큰 커밋 시험(npm run test:stress, npm test 에도 든다): 10MB 파일 끝의 토큰, 40MB 파일, 파일 2000개를
// stage 한 저장소에서 본체(hooks/git-pre-commit.mjs)를 바로 돌려 막음·통과가 맞는지, 터지지 않는지, 시간 한도 안인지 본다.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FAKE } from '../strict-cases/helpers.mjs';
import { spread, BUDGET_MS } from '../helpers/hook-proc.mjs';
import { commitRepos, STACK, FOUND } from '../helpers/commit-repo.mjs';

// 커밋 한 번의 한도(git 을 여러 번 띄운다). 한도를 넘으면 두 번 더 재어 가장 빠른 값으로 본다.
const COMMIT_BUDGET_MS = Number(process.env.HARNESS_COMMIT_BUDGET_MS || 2 * BUDGET_MS);
const tokenLine = `export const token = "${FAKE.github}";\n`;
let tmp;
let h;
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-githook-big-'));
  h = commitRepos(tmp);
});
after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

const CASES = [
  ['block', '10MB 파일 끝의 토큰', (d) => { h.put(d, 'src/big.js', '// x\n'.repeat(2 * 1024 * 1024) + tokenLine); h.gitIn(d, 'add', 'src/big.js'); }],
  ['pass', '40MB 파일(한 번에 읽는 한도 32MB 를 넘어 보지 않지만 터지지 않는다)', (d) => { fs.mkdirSync(path.join(d, 'data')); fs.writeFileSync(path.join(d, 'data', 'huge.txt'), Buffer.alloc(40 * 1024 * 1024, 0x61)); h.gitIn(d, 'add', 'data/huge.txt'); }],
  ['block', '파일 2000개 가운데 하나의 토큰', (d) => {
    for (let i = 0; i < 2000; i++) h.put(d, `many/f${i}.js`, `export const v${i} = ${i};\n`);
    h.put(d, 'many/f1999.js', tokenLine);
    h.gitIn(d, 'add', 'many');
  }],
];

describe('큰 커밋', { concurrency: false }, () => {
  for (const [want, why, setup] of CASES) {
    test(`${want}: ${why}`, () => {
      const d = h.repo();
      setup(d);
      const from = h.times.length;
      let r = h.preCommit(d);
      for (let i = 1; i < 3 && h.times.at(-1) >= COMMIT_BUDGET_MS; i++) r = h.preCommit(d);
      const best = Math.min(...h.times.slice(from));
      assert.ok(r.status === 0 || r.status === 1, `훅 결과 ${r.status}: ${r.stderr}`);
      assert.doesNotMatch(r.stderr, STACK, r.stderr);
      if (want === 'block') {
        assert.equal(r.status, 1, r.stderr);
        assert.match(r.stderr, FOUND);
      } else assert.equal(r.status, 0, r.stderr);
      assert.ok(best < COMMIT_BUDGET_MS, `${why}: ${best.toFixed(0)}ms (한도 ${COMMIT_BUDGET_MS}ms)`);
    });
  }
  test('걸린 시간(진단)', (t) => t.diagnostic(spread(h.times)));
});
