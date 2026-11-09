// 고르기 화면은 기존 훅 시험을 기다리지 않고 먼저 뜬다(2026-11-06 — 이 PC 에서 시험이 14.5초).
// 그동안 /api/state 는 hooksPending, /api/existing 은 시험이 끝난 뒤의 상태를 주고, 화면은 적용을 막는다(frame.js applyBlock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDir, gitInit } from './helpers.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyBlock } from '../../picker/frame.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

test('적용 막기: 기존 훅을 확인하는 중이면 다른 까닭보다 먼저 막는다', () => {
  const S = (pending) => ({ detected: { existing: { hooksPending: pending } } });
  const ui = { preview: { changes: [] }, previewStale: false };
  const sel = { flow: 'none', share: false };
  assert.equal(applyBlock({ S: S(true), sel, ui }), 'applyNeedExisting');
  assert.equal(applyBlock({ S: S(false), sel, ui }), null);
  assert.equal(applyBlock({ S: { detected: { existing: {} } }, sel, ui: { preview: null } }), 'applyNeedPreview');
});

test('고르기 서버: 시험이 끝나기 전에 주소를 내고, /api/existing 은 끝난 뒤 결과를 준다', async () => {
  const home = tmpDir('harness-pk-home-');
  const repo = tmpDir('harness-pk-repo-');
  let child;
  try {
    gitInit(repo);
    // 느린 기존 훅(부를 때마다 0.1초 더): git add -A·. 만 막는다
    const hook = path.join(home, 'slow-add-all.cjs');
    fs.writeFileSync(hook, "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>setTimeout(()=>{const c=JSON.parse(s).tool_input.command||'';process.exit(/git add (-A|\\.)(\\s|$)/.test(c)?2:0)},100))");
    fs.mkdirSync(path.join(home, '.claude'));
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `node "${hook.split(path.sep).join('/')}"` }] }] } }));
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CONFIG_DIR; // 설정 폴더도 임시 홈 아래로(hooks/lib/claude-home.mjs)
    const t0 = performance.now();
    child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'picker.mjs'), repo, '--lang', 'ko', '--no-open'], { env, windowsHide: true });
    child.stdout.resume();
    const url = await new Promise((resolve, reject) => {
      let err = '';
      child.stderr.on('data', (d) => {
        err += d;
        const m = err.match(/http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]+/);
        if (m) resolve(m[0]);
      });
      child.on('exit', () => reject(new Error(`picker 가 끝났다: ${err}`)));
    });
    const shownMs = performance.now() - t0;
    const u = new URL(url);
    const get = async (p) => (await fetch(`${u.origin}${p}`, { headers: { 'X-Harness-Token': u.searchParams.get('t') } })).json();
    const first = await get('/api/state');
    assert.equal(first.detected.existing.hooksPending, true, '화면이 뜰 때는 아직 시험 중');
    assert.deepEqual(first.detected.existing.hooks, {});
    const done = await get('/api/existing?lang=en');
    const doneMs = performance.now() - t0;
    assert.equal(done.lang, 'en');
    assert.equal(done.detected.existing.hooksPending, false);
    assert.deepEqual(Object.keys(done.detected.existing.hooks), ['git-add-all']);
    // 「이미 쓰고 있는 훅」 창이 쓰는 것: 훅마다 짧은 이름·적힌 곳, 시험이 무엇을 막았는지 한 줄(명령 전체·경로는 보내지 않는다)
    assert.deepEqual(done.detected.existing.hooks['git-add-all'].from, [{ label: 'slow-add-all.cjs', scope: 'user', plugin: null }]);
    assert.ok(!JSON.stringify(done.detected.existing.hooks).includes(home.split(path.sep).join('/')), '훅 결과에 홈 경로가 실렸다');
    assert.match(done.probeSaid['git-add-all'], /git add -A/);
    assert.ok(shownMs < doneMs, `주소 ${shownMs.toFixed(0)}ms · 시험 끝 ${doneMs.toFixed(0)}ms`);
    // 끝난 뒤의 /api/state 도 결과를 갖는다
    assert.equal((await get('/api/state')).detected.existing.hooksPending, false);
    await fetch(`${u.origin}/api/cancel`, { method: 'POST', headers: { 'X-Harness-Token': u.searchParams.get('t'), 'Content-Type': 'application/json' }, body: '{}' });
  } finally {
    child?.kill();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
