// 3차 검토에서 찾은 빈틈 시험. 셸(bash·PowerShell)마다 따옴표를 읽는 법이 달라 도구 이름별로 보낸다.
// 위험해 보이는 명령은 조각을 이어 만든다(이 파일을 고칠 때 다른 훅에 걸리지 않게).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { evaluate } from '../lib/evaluate.mjs';
import { stripQuoted, splitWords, dataMasked, heredocs, BASH, POWERSHELL } from '../lib/cmdline.mjs';
import { commitMessage } from '../rules/git.mjs';

let repo;
const sh = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
const setRules = (rules) => fs.writeFileSync(path.join(repo, '.claude', 'harness.json'), JSON.stringify({ lang: 'en', rules }));
const run = (tool, command) => evaluate({ tool_name: tool, cwd: repo, tool_input: { command } });
const blocks = (tool, cmds) => cmds.forEach((c) => assert.equal(run(tool, c).length, 1, `막아야 함(${tool}): ${c}`));
const allows = (tool, cmds) => cmds.forEach((c) => assert.deepEqual(run(tool, c), [], `통과해야 함(${tool}): ${c}`));
const put = (rel, text) => fs.writeFileSync(path.join(repo, rel), text);

const RF = 'r' + 'm -' + 'rf';
const RI = 'Remove-' + 'Item -Recurse -Force';
const ENV = '.e' + 'nv';

before(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-r3-'));
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  sh('config', 'user.email', 'test@example.com');
  sh('config', 'user.name', 'test');
  fs.mkdirSync(path.join(repo, '.claude'));
  put('a.txt', 'a\n');
  sh('add', 'a.txt');
  sh('commit', '-q', '-m', 'init');
});
after(() => fs.rmSync(repo, { recursive: true, force: true }));

test('1. PowerShell 은 처음부터 PowerShell 규칙으로 읽는다(상대 경로 끝 \\" 가 명령을 건너 짝짓지 않는다)', () => {
  setRules({ 'danger-cmd': true });
  blocks('PowerShell', [`Write-Host "Cleaning .\\out\\"; ${RI} ~; Write-Host "Kept .\\src\\"`]);
  allows('PowerShell', [`${RI} "C:\\Users\\me\\proj\\build\\"`, `Write-Host "a\`"; ${RI} ~; Write-Host \`""`, `Write-Host 'it''s'`]);
  blocks('PowerShell', [`Write-Host 'it''s'; ${RI} ~`, `Write-Host "$("x"; ${RI} ~)"`]);
  // bash 에서는 \" 가 따옴표 글자다.
  allows('Bash', [`echo "a\\"; ${RF} ~; echo \\""`]);
  blocks('Bash', [`echo "$(echo "x"; ${RF} ~)"`]);

  setRules({ 'protect-branch': { branches: ['main'] } });
  blocks('PowerShell', [
    'Get-ChildItem ".\\logs\\" | Out-Null; git push --force; Get-ChildItem ".\\tmp\\"',
    `Write-Host "Cleaning .\\out\\"; git commit -m 'feat: x'; Write-Host "Kept .\\src\\"`,
  ]);
  allows('PowerShell', ['Get-ChildItem ".\\logs\\" | Out-Null; git status; Get-ChildItem ".\\tmp\\"']);
  assert.match(stripQuoted('git -C ".\\a\\" push -f', POWERSHELL), / push -f$/);
  assert.deepEqual(splitWords(`-m 'it''s' x`, POWERSHELL), ['-m', "it''s", 'x']);
});

test('2. bash 주석 속 따옴표는 따옴표가 아니다(낱말 속 # 은 주석이 아니다)', () => {
  setRules({ 'danger-cmd': true });
  blocks('Bash', [`echo \\"; ${RF} ~; echo # "`, `echo 'x' # it's\n${RF} ~`, `echo a#b; ${RF} ~`, `echo \${#x}; ${RF} ~`]);
  allows('Bash', [`ls # ${RF} ~`, 'git log --oneline # 최근 것만', `echo "# ${RF} ~"`]);
  allows('PowerShell', [`Get-ChildItem # ${RI} ~`, `Get-ChildItem <# ${RI} ~ #>`]);
  assert.deepEqual(splitWords('add a.txt # all of it'), ['add', 'a.txt']);
});

