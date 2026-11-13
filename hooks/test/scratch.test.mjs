// stale-scratch: 하루 한 번만 알리고, 본 날은 Temp 자리마다 따로 적는다(엄격 사례는 strict-cases/events.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { staleScratch } from '../rules/scratch.mjs';
import { buildScratch } from '../../scripts/lib/probe-run.mjs';
import { translator } from '../lib/core.mjs';

const t = translator('en');
const VENV = [{ dir: '0123456789abcdef/old/scratchpad/venv', files: ['pyvenv.cfg'], days: 5 }];

// TEMP·설정 폴더를 시험 폴더로 돌려 놓고 fn 을 부른다
const withTemp = (fn) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-scratch-'));
  const keep = ['TEMP', 'TMP', 'TMPDIR', 'CLAUDE_CONFIG_DIR'].map((k) => [k, process.env[k]]);
  const use = (name) => {
    const tmp = path.join(base, name);
    fs.mkdirSync(tmp, { recursive: true });
    Object.assign(process.env, { TEMP: tmp, TMP: tmp, TMPDIR: tmp });
    return path.join(tmp, 'claude');
  };
  process.env.CLAUDE_CONFIG_DIR = path.join(base, 'config');
  try {
    fn(use);
  } finally {
    for (const [k, v] of keep) v === undefined ? delete process.env[k] : (process.env[k] = v);
    fs.rmSync(base, { recursive: true, force: true });
  }
};
const run = () => staleScratch.check({ input: { session_id: 'now' }, t });

test('같은 날 두 번째 세션 시작에는 알리지 않고, 다른 Temp 자리는 따로 센다', () => {
  withTemp((use) => {
    buildScratch(use('a'), VENV);
    assert.match(run(), /Python venv/);
    assert.equal(run(), null);
    buildScratch(use('b'), VENV);
    assert.match(run(), /Python venv/);
  });
});

test('본 날이 어제면 다시 본다', () => {
  withTemp((use) => {
    buildScratch(use('a'), VENV);
    assert.ok(run());
    const dir = path.join(process.env.CLAUDE_CONFIG_DIR, 'harness-fit', 'stale-scratch');
    for (const f of fs.readdirSync(dir)) fs.writeFileSync(path.join(dir, f), '2000-01-01');
    assert.ok(run());
  });
});

test('무거운 것이 6개 넘으면 5개까지 보이고 남은 수를 적는다', () => {
  withTemp((use) => {
    buildScratch(use('a'), Array.from({ length: 7 }, (_, k) => ({ dir: `0123456789abcdef/s${k}/scratchpad/venv`, files: ['pyvenv.cfg'], days: 5 })));
    const out = run();
    assert.equal(out.match(/\(Python venv\)/g).length, 5);
    assert.match(out, /and 2 more/);
  });
});
