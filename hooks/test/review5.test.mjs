// 다섯째 검토(2026-11-13, 평소 명령 1,002개를 옛·새 훅에 돌려 본 결과)의 헛막음: 있는지 확인한 .env 처음 만들기, env -i 깨끗한 시험,
// kubectl rollout status·history, 이 PC 주소의 DB 접속 주소, PowerShell @'…'@ 메시지, terraform -help, git clean 경로, 숨은 실행 알림.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { evaluate } from '../lib/evaluate.mjs';
import { missingOnly } from '../lib/exist-guard.mjs';
import { BASH, POWERSHELL, commandSegments } from '../lib/cmdline.mjs';

let repo;
const setRules = (rules) => fs.writeFileSync(path.join(repo, '.claude', 'harness.json'), JSON.stringify({ lang: 'ko', rules }));
const run = (command, tool_name = 'Bash', asks = []) => evaluate({ tool_name, cwd: repo, tool_input: { command } }, [], [], [], asks);
const g = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();

before(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-r5-'));
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  g('config', 'user.email', 't@e.com');
  g('config', 'user.name', 't');
  fs.mkdirSync(path.join(repo, '.claude'));
  fs.writeFileSync(path.join(repo, '.gitignore'), '.env\ndist/\n.claude/\n');
  fs.writeFileSync(path.join(repo, 'a.txt'), '1\n');
  g('add', '.gitignore', 'a.txt');
  g('commit', '-q', '-m', 'chore: 시작');
});
after(() => fs.rmSync(repo, { recursive: true, force: true }));

// 확인한 구간 안의 조각인지(조각 시작 자리로)
const guardedSegs = (cmd, shell, file) => {
  const gs = missingOnly(cmd, shell).filter((x) => x.path === file);
  return commandSegments(cmd, shell).filter((s) => gs.some((x) => x.from < s.start && s.start < x.to)).map((s) => s.raw.trim());
};

test('있는지 확인 구간: 같은 경로가 없을 때만 도는 조각만', () => {
  assert.deepEqual(guardedSegs('if [ ! -f .env ]; then cp .env.example .env; fi', BASH, '.env'), ['then cp .env.example .env']);
  assert.deepEqual(guardedSegs('if [ -f .env ]; then echo ok; else cp .env.example .env; fi', BASH, '.env'), ['else cp .env.example .env']);
  assert.deepEqual(guardedSegs('[ -f .env ] || cp .env.example .env; cp b .env', BASH, '.env'), ['cp .env.example .env']);
  assert.deepEqual(guardedSegs('[ -f .env ] && echo yes || cp .env.example .env', BASH, '.env'), ['cp .env.example .env']);
  assert.deepEqual(guardedSegs('[ ! -e ".env" ] && cp .env.example .env', BASH, '.env'), ['cp .env.example .env']);
  assert.deepEqual(guardedSegs('if (-not (Test-Path -Path .env)) { Copy-Item .env.example .env }', POWERSHELL, '.env'), ['{ Copy-Item .env.example .env }']);
  // 있을 때 도는 쪽·앞 명령 결과가 섞인 꼴·겹친 if 는 구간이 아니다
  for (const cmd of ['if [ -f .env ]; then cp a .env; fi', '[ -f .env ] && cp a .env', '[ ! -f .env ] || cp a .env', 'x && [ -f .env ] || cp a .env',
    'if [ -f .env ]; then if x; then a; else cp b .env; fi; fi', '[ -f .env ] && a | b || cp c .env']) {
    assert.deepEqual(guardedSegs(cmd, BASH, '.env'), [], cmd);
  }
  assert.deepEqual(guardedSegs('if (Test-Path .env) { Copy-Item a .env }', POWERSHELL, '.env'), []);
});

