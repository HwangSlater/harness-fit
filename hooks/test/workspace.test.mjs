// 작업 폴더(git 저장소가 아닌 맨 위 + 바로 아래 저장소 여럿) 훅 시험: 설정 찾기(loadConfig), git 규칙이 명령이 닿는 저장소를 보는지,
// 보호 경로·마이그레이션이 저장소 안에서도 작업 폴더 기준 경로로 맞는지, git pre-commit 본체가 저장소 안에서 작업 폴더 설정을 읽는지.
// ⚠️ 세션 cwd 가 저장소 안이면(Claude Code 는 cd 를 이어 간다) loadConfig 가 그 저장소의 .git 에서 멈춰 설정을 못 찾아 모든 검사가 조용히 꺼졌다(0.2.0 에서 잼).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig } from '../lib/core.mjs';
import { evaluate } from '../lib/evaluate.mjs';
import { packs, gitIn, HOOK, runEntry } from './helpers/hook-proc.mjs';

const GITFLOW = packs.flows.find((f) => f.id === 'git-flow').hooks;
const RULES = { 'protect-branch': GITFLOW['protect-branch'], 'git-add-all': true, secrets: true, 'protected-files': { paths: ['messenger/data/raw/'] }, 'migration-edit': true };
const REPOS = ['messenger', 'portal-web'];
let ws;
const at = (...p) => path.join(ws, ...p);
const writeCfg = (dir, cfg) => {
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'harness.json'), JSON.stringify(cfg));
};
const makeChild = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
  gitIn(path.dirname(dir), 'init', '-q', '-b', 'main', path.basename(dir));
  gitIn(dir, 'config', 'user.email', 't@example.com');
  gitIn(dir, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'README.md'), 'hi\n');
  gitIn(dir, 'add', 'README.md');
  gitIn(dir, 'commit', '-q', '-m', 'chore: 시작');
};
const bash = (cwd, command) => evaluate({ tool_name: 'Bash', cwd, tool_input: { command } });
const write = (cwd, file_path) => evaluate({ tool_name: 'Write', cwd, tool_input: { file_path, content: 'x\n' } });

