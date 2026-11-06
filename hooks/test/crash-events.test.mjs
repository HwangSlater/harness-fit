// 터짐·느림 시험(도구 호출이 아닌 때의 진입점): hooks/stop.mjs · session-start.mjs · prompt-submit.mjs 를 자식 프로세스로 돌려
// 깨진 입력, 아주 크거나 깨진 대화 기록, 이상한 경로·환경에서도 터지지 않고(종료 코드 0, JSON 하나, 오류 흔적 없음), 시간 한도 안에 끝나는지 본다.
// 모든 훅을 켠 저장소에서 돈다. 홈은 시험 폴더로 바꾼다(체크리스트 파일이 사용자 홈에 생기지 않게).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ENTRY = { stop: 'stop.mjs', start: 'session-start.mjs', prompt: 'prompt-submit.mjs' };
const packs = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog', 'packs.json'), 'utf8'));
const ALL_RULES = Object.fromEntries(packs.hooks.map((h) => [h.id, true]));
const BUDGET_MS = Number(process.env.HARNESS_BUDGET_MS || 4000);
const STACK = /\n\s+at .+[:(]\d+|node:internal|Error:/;
const MB = 1024 * 1024;

let tmp;
let repo;
let home;
const gitIn = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-crash-ev-'));
  home = path.join(tmp, 'home');
  fs.mkdirSync(home);
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  gitIn(repo, 'config', 'user.email', 't@example.com');
  gitIn(repo, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n');
  gitIn(repo, 'add', 'README.md');
  gitIn(repo, 'commit', '-q', '-m', 'chore: 시작');
  fs.mkdirSync(path.join(repo, '.claude'));
  fs.writeFileSync(path.join(repo, '.claude', 'harness.json'), JSON.stringify({ lang: 'en', rules: ALL_RULES }));
  // 고치는 중인 문서 여럿(끝낼 때 검사가 읽는다)
  fs.mkdirSync(path.join(repo, 'docs'));
  fs.writeFileSync(path.join(repo, 'docs', 'README.md'), '# 문서\n\n' + '- [a](a.md)\n'.repeat(20000) + '](' + 'x'.repeat(MB) + '\n');
  fs.writeFileSync(path.join(repo, 'docs', 'big.md'), '#'.repeat(MB) + '\n');
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const run = (entry, stdin, { env } = {}) =>
  new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(process.execPath, [path.join(ROOT, 'hooks', ENTRY[entry])], { cwd: repo, env: env || { ...process.env, HOME: home, USERPROFILE: home } });
    const out = [];
    const err = [];
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('close', (status) => resolve({ status, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), ms: performance.now() - t0 }));
    child.stdin.on('error', () => {});
    child.stdin.end(typeof stdin === 'string' ? stdin : JSON.stringify(stdin));
  });

const ok = (r, label) => {
  assert.equal(r.status, 0, `${label}: 종료 코드 ${r.status} ${r.stderr.slice(0, 300)}`);
  assert.doesNotMatch(r.stderr, STACK, `${label}: 오류 흔적 ${r.stderr.slice(0, 300)}`);
  assert.ok(r.ms < BUDGET_MS, `${label}: ${r.ms.toFixed(0)}ms (한도 ${BUDGET_MS}ms)`);
  const j = JSON.parse(r.stdout);
  // 터진 규칙이 있으면 그 알림이 나온다 — 여기 입력은 모두 터지지 않아야 한다
  assert.equal(j.systemMessage, undefined, `${label}: 오류 알림 ${r.stdout.slice(0, 300)}`);
  return j;
};

const transcript = (name, text) => {
  const f = path.join(tmp, name);
  fs.writeFileSync(f, text);
  return f;
};
const line = (r) => JSON.stringify(r) + '\n';
const prompt = line({ type: 'user', message: { role: 'user', content: '해 주세요' }, timestamp: new Date(Date.now() - 60000).toISOString() });
const say = (text) => line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] }, timestamp: new Date().toISOString() });

