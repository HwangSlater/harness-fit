// 터짐·느림 시험(2026-11-06 사용자 요청): 진짜 진입점 hooks/run.mjs 를 자식 프로세스로 돌려
// 깨진 입력, 아주 크거나 이상한 글, 이상한 환경, 정규식을 오래 돌게 하는 입력에서
//   1) 터지지 않는다 — 종료 코드 0, stdout 은 {} · 막음(deny) · 알림(systemMessage) 중 하나인 JSON, stderr 에 오류 흔적 없음
//   2) 쓰레기 입력은 막지 않는다(진짜 위반만 막는다)
//   3) 한 번이 시간 한도(BUDGET_MS) 안에 끝난다
// 를 본다. 모든 훅을 켠 저장소에서 돈다. 걸린 시간의 p50·p95·최대는 진단 줄로 남긴다.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FAKE } from './strict-cases/helpers.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RUN = path.join(ROOT, 'hooks', 'run.mjs');
const packs = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog', 'packs.json'), 'utf8'));
const FLOW_OPTS = packs.flows.find((f) => f.id === 'github-flow').hooks;
const ALL_RULES = Object.fromEntries(packs.hooks.map((h) => [h.id, FLOW_OPTS[h.id] || true]));
// 한 번의 한도. 다른 시험 파일과 함께 돌 때도 넘지 않게 여유를 둔다(이 PC 에서 혼자 돌면 대부분 0.2~1초).
const BUDGET_MS = Number(process.env.HARNESS_BUDGET_MS || 4000);
const PARALLEL = 4;
const MB = 1024 * 1024;
const STACK = /\n\s+at .+[:(]\d+|node:internal|Error:/;
const SHELLS = ['Bash', 'PowerShell'];

let tmp;
let repo;
const times = [];
const slowest = []; // [ms, 사례 이름]
const gitIn = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
const makeRepo = (dir, rules = ALL_RULES) => {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  gitIn(dir, 'config', 'user.email', 't@example.com');
  gitIn(dir, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'README.md'), 'hello\n');
  gitIn(dir, 'add', 'README.md');
  gitIn(dir, 'commit', '-q', '-m', 'chore: 시작');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'harness.json'), JSON.stringify({ lang: 'en', rules }));
  return dir;
};
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-crash-'));
  repo = makeRepo(path.join(tmp, 'repo'));
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

const runRaw = (stdin, { cwd = repo, env } = {}) =>
  slot(() => new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(process.execPath, [RUN], { cwd, env: env || process.env });
    const out = [];
    const err = [];
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => resolve({ status: -1, stdout: '', stderr: String(e), ms: 0 }));
    child.on('close', (status) => {
      const ms = performance.now() - t0;
      times.push(ms);
      resolve({ status, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), ms });
    });
    child.stdin.on('error', () => {}); // 자식이 입력을 다 읽기 전에 끝나도 시험이 터지지 않게
    child.stdin.end(stdin);
  }));

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
  assert.ok(r.ms < BUDGET_MS, `${label}: ${r.ms.toFixed(0)}ms (한도 ${BUDGET_MS}ms)`);
  if (j.hookSpecificOutput?.permissionDecision === 'deny') {
    assert.equal(typeof j.hookSpecificOutput.permissionDecisionReason, 'string');
    return 'block';
  }
  if (typeof j.systemMessage === 'string') return 'notice';
  assert.deepEqual(j, {}, `${label}: 막지 않을 때는 {} 만 ${r.stdout.slice(0, 200)}`);
  return 'pass';
};

// 사례: [이름, stdin(글·Buffer·객체), 기대('pass'|'block'|'notice'|'any'), 선택: { cwd, env }]
const input = (tool_name, tool_input, extra = {}) => ({ tool_name, tool_input, ...extra });
const runCase = async ([label, stdin, want, opts = {}]) => {
  const raw = Buffer.isBuffer(stdin) || typeof stdin === 'string' ? stdin : JSON.stringify({ cwd: opts.cwd ?? repo, ...stdin });
  const r = await runRaw(raw, opts);
  slowest.push([r.ms, label]);
  const got = outcome(r, label);
  if (want !== 'any') assert.equal(got, want, `${label}: ${want} 이어야 함`);
};
// serial: 하나씩(10MB 입력을 여럿 함께 돌리면 서로 CPU·메모리를 뺏어 한 번의 시간을 제대로 잴 수 없다)
const group = (title, cases, { serial = false } = {}) =>
  test(title, async () => {
    const failures = [];
    const one = (c) => runCase(c).catch((e) => failures.push(e.message));
    if (serial) for (const c of cases) await one(c);
    else await Promise.all(cases.map(one));
    assert.deepEqual(failures, [], failures.join('\n'));
  });

