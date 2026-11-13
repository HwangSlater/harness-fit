// 기존 훅 겹침 시험 결과 캐시(scripts/lib/probe-cache.mjs): 담아 둔 결과가 새로 시험한 결과와 같은지,
// 훅이 끌어오는 파일이 바뀌면 다시 시험하는지, 깨진 캐시는 빈 것으로 보는지, 시간이 넘은 시험은 담지 않는지.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from './helpers.mjs';
import { probeExistingHooks, listHooks } from '../lib/existing-hooks.mjs';
import { probeCacheFile, probeCacheKey } from '../lib/probe-cache.mjs';

// 시험 입력은 git-add-all 만(다른 시험 파일과 함께 돌 때 PC 를 덜 바쁘게)
const all = JSON.parse(fs.readFileSync(new URL('../../catalog/probes.json', import.meta.url), 'utf8'));
const probes = { 'git-add-all': all['git-add-all'] };
const ADD_ALL = "module.exports=(c)=>/git add (-A|\\.)(\\s|$)/.test(c);";

// 임시 홈에 훅 하나(판정은 lib/rule.cjs 가 — 끌어오는 파일이 바뀌는지 보려고). 돌 때마다 runs 파일에 한 글자 붙인다.
const setup = (rule = ADD_ALL, { timeout } = {}) => {
  const home = tmpDir('harness-cache-home-');
  const root = tmpDir('harness-cache-root-');
  const runs = path.join(home, 'runs.txt');
  fs.mkdirSync(path.join(home, 'hooks', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(home, 'hooks', 'lib', 'rule.cjs'), rule);
  const script = path.join(home, 'hooks', 'guard.cjs');
  fs.writeFileSync(script, `const fs=require('fs');let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{fs.appendFileSync(${JSON.stringify(runs)},'x');` +
    "const c=JSON.parse(s).tool_input.command||'';process.exit(require('./lib/rule.cjs')(c)?2:0)})");
  fs.mkdirSync(path.join(home, '.claude'));
  const hook = { type: 'command', command: `node "${script.split(path.sep).join('/')}"`, ...(timeout ? { timeout } : {}) };
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [hook] }] } }));
  const count = () => (fs.existsSync(runs) ? fs.readFileSync(runs, 'utf8').length : 0);
  const done = () => { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); };
  return { home, root, count, done, rulePath: path.join(home, 'hooks', 'lib', 'rule.cjs') };
};
const probe = (s, cache = true) => probeExistingHooks(s.root, { home: s.home, trustProject: false, probes, cache });

test('캐시: 담아 둔 결과는 새로 시험한 결과와 같고, 두 번째부터는 훅을 돌리지 않는다', async () => {
  const s = setup();
  try {
    const fresh = await probe(s, false);
    assert.deepEqual(Object.keys(fresh), ['git-add-all'], JSON.stringify(fresh));
    assert.ok(!fs.existsSync(probeCacheFile(s.home)), 'cache: false 는 캐시를 쓰지 않는다');
    const first = await probe(s);
    assert.deepEqual(first, fresh);
    assert.ok(fs.existsSync(probeCacheFile(s.home)), '캐시 파일은 설정 폴더의 harness-fit 아래');
    const ran = s.count();
    const second = await probe(s);
    assert.deepEqual(second, fresh);
    assert.equal(s.count(), ran, '캐시가 맞는데 훅을 다시 돌렸다');
    const saved = fs.readFileSync(probeCacheFile(s.home), 'utf8');
    assert.ok(!saved.includes('git add') && !saved.includes(s.home.split(path.sep).join('/')), '캐시에 시험 입력·명령 경로가 담겼다');
  } finally {
    s.done();
  }
});

test('캐시: 훅이 끌어오는 파일(require 한 lib)이 바뀌면 다시 시험한다', async () => {
  const s = setup();
  try {
    assert.deepEqual(Object.keys(await probe(s)), ['git-add-all']);
    fs.writeFileSync(s.rulePath, 'module.exports=()=>false;'); // 이제 아무것도 막지 않는다
    const ran = s.count();
    assert.deepEqual(await probe(s), {}, '바뀐 훅인데 옛 결과를 썼다');
    assert.ok(s.count() > ran, '다시 시험하지 않았다');
    const entries = JSON.parse(fs.readFileSync(probeCacheFile(s.home), 'utf8')).entries;
    assert.equal(entries.length, 2, '열쇠마다 하나씩');
  } finally {
    s.done();
  }
});

test('캐시: 깨진 파일·꼴이 틀린 항목은 빈 캐시로 보고 다시 시험해 고쳐 쓴다', async () => {
  const s = setup();
  try {
    const file = probeCacheFile(s.home);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"v":1,"entries":[{"key":');
    assert.deepEqual(Object.keys(await probe(s)), ['git-add-all']);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).entries.length, 1, '깨진 파일을 고쳐 쓰지 않았다');
    // 열쇠는 맞지만 결과 꼴이 틀린 항목(남이 고친 파일)
    const hooks = listHooks(s.root, s.home).filter((h) => h.scope === 'user');
    const key = await probeCacheKey(hooks, probes);
    fs.writeFileSync(file, JSON.stringify({ v: 1, entries: [{ key, at: Date.now(), result: { 'git-add-all': { scope: 'user', by: 'x' } } }] }));
    const ran = s.count();
    assert.deepEqual(Object.keys(await probe(s)), ['git-add-all']);
    assert.ok(s.count() > ran, '꼴이 틀린 항목을 그대로 썼다');
    // 오래된 항목도 쓰지 않는다
    const old = JSON.parse(fs.readFileSync(file, 'utf8'));
    old.entries[0].at = Date.now() - 30 * 86400000;
    old.entries[0].result = {};
    fs.writeFileSync(file, JSON.stringify(old));
    assert.deepEqual(Object.keys(await probe(s)), ['git-add-all'], '오래된 항목을 썼다');
  } finally {
    s.done();
  }
});

test('캐시: 시간이 넘은 훅이 있던 시험은 담지 않는다', async () => {
  const s = setup("module.exports=()=>{const t=Date.now()+3000;while(Date.now()<t);return false;};", { timeout: 1 });
  try {
    assert.deepEqual(await probe(s), {});
    assert.ok(!fs.existsSync(probeCacheFile(s.home)), '시간이 넘은 결과를 담았다');
  } finally {
    s.done();
  }
});