test('깨진 입력·깨진 기록·큰 기록에서 터지지 않고 시간 안에 끝난다', async () => {
  const cases = [];
  const base = { session_id: 's1', cwd: repo };
  for (const entry of Object.keys(ENTRY)) {
    for (const [label, stdin] of [
      ['빈 입력', ''], ['JSON 아님', 'nope'], ['배열', '[1]'], ['null', 'null'], ['깊은 중첩', '['.repeat(1e5) + ']'.repeat(1e5)],
      ['session_id 숫자', { ...base, session_id: 5 }], ['session_id 객체', { ...base, session_id: { a: 1 } }], ['session_id 경로', { ...base, session_id: '../../../etc' }],
      ['session_id 아주 김', { ...base, session_id: 'a'.repeat(MB) }], ['cwd 없음', { session_id: 's1' }], ['없는 cwd', { ...base, cwd: path.join(tmp, 'no', 'such') }],
      ['transcript 숫자', { ...base, transcript_path: 5 }], ['transcript 폴더', { ...base, transcript_path: tmp }], ['transcript 없음', { ...base, transcript_path: path.join(tmp, 'none.jsonl') }],
      ['transcript NUL', { ...base, transcript_path: 'a\0b' }], ['stop_hook_active 글자', { ...base, stop_hook_active: 'yes' }],
      ['last_assistant_message 객체', { ...base, last_assistant_message: { a: 1 } }],
    ]) cases.push([`${entry} · ${label}`, entry, stdin]);
  }
  const garbage = transcript('garbage.jsonl', 'not json\n{"type":\n' + line(null) + line([1]) + line({ type: 'assistant', message: { content: 'x' } }) + line({ type: 'assistant', message: { content: [null, 5, { type: 'text', text: 7 }, { type: 'tool_use', input: null }] } }) + prompt + say('끝'));
  const noNewline = transcript('one-line.jsonl', 'x'.repeat(10 * MB));
  const big = transcript('big.jsonl', prompt + say('a '.repeat(2 * MB)) + line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'git commit -m x && '.repeat(5000) } }] } }) + say('the '.repeat(MB)));
  const huge = transcript('huge.jsonl', prompt + (say('가'.repeat(1000)).repeat(80000)));
  const hashes = transcript('hashes.jsonl', prompt + line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'git commit -m x' } }] } }) + say('abcdef1 '.repeat(MB / 4)));
  for (const [label, file] of [['깨진 줄', garbage], ['줄바꿈 없는 10MB', noNewline], ['큰 기록', big], ['80MB 기록', huge], ['해시 모양 글 가득', hashes]]) {
    cases.push([`stop · ${label}`, 'stop', { session_id: 's1', cwd: repo, transcript_path: file }]);
  }
  const failures = [];
  for (const [label, entry, stdin] of cases) {
    try {
      ok(await run(entry, stdin), label);
    } catch (e) {
      failures.push(e.message);
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('git 없음(PATH 비움)·git 아님·설정 깨짐에서도 터지지 않는다', async () => {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  for (const k of Object.keys(env)) if (k.toLowerCase() === 'path') delete env[k];
  env.PATH = '';
  const plain = path.join(tmp, 'plain');
  fs.mkdirSync(path.join(plain, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(plain, '.claude', 'harness.json'), JSON.stringify({ rules: ALL_RULES }));
  const broken = path.join(tmp, 'broken');
  fs.mkdirSync(path.join(broken, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(broken, '.claude', 'harness.json'), '{ nope');
  const t = transcript('plain.jsonl', prompt + say('done'));
  const failures = [];
  for (const entry of Object.keys(ENTRY)) {
    for (const [label, cwd, e] of [['git 없음', repo, env], ['git 아님', plain, undefined], ['설정 깨짐', broken, undefined]]) {
      try {
        const j = ok(await run(entry, { session_id: 's2', cwd, transcript_path: t }, { env: e }), `${entry} · ${label}`);
        if (label === '설정 깨짐') assert.deepEqual(j, {}, '깨진 설정 알림은 PreToolUse 가 한다');
      } catch (err) {
        failures.push(err.message);
      }
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('설정이 없는 프로젝트는 규칙 모듈을 불러오지 않고 바로 통과한다', async () => {
  const none = path.join(tmp, 'none');
  fs.mkdirSync(none);
  execFileSync('git', ['init', '-q', none]);
  for (const entry of Object.keys(ENTRY)) {
    const r = await run(entry, { session_id: 's3', cwd: none });
    assert.deepEqual(ok(r, entry), {});
  }
  // 켠 훅이 그 때의 것이 아니면 역시 바로 통과(규칙 모듈을 불러오지 않는다)
  const other = path.join(tmp, 'other');
  fs.mkdirSync(path.join(other, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(other, '.claude', 'harness.json'), JSON.stringify({ rules: { secrets: true } }));
  for (const entry of Object.keys(ENTRY)) assert.deepEqual(ok(await run(entry, { session_id: 's3', cwd: other }), entry), {});
});

test('lib/entry.mjs 의 때별 훅 id 는 lib/events.mjs 규칙과 같다', async () => {
  const { EVENT_HOOK_IDS } = await import('../lib/entry.mjs');
  const { EVENT_RULES } = await import('../lib/events.mjs');
  for (const on of Object.keys(EVENT_HOOK_IDS)) {
    assert.deepEqual([...EVENT_HOOK_IDS[on]].sort(), [...new Set(EVENT_RULES.filter((r) => r.on === on).map((r) => r.id))].sort(), on);
  }
});
