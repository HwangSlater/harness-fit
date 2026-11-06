// catalog/probes.json 의 시험 입력이 맞는지: harness-fit 훅 자신이 block 은 막고 pass 는 통과시켜야 한다.
// 이게 틀리면 기존 훅과 겹치는지 알아보는 일(scripts/lib/existing-hooks.mjs)이 엉뚱한 답을 낸다.
// (2026-11-05: 시험용 토큰이 한 글자 짧아 비밀값 훅이 못 잡던 일 — 이 시험이 그런 실수를 잡는다)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluate } from '../../hooks/lib/evaluate.mjs';
import { makeProbeRepo, probeExistingHooks } from '../lib/existing-hooks.mjs';
import { loadAll } from '../lib/catalog.mjs';
import { ownSpace, eventInput } from '../lib/probe-run.mjs';

const all = loadAll();
const probes = JSON.parse(fs.readFileSync(new URL('../../catalog/probes.json', import.meta.url), 'utf8'));
const ids = Object.keys(probes).filter((k) => !k.startsWith('_'));
// 브랜치 방식이 넣는 옵션(보호 브랜치 목록·이름 모양)은 GitHub Flow 값으로
const flowOpts = all.packs.flows.find((f) => f.id === 'github-flow')?.hooks || {};

test('훅마다 시험 입력이 있다', () => {
  for (const h of all.packs.hooks) assert.ok(probes[h.id]?.block?.length && probes[h.id]?.pass?.length, `시험 입력 없음: ${h.id}`);
});

// 도구 호출 시험만 여기서(Stop 등·저장소 준비가 있는 시험은 hooks/test/strict.test.mjs 가 실제 진입점으로 본다)
test('harness-fit 훅은 시험 입력의 block 을 막고 pass 를 통과시킨다(도구 호출)', () => {
  const dir = makeProbeRepo();
  try {
    fs.mkdirSync(path.join(dir, '.claude'));
    for (const id of ids) {
      fs.writeFileSync(path.join(dir, '.claude', 'harness.json'), JSON.stringify({ lang: 'ko', rules: { [id]: flowOpts[id] || true } }));
      for (const [want, list] of [['block', probes[id].block], ['pass', probes[id].pass]]) {
        for (const p of list.filter((x) => !ownSpace(x))) {
          const msgs = evaluate(eventInput(p, { dir, vars: { probe: dir.split(path.sep).join('/') } }));
          assert.equal(msgs.length > 0, want === 'block', `${id} ${want}: ${JSON.stringify(p.tool_input).slice(0, 80)} → ${msgs.join(' / ') || '통과'}`);
        }
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// exec 꼴(command + args, 셸 없음)로 적힌 기존 훅도 실제로 돌려 본다 — 띄어쓰기·한글이 든 경로도 따옴표 없이
test('기존 훅: exec 꼴(args) 훅도 시험하고, 이름은 args 의 스크립트에서 딴다', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-home 홈 '));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-root-'));
  try {
    const f = path.join(home, 'add-all.mjs');
    fs.writeFileSync(f, "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const c=JSON.parse(s).tool_input.command||'';process.exit(/git add (-A|\\.)(\\s|$)/.test(c)?2:0)})");
    fs.mkdirSync(path.join(home, '.claude'));
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: process.execPath, args: [f] }] }] } }));
    const got = await probeExistingHooks(root, { home, trustProject: true });
    assert.deepEqual(Object.keys(got), ['git-add-all'], JSON.stringify(got));
    assert.deepEqual(got['git-add-all'].by, ['add-all.mjs']);
  } finally {
    fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true });
  }
});

// 가짜 「기존 훅」을 settings 에 두고, 같은 일을 하는 것만 겹친다고 보는지
test('기존 훅: 같은 일을 하면 겹침, 다른 이유로 다 막는 훅은 겹침 아님', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-home-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-root-'));
  try {
    const script = (name, body) => { const f = path.join(home, name); fs.writeFileSync(f, body); return `node "${f.split(path.sep).join('/')}"`; };
    // git add -A·. 만 막는 훅(전역) / 모든 셸 명령을 막는 훅(프로젝트)
    const addAll = script('add-all.mjs', "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const c=JSON.parse(s).tool_input.command||'';process.exit(/git add (-A|\\.)(\\s|$)/.test(c)?2:0)})");
    const blockAll = script('block-all.mjs', "process.stdin.resume();process.stdin.on('end',()=>process.exit(2))");
    fs.mkdirSync(path.join(home, '.claude')); fs.mkdirSync(path.join(root, '.claude'));
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: addAll }] }] } }));
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: blockAll }] }] } }));
    const got = await probeExistingHooks(root, { home, trustProject: true });
    assert.deepEqual(Object.keys(got), ['git-add-all'], JSON.stringify(got));
    assert.equal(got['git-add-all'].scope, 'user');
    assert.deepEqual(got['git-add-all'].by, ['add-all.mjs']);
    // Claude Code 밖(폴더를 믿는다고 하기 전)에서는 저장소 쪽 훅을 돌리지 않는다
    const marker = path.join(root, 'ran.txt');
    const touch = script('touch.mjs', `require('fs').writeFileSync(${JSON.stringify(marker)}, '1')`);
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: touch }] }] } }));
    await probeExistingHooks(root, { home, trustProject: false });
    assert.ok(!fs.existsSync(marker), '믿지 않은 저장소의 훅이 돌았다');
  } finally {
    fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true });
  }
});

