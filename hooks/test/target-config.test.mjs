// 호출이 닿는 저장소의 설정으로 판정하는지(hooks/lib/target-config.mjs configsFor).
// ⚠️ 설정이 없는 폴더에서 연 세션이 `cd …/portal-deploy && git …`·`git -C …` 로 팀 저장소를 만졌는데
//    loadConfig(세션 cwd) 가 null 이라 PreToolUse 규칙이 하나도 돌지 않았다(2026-11-21).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluate } from '../lib/evaluate.mjs';
import { configsFor, MAX_TARGETS } from '../lib/target-config.mjs';
import { commandCwd } from '../lib/core.mjs';
import { ALL_RULES, FLOW_OPTS, makeRepo, HOOK, runEntry } from './helpers/hook-proc.mjs';

let base;
const at = (...p) => path.join(base, ...p);
const PB = { 'protect-branch': FLOW_OPTS['protect-branch'] };
const writeCfg = (dir, cfg) => {
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'harness.json'), JSON.stringify({ lang: 'en', ...cfg }));
};
const bash = (cwd, command, tool = 'Bash') => evaluate({ tool_name: tool, cwd, tool_input: { command } });
const write = (cwd, file_path) => evaluate({ tool_name: 'Write', cwd, tool_input: { file_path, content: 'x\n' } });
const COMMIT = 'git commit -m "feat: x"';

// plain: 설정 없는 저장소(세션 cwd — naver 꼴, main) · team/deploy: 작업 폴더 설정으로 덮인 저장소(portal-deploy 꼴)
// own: 자기 설정(보호 브랜치 + 보호 경로) · other: 자기 설정(git-add-all 만 — cwd 설정과 대상 설정을 함께 보기)
before(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-target-'));
  makeRepo(at('plain'));
  fs.rmSync(at('plain', '.claude'), { recursive: true, force: true });
  fs.mkdirSync(at('team'));
  makeRepo(at('team', 'deploy'));
  fs.rmSync(at('team', 'deploy', '.claude'), { recursive: true, force: true });
  writeCfg(at('team'), { rules: { ...PB, 'protected-files': { paths: ['deploy/secrets/'] } }, workspace: ['deploy'] });
  makeRepo(at('own'), { ...PB, 'protected-files': { paths: ['data/raw/'] } });
  makeRepo(at('other'), { 'git-add-all': true });
  // 독립 검토 회귀용: strict(모든 훅) · lax(빈 규칙) · brk(깨진 설정) · emp(저장소 아닌 폴더의 빈 설정)
  // loose(저장소 아닌 폴더의 엄한 설정) · plain2/sub(저장소 속 하위 폴더의 설정) — 뒤 둘은 대상으로 치지 않는다
  makeRepo(at('strict'));
  makeRepo(at('lax'), {});
  makeRepo(at('brk'));
  fs.writeFileSync(at('brk', '.claude', 'harness.json'), '{ broken');
  fs.mkdirSync(at('emp'));
  writeCfg(at('emp'), { rules: {} });
  fs.mkdirSync(at('loose'));
  writeCfg(at('loose'), { rules: ALL_RULES });
  makeRepo(at('plain2'));
  fs.rmSync(at('plain2', '.claude'), { recursive: true, force: true });
  fs.mkdirSync(at('plain2', 'sub'));
  writeCfg(at('plain2', 'sub'), { rules: ALL_RULES });
});
after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

test('설정 없는 cwd: cd 저장소 && git commit 을 그 저장소(작업 폴더 설정)의 보호 브랜치로 막는다', () => {
  assert.equal(bash(at('plain'), `cd "${at('team', 'deploy')}" && ${COMMIT}`).length, 1, '절대 경로');
  assert.equal(bash(at('plain'), `cd ../team/deploy && ${COMMIT}`).length, 1, '상대 경로');
  assert.equal(bash(at('plain'), `Set-Location ../own; ${COMMIT}`, 'PowerShell').length, 1, 'PowerShell Set-Location');
  assert.equal(bash(at('plain'), `bash -c "cd ../own && ${COMMIT.replace(/"/g, "'")}"`).length, 1, 'bash -c 속 cd');
});

test('설정 없는 cwd: git -C 저장소 커밋도 막는다', () => {
  assert.equal(bash(at('plain'), `git -C "${at('own')}" ${COMMIT.slice(4)}`).length, 1);
  assert.equal(bash(at('plain'), `git -C ../team/deploy ${COMMIT.slice(4)}`).length, 1);
});