test('.env 처음 만들기: 앞에서 없는지 확인하면 지금 있어도 둔다, 확인 없이 덮어쓰기·값 쓰기·다른 경로 확인은 막는다', () => {
  setRules({ 'protected-files': true });
  fs.writeFileSync(path.join(repo, '.env'), 'A=1\n');
  for (const cmd of ['if [ ! -f .env ]; then cp .env.example .env; fi', '[ -f .env ] || cp .env.example .env', 'test -e .env || cp .env.example .env',
    'if [ -f .env ]; then echo ok; else cp .env.example .env; fi', '[ -f .env ] && echo ok || cp .env.example .env']) {
    assert.deepEqual(run(cmd), [], cmd);
  }
  for (const cmd of ['if (-not (Test-Path .env)) { Copy-Item .env.example .env }', 'if (!(Test-Path .env)) { Copy-Item .env.example .env }', 'if (!(Test-Path .env)) { New-Item .env -ItemType File }']) {
    assert.deepEqual(run(cmd, 'PowerShell'), [], cmd);
  }
  for (const cmd of ['cp .env.example .env', 'if [ -f .env ]; then cp .env.example .env; fi', 'if [ ! -f other ]; then cp .env.example .env; fi',
    'if [ ! -f .env ]; then echo A=2 > .env; fi', '[ -f .env ] || cp real.txt .env', 'echo "$( [ -f .env ] || cp .env.example .env )"']) {
    assert.equal(run(cmd).length, 1, cmd);
  }
  assert.equal(run('New-Item .env -ItemType File -Force', 'PowerShell').length, 1, '확인 없는 New-Item');
  assert.equal(run('if (!(Test-Path .env)) { New-Item .env -Value "A=2" }', 'PowerShell').length, 1, '값을 쓰는 New-Item');
  // 막는 글이 권하는 꼴이 실제로 지나간다
  const [msg] = run('cp .env.example .env');
  assert.match(msg, /\[ -f \.env \] \|\| cp/);
  assert.match(msg, /Test-Path \.env/);
  assert.ok(!/실제로 실행해요/.test(msg));
  // 따옴표 없는 heredoc 속 백틱은 실제로 실행된다 — 그 까닭을 덧붙인다
  assert.match(run('cat > docs/setup.md <<EOF\n1. `cp .env.example .env`\nEOF').join('\n'), /bash 가 실제로 실행해요/);
  assert.deepEqual(run("cat > docs/setup.md <<'EOF'\n1. `cp .env.example .env`\nEOF"), [], "<<'EOF' 는 글");
  fs.rmSync(path.join(repo, '.env'));
});

test('사용자가 적은 보호 경로는 빈 파일 만들기도 그대로 막는다', () => {
  setRules({ 'protected-files': { paths: ['Config/*.xcconfig'] } });
  assert.equal(run('New-Item -ItemType File -Path Config\\Local.xcconfig', 'PowerShell').length, 1);
  assert.equal(run('if (!(Test-Path Config\\Local.xcconfig)) { New-Item Config\\Local.xcconfig }', 'PowerShell').length, 1);
});

test('env -i: 같은 명령이 커밋할 때만(git commit · 묻기·막기 목록의 make 목표) 막는다', () => {
  setRules({ 'protected-files': true, 'ask-cmd': { commands: ['make release'], block: ['make deploy-prod'], remote: false } });
  for (const cmd of ['env -i PATH="$PATH" make test', 'env -i PATH=/usr/bin npm test', 'env -i HOME=/tmp make -C sub build']) assert.deepEqual(run(cmd), [], cmd);
  for (const cmd of ['env -i PATH="$PATH" git commit -m "feat: x"', 'env -i git -c user.name=x commit -m "feat: x"', 'env -i bash -c "git commit -m x"',
    'env -i PATH="$PATH" make release', 'env -i make deploy-prod']) {
    assert.ok(run(cmd).some((m) => /CLAUDECODE/.test(m)), cmd);
  }
  setRules({ 'protected-files': true });
  assert.deepEqual(run('env -i make release'), [], 'ask-cmd 를 끄면 make 목표는 모른다');
});

test('원격 묻기: kubectl rollout status·history 와 terraform 도움말은 묻지 않고, 바꾸는 rollout 은 묻는다', () => {
  setRules({ 'ask-cmd': { commands: [], remote: true } });
  for (const cmd of ['kubectl rollout status deploy/api', 'kubectl -n prod rollout history deploy/api', 'terraform apply --help', 'terraform apply -help',
    'terraform apply -h', 'terraform import -help', 'tofu destroy -help']) {
    const asks = [];
    run(cmd, 'Bash', asks);
    assert.deepEqual(asks, [], cmd);
  }
  for (const cmd of ['kubectl rollout restart deploy/api', 'kubectl rollout undo deploy/api', 'kubectl rollout pause deploy/api', 'kubectl rollout resume deploy/api',
    'terraform apply', 'terraform apply -h prod.tfvars', 'ssh prod ls --help', 'kubectl exec api -- rm -rf /data --help']) {
    const asks = [];
    run(cmd, 'Bash', asks);
    assert.equal(asks.length, 1, cmd);
  }
});

