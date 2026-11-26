// 작업 폴더(git 저장소가 아닌 맨 위 + 바로 아래 저장소 여럿 + 같이 쓰는 docs/) 감지·추천·적용·되돌리기·지우기 시험. 네트워크 없이(스킬은 고르지 않는다).
// 픽스처는 사용자 팀의 꼴: GitLab 저장소 넷, 셋은 main + develop(Git Flow), 배포 저장소 하나는 main 만.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpDir, writeFiles } from './helpers.mjs';
import { detect } from '../detect.mjs';
import { workspaceRepos, mergeWorkspace } from '../lib/workspace.mjs';
import { loadAll, recommend, labelsFor } from '../lib/catalog.mjs';
import { plan } from '../lib/plan.mjs';
import { apply, undo } from '../lib/apply-run.mjs';
import { removeAll } from '../lib/remove.mjs';
import { MARKER, launcherText, PLUGIN_DIR } from '../../hooks/lib/git-hook.mjs';
import { BACKUP_DIR } from '../lib/backup.mjs';

const all = loadAll();
const HOOK = path.join('.git', 'hooks', 'pre-commit');
let tmp;
let saved;
const git = (dir, who, ...args) => execFileSync('git', ['-C', dir, '-c', `user.email=${who}@e.com`, '-c', `user.name=${who}`, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
// 저장소 하나: GitLab 원격, 커밋한 사람들(who), develop 이 있으면 develop 으로 옮겨 둔다(실제 저장소처럼 로컬은 develop 에서 일한다)
const repo = (ws, name, { who = ['a'], develop = true, files = {} } = {}) => {
  const dir = path.join(ws, name);
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  git(dir, 'a', 'remote', 'add', 'origin', `https://gitlab.com/acme/${name}.git`);
  writeFiles(dir, { 'package.json': { name, private: true, scripts: { test: 'vitest run' }, dependencies: { react: '18.2.0' } }, ...files });
  git(dir, who[0], 'add', '--', 'package.json', ...Object.keys(files));
  git(dir, who[0], 'commit', '-q', '-m', 'feat: 시작');
  for (const [i, w] of who.slice(1).entries()) {
    fs.writeFileSync(path.join(dir, `f${i}.txt`), `${w}\n`);
    git(dir, w, 'add', '--', `f${i}.txt`);
    git(dir, w, 'commit', '-q', '-m', 'fix: 고침');
  }
  if (develop) git(dir, 'a', 'switch', '-q', '-c', 'develop');
  return dir;
};
// 작업 폴더는 처음 한 번만 git 으로 만들고(저장소 넷에 git 을 스무 번 넘게 띄운다) 사례마다 통째로 복사한다(2026-11-19)
let wsTemplate = null;
const workspace = () => {
  if (!wsTemplate) {
    wsTemplate = tmpDir('harness-ws-tpl-');
    writeFiles(wsTemplate, { 'docs/README.md': '# 문서\n' });
    repo(wsTemplate, 'portal-web', { who: ['a', 'b'], files: { '.gitignore': 'data/raw/\n' } });
    repo(wsTemplate, 'messenger', { who: ['a'] });
    repo(wsTemplate, 'mail', { who: ['c'] });
    repo(wsTemplate, 'portal-deploy', { who: ['a'], develop: false });
  }
  const ws = tmpDir('harness-ws-');
  fs.cpSync(wsTemplate, ws, { recursive: true });
  return ws;
};
let ws;
// 같이 쓰는 작업 폴더(ws)는 어느 시험도 바꾸지 않으니 감지는 폴더마다 한 번(감지 한 번에 저장소마다 git 을 열 번 넘게 띄운다)
const seen = new Map();
const detected = (dir) => {
  if (!seen.has(dir)) seen.set(dir, detect(dir));
  return seen.get(dir);
};
before(() => {
  tmp = tmpDir('harness-ws-top-');
  ws = workspace();
  // apply() 는 플러그인이 켜졌는지 본다 — 플러그인 안에서 도는 것처럼(git-hook-apply.test.mjs 와 같다)
  saved = process.env.CLAUDE_PLUGIN_ROOT;
  process.env.CLAUDE_PLUGIN_ROOT = path.resolve(import.meta.dirname, '..', '..');
  process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET = '100000000';
});
after(() => {
  delete process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET;
  if (saved === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
  else process.env.CLAUDE_PLUGIN_ROOT = saved;
  for (const d of [tmp, ws, wsTemplate]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('작업 폴더 알아보기: 저장소가 아닌 맨 위 + 바로 아래 저장소 둘 이상만', () => {
  assert.deepEqual(workspaceRepos(ws), ['mail', 'messenger', 'portal-deploy', 'portal-web']);
  assert.equal(workspaceRepos(path.join(ws, 'messenger')), null, '저장소 자신');
  assert.equal(workspaceRepos(path.join(ws, 'docs')), null, '저장소 없는 폴더');
  const one = fs.mkdtempSync(path.join(tmp, 'one-'));
  repo(one, 'only');
  assert.equal(workspaceRepos(one), null, '저장소 하나는 작업 폴더가 아니다(그 저장소에서 열면 된다)');
  // 저장소 안의 폴더에 저장소 둘(예제·받아 온 코드)이 있어도 바깥 저장소 하나로 본다
  const outer = path.join(tmp, 'outer');
  repo(tmp, 'outer');
  repo(outer, 'x');
  repo(outer, 'y');
  assert.equal(workspaceRepos(outer), null);
  // 점 폴더·node_modules 안의 .git 은 세지 않는다
  const dots = fs.mkdtempSync(path.join(tmp, 'dots-'));
  repo(dots, '.hidden');
  repo(dots, 'node_modules');
  repo(dots, 'app');
  assert.equal(workspaceRepos(dots), null);
});

test('감지: 저장소마다 읽어 합친다 — 사람은 저장소를 넘어 한 번씩, 위치는 모두 같을 때, develop 은 절반 이상일 때', () => {
  const det = detected(ws);
  assert.equal(det.root, ws);
  assert.equal(det.isGit, false);
  assert.deepEqual(det.workspace.map((r) => r.name), ['mail', 'messenger', 'portal-deploy', 'portal-web']);
  assert.equal(det.authors, 3, 'a·b·c (a 는 세 저장소에 있지만 한 사람)');
  assert.equal(det.team, true);
  assert.equal(det.host, 'gitlab');
  assert.equal(det.hasDevelop, true);
  assert.equal(det.defaultBranch, 'develop');
  assert.ok(det.stack.includes('React'));
  assert.ok(det.kinds.includes('web'));
  assert.equal(det.thin, false);
  // 맨 위에서 돌려도 맞게 저장소 폴더로 들어가는 명령
  assert.ok(det.commands.test.includes('cd portal-web && npm test'), JSON.stringify(det.commands));
  assert.ok(det.commands.test.every((c) => /^cd [\w-]+ && /.test(c)));
  // 보호 경로는 작업 폴더 기준
  assert.ok(det.suggest.protect.includes('portal-web/data/raw/'), JSON.stringify(det.suggest));
  assert.equal(det.suggest.why['portal-web/data/raw/'].at, 'portal-web/.gitignore');
  assert.deepEqual(det.existing, { claudeMd: false, skills: false, harness: false });
  assert.equal(det.history.subjects, 5);
  // 저장소 하나의 감지 결과는 그대로(workspace 칸 없음)
  const one = detected(path.join(ws, 'messenger'));
  assert.equal('workspace' in one, false);
  assert.equal(one.isGit, true);
  assert.deepEqual(one.commands.test, ['npm test']);
});

test('합치기: 위치가 갈리면 mixed, develop 이 절반 못 되면 Git Flow 아님, 형식은 모두 같을 때만', () => {
  const det = (o) => ({ stack: [], kinds: [], commands: {}, suggest: { ask: [], protect: [], why: {} }, history: {}, vcs: { commit: null, pr: { templates: [], title: null, own: false } }, ...o });
  const kindsOf = (stack, signals) => signals;
  const merged = mergeWorkspace('/w', [
    { name: 'a', det: det({ host: 'gitlab', hasDevelop: true, vcs: { commit: { lang: 'ko' }, pr: { templates: ['.gitlab/merge_request_templates/x.md'], title: null, own: true } }, suggest: { ask: ['./deploy.sh'], protect: ['config/prod.json', '.hdf5'], offer: ['results/'], why: { './deploy.sh': { k: 'remote', at: 'deploy.sh' } } } }), authorIds: ['x'] },
    { name: 'b c', det: det({ host: 'github', hasDevelop: false, vcs: { commit: { lang: 'en' }, pr: { templates: [], title: null, own: false } }, commands: { build: ['make build'] } }), authorIds: ['x'] },
    { name: 'd', det: det({ host: 'none', hasDevelop: false }), authorIds: [] },
  ], { kindsOf, existing: {}, branchesMax: 200 });
  assert.equal(merged.host, 'mixed');
  assert.equal(merged.hasDevelop, false, '셋 중 하나');
  assert.equal(merged.authors, 1);
  assert.equal(merged.team, false);
  assert.equal(merged.vcs.commit, null, '커밋 꼴이 저장소마다 다르면 적지 않는다');
  assert.deepEqual(merged.vcs.pr.templates, ['a/.gitlab/merge_request_templates/x.md']);
  assert.deepEqual(merged.commands.build, ['cd "b c" && make build']);
  assert.deepEqual(merged.suggest.ask, ['./deploy.sh']);
  assert.deepEqual(merged.suggest.protect, ['a/config/prod.json', '.hdf5']);
  assert.deepEqual(merged.suggest.offer, ['a/results/']);
  assert.equal(merged.suggest.why['./deploy.sh'].at, 'a/deploy.sh');
  const two = mergeWorkspace('/w', [{ name: 'a', det: det({ host: 'gitlab', hasDevelop: true }) }, { name: 'b', det: det({ host: 'gitlab', hasDevelop: false }) }], { kindsOf, existing: {}, branchesMax: 200 });
  assert.equal(two.hasDevelop, true, '둘 중 하나면 절반');
  assert.equal(two.host, 'gitlab');
});

test('추천: 팀 Git Flow 저장소처럼 — GitLab 이라 GitHub 전용 훅은 빼고, develop 없는 저장소는 이유 줄에 이름을 밝힌다', () => {
  const det = detected(ws);
  const sel = recommend(all, det, 'ko');
  assert.equal(sel.combo, 'team');
  assert.equal(sel.flow, 'git-flow');
  for (const id of ['protect-branch', 'branch-name', 'merge-flow', 'git-add-all', 'no-verify']) assert.ok(sel.hooks.includes(id), id);
  for (const id of ['prefer-gh']) assert.ok(!sel.hooks.includes(id), id);
  const labels = labelsFor(all, sel, 'ko');
  assert.equal(labels.combo, '팀 협업');
  assert.equal(labels.flow, 'Git Flow');
  assert.ok(sel.why.some((w) => w.includes('작업 폴더') && w.includes('portal-web')), sel.why.join('\n'));
  assert.ok(sel.why.some((w) => w.includes('portal-deploy') && w.includes('develop')), sel.why.join('\n'));
  // 같은 저장소 하나를 따로 열었을 때와 같은 조합·전략
  const one = recommend(all, detected(path.join(ws, 'messenger')), 'ko');
  assert.equal(one.flow, sel.flow);
});

const SEL = { lang: 'ko', combo: 'team', skills: [], hooks: ['secrets', 'protect-branch', 'merge-flow'], rules: ['collab'], flow: 'git-flow', explore: [], note: '', share: false };

test('적용 계획: harness.json·CLAUDE.md 는 맨 위(작업 폴더 표시), git 훅은 저장소마다 — 맨 위 .git 은 만들지 않는다', () => {
  const p = plan(ws, SEL, all, { active: true });
  const cfg = JSON.parse(p.changes.find((c) => c.kind === 'config').content);
  assert.deepEqual(cfg.workspace, ['mail', 'messenger', 'portal-deploy', 'portal-web']);
  assert.ok(p.changes.some((c) => c.kind === 'claude-md' && c.path === path.join(ws, 'CLAUDE.md')));
  const hooks = p.changes.filter((c) => c.kind === 'git-hook').map((c) => path.relative(ws, c.path));
  assert.deepEqual(hooks.sort(), ['mail', 'messenger', 'portal-deploy', 'portal-web'].map((r) => path.join(r, HOOK)));
  assert.ok(!p.changes.some((c) => /^\.git[\\/]/.test(path.relative(ws, c.path))),'맨 위 .git 에는 쓰지 않는다');
  assert.deepEqual(p.workspace.map((r) => [r.name, r.gitHook]), [['mail', 'install'], ['messenger', 'install'], ['portal-deploy', 'install'], ['portal-web', 'install']]);
});

test('적용 계획: 남의 훅·core.hooksPath 가 있는 저장소는 덮어쓰지 않고 저장소 이름과 함께 알린다', () => {
  const w = workspace();
  try {
    fs.writeFileSync(path.join(w, 'mail', HOOK), '#!/bin/sh\nnpm test\n');
    git(path.join(w, 'messenger'), 'a', 'config', 'core.hooksPath', '.husky');
    writeFiles(path.join(w, 'portal-web'), { '.pre-commit-config.yaml': 'repos: []\n' });
    const p = plan(w, SEL, all, { active: true });
    const by = Object.fromEntries(p.workspace.map((r) => [r.name, r.gitHook]));
    assert.deepEqual(by, { mail: 'git-hook-exists', messenger: 'git-hook-exists', 'portal-deploy': 'install', 'portal-web': 'pre-commit' });
    assert.ok(p.warnings.includes('git-hook-exists'));
    assert.ok(p.gitHookCmd, '이어 붙일 한 줄');
    assert.equal(fs.readFileSync(path.join(w, 'mail', HOOK), 'utf8'), '#!/bin/sh\nnpm test\n');
    assert.ok(!p.changes.some((c) => c.kind === 'pre-commit-runner'), '작업 폴더에서는 저장소 안에 실행 파일을 만들지 않는다');
  } finally {
    fs.rmSync(w, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('적용 → 되돌리기: 저장소마다 넣은 git 훅까지 모두 원래대로', async () => {
  const w = workspace();
  try {
    // mail 에는 우리 훅이 이미 있다(전에 mail 만 따로 적용) — 그대로 두고, 되돌려도 남아야 한다
    fs.writeFileSync(path.join(w, 'mail', HOOK), launcherText(PLUGIN_DIR));
    const r = await apply(w, SEL);
    assert.ok(r.changed.includes('+ messenger/.git/hooks/pre-commit'), r.changed.join('\n'));
    assert.deepEqual(r.workspace.map((x) => x.gitHook), ['current', 'install', 'install', 'install']);
    for (const name of ['mail', 'messenger', 'portal-deploy', 'portal-web']) assert.match(fs.readFileSync(path.join(w, name, HOOK), 'utf8'), new RegExp(MARKER));
    assert.ok(!fs.existsSync(path.join(w, '.git')));
    const u = undo(w);
    assert.ok(u.removed.includes('messenger/.git/hooks/pre-commit'), JSON.stringify(u));
    assert.ok(!u.skipped, JSON.stringify(u));
    for (const name of ['messenger', 'portal-deploy', 'portal-web']) assert.ok(!fs.existsSync(path.join(w, name, HOOK)), name);
    assert.equal(fs.readFileSync(path.join(w, 'mail', HOOK), 'utf8'), launcherText(PLUGIN_DIR), '적용 전부터 있던 우리 훅');
    assert.ok(!fs.existsSync(path.join(w, '.claude', 'harness.json')));
    assert.ok(!fs.existsSync(path.join(w, 'CLAUDE.md')));
  } finally {
    fs.rmSync(w, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('되돌리기: 적용 뒤 저장소에서 바꾼 훅은 두고, 가짜 백업 목록의 저장소 밖·이상한 경로는 건드리지 않는다', async () => {
  const w = workspace();
  try {
    await apply(w, SEL);
    fs.writeFileSync(path.join(w, 'mail', HOOK), '#!/bin/sh\nnpx lint-staged\n');
    // 목록에 심어 둔 경로: 두 단계 아래 저장소·점 폴더·밖(..)의 훅 — 우리 실행기가 있어도 건드리지 않는다
    const nested = path.join(w, 'portal-web', 'sub');
    execFileSync('git', ['init', '-q', nested]);
    fs.writeFileSync(path.join(nested, HOOK), launcherText(PLUGIN_DIR));
    const bk = path.join(w, BACKUP_DIR);
    const mf = path.join(bk, fs.readdirSync(bk)[0], 'manifest.json');
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    const planted = ['portal-web/sub/.git/hooks/pre-commit', '../x/.git/hooks/pre-commit', '.x/.git/hooks/pre-commit'];
    m.entries.push(...planted.map((p) => ({ path: p, kind: 'git-hook', action: 'create' })));
    fs.writeFileSync(mf, JSON.stringify(m));
    const u = undo(w);
    assert.deepEqual(u.skipped.sort(), [...planted].sort());
    assert.ok(fs.existsSync(path.join(nested, HOOK)));
    assert.ok(u.kept.includes('mail/.git/hooks/pre-commit'));
    assert.equal(fs.readFileSync(path.join(w, 'mail', HOOK), 'utf8'), '#!/bin/sh\nnpx lint-staged\n');
  } finally {
    fs.rmSync(w, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('명령줄 apply.mjs: 맨 위 CLAUDE.md 의 「이 저장소 명령」은 저장소 폴더로 들어가는 꼴, 결과에 저장소마다 git 훅', () => {
  const w = workspace();
  try {
    const file = path.join(w, '..', `${path.basename(w)}-sel.json`);
    fs.writeFileSync(file, JSON.stringify({ ...SEL, rules: ['collab', 'commands'] }));
    const out = JSON.parse(execFileSync(process.execPath, [path.join(import.meta.dirname, '..', 'apply.mjs'), w, '--selection', file], { encoding: 'utf8' }));
    fs.rmSync(file, { force: true });
    assert.deepEqual(out.workspace.map((r) => r.name), ['mail', 'messenger', 'portal-deploy', 'portal-web']);
    const md = fs.readFileSync(path.join(w, 'CLAUDE.md'), 'utf8');
    assert.match(md, /`cd portal-web && npm test`/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(w, '.claude', 'harness.json'), 'utf8')).workspace.length, 4);
  } finally {
    fs.rmSync(w, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('지우기(--remove): 저장소마다 넣은 우리 git 훅도 뺀다', async () => {
  const w = workspace();
  try {
    await apply(w, SEL);
    const dry = removeAll(w, { dryRun: true });
    assert.ok(dry.removed.includes('portal-web/.git/hooks/pre-commit'), JSON.stringify(dry));
    removeAll(w);
    for (const name of ['mail', 'messenger', 'portal-deploy', 'portal-web']) assert.ok(!fs.existsSync(path.join(w, name, HOOK)), name);
  } finally {
    fs.rmSync(w, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
