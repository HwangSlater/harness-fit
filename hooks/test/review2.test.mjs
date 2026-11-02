// 2차 검토에서 찾은 빈틈(놓침·잘못 막음) 시험. 항목마다 막아야 할 것과 통과해야 할 것을 같이 본다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { evaluate } from '../lib/evaluate.mjs';
import { stripQuoted, splitWords, POWERSHELL } from '../lib/cmdline.mjs';

let repo;
const sh = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
const setRules = (rules, lang = 'en') =>
  fs.writeFileSync(path.join(repo, '.claude', 'harness.json'), JSON.stringify({ lang, rules }));
const bash = (command) => evaluate({ tool_name: 'Bash', cwd: repo, tool_input: { command } });
const blocks = (cmds) => cmds.forEach((c) => assert.equal(bash(c).length, 1, `막아야 함: ${c}`));
const allows = (cmds) => cmds.forEach((c) => assert.deepEqual(bash(c), [], `통과해야 함: ${c}`));
const put = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), text);
};
const drop = (rel) => fs.rmSync(path.join(repo, rel), { recursive: true, force: true });
// 비밀값 모양 글자는 조각을 이어 만든다(이 파일이 비밀값 훅에 걸리지 않게).
const FAKE_GH = 'ghp_' + 'a'.repeat(36);
const ASSIGN = (v) => 'const password = "' + v + '"';

before(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-r2-'));
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  sh('config', 'user.email', 'test@example.com');
  sh('config', 'user.name', 'test');
  fs.mkdirSync(path.join(repo, '.claude'));
  put('a.txt', 'a\n');
  sh('add', 'a.txt');
  sh('commit', '-q', '-m', 'init');
});
after(() => fs.rmSync(repo, { recursive: true, force: true }));

test('1. PowerShell 경로 끝의 \\" 는 닫는 따옴표다(뒤 옵션을 놓치지 않는다)', () => {
  assert.match(stripQuoted('git -C "C:\\repo\\" commit -m "feat: x" -a', POWERSHELL), / commit -m "_+" -a$/);
  assert.deepEqual(splitWords('-C "C:\\repo\\" commit', POWERSHELL), ['-C', 'C:\\repo\\', 'commit']);
  // 저장소 경로 끝에 구분자를 붙여 준다(Windows 에서는 "C:\…\" 모양). PowerShell 도구로 보낸다.
  const dir = `"${repo}${path.sep}"`;
  const pwsh = (command) => evaluate({ tool_name: 'PowerShell', cwd: repo, tool_input: { command } });
  setRules({ 'git-add-all': true, 'no-verify': true });
  [`git -C ${dir} commit -m "feat: x" -a`, `git -C ${dir} commit -m "feat: x" -n`].forEach((c) => assert.equal(pwsh(c).length, 1, c));
  assert.deepEqual(pwsh(`git -C ${dir} commit -m "feat: x"`), []);
  allows(['git commit -m "fix: say \\"-n\\" here"']);
  setRules({ 'protect-branch': { branches: ['main'] } });
  assert.equal(pwsh(`git -C ${dir} commit -m "feat: x"`).length, 1);
});

test('2. 따옴표 친 refspec 으로 강제 push 를 피하지 못한다', () => {
  setRules({ 'protect-branch': { branches: ['main'] } });
  blocks(['git push -f origin "main"', "git push --force origin 'main'", 'git push origin "+main"', 'git push -f origin "HEAD:main"']);
  allows(['git push -f origin "feature/x"', 'git push origin "main"']);
});

test('3. 보호 브랜치를 원격에서 지우지 못한다', () => {
  setRules({ 'protect-branch': { branches: ['main'] } });
  blocks(['git push origin :main', 'git push --delete origin main', 'git push -d origin main', 'git push origin --delete "main"']);
  assert.match(bash('git push origin :main')[0], /delete/i);
  allows(['git push origin :feature/x', 'git push -d origin feature/x', 'git push origin main:main']);
});

test('4. 한글 경로의 키 파일도 커밋 전에 잡는다', () => {
  setRules({ secrets: true });
  put('설정/.env', 'X=1\n');
  sh('add', '설정/.env');
  blocks(['git commit -m "feat: x"']);
  sh('reset', '-q', '--', '설정/.env');
  allows(['git commit -m "feat: x"']);
  put('설정/키.js', `token: ${FAKE_GH}\n`);
  blocks(['git add 설정/키.js && git commit -m "feat: x"']);
  drop('설정');
});