test('명령줄 비밀번호: 이 PC 주소와 compose 서비스의 개발 기본값 주소는 두고, 밖의 주소는 막는다', () => {
  setRules({ 'password-cli': true });
  const pw = ['hunter', '2x'].join('');
  for (const cmd of ['psql postgres://postgres:postgres@localhost:5432/app -c "select 1"', 'psql postgresql://app:app@127.0.0.1/app', 'redis-cli -u redis://u:u@[::1]:6379',
    'psql postgres://postgres:postgres@db:5432/app']) {
    assert.deepEqual(run(cmd), [], cmd);
  }
  for (const cmd of [`psql postgres://admin:${pw}@db.example.com:5432/app`, `psql postgres://app:${pw}@db:5432/app`, `psql postgres://postgres:postgres@prod.example.com/app`,
    `curl https://u:${pw}@api.example.com`]) {
    assert.equal(run(cmd).length, 1, cmd);
  }
});

test('커밋 메시지: PowerShell @\'…\'@ 는 글자 그대로, @"…"@ 와 bash 큰따옴표 속 치환은 못 읽고 셸이 실행한다고 알린다', () => {
  setRules({ 'commit-msg': true });
  assert.deepEqual(run("git commit -m @'\nfeat: 경로 $(pwd) 보이기\n'@", 'PowerShell'), []);
  assert.deepEqual(run("git commit -m @'\r\nfix: $(Get-Location) 대신 $env:PATH\r\n'@", 'PowerShell'), []);
  const [ps] = run('git commit -m @"\nfeat: 경로 $(pwd) 보이기\n"@', 'PowerShell');
  assert.match(ps, /PowerShell 이 실제로 실행해요/);
  const [sh] = run('git commit -m "feat: `whoami` 추가"');
  assert.match(sh, /bash 가 실제로 실행해요/);
  const [plain] = run('git commit -F msg.txt -m "x"');
  assert.ok(!plain || !/실제로 실행해요/.test(plain), '치환이 아닌 까닭에는 붙이지 않는다');
});

test('숨은 실행 알림: 백틱·$(…)·따옴표 없는 heredoc 속에서 걸렸을 때만 덧붙인다', () => {
  setRules({ 'protected-files': { paths: ['data/raw'] }, 'danger-cmd': true, 'ask-cmd': { commands: [], block: ['terraform apply'], remote: false } });
  const note = /bash 가 실제로 실행해요/;
  assert.match(run('git commit -m "$(cat <<EOF\nfeat: $(rm -rf data/raw)\nEOF\n)"').join('\n'), note);
  assert.match(run('echo "$(rm -rf ~)"').join('\n'), note);
  assert.match(run('echo `terraform apply`').join('\n'), note);
  assert.match(run('echo $(terraform apply)').join('\n'), note);
  assert.ok(!note.test(run('rm -rf data/raw').join('\n')), '그냥 명령');
  assert.ok(!note.test(run('terraform apply').join('\n')), '그냥 막는 명령');
  assert.ok(!note.test(run('echo "terraform apply" | bash').join('\n')), '파이프로 넘긴 글은 치환이 아니다');
});

test('git clean: 주어진 경로 안에서 실제로 지울 것만 센다(추적 중인 파일의 변경은 clean 이 건드리지 않는다)', () => {
  setRules({ 'danger-cmd': true });
  fs.writeFileSync(path.join(repo, 'a.txt'), '2\n'); // 추적 중인 파일의 변경
  fs.mkdirSync(path.join(repo, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'dist', 'out.js'), 'x\n'); // 무시된 파일
  fs.mkdirSync(path.join(repo, 'tmp'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'tmp', 'n.txt'), 'x\n'); // 추적 안 된 파일
  assert.deepEqual(run('git clean -fd dist'), [], '무시된 파일은 -x 없이는 지우지 않는다');
  assert.match(run('git clean -fdx dist').join('\n'), /1/);
  assert.match(run('git clean -fd tmp').join('\n'), /1/);
  assert.match(run('git clean -fd').join('\n'), /1/);
  assert.deepEqual(run('git clean -fd -- src'), [], '없는 경로');
  assert.deepEqual(run('git clean -nd'), [], '보기만');
  fs.rmSync(path.join(repo, 'tmp'), { recursive: true });
  fs.rmSync(path.join(repo, 'dist'), { recursive: true });
  g('checkout', '--', 'a.txt');
});
