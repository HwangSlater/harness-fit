// 터짐·느림 시험(2026-11-06 사용자 요청): 진짜 진입점 hooks/run.mjs 를 자식 프로세스로 돌려
// 깨진 stdin(JSON 아님·깊은 중첩·깨진 UTF-8 바이트), 모양이 다른 입력, 이상한 환경, 깨진 설정에서
//   1) 터지지 않는다 — 종료 코드 0, stdout 은 {} · 막음(deny) · 알림(systemMessage) 중 하나인 JSON, stderr 에 오류 흔적 없음
//   2) 쓰레기 입력은 막지 않는다(진짜 위반만 막는다)
//   3) 한 번이 시간 한도(BUDGET_MS) 안에 끝난다 — 다른 시험과 함께 돌 때의 느림은 helpers/hook-proc.mjs timed 가 거른다
// 를 본다. 모든 훅을 켠 저장소에서 돈다. 걸린 시간의 p50·p95·최대는 진단 줄로 남긴다.
// 프로세스가 아니라 판정을 보는 사례(모양·환경·ReDoS 수백 개)는 crash-inproc.test.mjs, 10MB 이상은 stress/crash-big.test.mjs(npm run test:stress).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { FAKE } from './strict-cases/helpers.mjs';
import { HOOK, MB, STACK, SHELLS, ALL_RULES, makeRepo, gitIn, runEntry, timed, assertFast, idleRun, spread, BUDGET_MS } from './helpers/hook-proc.mjs';
import { input, big, N } from './crash-cases.mjs';

const RUN = HOOK('run.mjs');
const PARALLEL = 4;

let tmp;
let repo;
let idle;
const times = [];
const slowest = []; // [ms, 사례 이름]
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-crash-'));
  repo = makeRepo(path.join(tmp, 'repo'));
  const none = path.join(tmp, 'none');
  execFileSync('git', ['init', '-q', none]);
  idle = idleRun(RUN, none);
});
after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

// 동시에 PARALLEL 개까지
let busy = 0;
const waiting = [];
const slot = async (job) => {
  if (busy >= PARALLEL) await new Promise((r) => waiting.push(r));
  busy++;
  try {
    return await job();
  } finally {
    busy--;
    waiting.shift()?.();
  }
};

// 결과 → 'pass' | 'block' | 'notice'. 터진 흔적·이상한 출력·시간 초과면 실패.
const outcome = (r, label) => {
  assert.equal(r.status, 0, `${label}: 종료 코드 ${r.status} ${r.stderr.slice(0, 300)}`);
  assert.doesNotMatch(r.stderr, STACK, `${label}: 오류 흔적 ${r.stderr.slice(0, 300)}`);
  let j;
  try {
    j = JSON.parse(r.stdout);
  } catch {
    assert.fail(`${label}: stdout 이 JSON 이 아님 ${JSON.stringify(r.stdout.slice(0, 200))}`);
  }
  assertFast(r, label);
  if (j.hookSpecificOutput?.permissionDecision === 'deny') {
    assert.equal(typeof j.hookSpecificOutput.permissionDecisionReason, 'string');
    return 'block';
  }
  if (typeof j.systemMessage === 'string') return 'notice';
  assert.deepEqual(j, {}, `${label}: 막지 않을 때는 {} 만 ${r.stdout.slice(0, 200)}`);
  return 'pass';
};

// 사례: [이름, stdin(글·Buffer·객체), 기대('pass'|'block'|'notice'|'any'), 선택: { cwd, env }]
const runCase = async ([label, stdin, want, opts = {}]) => {
  const raw = Buffer.isBuffer(stdin) || typeof stdin === 'string' ? stdin : JSON.stringify({ cwd: opts.cwd ?? repo, ...stdin });
  const r = await slot(() => timed(() => runEntry(RUN, raw, { cwd: opts.cwd ?? repo, env: opts.env }), { idle }));
  times.push(r.ms);
  slowest.push([r.ms, label]);
  const got = outcome(r, label);
  if (want !== 'any') assert.equal(got, want, `${label}: ${want} 이어야 함`);
};
const group = (title, cases) =>
  test(title, async () => {
    const failures = [];
    await Promise.all((typeof cases === 'function' ? cases() : cases).map((c) => runCase(c).catch((e) => failures.push(e.message))));
    assert.deepEqual(failures, [], failures.join('\n'));
  });