test('5. 추적 중인 .env·키 파일을 저장소에서 빼는 커밋은 막지 않는다', () => {
  setRules({ secrets: true });
  put('.env', 'X=1\n');
  put('deploy.pem', 'x\n');
  sh('add', '.env', 'deploy.pem');
  sh('commit', '-q', '-m', 'track');
  sh('rm', '-q', '--cached', '.env');
  allows(['git commit -m "chore: stop tracking env"']);
  sh('reset', '-q', '--', '.env');
  drop('deploy.pem');
  allows(['git commit -a -m "chore: remove key"', 'git add deploy.pem && git commit -m "chore: remove key"']);
  put('.env', 'X=2\n');
  blocks(['git commit -a -m "feat: x"', 'git add .env && git commit -m "feat: x"']);
  sh('rm', '-q', '-f', '--', '.env', 'deploy.pem');
  sh('commit', '-q', '-m', 'untrack');
});

test('6. 같은 명령의 add(폴더·-u)와 commit <경로> 가 넣는 것도 본다', () => {
  setRules({ secrets: true });
  put('newdir/conf.js', ASSIGN('realvalue123') + '\n');
  put('keydir/.env', 'X=1\n');
  put('clean/ok.js', 'export const ok = 1;\n');
  blocks(['git add newdir && git commit -m "feat: x"', 'git add keydir && git commit -m "feat: x"']);
  allows(['git add clean && git commit -m "feat: x"']);
  ['newdir', 'keydir', 'clean'].forEach(drop);

  put('a.txt', `token: ${FAKE_GH}\n`);
  blocks(['git add -u && git commit -m "feat: x"', 'git add --update && git commit -m "feat: x"']);
  blocks(['git commit a.txt -m "feat: x"', 'git commit -m "feat: x" -- a.txt']);
  allows(['git add b.txt && git commit -m "feat: x"', 'git commit -m "feat: x"']);
  sh('checkout', '--', 'a.txt');
});

test('7. Windows 지우기 명령과 PowerShell 줄임 매개변수', () => {
  setRules({ 'danger-cmd': true });
  blocks([
    'rm -Recurse -Force C:\\',
    'del -Recurse C:\\',
    'ri -r -Fo C:\\',
    'rd -rec ~',
    'erase -Recurse $env:USERPROFILE',
    'rmdir -Recurse C:\\',
    'Remove-Item -Recurse -Force .',
    'Remove-Item -Recurse:$true C:\\',
    'REMOVE-ITEM -RECURSE -Path:C:\\',
    'Remove-Item -Recurse .\\*',
    'rm -rf ./*',
    'rm -rf ../',
    'rd /s /q C:\\',
    'del /s /q C:\\*',
  ]);
  allows([
    'Remove-Item -Recurse:$false C:\\',
    'Remove-Item -Recurse C:\\ -WhatIf',
    'rm -Recurse .\\dist',
    'del C:\\tmp\\x.log',
    'rd /s /q .\\build',
    'rmdir empty',
    'rm -rf ./dist/*',
    'find . -name "*.tmp" -exec rm -rf {} \\;',
  ]);
});

test('8. 잘못 막던 경우: git rm·메시지 속 글·commit-graph·패턴 add', () => {
  setRules({ 'danger-cmd': true });
  allows([
    'git rm -rf --cached .',
    'git -C . rm -r --cached .',
    'git commit -m "docs: never run rm -rf / here"',
    'echo "rm -rf /"',
    "printf 'rm -rf ~'",
    `git commit -m "$(cat <<'EOF'\ndocs: rm -rf / 는 막힌다\nEOF\n)"`,
  ]);
  blocks([
    'bash -c "rm -rf /"',
    "sh -c 'rm -rf ~'",
    'pwsh -Command "Remove-Item -Recurse C:\\"',
    'powershell -c "rm -Recurse -Force C:\\"',
    'cmd /c "rd /s /q C:\\"',
    'eval "rm -rf /"',
    'echo "rm -rf /" | sh',
    'echo "$(rm -rf /)"',
    'bash <<EOF\nrm -rf /\nEOF',
  ]);

  setRules({ 'protect-branch': { branches: ['main'] } });
  allows(['git commit-graph write']);
  blocks(['git commit -m "feat: x"']);

  setRules({ 'git-add-all': true });
  allows(['git add *.md', 'git add "src/*.ts"', 'git add ./src']);
  blocks(['git add "*"', "git add '.'", 'git add :/', 'git add -Av']);
});