test('설정 없는 cwd: 설정이 있는 저장소의 파일 쓰기는 그 저장소 설정으로 본다', () => {
  assert.equal(write(at('plain'), at('own', 'data', 'raw', 'a.csv')).length, 1, '절대 경로');
  assert.equal(write(at('plain'), '../own/data/raw/a.csv').length, 1, '상대 경로');
  assert.equal(write(at('plain'), at('team', 'deploy', 'secrets', 'k.txt')).length, 1, '작업 폴더 설정의 경로');
  assert.deepEqual(write(at('plain'), 'data/raw/a.csv'), [], 'cwd 저장소의 같은 이름 폴더는 아니다');
  assert.deepEqual(write(at('plain'), at('own', 'src', 'a.js')), [], '보호 경로가 아닌 파일');
});

const found = (cwd, command, tool = 'Bash') => configsFor({ tool_name: tool, cwd, tool_input: tool === 'Bash' || tool === 'PowerShell' ? { command } : { file_path: command } }).found;
const names = (list) => list.map((f) => path.basename(f.cfg.root)).sort();

test('설정 있는 저장소에 닿지 않는 명령은 지금처럼 통과한다', () => {
  for (const c of [COMMIT, 'ls -la', 'cd src && ls', `git -C . ${COMMIT.slice(4)}`, 'git add -A', `cd "${os.tmpdir()}" && ${COMMIT}`]) {
    assert.deepEqual(bash(at('plain'), c), [], c);
    assert.deepEqual(found(at('plain'), c), [], c);
  }
  assert.deepEqual(configsFor({ tool_name: 'Glob', cwd: at('plain'), tool_input: { pattern: '../own/**' } }).found, [], '다른 도구');
});

test('대상으로 치는 설정은 저장소 맨 위·작업 폴더 설정뿐 — 저장소 밖 폴더·저장소 속 하위 폴더의 설정은 치지 않는다', () => {
  assert.deepEqual(found(at('plain'), 'cd ../loose && rm -rf ~'), [], '저장소 밖 폴더');
  assert.deepEqual(bash(at('plain'), 'cd ../loose && rm -rf ~'), []);
  assert.deepEqual(found(at('plain'), 'cd ../plain2/sub && rm -rf ~'), [], '저장소 속 하위 폴더');
  assert.deepEqual(names(found(at('plain'), 'cd ../team/deploy && ls')), ['team'], '작업 폴더 설정');
});

test('따옴표 속 글(커밋 메시지·echo)의 cd·git -C 로는 옮겨 가지 않는다', () => {
  for (const c of [`git commit -m "cd ../own && ${COMMIT.replace(/"/g, "'")}"`, `echo "git -C ../own commit -m x"`, `git commit -m 'wip; cd ../own; git -C ../own commit'`]) {
    assert.equal(commandCwd(c, at('plain')), at('plain'), c);
    assert.deepEqual(bash(at('plain'), c), [], c);
  }
});