describe('깨진 입력', { concurrency: true }, () => {
  group('JSON 이 아니거나 모양이 다른 stdin 은 그냥 통과', () => [
    ['빈 입력', '', 'pass'],
    ['JSON 아님', 'not json at all', 'pass'],
    ['반쯤 끊긴 JSON', '{"tool_name":"Bash","tool_input":{"command":"rm -rf ~"', 'pass'],
    ['배열', '[1,2,3]', 'pass'],
    ['숫자', '42', 'pass'],
    ['null', 'null', 'pass'],
    ['글자', '"rm -rf ~"', 'pass'],
    ['참거짓', 'true', 'pass'],
    ['빈 객체', '{}', 'pass'],
    ['BOM 이 앞에 붙은 JSON', '\uFEFF' + JSON.stringify(input('Bash', { command: 'ls' })), 'pass'],
    ['아주 깊은 중첩(10만 겹)', '['.repeat(1e5) + ']'.repeat(1e5), 'pass'],
    ['아주 깊은 중첩 객체', JSON.stringify({ tool_name: 'Bash', cwd: repo }).slice(0, -1) + ',"tool_input":' + '{"a":'.repeat(5e4) + '1' + '}'.repeat(5e4) + '}', 'pass'],
  ]);
  // 모양 사례 전부는 crash-inproc.test.mjs — 여기는 진입점이 입력을 고르는지(readInput)만 몇 개
  group('tool_name·tool_input 모양이 다름(대표)', () => [
    ['tool_name 이 숫자', { tool_name: 7, tool_input: { command: 'rm -rf ~' } }, 'pass'],
    ['tool_input 이 글자', { tool_name: 'Bash', tool_input: 'rm -rf ~' }, 'pass'],
    ['cwd 에 NUL', { tool_name: 'Bash', cwd: 'C:\0x', tool_input: { command: 'ls' } }, 'any'],
    ...SHELLS.map((s) => [`${s} command 가 배열`, input(s, { command: ['rm', '-rf', '~'] }), 'pass']),
    ['Write content 가 객체', input('Write', { file_path: path.join(repo, 'a.js'), content: { a: FAKE.github } }), 'any'],
    ['Edit edits 가 숫자 배열', input('Edit', { file_path: path.join(repo, 'a.js'), edits: [1, null, 'x', { new_string: 5 }] }), 'pass'],
    ['WebFetch url 이 객체', input('WebFetch', { url: { host: 'github.com' } }), 'pass'],
  ]);
  group('바이트·글자: 깨진 UTF-8·서로게이트·NUL·CRLF·1MB 한 줄', () => [
    ['깨진 UTF-8 바이트', Buffer.concat([Buffer.from(`{"tool_name":"Bash","cwd":${JSON.stringify(repo)},"tool_input":{"command":"echo `), Buffer.from([0xff, 0xfe, 0xc3, 0x28, 0xa0, 0xa1]), Buffer.from('"}}')]), 'pass'],
    ['혼자 있는 서로게이트', `{"tool_name":"Bash","cwd":${JSON.stringify(repo)},"tool_input":{"command":"echo \\ud800 \\udfff"}}`, 'pass'],
    ['서로게이트가 든 Write', `{"tool_name":"Write","cwd":${JSON.stringify(repo)},"tool_input":{"file_path":${JSON.stringify(path.join(repo, 'a.js'))},"content":"const a = '\\ud800';"}}`, 'pass'],
    ['NUL 이 든 명령', input('Bash', { command: 'ls\0 -la\0' }), 'pass'],
    ...SHELLS.map((s) => [`${s} CRLF 위험 명령`, input(s, { command: 'echo a\r\nrm -rf ~\r\n' }), 'block']),
    ['Bash 1MB 한 줄 커밋 메시지', input('Bash', { command: `git commit -m "feat: ${big(MB)}"` }), 'any'],
  ]);
  // 정규식 사례 전부는 crash-inproc.test.mjs — 여기는 진입점에서 셸·쓰기 하나씩
  group('정규식이 오래 돌지 않는다(대표)', () => [
    ['git -c 10만 자', input('Bash', { command: big(N / 6, 'git -c ') }), 'any'],
    ['닫히지 않은 ${{ 워크플로', input('Write', { file_path: path.join(repo, '.github/workflows/ci.yml'), content: 'on: pull_request_target\njobs:\n  a:\n    steps:\n      - run: ' + big(N / 4, '${{ ') + '\n' }), 'any'],
  ]);
});

