// 터짐·느림 시험 가운데 프로세스가 아니라 판정을 보는 것(2026-11-09 crash.test.mjs 에서 옮김 — Node 를 수백 번 띄우지 않게):
// 모양이 다른 입력, 이상한 글, 이상한 환경(git 없음·깨진 저장소 등), 옵션 모양이 틀린 설정, 정규식을 오래 돌게 하는 입력(ReDoS)을
// 진입점과 같은 길(readInput 의 normalizeInput → evaluate)로 이 프로세스의 일꾼 스레드 PARALLEL 개에서 바로 돌린다.
//   1) 던지지 않는다 2) 기대(pass·block)대로다 — pass 는 막지 않고 알림도 없음 3) 한 번이 IN_BUDGET_MS 안에 끝난다
// 진입점 자체(깨진 stdin·바이트·프로세스 종료·출력 JSON)는 crash.test.mjs, 10MB 이상은 stress/crash-big.test.mjs.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { FAKE } from './strict-cases/helpers.mjs';
import { SHELLS, ALL_RULES, packs, makeRepo, gitIn, spread, IN_BUDGET_MS } from './helpers/hook-proc.mjs';
import { judgePool } from './helpers/judge-pool.mjs';
import { input, shapeCases, oddTextCases, ENV_COMMANDS, JUNK_OPTS, JUNK_COMMANDS, JUNK_FILES, SHELL_REDOS, FILE_REDOS } from './crash-cases.mjs';


const PARALLEL = 4;

let tmp;
let repo;
let pool;
const times = [];
const slowest = [];
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-crash-in-'));
  repo = makeRepo(path.join(tmp, 'repo'));
  process.chdir(repo); // cwd 가 없거나 틀린 입력은 진입점처럼 프로세스 폴더(모든 훅을 켠 저장소)를 본다
  pool = judgePool(PARALLEL);
});
after(async () => {
  await pool.close();
  process.chdir(os.tmpdir());
  fs.rmSync(tmp, { recursive: true, force: true });
});

// 사례: [이름, 입력, 기대, 선택: { cwd, path, crashOk }]. path 를 주면 그 판정 동안 일꾼의 PATH 를 바꾼다(git 없음).
// crashOk: 규칙이 터져도 된다(옵션 모양이 틀린 설정 — 예: 정규식이 아닌 branch-name pattern 은 그 규칙만 멈추고 알린다).
const runCase = async ([label, raw, want, { cwd = repo, path: pathValue, crashOk = false } = {}]) => {
  const r = await pool.judge({ raw: { cwd, ...raw }, pathValue, budget: IN_BUDGET_MS, tries: 3 });
  assert.equal(r.threw, undefined, `${label}: 판정이 던짐 ${r.threw}`);
  assert.ok(r.shapeOk, `${label}: 판정 결과 모양이 다름`);
  // 규칙이 터지면 진입점은 막지 않고 알리지만, 여기 입력은 어느 규칙도 터지지 않아야 한다(진입점 시험보다 엄격)
  if (!crashOk) assert.deepEqual(r.errors, [], `${label}: 터진 규칙 ${r.errors.join(', ')}`);
  times.push(r.ms);
  slowest.push([r.ms, label]);
  assert.ok(r.ms < IN_BUDGET_MS, `${label}: ${r.ms.toFixed(0)}ms (한도 ${IN_BUDGET_MS}ms, 세 번 중 가장 빠른 값)`);
  if (want !== 'any') assert.equal(r.got, want, `${label}: ${want} 이어야 함${r.errors.length ? ` (터진 규칙 ${r.errors.join(', ')})` : ''}`);
};
const group = (title, cases) =>
  test(title, async () => {
    const failures = [];
    await Promise.all((typeof cases === 'function' ? cases() : cases).map((c) => runCase(c).catch((e) => failures.push(e.message))));
    assert.deepEqual(failures, [], failures.join('\n'));
  });

describe('모양이 다른 입력·이상한 글', () => {
  group('tool_name·tool_input 이 없거나 모양이 다름', () => shapeCases(repo));
  group('1MB 한 줄·NUL·CRLF·이모지·RTL·바이너리', () => oddTextCases(repo));
});