test('commandCwd: 줄바꿈 구분 · Set-Location -LiteralPath · git -C 여러 번 · Windows 의 Git Bash 경로', () => {
  assert.equal(commandCwd('cd ../own\ngit commit -m x', at('plain')), at('own'));
  assert.equal(commandCwd(`Set-Location -LiteralPath "${at('own')}"; git status`, at('plain')), at('own'));
  assert.equal(commandCwd('git -C .. -C own status', at('plain')), at('own'));
  assert.equal(bash(at('plain'), `cd ../own\n${COMMIT}`).length, 1, '줄바꿈 뒤 커밋');
  if (process.platform === 'win32') {
    const gitBash = at('own').replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`).replace(/\\/g, '/');
    assert.equal(commandCwd(`cd ${gitBash} && ls`, at('plain')).toLowerCase(), at('own').toLowerCase());
    assert.equal(bash(at('plain'), `cd ${gitBash} && ${COMMIT}`).length, 1, 'Git Bash 경로');
  }
});

test('cwd 에 설정이 있으면 cwd 설정은 늘 호출 전체를 보고, 대상 저장소의 설정이 더해진다', () => {
  // other(git-add-all 만) → own(보호 브랜치만): 둘 다 본다
  assert.equal(bash(at('other'), `git -C ../own ${COMMIT.slice(4)}`).length, 1, '대상 설정의 보호 브랜치');
  assert.equal(bash(at('other'), 'git -C ../own add -A').length, 1, 'cwd 설정의 git-add-all 도 그대로');
  assert.deepEqual(names(found(at('other'), 'git -C ../own status')), ['other', 'own']);
  assert.equal(bash(at('other'), 'git add -A').length, 1, 'cwd 저장소는 cwd 설정');
  assert.equal(bash(at('other'), 'git -C ../plain add -A').length, 1, '설정 없는 대상은 cwd 설정');
  assert.equal(bash(at('own'), `git -C ../plain ${COMMIT.slice(4)}`).length, 1, '설정 없는 대상 + cwd 의 보호 브랜치');
  assert.equal(write(at('other'), '../own/data/raw/a.csv').length, 1, '파일 쓰기도 대상 설정이 더해진다');
});

// 독립 검토(2026-11-23)가 찾은 회귀: 대상 설정이 cwd 설정을 대신하면, 느슨한·빈·깨진 설정 폴더로 먼저 옮겨 가 cwd 저장소의 위험 명령이 통과했다
test('회귀: 느슨한·깨진·빈 설정으로 먼저 옮겨 가도 cwd 설정은 그대로 막는다', () => {
  const s = at('strict');
  for (const c of ['cd ../lax && cd - && git push --force origin main', 'git -C ../lax status; git commit -m x', 'git -C ../lax -C ../strict push --force origin main', 'cd ../brk && cd ../strict && rm -rf ~', 'cd ../emp; cd -; rm -rf ~']) {
    assert.ok(bash(s, c).length >= 1, c);
  }
  for (const f of ['../brk/.env', '../emp/.env', '../lax/.env']) assert.ok(write(s, f).length >= 1, f);
});

test('Read: 설정 없는 cwd 에서 설정 있는 저장소의 비밀 파일 읽기를 그 설정으로 묻는다', () => {
  const ask = (file) => {
    const asks = [];
    evaluate({ tool_name: 'Read', cwd: at('plain'), tool_input: { file_path: file } }, [], [], [], asks);
    return asks;
  };
  assert.ok(ask(at('strict', 'kubeconfig.yaml')).length >= 1);
  assert.deepEqual(ask(at('plain', 'kubeconfig.yaml')), []);
});

test('한 명령이 설정 여럿에 닿으면 설정마다 제 조각만 본다', () => {
  const cmd = `git -C ../other add -A; bash -c "git -C ../own commit -m 'feat: x'"`;
  const list = found(at('plain'), cmd);
  assert.deepEqual(names(list), ['other', 'own']);
  assert.ok(list.every((f) => f.scope.only instanceof Set && f.scope.only.size === 1));
  assert.equal(bash(at('plain'), cmd).length, 2, 'git-add-all(other) + 보호 브랜치(own)');
  // 설정 없는 곳에 닿는 조각(cwd 의 main 커밋)은 다른 조각의 설정으로 보지 않는다
  const mixed = `git -C ../other status; bash -c "git commit -m 'feat: x'"`;
  assert.deepEqual(bash(at('plain'), mixed), [], mixed);
  assert.deepEqual([...found(at('plain'), mixed)[0].scope.only], [at('other')]);
});

test('대상이 너무 많으면 대상 설정은 보지 않고(cwd 설정만), 많아도 빨리 끝난다', () => {
  const many = (n) => [`git -C ../own status`, ...Array.from({ length: n }, (_, i) => `bash -c "cd ../d${i} && ls"`)].join('; ');
  assert.deepEqual(names(found(at('plain'), many(MAX_TARGETS - 1))), ['own'], '한도 안');
  assert.deepEqual(found(at('plain'), many(MAX_TARGETS)), [], '한도 넘음 — cwd 에 설정이 없으면 통과');
  assert.deepEqual(names(found(at('other'), many(MAX_TARGETS))), ['other'], '한도 넘음 — cwd 설정만');
  const t0 = performance.now();
  configsFor({ tool_name: 'Bash', cwd: at('plain'), tool_input: { command: many(2000) } });
  const ms = performance.now() - t0;
  assert.ok(ms < 2000, `${ms.toFixed(0)}ms`);
});

test('진입점(hooks/run.mjs): 설정 없는 cwd 에서 cd 저장소 && git commit 을 막고, 닿지 않으면 그냥 통과', async () => {
  const run = (command, cwd = at('plain')) => runEntry(HOOK('run.mjs'), JSON.stringify({ tool_name: 'Bash', cwd, tool_input: { command } }), { cwd });
  const r = await run(`cd ../team/deploy && ${COMMIT}`);
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision, 'deny', r.stdout);
  assert.equal((await run(COMMIT)).stdout, '{}');
  // 대상 설정이 깨졌으면 알리고 통과(cwd 에 설정이 없을 때)
  const b = JSON.parse((await run(`git -C ../brk ${COMMIT.slice(4)}`)).stdout);
  assert.match(b.systemMessage || '', /harness\.json/);
  assert.equal(b.hookSpecificOutput, undefined);
  // cwd 에 설정이 있으면 깨진 대상 설정은 알림만 더하고 cwd 설정으로 막는다
  const s = JSON.parse((await run('cd ../brk && cd ../strict && rm -rf ~', at('strict'))).stdout);
  assert.equal(s.hookSpecificOutput?.permissionDecision, 'deny', JSON.stringify(s));
});
