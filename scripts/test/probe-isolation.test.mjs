// 기존 훅 시험(scripts/lib/probe-run.mjs · existing-hooks.mjs)이 사용자 홈·설정 폴더를 건드리지 않는지,
// 명령 속 홈 경로(~ · $HOME · %USERPROFILE% …)를 실제 경로로 펼쳐 스크립트를 찾는지, 시간이 넘은 훅을 손자까지 끝내는지 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { runProbeCase, expandHomeRefs, probeExistingHooks } from '../lib/existing-hooks.mjs';
import { runCommand, spaceEnv, makeHome } from '../lib/probe-run.mjs';

// 겹침 시험은 git-add-all 시험 입력만(다른 시험 파일과 함께 돌 때 PC 를 덜 바쁘게)
const probes = JSON.parse(fs.readFileSync(new URL('../../catalog/probes.json', import.meta.url), 'utf8'));
const tmpDir = (p) =>fs.mkdtempSync(path.join(os.tmpdir(), p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('시험은 도구·Stop 어느 때든 홈과 APPDATA·XDG·CLAUDE_CONFIG_DIR 를 임시 폴더로 바꿔 돌린다', async () => {
  const name = `harness-probe-leak-${crypto.randomBytes(4).toString('hex')}.txt`;
  const work = tmpDir('harness-iso-');
  // 홈·설정 폴더마다 표시 파일을 쓰고 막는다(2) — 막혔으면 훅이 돌았고 쓰기도 됐다는 뜻
  const script = path.join(work, 'leak.cjs');
  fs.writeFileSync(script, `const fs=require('fs'),os=require('os'),path=require('path');process.stdin.resume();process.stdin.on('end',()=>{
for (const d of [os.homedir(), process.env.HOME, process.env.USERPROFILE, process.env.APPDATA, process.env.LOCALAPPDATA, process.env.XDG_CONFIG_HOME, process.env.XDG_DATA_HOME, process.env.XDG_STATE_HOME, process.env.XDG_CACHE_HOME, process.env.CLAUDE_CONFIG_DIR]) {
  if (!d) process.exit(1);
  fs.writeFileSync(path.join(d, ${JSON.stringify(name)}), '1');
}
process.exit(2);});`);
  const real = [os.homedir(), process.env.APPDATA, process.env.LOCALAPPDATA, path.join(os.homedir(), '.claude'), path.join(os.homedir(), '.config'), process.env.CLAUDE_CONFIG_DIR, process.env.XDG_CONFIG_HOME]
    .filter(Boolean).map((d) => path.join(d, name));
  const repo = tmpDir('harness-iso-repo-');
  try {
    const hook = { command: `node "${script.split(path.sep).join('/')}"`, timeout: 20 };
    const cases = [{ tool_name: 'Bash', tool_input: { command: 'ls' } }, { event: 'Stop', transcript: [] }];
    for (const x of cases) {
      const [r] = await runProbeCase(x, [hook], { sharedDir: repo });
      assert.equal(r.blocked, true, `${x.event || 'PreToolUse'}: 훅이 돌지 않았거나 쓰기에 실패했다`);
    }
    for (const f of real) assert.ok(!fs.existsSync(f), `사용자 폴더에 시험 기록이 생겼다: ${f}`);
  } finally {
    for (const f of real) fs.rmSync(f, { force: true });
    fs.rmSync(work, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('spaceEnv: 대소문자만 다른 같은 이름의 변수는 남기지 않는다', () => {
  const home = makeHome();
  try {
    const env = spaceEnv({ dir: home, home });
    for (const k of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'CLAUDE_CONFIG_DIR', 'XDG_CONFIG_HOME']) {
      const same = Object.keys(env).filter((x) => x.toUpperCase() === k);
      assert.deepEqual(same, [k], k);
      assert.ok(env[k].startsWith(home), `${k}=${env[k]}`);
      assert.ok(fs.existsSync(env[k]), `${k} 폴더가 있다`);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('명령 속 홈 경로를 실제 홈으로 펼친다(셸 꼴·exec 꼴)', () => {
  const home = path.join(os.tmpdir(), 'my home');
  const sh = (c) => expandHomeRefs(c, null, home).command;
  assert.equal(sh('node ~/.claude/hooks/x.mjs'), `node "${home}/.claude/hooks/x.mjs"`, '빈칸이 든 홈은 따옴표로');
  assert.equal(sh('node "$HOME/.claude/x.mjs"'), `node "${home}/.claude/x.mjs"`);
  assert.equal(sh('node "${HOME}/x.mjs" --a'), `node "${home}/x.mjs" --a`);
  assert.equal(sh('node %USERPROFILE%\\x.mjs'), `node "${home}\\x.mjs"`);
  assert.equal(sh('pwsh -File $env:USERPROFILE\\x.ps1'), `pwsh -File "${home}\\x.ps1"`);
  assert.equal(sh("node '${HOME}/x.mjs'"), "node '${HOME}/x.mjs'", '작은따옴표 속은 그대로');
  assert.equal(sh('echo $HOMEBREW a~/b'), 'echo $HOMEBREW a~/b', '다른 변수·낱말 중간의 ~ 는 그대로');
  const plain = path.join(os.tmpdir(), 'h');
  assert.equal(expandHomeRefs('node ~/x.mjs', null, plain).command, `node ${plain}/x.mjs`, '빈칸 없으면 따옴표 없이');
  const ex = expandHomeRefs('~/bin/node', ['$HOME/x.mjs', '${USERPROFILE}\\y.mjs', '%HOME%/z', 'plain'], home);
  assert.deepEqual(ex, { command: `${home}/bin/node`, args: [`${home}/x.mjs`, `${home}\\y.mjs`, `${home}/z`, 'plain'] });
});

test('기존 훅: ~ · $HOME 로 적힌 스크립트도 찾아 겹침을 알아낸다(셸 꼴·exec 꼴)', async () => {
  const home = tmpDir('harness-home 홈 ');
  const root = tmpDir('harness-root-');
  try {
    fs.writeFileSync(path.join(home, 'add-all.mjs'), "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const c=JSON.parse(s).tool_input.command||'';process.exit(/git add (-A|\\.)(\\s|$)/.test(c)?2:0)})");
    fs.mkdirSync(path.join(home, '.claude'));
    for (const h of [{ type: 'command', command: 'node ~/add-all.mjs' }, { type: 'command', command: process.execPath, args: ['$HOME/add-all.mjs'] }]) {
      fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [h] }] } }));
      const got = await probeExistingHooks(root, { home, trustProject: false, probes: { 'git-add-all': probes['git-add-all'] } });
      assert.deepEqual(Object.keys(got), ['git-add-all'], `${JSON.stringify(h)} → ${JSON.stringify(got)}`);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true });
  }
});

test('시간이 넘은 훅은 손자 프로세스까지 끝내고, 출력은 256KB 까지만 모은다', async () => {
  const work = tmpDir('harness-kill-');
  try {
    const marker = path.join(work, 'grandchild-alive.txt');
    const late = `setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(marker)},'1'),2500)`;
    const parent = path.join(work, 'parent.cjs');
    fs.writeFileSync(parent, `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(late)}],{stdio:'ignore'});setInterval(()=>{},1000);`);
    const env = { ...process.env };
    const r = await runCommand(`node "${parent.split(path.sep).join('/')}"`, {}, { cwd: work, env, timeoutS: 1 });
    assert.equal(r.timedOut, true);
    await sleep(3500);
    assert.ok(!fs.existsSync(marker), '시간이 넘은 훅의 손자 프로세스가 살아 있었다');
    const loud = path.join(work, 'loud.cjs');
    fs.writeFileSync(loud, "process.stdout.write('a'.repeat(1024*1024));");
    const big = await runCommand(`node "${loud.split(path.sep).join('/')}"`, {}, { cwd: work, env, timeoutS: 20 });
    assert.equal(big.code, 0);
    assert.equal(big.out.length, 256 * 1024);
  } finally {
    await sleep(200);
    fs.rmSync(work, { recursive: true, force: true });
  }
});