before(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-ws-'));
  fs.mkdirSync(at('docs'));
  fs.writeFileSync(at('docs', 'README.md'), '# 문서\n');
  for (const r of REPOS) makeChild(at(r));
  fs.mkdirSync(at('messenger', 'src'));
  writeCfg(ws, { lang: 'en', rules: RULES, workspace: REPOS });
});
after(() => fs.rmSync(ws, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

test('loadConfig: 저장소 안(하위 폴더 포함)에서도 바로 위 작업 폴더 설정을 찾는다', () => {
  for (const cwd of [ws, at('docs'), at('messenger'), at('messenger', 'src'), at('portal-web')]) {
    const cfg = loadConfig(cwd);
    assert.ok(cfg, cwd);
    assert.equal(path.resolve(cfg.root), path.resolve(ws), cwd);
    assert.deepEqual(cfg.workspace, REPOS);
  }
});

test('loadConfig: 저장소 자신의 설정이 있으면 그것이 먼저다', () => {
  const own = at('portal-web');
  writeCfg(own, { lang: 'en', rules: { 'danger-cmd': true } });
  try {
    assert.equal(path.resolve(loadConfig(own).root), path.resolve(own));
  } finally {
    fs.rmSync(path.join(own, '.claude'), { recursive: true, force: true });
  }
});

test('loadConfig: 작업 폴더 표시가 없는 위 설정·깨진 위 설정·두 단계 위 설정은 저장소 안으로 새지 않는다', () => {
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-ws-leak-'));
  try {
    makeChild(path.join(top, 'app'));
    // 표시 없음(그냥 위 폴더에 적용한 설정 — 예전처럼 .git 에서 멈춘다)
    writeCfg(top, { lang: 'en', rules: { 'danger-cmd': true } });
    assert.equal(loadConfig(path.join(top, 'app')), null);
    // workspace 가 목록이 아님
    writeCfg(top, { lang: 'en', rules: {}, workspace: 'yes' });
    assert.equal(loadConfig(path.join(top, 'app')), null);
    // 깨진 설정은 작업 폴더인지 알 수 없다 — 남의 저장소에 「설정이 깨졌다」 알림을 내지 않게 아무것도 하지 않는다
    fs.writeFileSync(path.join(top, '.claude', 'harness.json'), '{ broken');
    assert.equal(loadConfig(path.join(top, 'app')), null);
    // 저장소의 저장소(submodule 꼴): 바로 위가 저장소면 그 위 작업 폴더까지는 가지 않는다
    writeCfg(top, { lang: 'en', rules: {}, workspace: ['app'] });
    makeChild(path.join(top, 'app', 'sub'));
    assert.equal(loadConfig(path.join(top, 'app', 'sub')), null);
    assert.ok(loadConfig(path.join(top, 'app')));
  } finally {
    fs.rmSync(top, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('보호 브랜치: 명령이 실제로 닿는 저장소로 본다(cwd 가 저장소 안 · cd 저장소 && · git -C 저장소)', () => {
  assert.equal(bash(at('messenger'), 'git commit -m "feat: x"').length, 1, 'cwd 가 저장소 안');
  assert.equal(bash(at('messenger', 'src'), 'git commit -m "feat: x"').length, 1, 'cwd 가 저장소의 하위 폴더');
  assert.equal(bash(ws, 'cd messenger && git commit -m "feat: x"').length, 1, 'cd 저장소 &&');
  assert.equal(bash(ws, 'git -C portal-web commit -m "feat: x"').length, 1, 'git -C 저장소');
  // 맨 위(저장소 아님)에서 저장소에 닿지 않는 명령은 git 규칙이 볼 것이 없다
  for (const c of ['git status', 'git commit -m "feat: x"', 'ls docs', 'echo hi']) assert.deepEqual(bash(ws, c), [], c);
  assert.deepEqual(bash(at('docs'), 'git commit -m "feat: x"'), [], 'docs/ 는 저장소가 아니다');
});

test('보호 브랜치: 기능 브랜치·다른 저장소의 브랜치는 따로 본다', () => {
  gitIn(at('messenger'), 'switch', '-q', '-c', 'feature/a');
  try {
    assert.deepEqual(bash(at('messenger'), 'git commit -m "feat: x"'), []);
    assert.equal(bash(at('messenger'), 'git -C ../portal-web commit -m "feat: x"').length, 1, 'portal-web 은 아직 main');
  } finally {
    gitIn(at('messenger'), 'switch', '-q', 'main');
  }
});

test('보호 경로: 작업 폴더 기준 경로(messenger/data/raw/)를 맨 위·저장소 안 어디서 써도, git add 해도 막는다', () => {
  assert.equal(write(ws, 'messenger/data/raw/a.csv').length, 1, '맨 위에서');
  assert.equal(write(at('messenger'), 'data/raw/a.csv').length, 1, '저장소 안에서');
  assert.deepEqual(write(at('portal-web'), 'data/raw/a.csv'), [], '다른 저장소의 같은 이름 폴더는 아니다');
  fs.mkdirSync(at('messenger', 'data', 'raw'), { recursive: true });
  fs.writeFileSync(at('messenger', 'data', 'raw', 'a.csv'), 'a\n');
  try {
    assert.equal(bash(at('messenger'), 'git add data/raw/a.csv').length, 1, 'git add — 저장소 기준 경로를 작업 폴더 기준으로도 맞춘다');
  } finally {
    fs.rmSync(at('messenger', 'data'), { recursive: true, force: true });
  }
});

test('마이그레이션: 커밋한 마이그레이션 고치기를 저장소 안·맨 위에서 모두 본다', () => {
  const mig = at('messenger', 'db', 'migrate');
  fs.mkdirSync(mig, { recursive: true });
  fs.writeFileSync(path.join(mig, '20240101000000_init.rb'), 'class Init; end\n');
  gitIn(at('messenger'), 'add', 'db');
  gitIn(at('messenger'), 'commit', '-q', '-m', 'feat: 표');
  assert.equal(write(at('messenger'), 'db/migrate/20240101000000_init.rb').length, 1, '저장소 안에서');
  assert.equal(write(ws, 'messenger/db/migrate/20240101000000_init.rb').length, 1, '맨 위에서');
  assert.deepEqual(write(at('messenger'), 'db/migrate/20250101000000_next.rb'), [], '새 마이그레이션은 통과');
});

test('진입점(hooks/run.mjs): 저장소 안 cwd 에서도 작업 폴더 설정으로 막는다', async () => {
  const input = JSON.stringify({ tool_name: 'Bash', cwd: at('messenger'), tool_input: { command: 'git commit -m "feat: x"' } });
  const r = await runEntry(HOOK('run.mjs'), input, { cwd: at('messenger') });
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision, 'deny', r.stdout);
});

test('git pre-commit 본체: 저장소 안에서 돌 때 작업 폴더 설정의 쓰기 훅으로 커밋을 막는다', () => {
  const dir = at('portal-web');
  fs.writeFileSync(path.join(dir, '.env'), 'A=1\n');
  gitIn(dir, 'add', '-f', '.env');
  try {
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (/^GIT_/.test(k)) delete env[k];
    const r = spawnSync(process.execPath, [HOOK('git-pre-commit.mjs')], { cwd: dir, encoding: 'utf8', env });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /\.env/);
  } finally {
    gitIn(dir, 'rm', '-q', '--cached', '.env');
    fs.rmSync(path.join(dir, '.env'), { force: true });
  }
});
