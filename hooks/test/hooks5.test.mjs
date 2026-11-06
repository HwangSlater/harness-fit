// 훅 3개(no-rewrite-pushed · gha-inject · pr-merge) 시험. node --test hooks/test
// 잘못 막는 것이 놓치는 것보다 나쁘다 — 「막아야 할 것」과 「통과해야 할 것」을 함께 둔다.
// 막아야 할 코드 글은 이어 붙여 만든다(이 파일을 고칠 때 harness-fit 훅이 이 파일을 막지 않게).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { evaluate } from '../lib/evaluate.mjs';
import { untrustedIn } from '../lib/gha-inject.mjs';
import { parseRebase, parsePrMerge } from '../rules/history.mjs';
import { loadAll, expandCombo, applyFlow } from '../../scripts/lib/catalog.mjs';
import { renderRule } from '../../scripts/lib/claude-md.mjs';

let repo;
const setRules = (rules) => fs.writeFileSync(path.join(repo, '.claude', 'harness.json'), JSON.stringify({ lang: 'en', rules }));
const run = (tool_name, tool_input) => evaluate({ tool_name, cwd: repo, tool_input });
const write = (file_path, content) => run('Write', { file_path, content });
const edit = (file_path, old_string, new_string) => run('Edit', { file_path, old_string, new_string });
const bash = (command) => run('Bash', { command });
const put = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), text);
};
const blocks = (file, list) => list.forEach((c) => assert.equal(write(file, c).length, 1, `막아야 함(${file}): ${c}`));
const allows = (file, list) => list.forEach((c) => assert.deepEqual(write(file, c), [], `통과해야 함(${file}): ${c}`));
const g = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
const commit = (file, text, msg) => {
  put(file, text);
  g('add', file);
  g('commit', '-q', '-m', msg);
  return g('rev-parse', 'HEAD');
};


before(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-h5-'));
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  g('config', 'user.email', 't@example.com');
  g('config', 'user.name', 't');
  fs.mkdirSync(path.join(repo, '.claude'));
});
after(() => fs.rmSync(repo, { recursive: true, force: true }));
const WF = '.github/workflows/ci.yml';
const prt = (ref) => `on:\n  pull_request_target:\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: \${{ ${ref} }}\n`;

test('gha-inject: run 에 바깥 값, pull_request_target + PR 코드, 고정 안 한 액션을 막는다', () => {
  setRules({ 'gha-inject': true });
  blocks(WF, [
    'on: issues\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "${{ github.event.issue.title }}"\n',
    'on: pull_request\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - name: b\n        run: |\n          git checkout ${{ github.head_ref }}\n',
    'on: push\njobs:\n  t:\n    steps:\n      - run: echo "${{ github.event.commits[0].message }}"\n',
    prt('github.event.pull_request.head.sha'),
    'on: push\njobs:\n  t:\n    steps:\n      - uses: tj-actions/changed-files@v45\n',
  ]);
});

test('gha-inject: env 로 넘기기·저장소 쪽 값·SHA 고정·actions/·로컬은 통과한다', () => {
  setRules({ 'gha-inject': true });
  allows(WF, [
    'on: issues\njobs:\n  t:\n    steps:\n      - env:\n          TITLE: ${{ github.event.issue.title }}\n        run: echo "$TITLE"\n',
    'on: push\njobs:\n  t:\n    steps:\n      - run: echo "${{ github.event.repository.name }} ${{ github.sha }} ${{ github.event.pull_request.base.ref }}"\n',
    'on: push\njobs:\n  t:\n    steps:\n      - uses: actions/checkout@v4\n      - uses: github/codeql-action/init@v3\n      - uses: ./.github/actions/local\n      - uses: docker://alpine:3.20\n      - uses: tj-actions/changed-files@' + 'a'.repeat(40) + ' # v45\n',
    prt('github.sha').replace('pull_request_target', 'pull_request'),
    '# run: echo "${{ github.event.issue.title }}"\non: push\n',
  ]);
  // 다른 파일·이미 있던 것
  allows('docs/ci.yml', ['steps:\n  - uses: tj-actions/changed-files@v45\n']);
  const old = 'on: push\njobs:\n  t:\n    steps:\n      - uses: tj-actions/changed-files@v45\n';
  put(WF, old);
  assert.deepEqual(edit(WF, 'on: push', 'on: [push, workflow_dispatch]'), []);
  assert.equal(edit(WF, '      - uses: tj', '      - uses: some/action@main\n      - uses: tj').length, 1);
  fs.rmSync(path.join(repo, WF));
});

test('gha-inject: 바깥 값 판정', () => {
  assert.deepEqual(untrustedIn(' github.event.pull_request.head.ref '), ['github.event.pull_request.head.ref']);
  assert.deepEqual(untrustedIn(" toJSON(github.event.comment.body) "), ['github.event.comment.body']);
  assert.deepEqual(untrustedIn(' github.event.workflow_run.name '), []);
  assert.deepEqual(untrustedIn(' github.event.pull_request.number '), []);
});

test('pr-merge: squash·브랜치 지우기가 없으면 막는다', () => {
  setRules({ 'pr-merge': true });
  for (const c of ['gh pr merge 12', 'gh pr merge 12 --merge --delete-branch', 'gh pr merge --squash', 'git fetch && gh pr merge 3 -s', 'gh pr merge 3 --rebase -d'])
    assert.equal(bash(c).length, 1, c);
  assert.match(bash('gh pr merge 12')[0], /--squash.*--delete-branch/);
  for (const c of ['gh pr merge 12 --squash --delete-branch', 'gh pr merge 12 -s -d --auto', 'gh pr merge -sd 12', 'gh pr view 12', 'git commit -m "gh pr merge 12"', 'echo "gh pr merge"', 'gh pr merge 12 --squash --delete-branch --subject "-m x"'])
    assert.deepEqual(bash(c), [], c);
  assert.deepEqual(parsePrMerge(['12', '-t', '-s', '-d']), { squash: false, del: true });
  assert.equal(run('PowerShell', { command: '& gh pr merge 12' }).length, 1);
  assert.deepEqual(run('PowerShell', { command: 'gh pr merge 12 --squash --delete-branch' }), []);
});