describe('깨진 입력', { concurrency: true }, () => {
  group('JSON 이 아니거나 모양이 다른 stdin 은 그냥 통과', [
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
  group('tool_name·tool_input 이 없거나 모양이 다름', [
    ['tool_name 없음', { tool_input: { command: 'rm -rf ~' } }, 'pass'],
    ['tool_name 이 숫자', { tool_name: 7, tool_input: { command: 'rm -rf ~' } }, 'pass'],
    ['tool_name 이 객체', { tool_name: { a: 1 }, tool_input: { command: 'rm -rf ~' } }, 'pass'],
    ['모르는 도구', input('Read', { file_path: '/etc/passwd' }), 'pass'],
    ['모르는 도구(빈 이름)', input('', { command: 'rm -rf ~' }), 'pass'],
    ['소문자 bash', input('bash', { command: 'rm -rf ~' }), 'pass'],
    ['tool_input 없음', { tool_name: 'Bash' }, 'pass'],
    ['tool_input 이 글자', { tool_name: 'Bash', tool_input: 'rm -rf ~' }, 'pass'],
    ['tool_input 이 배열', { tool_name: 'Write', tool_input: ['a'] }, 'pass'],
    ['tool_input 이 null', { tool_name: 'Edit', tool_input: null }, 'pass'],
    ['cwd 가 숫자', { tool_name: 'Bash', cwd: 5, tool_input: { command: 'ls' } }, 'any'],
    ['cwd 에 NUL', { tool_name: 'Bash', cwd: 'C:\0x', tool_input: { command: 'ls' } }, 'any'],
    ...[['숫자', 42], ['배열', ['rm', '-rf', '~']], ['객체', { cmd: 'rm -rf ~' }], ['null', null], ['참거짓', true]].flatMap(([why, command]) =>
      SHELLS.map((s) => [`${s} command 가 ${why}`, input(s, { command }), 'pass'])),
    ['Write content 가 객체', input('Write', { file_path: path.join(repo, 'a.js'), content: { a: FAKE.github } }), 'any'],
    ['Write content 가 숫자', input('Write', { file_path: path.join(repo, 'a.js'), content: 12345 }), 'pass'],
    ['Write file_path 가 숫자', input('Write', { file_path: 5, content: 'x' }), 'pass'],
    ['Write file_path 가 객체', input('Write', { file_path: { p: '.env' }, content: 'x' }), 'pass'],
    ['Write file_path 없음', input('Write', { content: 'x' }), 'pass'],
    ['Edit edits 가 객체', input('Edit', { file_path: path.join(repo, 'a.js'), edits: { new_string: 'x' } }), 'pass'],
    ['Edit edits 가 글자', input('Edit', { file_path: path.join(repo, 'a.js'), edits: 'abc' }), 'pass'],
    ['Edit edits 가 숫자 배열', input('Edit', { file_path: path.join(repo, 'a.js'), edits: [1, null, 'x', { new_string: 5 }] }), 'pass'],
    ['Edit new_string 이 배열', input('Edit', { file_path: path.join(repo, 'a.js'), old_string: 'a', new_string: ['x'] }), 'pass'],
    ['NotebookEdit new_source 가 객체', input('NotebookEdit', { notebook_path: path.join(repo, 'n.ipynb'), new_source: { a: 1 } }), 'pass'],
    ['WebFetch url 이 숫자', input('WebFetch', { url: 5 }), 'pass'],
    ['WebFetch url 이 객체', input('WebFetch', { url: { host: 'github.com' } }), 'pass'],
    ['WebFetch url 이 깨짐', input('WebFetch', { url: 'http://[::1' }), 'pass'],
  ]);
});

const big = (n, ch = 'a') => ch.repeat(n); // ch 를 n 번
const sized = (bytes, unit) => unit.repeat(Math.ceil(bytes / unit.length)); // 모두 bytes 글자쯤
describe('크고 이상한 글', { concurrency: true }, () => {
  group('아주 큰 입력·한 줄·NUL·깨진 UTF-8·서로게이트·CRLF·이모지·RTL·바이너리', [
    ...SHELLS.map((s) => [`${s} 10MB 명령(echo)`, input(s, { command: 'echo ' + big(10 * MB) }), 'pass']),
    ...SHELLS.map((s) => [`${s} 10MB 명령 끝의 위험 명령`, input(s, { command: 'echo ' + big(10 * MB) + '\nrm -rf ~' }), 'any']),
    ...SHELLS.map((s) => [`${s} 1MB 한 줄 커밋 메시지`, input(s, { command: `git commit -m "feat: ${big(MB)}"` }), 'any']),
    ['10MB Write(평범한 코드)', input('Write', { file_path: path.join(repo, 'src', 'big.md'), content: sized(10 * MB, 'x\n') }), 'pass'],
    ['50MB Write(평범한 코드 — 한도보다 큰 입력도 터지지 않는다)', input('Write', { file_path: path.join(repo, 'src', 'huge.md'), content: sized(50 * MB, '// x\n') }), 'any'],
    ['10MB Write 끝의 토큰은 막는다', input('Write', { file_path: path.join(repo, 'src', 'k.js'), content: sized(10 * MB, '// x\n') + `const t = "${FAKE.github}";\n` }), 'block'],
    ['1MB 한 줄 Write', input('Write', { file_path: path.join(repo, 'src', 'line.js'), content: 'const a = "' + big(MB) + '";\n' }), 'pass'],
    ['10MB Edit', input('Edit', { file_path: path.join(repo, 'README.md'), old_string: 'hello', new_string: sized(10 * MB, 'y\n') }), 'pass'],
    ['NUL 이 든 명령', input('Bash', { command: 'ls\0 -la\0' }), 'pass'],
    ['NUL 이 든 위험 명령', input('Bash', { command: 'rm -rf ~\0' }), 'any'],
    ['NUL 이 든 파일 경로', input('Write', { file_path: path.join(repo, 'a\0.env'), content: 'x' }), 'any'],
    ['NUL 이 든 내용', input('Write', { file_path: path.join(repo, 'a.js'), content: 'a\0b\0'.repeat(1000) }), 'pass'],
    ['깨진 UTF-8 바이트', Buffer.concat([Buffer.from(`{"tool_name":"Bash","cwd":${JSON.stringify(repo)},"tool_input":{"command":"echo `), Buffer.from([0xff, 0xfe, 0xc3, 0x28, 0xa0, 0xa1]), Buffer.from('"}}')]), 'pass'],
    ['혼자 있는 서로게이트', `{"tool_name":"Bash","cwd":${JSON.stringify(repo)},"tool_input":{"command":"echo \\ud800 \\udfff"}}`, 'pass'],
    ['서로게이트가 든 Write', `{"tool_name":"Write","cwd":${JSON.stringify(repo)},"tool_input":{"file_path":${JSON.stringify(path.join(repo, 'a.js'))},"content":"const a = '\\ud800';"}}`, 'pass'],
    ...SHELLS.map((s) => [`${s} CRLF 명령`, input(s, { command: 'git status\r\ngit log -1\r\n' }), 'pass']),
    ...SHELLS.map((s) => [`${s} CRLF 위험 명령`, input(s, { command: 'echo a\r\nrm -rf ~\r\n' }), 'block']),
    ['이모지 명령', input('Bash', { command: 'echo "🚀🔥 배포 👍" && git status' }), 'pass'],
    ['이모지 커밋 메시지', input('Bash', { command: 'git commit -m "feat: 🚀 배포"' }), 'any'],
    ['RTL 표시가 든 명령', input('Bash', { command: 'echo "\u202Eabc\u202C" \u200F' }), 'pass'],
    ['RTL 표시로 감싼 위험 명령', input('Bash', { command: '\u202Erm -rf ~' }), 'any'],
    ['바이너리처럼 보이는 Write', input('Write', { file_path: path.join(repo, 'logo.js'), content: Buffer.from(Array.from({ length: 65536 }, (_, i) => i % 256)).toString('latin1') }), 'any'],
    ['제어 문자 가득한 명령', input('PowerShell', { command: Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).join('').repeat(1000) }), 'pass'],
  ], { serial: true });
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
  test('없는 cwd·git 아님·git 없음·깨진 저장소·detached HEAD·빈 저장소·공백 한글 경로', async () => {
    const plain = dirOf('plain', (d) => { fs.mkdirSync(path.join(d, '.claude'), { recursive: true }); fs.writeFileSync(path.join(d, '.claude', 'harness.json'), JSON.stringify({ rules: ALL_RULES })); });
    const broken = dirOf('broken', (d) => { fs.mkdirSync(path.join(d, '.claude'), { recursive: true }); fs.writeFileSync(path.join(d, '.git'), 'gitdir: /no/such/place\n'); fs.writeFileSync(path.join(d, '.claude', 'harness.json'), JSON.stringify({ rules: ALL_RULES })); });
    const detached = dirOf('detached', (d) => { makeRepo(d); gitIn(d, 'checkout', '-q', '--detach'); });
    const empty = dirOf('empty', (d) => { fs.mkdirSync(path.join(d, '.claude'), { recursive: true }); execFileSync('git', ['init', '-q', '-b', 'main', d]); fs.writeFileSync(path.join(d, '.claude', 'harness.json'), JSON.stringify({ rules: ALL_RULES })); });
    const korean = dirOf('한글 폴더 (공백)', (d) => makeRepo(d));
    const cmds = ['git commit -m "feat: x"', 'git push -f origin main', 'git add -A', 'git switch -c 이름', 'rm -rf ./build', 'git cherry-pick --continue', 'git rebase -i HEAD~1', 'ls'];
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
      for (const command of cmds) for (const s of SHELLS) cases.push([`${where} · ${s} · ${command}`, { tool_name: s, cwd, tool_input: { command } }, 'any', { cwd: fs.existsSync(cwd) ? cwd : tmp, env }]);
      cases.push([`${where} · Write`, { tool_name: 'Write', cwd, tool_input: { file_path: path.join(cwd, 'src', 'a.js'), content: `const t = "${FAKE.github}";\n` } }, fs.existsSync(cwd) ? 'block' : 'pass', { cwd: fs.existsSync(cwd) ? cwd : tmp, env }]);
    }
    const failures = [];
    await Promise.all(cases.map((c) => runCase(c).catch((e) => failures.push(e.message))));
    assert.deepEqual(failures, [], failures.join('\n'));
  });

  test('harness.json 이 폴더·아주 큼·모양이 다름이어도 터지지 않고, 깨졌으면 알린다', async () => {
    const cfgDir = (name, write) => {
      const d = makeRepo(path.join(tmp, name));
      const f = path.join(d, '.claude', 'harness.json');
      fs.rmSync(f);
      write(f);
      return d;
    };
    const cases = [
      ['폴더인 harness.json', cfgDir('cfg-dir', (f) => fs.mkdirSync(f)), 'notice'],
      ['아주 큰 harness.json', cfgDir('cfg-big', (f) => fs.writeFileSync(f, JSON.stringify({ rules: ALL_RULES, pad: 'x'.repeat(MB) }))), 'notice'],
      ['rules 가 배열', cfgDir('cfg-arr', (f) => fs.writeFileSync(f, JSON.stringify({ rules: ['secrets'] }))), 'notice'],
      ['rules 가 글자', cfgDir('cfg-str', (f) => fs.writeFileSync(f, JSON.stringify({ rules: 'all' }))), 'notice'],
      ['JSON 이 null', cfgDir('cfg-null', (f) => fs.writeFileSync(f, 'null')), 'notice'],
      ['JSON 이 숫자', cfgDir('cfg-num', (f) => fs.writeFileSync(f, '5')), 'notice'],
      ['빈 파일', cfgDir('cfg-empty', (f) => fs.writeFileSync(f, '')), 'notice'],
      ['BOM 붙은 설정은 읽는다', cfgDir('cfg-bom', (f) => fs.writeFileSync(f, '\uFEFF' + JSON.stringify({ rules: { 'danger-cmd': true } }))), 'block'],
    ].map(([label, cwd, want]) => [label, { tool_name: 'Bash', cwd, tool_input: { command: 'rm -rf ~' } }, want, { cwd }]);
    // 옵션 모양이 모두 틀린 설정: 어떤 명령이든 터지지 않는다(막을지는 옵션 없는 기본 검사 몫)
    const junk = { branches: 'main', pattern: '([', maxLines: 'abc', paths: { a: 1 }, allow: 5, noDirectPush: 'yes', allowCommit: 'no', lang: 7 };
    const bad = makeRepo(path.join(tmp, 'cfg-opts'), Object.fromEntries(packs.hooks.map((h) => [h.id, junk])));
    for (const command of ['git commit -m "update"', 'git push -f origin main', 'git switch -c wip', 'git add -A', 'rm -rf ~', 'gh pr merge 1', 'git commit --amend --no-edit'])
      for (const s of SHELLS) cases.push([`옵션 모양 틀림 · ${s} · ${command}`, { tool_name: s, cwd: bad, tool_input: { command } }, 'any', { cwd: bad }]);
    for (const [file, content] of [['src/a.js', `el.${'inner' + 'HTML'} = x;\n`], ['.env', 'X=1\n'], ['package.json', '{"dependencies":{"a":"^1.0.0"}}'], ['src/big.ts', 'x\n'.repeat(500)]])
      cases.push([`옵션 모양 틀림 · Write ${file}`, { tool_name: 'Write', cwd: bad, tool_input: { file_path: path.join(bad, file), content } }, 'any', { cwd: bad }]);
    const failures = [];
    await Promise.all(cases.map((c) => runCase(c).catch((e) => failures.push(e.message))));
    assert.deepEqual(failures, [], failures.join('\n'));
  });
});

