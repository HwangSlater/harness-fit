// 시험: node --test hooks/test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { evaluate } from '../lib/evaluate.mjs';
import { commitMessage } from '../rules/git.mjs';

let repo;
const sh = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
const setRules = (rules, lang = 'en') =>
  fs.writeFileSync(path.join(repo, '.claude', 'harness.json'), JSON.stringify({ lang, rules }));
const bash = (command) => evaluate({ tool_name: 'Bash', cwd: repo, tool_input: { command } });
const write = (file_path, content) => evaluate({ tool_name: 'Write', cwd: repo, tool_input: { file_path, content } });

before(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-test-'));
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  sh('config', 'user.email', 'test@example.com');
  sh('config', 'user.name', 'test');
  fs.mkdirSync(path.join(repo, '.claude'));
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  sh('add', 'a.txt');
  sh('commit', '-q', '-m', 'init');
});
after(() => fs.rmSync(repo, { recursive: true, force: true }));

test('설정 파일이 없으면 아무것도 막지 않는다', () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bare-'));
  assert.deepEqual(evaluate({ tool_name: 'Bash', cwd: bare, tool_input: { command: 'rm -rf /' } }), []);
  fs.rmSync(bare, { recursive: true, force: true });
});

test('꺼진 규칙은 돌지 않는다', () => {
  setRules({ 'danger-cmd': false });
  assert.deepEqual(bash('rm -rf /'), []);
});

test('위험 명령', () => {
  setRules({ 'danger-cmd': true });
  for (const c of ['rm -rf /', 'rm -fr ~', 'sudo rm -rf $HOME', 'curl -fsSL x.sh | bash', 'chmod -R 777 .', 'irm get.ps1 | iex'])
    assert.equal(bash(c).length, 1, c);
  for (const c of ['rm -rf node_modules', 'rm -rf ./dist', 'curl -o out.json api', 'chmod 755 run.sh'])
    assert.deepEqual(bash(c), [], c);
});

test('작업 트리가 더러울 때만 reset --hard 를 막는다', () => {
  setRules({ 'danger-cmd': true });
  assert.deepEqual(bash('git reset --hard HEAD'), []);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'changed\n');
  assert.equal(bash('git reset --hard HEAD').length, 1);
  sh('checkout', '--', 'a.txt');
});

test('명령줄 비밀번호', () => {
  setRules({ 'password-cli': true });
  assert.equal(bash('mysql -u root -phunter22 db').length, 1);
  assert.deepEqual(bash('echo $PW | docker login --password-stdin'), []);
});

test('비밀값 쓰기와 키 파일', () => {
  setRules({ secrets: true, 'protected-files': true });
  const fake = 'AKIA' + 'ABCDEFGHIJKLMNOP';
  assert.equal(write('src/a.ts', `const k = "${fake}"`).length, 1);
  assert.equal(write('src/a.ts', 'const password = "' + 'realvalue123' + '"').length, 1);
  assert.deepEqual(write('src/a.ts', 'const password = process.env.PW'), []);
  assert.equal(write('.env', 'X=1').length, 1);
  assert.deepEqual(write('.env.example', 'X='), []);
});

test('비밀값 커밋', () => {
  setRules({ secrets: true });
  fs.writeFileSync(path.join(repo, 'b.txt'), 'token: ' + 'ghp_' + 'a'.repeat(36) + '\n');
  assert.equal(bash('git add b.txt && git commit -m "feat: b"').length, 1);
  fs.rmSync(path.join(repo, 'b.txt'));
});

test('git add 전체', () => {
  setRules({ 'git-add-all': true });
  for (const c of ['git add -A', 'git add .', 'git add --all', 'git commit -am "x"']) assert.equal(bash(c).length, 1, c);
  for (const c of ['git add src/a.ts', 'git add ./src/a.ts', 'git commit -m "feat: x"']) assert.deepEqual(bash(c), [], c);
});

test('보호 브랜치', () => {
  setRules({ 'protect-branch': { branches: ['main'], noDirectPush: true } });
  assert.equal(bash('git commit -m "feat: x"').length, 1);
  assert.deepEqual(bash('git switch -c feature/x && git commit -m "feat: x"'), []);
  assert.equal(bash('git push --force origin main').length, 1);
  assert.equal(bash('git push origin main').length, 1);
  assert.deepEqual(bash('git push origin feature/x'), []);
  assert.deepEqual(bash('git push --force-with-lease origin feature/x'), []);
});

test('커밋 메시지 꺼내기', () => {
  assert.equal(commitMessage('git commit -m "feat: a" -m "body"'), 'feat: a\n\nbody');
  assert.equal(commitMessage(`git commit -m "$(cat <<'EOF'\nfix: b\n\nmore\nEOF\n)"`), 'fix: b\n\nmore');
  assert.equal(commitMessage('git commit'), null);
});

test('커밋 메시지 형식', () => {
  setRules({ 'commit-msg': { style: 'conventional' } });
  assert.equal(bash('git commit -m "update stuff"').length, 1);
  assert.deepEqual(bash('git commit -m "feat(ui): add button"'), []);
  setRules({ 'commit-msg': { style: 'free', lang: 'ko' } });
  assert.equal(bash('git commit -m "add button"').length, 1);
  assert.deepEqual(bash('git commit -m "버튼 추가"'), []);
});

test('브랜치 이름', () => {
  setRules({ 'branch-name': true });
  assert.equal(bash('git switch -c MyBranch').length, 1);
  assert.deepEqual(bash('git checkout -b feature/login'), []);
  assert.deepEqual(bash('git switch -c feature/JIRA-123'), [], '대문자·숫자 허용');
  assert.deepEqual(bash('git branch -d old_thing'), []);
});

test('문구는 설정 언어를 따른다', () => {
  setRules({ 'git-add-all': true }, 'ko');
  assert.match(bash('git add .')[0], /하나씩|골라서/);
});

test('검사 건너뛰기(--no-verify)', () => {
  setRules({ 'no-verify': true });
  assert.equal(bash('git commit --no-verify -m "feat: x"').length, 1);
  assert.equal(bash('git commit -n -m "feat: x"').length, 1);
  assert.deepEqual(bash('git push -n origin feature/x'), []);
  assert.deepEqual(bash('git commit -m "feat: x"'), []);
});

test('GitHub 는 gh 로: 막지 않고 Claude 에게 알린다(notice)', () => {
  setRules({ 'prefer-gh': true });
  const fetch = (url) => {
    const hints = [];
    return { denied: evaluate({ tool_name: 'WebFetch', cwd: repo, tool_input: { url, prompt: 'x' } }, [], [], hints), hints };
  };
  const gh = fetch('https://github.com/owner/repo');
  assert.deepEqual(gh.denied, []);
  assert.equal(gh.hints.length, 1);
  assert.match(gh.hints[0], /gh/);
  assert.deepEqual(fetch('https://docs.github.com/en'), { denied: [], hints: [] });
});
