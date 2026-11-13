// 터짐·느림 시험(도구 호출이 아닌 때): hooks/stop.mjs · session-start.mjs · prompt-submit.mjs 가
// 깨진 입력, 깨진 대화 기록, 이상한 경로·환경에서도 터지지 않고(종료 코드 0, JSON 하나, 오류 흔적 없음), 시간 한도 안에 끝나는지 본다.
// 진입점(자식 프로세스)으로는 깨진 stdin·환경·설정 없음을, 모양이 다른 입력·깨진 기록은 판정(evaluateEvent)을 일꾼 스레드에서 바로 불러 본다(규칙이 하나도 터지지 않아야 한다).
// 아주 큰 기록(10MB 한 줄·80MB)은 stress/transcript-big.test.mjs. 모든 훅을 켠 저장소에서 돈다. 홈은 시험 폴더로 바꾼다(체크리스트 파일이 사용자 홈에 생기지 않게).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { EVENT_RULES } from '../lib/events.mjs';
import { EVENT_HOOK_IDS } from '../lib/entry.mjs';
import { HOOK, MB, STACK, packs, gitIn, runEntry, timed, assertFast, idleRun, IN_BUDGET_MS } from './helpers/hook-proc.mjs';
import { judgePool } from './helpers/judge-pool.mjs';

const ENTRY = { stop: 'stop.mjs', start: 'session-start.mjs', prompt: 'prompt-submit.mjs' };
const ON = { stop: 'stop', start: 'session-start', prompt: 'prompt' };
const ALL_RULES = Object.fromEntries(packs.hooks.map((h) => [h.id, true]));
const PARALLEL = 4;

let tmp;
let repo;
let home;
let idle;
const saved = {};
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-crash-ev-'));
  home = path.join(tmp, 'home');
  fs.mkdirSync(home);
  // 판정을 바로 부르는 사례도 사용자 홈을 건드리지 않게
  for (const k of ['HOME', 'USERPROFILE']) [saved[k], process.env[k]] = [process.env[k], home];
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
  const none = path.join(tmp, 'none');
  execFileSync('git', ['init', '-q', none]);
  idle = idleRun(HOOK('stop.mjs'), none);
});
after(() => {
  for (const k of Object.keys(saved)) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  fs.rmSync(tmp, { recursive: true, force: true });
});

const run = (entry, stdin, { env, cwd = repo } = {}) =>
  timed(() => runEntry(HOOK(ENTRY[entry]), typeof stdin === 'string' ? stdin : JSON.stringify(stdin), { cwd, env: env || { ...process.env, HOME: home, USERPROFILE: home } }), { idle });