describe('이상한 환경', () => {
  const dirOf = (name, setup) => {
    const d = path.join(tmp, name);
    setup(d);
    return d;
  };
  const writeCfg = (d, text) => {
    fs.mkdirSync(path.join(d, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(d, '.claude', 'harness.json'), text);
  };
  group('없는 cwd·git 아님·git 없음·깨진 저장소·detached HEAD·빈 저장소·공백 한글 경로', () => {
    const plain = dirOf('plain', (d) => writeCfg(d, JSON.stringify({ rules: ALL_RULES })));
    const broken = dirOf('broken', (d) => { writeCfg(d, JSON.stringify({ rules: ALL_RULES })); fs.writeFileSync(path.join(d, '.git'), 'gitdir: /no/such/place\n'); });
    const detached = dirOf('detached', (d) => { makeRepo(d); gitIn(d, 'checkout', '-q', '--detach'); });
    const empty = dirOf('empty', (d) => { execFileSync('git', ['init', '-q', '-b', 'main', d]); writeCfg(d, JSON.stringify({ rules: ALL_RULES })); });
    const korean = dirOf('한글 폴더 (공백)', (d) => makeRepo(d));
    const cases = [];
    for (const [where, cwd, pathValue] of [
      ['없는 cwd', path.join(tmp, 'no', 'such', 'dir')],
      ['git 아님', plain],
      ['깨진 저장소', broken],
      ['detached HEAD', detached],
      ['빈 저장소', empty],
      ['공백·한글 경로', korean],
      ['git 없음(PATH 비움)', repo, ''],
    ]) {
      for (const command of ENV_COMMANDS) for (const s of SHELLS) cases.push([`${where} · ${s} · ${command}`, { tool_name: s, tool_input: { command } }, 'any', { cwd, path: pathValue }]);
      cases.push([`${where} · Write`, { tool_name: 'Write', tool_input: { file_path: path.join(cwd, 'src', 'a.js'), content: `const t = "${FAKE.github}";\n` } }, fs.existsSync(cwd) ? 'block' : 'pass', { cwd, path: pathValue }]);
    }
    return cases;
  });
  group('옵션 모양이 모두 틀린 설정: 어떤 명령·쓰기든 던지지 않는다', () => {
    const bad = makeRepo(path.join(tmp, 'cfg-opts'), Object.fromEntries(packs.hooks.map((h) => [h.id, JUNK_OPTS])));
    const cases = [];
    for (const command of JUNK_COMMANDS) for (const s of SHELLS) cases.push([`옵션 모양 틀림 · ${s} · ${command}`, { tool_name: s, tool_input: { command } }, 'any', { cwd: bad, crashOk: true }]);
    for (const [file, content] of JUNK_FILES) cases.push([`옵션 모양 틀림 · Write ${file}`, { tool_name: 'Write', tool_input: { file_path: path.join(bad, file), content } }, 'any', { cwd: bad, crashOk: true }]);
    return cases;
  });
});

describe('정규식이 오래 돌지 않는다(ReDoS)', () => {
  group('셸 명령(Bash·PowerShell)', SHELL_REDOS.flatMap((command, i) => SHELLS.map((s) => [`셸 ${i} ${s}: ${JSON.stringify(command.slice(0, 40))}`, input(s, { command }), 'any'])));
  group('파일 쓰기(Write·Edit)', () => FILE_REDOS.flatMap(([file, content], i) => [
    [`Write ${i}: ${JSON.stringify(content.slice(0, 40))}`, input('Write', { file_path: path.join(repo, file), content }), 'any'],
    [`Edit ${i}: ${JSON.stringify(content.slice(0, 40))}`, input('Edit', { file_path: path.join(repo, file), old_string: 'x', new_string: content }), 'any'],
  ]));
});

test('걸린 시간(진단): p50·p95·최대', (t) => {
  t.diagnostic(`${spread(times)} budget=${IN_BUDGET_MS}ms`);
  for (const [ms, label] of slowest.sort((a, b) => b[0] - a[0]).slice(0, 5)) t.diagnostic(`slow ${ms.toFixed(0)}ms ${label.slice(0, 80)}`);
  assert.ok(times.length > 0);
});