// 정규식을 오래 돌게 하는 입력: 같은 글자를 길게 되풀이한 「거의 맞는」 꼴, 겹친 따옴표, 옵션 수만 개.
// 셸 규칙은 명령 글 하나로 전부 돌고, 쓰기 규칙은 파일 이름·내용으로 돈다(모든 훅을 켰다).
const N = 1e5;
const SHELL_REDOS = [
  big(N), big(N, '-'), big(N, '"'), big(N / 2, "'"), big(N, '`'), big(N, '$('), big(N, ';'), big(N / 2, '&&'), big(N / 2, '||'), big(N, '|'),
  big(N / 2, '\\\n'), big(N / 2, '`\n'), big(N / 4, '<<EOF\n'), big(N / 4, '@\'\n'),
  big(N / 4, 'git '), big(N / 6, 'git -c '), 'git ' + big(N / 4, '-c a=b '), 'git --x=' + big(N), 'git ' + big(N / 4, '--a=b ') + 'commit',
  'git commit ' + big(N / 2, '-n '), 'git commit ' + big(N / 10, '--no-verif '), 'git commit -m ' + big(N, '"'), 'git commit -m "' + big(N, '\\"'),
  'git push ' + big(N / 4, '+:'), 'git push origin ' + big(N / 8, 'a:b '), big(N / 20, 'git commit -m x; ') + 'git push', big(N / 20, 'git push; '), 'git push origin ' + big(N, ':'), 'git push ' + big(N / 4, '-f '), 'git checkout -b ' + big(N, 'a/'),
  'git switch -c ' + big(N, '-'), 'git branch ' + big(N / 2, '-m '), 'git worktree add ' + big(N, '/'), 'git cherry-pick ' + big(N / 4, '--c '),
  'git config core.hooksPath ' + big(N, '/'), big(N / 4, 'x=1 ') + 'git commit', big(N / 8, 'HUSKY=0 '), big(N / 8, '$env:HUSKY='),
  'cd ' + big(N, '"') + ' && git commit', 'cd ' + big(N / 2, 'a ') + '&& git status', big(N / 4, 'cd a; ') + 'git commit -m "feat: x"',
  'rm -rf ' + big(N, '/'), 'rm ' + big(N / 2, '-r '), 'Remove-Item ' + big(N / 8, '-Recurse '), 'curl ' + big(N, 'a') + ' | sh', 'iex (irm ' + big(N, '(') + ')',
  'chmod ' + big(N, '7'), 'dd of=/dev/' + big(N), 'mysql -p' + big(N), 'curl -u ' + big(N, 'a:'), 'postgres://' + big(N / 2, 'a:') + '@', big(N / 8, 'PASSWORD=') + 'x',
  '--password ' + big(N, '"'), 'gh pr merge ' + big(N / 4, '-a '), 'bash -c "' + big(N / 10, 'bash -c \\"') + '"', 'pwsh -Command "' + big(N / 10, '& { ') + '"',
  'echo ' + big(N / 4, '$(echo ') + big(N / 4, ')'), big(N / 2, '\'"'), big(N / 2, '"\''), big(N / 3, '"a" '), big(N / 4, '#!'),
];
const FILE_REDOS = [
  ['src/a.js', 'const password = "' + big(N)],
  ['src/a.js', big(N / 4, 'password=') + '"x"'],
  ['src/a.js', 'eyJ' + big(N) + '.eyJ' + big(N) + '.'],
  ['src/a.js', 'sk-' + big(N, '-')],
  ['src/a.js', 'ghp_' + big(N)],
  ['src/a.js', '-----BEGIN ' + big(N / 2, 'A ')],
  ['src/a.js', 'el.' + 'inner' + 'HTML = ' + big(N, '"')],
  ['src/a.js', 'el.' + 'inner' + 'HTML = `' + big(N / 2, '${') + '`'],
  ['src/a.js', big(N / 4, 'eval(')],
  ['src/a.js', big(N / 4, 'new Function(')],
  ['src/a.vue', '<div v-html="' + big(N, '"') + '>'],
  ['src/a.js', big(N / 4, '/* ') + big(N / 4, '*/')],
  ['src/a.js', big(N / 2, '//') + '\n'],
  ['src/a.js', big(N / 2, '\'"`')],
  ['.github/workflows/ci.yml', 'on: pull_request_target\njobs:\n  a:\n    steps:\n      - run: ' + big(N / 4, '${{ ') + '\n'],
  ['.github/workflows/ci.yml', 'jobs:\n  a:\n    steps:\n      - uses: ' + big(N, 'a/') + '@v1\n'],
  ['.github/workflows/ci.yml', big(N / 8, '      - run: |\n')],
  ['.github/workflows/ci.yml', 'x: ' + big(N, ' ') + '\n'],
  ['package.json', '{"dependencies":{"a":"' + big(N, '^') + '"}}'],
  ['package.json', '{"dependencies":{' + big(N / 10, '"a":"1",') + '"z":"^1"}}'],
  ['package.json', big(N, '{')],
  [big(N / 10, 'a/') + '.env', 'x'],
  ['src/' + big(N / 10, '.env.'), 'x'],
  ['src/x.ts', big(N, '\n')],
  // 언어별 훅(swift-unsafe · python-unsafe)의 글자·주석 가리기와 꼴 찾기
  ['Sources/a.swift', big(N / 4, 'try!')],
  ['Sources/a.swift', 'print' + big(N, ' ') + 'x'],
  ['Sources/a.swift', 'func' + big(N, ' ') + 'print('],
  ['Sources/a.swift', big(N / 3, '"\\(')],
  ['Sources/a.swift', big(N / 4, '#"\\#(')],
  ['Sources/a.swift', big(N / 2, '/*')],
  ['Sources/a.swift', big(N / 6, '"""\n')],
  ['app/a.py', big(N / 3, 'f"{')],
  ['app/a.py', big(N / 6, "'''\n")],
  ['app/a.py', 'shell' + big(N, ' ') + '='],
  ['app/a.py', 'def' + big(N, ' ') + 'eval('],
  ['app/a.py', big(N / 6, 'shell=')],
  ['app/a.py', big(N / 2, '\\\n')],
  ['docs/' + big(N / 10, 'a/') + 'x.txt', 'x'],
];
describe('정규식이 오래 돌지 않는다(ReDoS)', { concurrency: true }, () => {
  group('셸 명령(Bash·PowerShell)', SHELL_REDOS.flatMap((command, i) => SHELLS.map((s) => [`셸 ${i} ${s}: ${JSON.stringify(command.slice(0, 40))}`, input(s, { command }), 'any'])));
  group('파일 쓰기(Write·Edit)', FILE_REDOS.flatMap(([file, content], i) => [
    [`Write ${i}: ${JSON.stringify(content.slice(0, 40))}`, input('Write', { file_path: path.join(repo, file), content }), 'any'],
    [`Edit ${i}: ${JSON.stringify(content.slice(0, 40))}`, input('Edit', { file_path: path.join(repo, file), old_string: 'x', new_string: content }), 'any'],
  ]));
});

test('걸린 시간(진단): p50·p95·최대', (t) => {
  const s = [...times].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(0);
  t.diagnostic(`runs=${s.length} p50=${at(0.5)}ms p95=${at(0.95)}ms max=${s.at(-1).toFixed(0)}ms budget=${BUDGET_MS}ms`);
  for (const [ms, label] of slowest.sort((a, b) => b[0] - a[0]).slice(0, 5)) t.diagnostic(`slow ${ms.toFixed(0)}ms ${label.slice(0, 80)}`);
  assert.ok(s.length > 0);
});