const ok = (r, label) => {
  assert.equal(r.status, 0, `${label}: 종료 코드 ${r.status} ${r.stderr.slice(0, 300)}`);
  assert.doesNotMatch(r.stderr, STACK, `${label}: 오류 흔적 ${r.stderr.slice(0, 300)}`);
  assertFast(r, label);
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

test('진입점: 깨진 stdin 에서 터지지 않고 시간 안에 끝난다', async () => {
  const failures = [];
  const jobs = [];
  for (const entry of Object.keys(ENTRY)) {
    for (const [label, stdin] of [['빈 입력', ''], ['JSON 아님', 'nope'], ['배열', '[1]'], ['null', 'null'], ['깊은 중첩', '['.repeat(1e5) + ']'.repeat(1e5)]]) {
      jobs.push(async () => ok(await run(entry, stdin), `${entry} · ${label}`));
    }
  }
  // PARALLEL 개씩
  for (let i = 0; i < jobs.length; i += PARALLEL) await Promise.all(jobs.slice(i, i + PARALLEL).map((j) => j().catch((e) => failures.push(e.message))));
  assert.deepEqual(failures, [], failures.join('\n'));
});

// 판정 한 번(진입점과 같은 normalizeInput → evaluateEvent, 일꾼 스레드에서). 던지거나 규칙이 터지거나 한도를 넘으면 실패.
const judge = async (pool, entry, raw, label) => {
  const r = await pool.judge({ raw, event: ON[entry], budget: IN_BUDGET_MS, tries: 3 });
  assert.equal(r.threw, undefined, `${label}: 판정이 던짐 ${r.threw}`);
  assert.ok(r.shapeOk, `${label}: 결과 모양`);
  assert.deepEqual(r.errors, [], `${label}: 터진 규칙 ${r.errors.join(', ')}`);
  assert.ok(r.ms < IN_BUDGET_MS, `${label}: ${r.ms.toFixed(0)}ms (한도 ${IN_BUDGET_MS}ms, 세 번 중 가장 빠른 값)`);
};

test('판정: 모양이 다른 입력·깨진 기록에서 규칙이 터지지 않고 시간 안에 끝난다', async () => {
  const failures = [];
  const base = { session_id: 's1', cwd: repo };
  const cases = [];
  for (const entry of Object.keys(ENTRY)) {
    for (const [label, raw] of [
      ['session_id 숫자', { ...base, session_id: 5 }], ['session_id 객체', { ...base, session_id: { a: 1 } }], ['session_id 경로', { ...base, session_id: '../../../etc' }],
      ['session_id 아주 김', { ...base, session_id: 'a'.repeat(MB) }], ['cwd 없음', { session_id: 's1' }], ['없는 cwd', { ...base, cwd: path.join(tmp, 'no', 'such') }],
      ['transcript 숫자', { ...base, transcript_path: 5 }], ['transcript 폴더', { ...base, transcript_path: tmp }], ['transcript 없음', { ...base, transcript_path: path.join(tmp, 'none.jsonl') }],
      ['transcript NUL', { ...base, transcript_path: 'a\0b' }], ['stop_hook_active 글자', { ...base, stop_hook_active: 'yes' }],
      ['last_assistant_message 객체', { ...base, last_assistant_message: { a: 1 } }],
    ]) cases.push([`${entry} · ${label}`, entry, raw]);
  }
  const garbage = transcript('garbage.jsonl', 'not json\n{"type":\n' + line(null) + line([1]) + line({ type: 'assistant', message: { content: 'x' } }) + line({ type: 'assistant', message: { content: [null, 5, { type: 'text', text: 7 }, { type: 'tool_use', input: null }] } }) + prompt + say('끝'));
  const hashes = transcript('hashes.jsonl', prompt + line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'git commit -m x' } }] } }) + say('abcdef1 '.repeat(MB / 4)));
  for (const [label, file] of [['깨진 줄', garbage], ['해시 모양 글 가득', hashes]]) cases.push([`stop · ${label}`, 'stop', { session_id: 's1', cwd: repo, transcript_path: file }]);
  const cwd = process.cwd();
  process.chdir(repo); // cwd 가 없는 입력은 진입점처럼 프로세스 폴더를 본다(일꾼도 같은 폴더)
  const pool = judgePool(PARALLEL); // 일꾼은 바꾼 HOME·USERPROFILE 을 물려받는다
  try {
    await Promise.all(cases.map(([label, entry, raw]) => judge(pool, entry, raw, label).catch((e) => failures.push(e.message))));
  } finally {
    await pool.close();
    process.chdir(cwd);
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
        const r = await run(entry, { session_id: 's2', cwd, transcript_path: t }, { env: e });
        // 깨진 설정 알림은 PreToolUse 와 세션 시작(한 번뿐)만 — 답·메시지마다 겹치지 않게(전체 검토 2026-11-13)
        if (label === '설정 깨짐' && entry === 'start') {
          assert.equal(r.status, 0, `${entry} · ${label}: 종료 코드`);
          assert.match(JSON.parse(r.stdout).systemMessage || '', /harness\.json/, '세션 시작에 깨진 설정을 알린다');
          continue;
        }
        const j = ok(r, `${entry} · ${label}`);
        if (label === '설정 깨짐') assert.deepEqual(j, {}, '깨진 설정 알림은 PreToolUse·세션 시작이 한다');
      } catch (err) {
        failures.push(err.message);
      }
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('설정이 없는 프로젝트는 규칙 모듈을 불러오지 않고 바로 통과한다', async () => {
  const none = path.join(tmp, 'none');
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

test('lib/entry.mjs 의 때별 훅 id 는 lib/events.mjs 규칙과 같다', () => {
  for (const on of Object.keys(EVENT_HOOK_IDS)) {
    assert.deepEqual([...EVENT_HOOK_IDS[on]].sort(), [...new Set(EVENT_RULES.filter((r) => r.on === on).map((r) => r.id))].sort(), on);
  }
});