test('규칙 글: 훅이 켜지면 그 줄만 빠지고, 스킬이 맡는 줄(주입·권한·로그)은 스킬이 있을 때만 빠진다', () => {
  const noSkill = renderRule('security', 'ko', ['secrets', 'danger-cmd', 'pin-deps']);
  assert.match(noSkill, /SQL·셸·파일 경로·HTML/);
  assert.match(noSkill, /개인정보/);
  assert.doesNotMatch(noSkill, /정확한 버전/);
  const skill = renderRule('security', 'ko', [], [], ['security-and-hardening']);
  assert.doesNotMatch(skill, /SQL·셸|개인정보|권한 검사/);
  assert.match(skill, /키·토큰/);
  // amend·rebase 만 막으므로 reset·강제 push 로 다시 쓰는 것은 글로 남는다
  const collab = renderRule('collab', 'ko', ['no-rewrite-pushed']);
  assert.doesNotMatch(collab, /다시 쓰지 않는다/);
  assert.match(collab, /reset·filter-branch/);
  assert.doesNotMatch(renderRule('collab', 'ko', []), /reset·filter-branch/);
  assert.doesNotMatch(renderRule('github-flow', 'en', ['pr-merge']), /Squash-merge/);
  assert.match(renderRule('github-flow', 'en', []), /Squash-merge/);
});

test('pr-merge 는 GitHub Flow 를 쓰는 조합에만 들어간다(브랜치 방식으로)', () => {
  const all = loadAll();
  const det = { stack: [], existing: {} };
  for (const c of all.combos.combos) {
    const sel = expandCombo(all, c.id, det);
    assert.equal(sel.hooks.includes('pr-merge'), c.flow === 'github-flow', c.id);
    const pick = applyFlow(all, { ...sel, hooks: [...sel.hooks] }, 'trunk');
    assert.ok(!pick.hooks.includes('pr-merge'), `${c.id} → trunk`);
  }
});

test('no-rewrite-pushed: 원격에 있는 커밋을 amend·rebase 하면 막는다', () => {
  setRules({ 'no-rewrite-pushed': true });
  commit('a.txt', '1', 'chore: 시작');
  g('update-ref', 'refs/remotes/origin/main', 'HEAD');
  g('switch', '-q', '-c', 'feature/x');
  const b = commit('b.txt', '1', 'feat: b');
  commit('c.txt', '1', 'feat: c');
  // 아직 아무것도 올리지 않은 기능 브랜치: amend·rebase 모두 괜찮다
  assert.deepEqual(bash('git commit --amend --no-edit'), []);
  assert.deepEqual(bash('git rebase -i HEAD~2'), []);
  assert.deepEqual(bash('git rebase main'), []);
  // b 까지 올렸다
  g('update-ref', 'refs/remotes/origin/feature/x', b);
  assert.deepEqual(bash('git commit --amend --no-edit'), [], 'HEAD(c)는 아직 안 올림');
  assert.equal(bash('git rebase -i HEAD~2').length, 1);
  assert.deepEqual(bash('git rebase -i HEAD~1'), [], 'c 만 다시 씀');
  assert.deepEqual(bash('git rebase main'), [], 'main 이 이미 조상이면 git 은 아무것도 다시 쓰지 않는다');
  assert.equal(bash('git rebase --force-rebase main').length, 1);
  g('switch', '-q', 'main');
  commit('d.txt', '1', 'feat: d');
  g('switch', '-q', 'feature/x');
  assert.equal(bash('git rebase main').length, 1);
  assert.equal(bash('git rebase --onto main HEAD~2').length, 1);
  assert.equal(bash('git rebase -i --root').length, 1);
  // 모두 올렸다 → amend 도 막는다
  g('update-ref', 'refs/remotes/origin/feature/x', 'HEAD');
  assert.equal(bash('git commit --amend -m "feat: c2"').length, 1);
  assert.match(bash('git commit --amend --no-edit')[0], /origin\/feature\/x/);
  // 진행 중인 rebase 다루기·pull --rebase·메시지 속 글자·보통 커밋은 통과
  for (const c of ['git rebase --continue', 'git rebase --abort', 'git pull --rebase', 'git commit -m "fix: --amend 설명"', 'git commit -m "feat: e"', 'git log --oneline'])
    assert.deepEqual(bash(c), [], c);
  // upstream 이 없는 rebase(대상 없음)·git 실패는 통과
  assert.deepEqual(bash('git rebase'), []);
  assert.deepEqual(parseRebase(['-x', 'npm test', '--onto', 'main', 'HEAD~2']), { control: false, root: false, rewrites: true, upstream: 'HEAD~2', branch: null });
});

test('no-rewrite-pushed: 저장소가 아니면 통과한다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-h5-nogit-'));
  try {
    fs.mkdirSync(path.join(dir, '.claude'));
    fs.writeFileSync(path.join(dir, '.claude', 'harness.json'), JSON.stringify({ rules: { 'no-rewrite-pushed': true } }));
    assert.deepEqual(evaluate({ tool_name: 'Bash', cwd: dir, tool_input: { command: 'git commit --amend' } }), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