test('3. PowerShell here-string 커밋 메시지를 읽는다', () => {
  assert.equal(commitMessage("git commit -m @'\nfeat: add login\n'@", POWERSHELL), 'feat: add login');
  assert.equal(commitMessage("git commit -m @'\r\nfeat: don't crash\r\n'@", POWERSHELL), "feat: don't crash");
  assert.equal(commitMessage('git commit -m @"\nfix: b\n\nmore\n"@', POWERSHELL), 'fix: b\n\nmore');
  assert.equal(commitMessage("git commit -F - <<'EOF'\nfeat: c\nEOF", BASH), 'feat: c');
  assert.equal(commitMessage('git commit -F msg.txt'), null);
  assert.equal(commitMessage('git commit --author "A B" --message="fix: d"'), 'fix: d');
  setRules({ 'commit-msg': true });
  allows('PowerShell', ["git commit -m @'\nfeat: add login\n'@", "git commit -m @'\nfeat: don't crash\n'@"]);
  blocks('PowerShell', ["git commit -m @'\nadd login\n'@"]);
  allows('Bash', [`git commit -m "$(cat <<'EOF'\nfeat: don't crash\n\nCo-Authored-By: x\nEOF\n)"`]);
  // here-string 속 -a 는 옵션이 아니다.
  setRules({ 'git-add-all': true });
  allows('PowerShell', ["git commit -m @'\nfeat: x\n\n-a 는 쓰지 않는다\n'@"]);
});

test('4. gh pr·issue·release 본문은 글이다(명령 치환은 그대로 본다)', () => {
  setRules({ 'danger-cmd': true });
  allows('Bash', [
    `gh pr create --title "feat: x" --body "stop using ${RF} ~ in docs"`,
    `gh issue comment 3 --body 'never run ${RF} /'`,
    `gh pr comment 5 --body "${RF} / is blocked"`,
    `gh release create v1.0.0 --notes "no more ${RF} ~"`,
    `gh pr create --title "feat: x" --body "$(cat <<'EOF'\n## Summary\n- don't ${RF} ~ anymore\nEOF\n)"`,
  ]);
  blocks('Bash', [`gh pr create --body "$(${RF} ~)"`, `gh pr create --body "x"; ${RF} ~`, `gh pr view 3 "${RF} ~" | sh`]);
});

test('5. git.exe·git.cmd·따옴표 친 경로·& 호출도 git 이다', () => {
  setRules({ 'protect-branch': { branches: ['main'] } });
  blocks('PowerShell', [
    'git.exe commit -m "feat: x"',
    'git.cmd commit -m "feat: x"',
    '& git commit -m "feat: x"',
    '"C:\\Program Files\\Git\\bin\\git.exe" commit -m "feat: x"',
    "& 'C:\\Program Files\\Git\\cmd\\git.exe' commit -m 'feat: x'",
  ]);
  blocks('Bash', ['/usr/bin/git commit -m "feat: x"', 'git.exe push --force']);
  allows('PowerShell', ['git.exe status', 'Write-Host "git.exe" commit', 'echo "C:\\Git\\git.exe" commit']);
  setRules({ 'no-verify': true });
  blocks('PowerShell', ['git.exe commit -n -m "feat: x"']);
});

test('6. git stage 는 git add 와 같다', () => {
  setRules({ secrets: true });
  put(ENV, 'X=1\n');
  blocks('Bash', [`git stage ${ENV} && git commit -m "feat: x"`]);
  allows('Bash', ['git stage a.txt && git commit -m "feat: x"']);
  fs.rmSync(path.join(repo, ENV));
  setRules({ 'git-add-all': true });
  blocks('Bash', ['git stage -A', 'git stage .']);
  allows('Bash', ['git stage a.txt']);
});

test('7. 닫히지 않은 heredoc·겹친 명령 치환이 많아도 빨리 끝난다', () => {
  const LIMIT_MS = 300;
  const LEN = 80000;
  const shapes = [
    [BASH, 'cat <<EOF\n'.repeat(LEN / 10)],
    [BASH, 'echo "' + '$("'.repeat(LEN / 3)],
    [POWERSHELL, "@'\n".repeat(LEN / 3)],
    [BASH, 'foo ' + '"a" '.repeat(LEN / 4)],
  ];
  for (const [shell, cmd] of shapes) {
    const t0 = performance.now();
    dataMasked(cmd, shell);
    const ms = performance.now() - t0;
    assert.ok(ms < LIMIT_MS, `${shell} ${cmd.slice(0, 12)}… ${ms.toFixed(0)}ms`);
  }
  // 빈 본문 heredoc 다음 줄은 명령이다(뒤의 같은 끝 낱말까지 본문으로 늘이지 않는다).
  assert.deepEqual(heredocs('cat <<EOF\nEOF\nx\nEOF').map((h) => h.body), ['']);
});
