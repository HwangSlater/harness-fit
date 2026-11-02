// 검토에서 찾은 빈틈(놓침·잘못 막음)을 다시 열지 않게 하는 시험. node --test hooks/test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { evaluate } from '../lib/evaluate.mjs';
import { commitMessage, DEFAULT_BRANCH_PATTERN } from '../rules/git.mjs';
import { renderRule } from '../../scripts/lib/claude-md.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let repo;
const sh = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
const setRules = (rules, lang = 'en') =>
  fs.writeFileSync(path.join(repo, '.claude', 'harness.json'), JSON.stringify({ lang, rules }));
const bash = (command) => evaluate({ tool_name: 'Bash', cwd: repo, tool_input: { command } });
const write = (file_path, content) => evaluate({ tool_name: 'Write', cwd: repo, tool_input: { file_path, content } });
const blocks = (cmds) => cmds.forEach((c) => assert.equal(bash(c).length, 1, `막아야 함: ${c}`));
const allows = (cmds) => cmds.forEach((c) => assert.deepEqual(bash(c), [], `통과해야 함: ${c}`));
const put = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), text);
};
// 비밀값 모양 글자는 조각을 이어 만든다(이 파일이 비밀값 훅에 걸리지 않게).
const FAKE_AWS = 'AKIA' + 'ABCDEFGHIJKLMNOP';
const FAKE_GH = 'ghp_' + 'a'.repeat(36);
const ASSIGN = (v) => 'const password = "' + v + '"';

before(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-reg-'));
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  sh('config', 'user.email', 'test@example.com');
  sh('config', 'user.name', 'test');
  fs.mkdirSync(path.join(repo, '.claude'));
  put('a.txt', 'a\n');
  sh('add', 'a.txt');
  sh('commit', '-q', '-m', 'init');
});
after(() => fs.rmSync(repo, { recursive: true, force: true }));

test('위험 명령: 옵션 순서·대소문자·PowerShell 인자 위치와 상관없이 막는다', () => {
  setRules({ 'danger-cmd': true });
  blocks([
    'rm -Rf /',
    'rm -rf --no-preserve-root /',
    'rm -r --force ~',
    'rm -f -R "$HOME"',
    'sudo rm -fR /*',
    'Remove-Item C:\\ -Recurse -Force',
    'Remove-Item -Path C:\\ -Recurse -Force',
    "Remove-Item -Recurse -Force -LiteralPath 'C:\\'",
    'remove-item ~ -r',
  ]);
  allows([
    'rm -rf ./build',
    'rm -rf node_modules',
    'rm -Rf dist/cache',
    'rm -f /tmp/x.log',
    'Remove-Item .\\dist -Recurse',
    'Remove-Item C:\\work\\tmp -Recurse -Force',
    'Remove-Item C:\\ -WhatIf',
  ]);
});

test('보호 브랜치: HEAD·옵션 묶음·--force-with-lease·git -c 로 돌아가지 못한다', () => {
  setRules({ 'protect-branch': { branches: ['main'] } });
  blocks([
    'git push -f origin HEAD',
    'git push -f',
    'git push -fu origin main',
    'git push -uf origin refs/heads/main',
    'git push --force-with-lease origin main',
    'git push --force-with-lease=main:abc origin HEAD:main',
    'git push origin +main',
    'git -c core.sshCommand=ssh push --force origin main',
    'git -c a=b -C . commit -m "feat: x"',
  ]);
  allows(['git push -fu origin feature/x', 'git push --force-with-lease origin feature/x', 'git push -u origin main']);

  sh('switch', '-q', '-c', 'feature/y');
  allows(['git push -f origin HEAD', 'git push -f']);
  sh('switch', '-q', 'main');

  setRules({ 'protect-branch': { branches: ['main'], noDirectPush: true } });
  blocks(['git push origin HEAD', 'git push', 'git --no-pager push -u origin main']);
  allows(['git push -u origin feature/x']);
});

test('커밋 메시지 속 글자는 옵션으로 읽지 않는다', () => {
  setRules({ 'git-add-all': true, 'no-verify': true });
  allows(['git commit -m "fix: handle -lang flag"', 'git commit -m "fix: drop -n option"', "git commit -m 'docs: --no-verify 설명'"]);
  blocks(['git commit -am "feat: x"', 'git commit -a -m "feat: x"', 'git commit -nm "feat: x"', 'git -c x=y commit --all -m "feat: x"']);
});