describe('이상한 환경', { concurrency: false }, () => {
  const withPath = (value) => {
    const e = { ...process.env };
    for (const k of Object.keys(e)) if (k.toLowerCase() === 'path') delete e[k];
    e.PATH = value;
    return e;
  };
  const dirOf = (name, setup) => {
    const d = path.join(tmp, name);
    setup(d);
    return d;
  };
  // 명령 여럿 × 셸 전부는 crash-inproc.test.mjs — 여기는 환경마다 진입점으로 셸 둘·쓰기 하나
  group('없는 cwd·git 아님·git 없음·깨진 저장소·detached HEAD·빈 저장소·공백 한글 경로', () => {
    const plain = dirOf('plain', (d) => { fs.mkdirSync(path.join(d, '.claude'), { recursive: true }); fs.writeFileSync(path.join(d, '.claude', 'harness.json'), JSON.stringify({ rules: ALL_RULES })); });
    const broken = dirOf('broken', (d) => { fs.mkdirSync(path.join(d, '.claude'), { recursive: true }); fs.writeFileSync(path.join(d, '.git'), 'gitdir: /no/such/place\n'); fs.writeFileSync(path.join(d, '.claude', 'harness.json'), JSON.stringify({ rules: ALL_RULES })); });
    const detached = dirOf('detached', (d) => { makeRepo(d); gitIn(d, 'checkout', '-q', '--detach'); });
    const empty = dirOf('empty', (d) => { fs.mkdirSync(path.join(d, '.claude'), { recursive: true }); execFileSync('git', ['init', '-q', '-b', 'main', d]); fs.writeFileSync(path.join(d, '.claude', 'harness.json'), JSON.stringify({ rules: ALL_RULES })); });
    const korean = dirOf('한글 폴더 (공백)', (d) => makeRepo(d));
    const cases = [];
    for (const [where, cwd, env] of [
      ['없는 cwd', path.join(tmp, 'no', 'such', 'dir')],
      ['git 아님', plain],
      ['깨진 저장소', broken],
      ['detached HEAD', detached],
      ['빈 저장소', empty],
      ['공백·한글 경로', korean],
      ['git 없음(PATH 비움)', repo, withPath('')],
    ]) {
      const at = { cwd: fs.existsSync(cwd) ? cwd : tmp, env };
      cases.push([`${where} · Bash · git commit`, { tool_name: 'Bash', cwd, tool_input: { command: 'git commit -m "feat: x"' } }, 'any', at]);
      cases.push([`${where} · PowerShell · git push -f`, { tool_name: 'PowerShell', cwd, tool_input: { command: 'git push -f origin main' } }, 'any', at]);
      cases.push([`${where} · Write`, { tool_name: 'Write', cwd, tool_input: { file_path: path.join(cwd, 'src', 'a.js'), content: `const t = "${FAKE.github}";\n` } }, fs.existsSync(cwd) ? 'block' : 'pass', at]);
    }
    return cases;
  });

  group('harness.json 이 폴더·아주 큼·모양이 다름이어도 터지지 않고, 깨졌으면 알린다', () => {
    const cfgDir = (name, write) => {
      const d = makeRepo(path.join(tmp, name));
      const f = path.join(d, '.claude', 'harness.json');
      fs.rmSync(f);
      write(f);
      return d;
    };
    return [
      ['폴더인 harness.json', cfgDir('cfg-dir', (f) => fs.mkdirSync(f)), 'notice'],
      ['아주 큰 harness.json', cfgDir('cfg-big', (f) => fs.writeFileSync(f, JSON.stringify({ rules: ALL_RULES, pad: 'x'.repeat(MB) }))), 'notice'],
      ['rules 가 배열', cfgDir('cfg-arr', (f) => fs.writeFileSync(f, JSON.stringify({ rules: ['secrets'] }))), 'notice'],
      ['rules 가 글자', cfgDir('cfg-str', (f) => fs.writeFileSync(f, JSON.stringify({ rules: 'all' }))), 'notice'],
      ['JSON 이 null', cfgDir('cfg-null', (f) => fs.writeFileSync(f, 'null')), 'notice'],
      ['JSON 이 숫자', cfgDir('cfg-num', (f) => fs.writeFileSync(f, '5')), 'notice'],
      ['빈 파일', cfgDir('cfg-empty', (f) => fs.writeFileSync(f, '')), 'notice'],
      ['BOM 붙은 설정은 읽는다', cfgDir('cfg-bom', (f) => fs.writeFileSync(f, '\uFEFF' + JSON.stringify({ rules: { 'danger-cmd': true } }))), 'block'],
    ].map(([label, cwd, want]) => [label, { tool_name: 'Bash', cwd, tool_input: { command: 'rm -rf ~' } }, want, { cwd }]);
  });
});

test('걸린 시간(진단): p50·p95·최대', (t) => {
  t.diagnostic(`${spread(times)} budget=${BUDGET_MS}ms`);
  for (const [ms, label] of slowest.sort((a, b) => b[0] - a[0]).slice(0, 5)) t.diagnostic(`slow ${ms.toFixed(0)}ms ${label.slice(0, 80)}`);
  assert.ok(times.length > 0);
});