test('-am 묶음에서도 커밋 메시지를 꺼내 검사한다', () => {
  assert.equal(commitMessage('git commit -am "feat: a"'), 'feat: a');
  assert.equal(commitMessage('git -c x=y commit -m"fix: b"'), 'fix: b');
  setRules({ 'commit-msg': { style: 'conventional' } });
  blocks(['git commit -am "update stuff"', 'git -c user.name=x commit -m "update stuff"']);
  allows(['git commit -am "feat: add button"']);
});

test('비밀값: 허용 주석은 패턴 검사에도 듣고, 경로 모양 값은 비밀번호가 아니다', () => {
  setRules({ secrets: true });
  assert.equal(write('src/a.ts', `const k = "${FAKE_AWS}"`).length, 1);
  assert.deepEqual(write('src/a.ts', `const k = "${FAKE_AWS}" // harness:allow secret 문서 예시`), []);
  assert.equal(write('src/a.ts', `// harness:allow secret 다른 줄\nconst k = "${FAKE_AWS}"`).length, 1, '허용은 그 줄에만');
  // 키 이름과 값을 떼어 적는다(전역 비밀값 훅이 이 시험 파일 자체를 막지 않게).
  const PWD = (v) => 'pwd' + ' = "' + v + '"';
  assert.deepEqual(write('src/a.sh', PWD('/var/www/html')), []);
  assert.deepEqual(write('src/a.py', PWD('C:\\app\\data')), []);
  assert.equal(write('src/a.ts', ASSIGN('realvalue123')).length, 1);
});

test('명령줄 비밀번호: mysql 의 -P(포트)는 막지 않는다', () => {
  setRules({ 'password-cli': true });
  allows(['mysql -h db -P3307 -u root', 'mysqldump -P 3307 -u root db']);
  blocks(['mysql -u root -phunter22 db']);
});

test('비밀값 커밋: 파일마다 경로를 보고, commit -a 가 넣을 변경도 본다', () => {
  setRules({ secrets: true });
  put('fixtures/login.test.js', ASSIGN('realvalue123') + '\n');
  allows(['git add fixtures/login.test.js && git commit -m "test: x"']);
  put('src/login.js', ASSIGN('realvalue123') + '\n');
  blocks(['git add src/login.js && git commit -m "feat: x"']);
  fs.rmSync(path.join(repo, 'fixtures'), { recursive: true });
  fs.rmSync(path.join(repo, 'src'), { recursive: true });

  put('a.txt', `token: ${FAKE_GH}\n`);
  blocks(['git commit -am "feat: x"', 'git commit --all -m "feat: x"']);
  allows(['git commit -m "feat: x"']);
  sh('checkout', '--', 'a.txt');
});

test('브랜치 이름 안내 예시는 지금 패턴에 맞는 것만', () => {
  const gitFlow = '^(feature|release|hotfix|bugfix|support)/[A-Za-z0-9][A-Za-z0-9._/-]*$';
  setRules({ 'branch-name': { pattern: gitFlow } });
  const [msg] = bash('git switch -c fix/empty-cart');
  assert.match(msg, /feature\/login/);
  assert.doesNotMatch(msg, /e\.g\..*`fix\//, 'Git Flow 가 받지 않는 fix/ 를 예로 들지 않는다');
  allows(['git switch -c bugfix/empty-cart', 'git commit -m "docs: git branch foo 설명"']);

  setRules({ 'branch-name': { pattern: '^x-\\d+$' } });
  assert.doesNotMatch(bash('git switch -c nope')[0], /e\.g\./);

  setRules({ 'branch-name': true });
  assert.match(bash('git switch -c MyBranch')[0], /fix\/empty-cart/);
});

test('기본 브랜치 패턴은 packs.json 의 GitHub Flow 패턴과 같다', () => {
  const packs = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog', 'packs.json'), 'utf8'));
  const flow = packs.flows.find((f) => f.id === 'github-flow');
  assert.equal(flow.hooks['branch-name'].pattern, DEFAULT_BRANCH_PATTERN);
});

test('보안 규칙 문장은 켠 훅마다 따로 붙는다', () => {
  for (const lang of ['ko', 'en']) {
    const onlySecrets = renderRule('security', lang, ['secrets']);
    const onlyDanger = renderRule('security', lang, ['danger-cmd']);
    const none = renderRule('security', lang, []);
    const lines = (s) => s.split('\n').length;
    assert.ok(!/\{\{/.test(onlySecrets + onlyDanger + none), '표시가 남으면 안 된다');
    assert.equal(lines(onlySecrets), lines(onlyDanger));
    assert.equal(lines(onlySecrets), lines(none));
    assert.notEqual(onlySecrets, onlyDanger);
    assert.notEqual(onlySecrets, none);
  }
});
