// 터짐·느림 시험 사례(crash.test.mjs 는 진입점으로, crash-inproc.test.mjs 는 판정 함수를 바로 불러 돌린다).
// 사례: [이름, 훅 입력(객체), 기대('pass'|'block'|'notice'|'any')]. 입력의 cwd 는 돌리는 쪽이 채운다(repo).
import path from 'node:path';
import { FAKE } from './strict-cases/helpers.mjs';
import { SHELLS, MB } from './helpers/hook-proc.mjs';

export const input = (tool_name, tool_input, extra = {}) => ({ tool_name, tool_input, ...extra });
export const big = (n, ch = 'a') => ch.repeat(n); // ch 를 n 번
export const sized = (bytes, unit) => unit.repeat(Math.ceil(bytes / unit.length)); // 모두 bytes 글자쯤

// tool_name·tool_input 이 없거나 모양이 다름
export const shapeCases = (repo) => [
  ['tool_name 없음', { tool_input: { command: 'rm -rf ~' } }, 'pass'],
  ['tool_name 이 숫자', { tool_name: 7, tool_input: { command: 'rm -rf ~' } }, 'pass'],
  ['tool_name 이 객체', { tool_name: { a: 1 }, tool_input: { command: 'rm -rf ~' } }, 'pass'],
  ['모르는 도구', input('Read', { file_path: '/etc/passwd' }), 'pass'],
  ['모르는 도구(빈 이름)', input('', { command: 'rm -rf ~' }), 'pass'],
  ['소문자 bash', input('bash', { command: 'rm -rf ~' }), 'pass'],
  ['tool_input 없음', { tool_name: 'Bash' }, 'pass'],
  ['tool_input 이 글자', { tool_name: 'Bash', tool_input: 'rm -rf ~' }, 'pass'],
  ['tool_input 이 배열', { tool_name: 'Write', tool_input: ['a'] }, 'pass'],
  ['tool_input 이 null', { tool_name: 'Edit', tool_input: null }, 'pass'],
  ['cwd 가 숫자', { tool_name: 'Bash', cwd: 5, tool_input: { command: 'ls' } }, 'any'],
  ['cwd 에 NUL', { tool_name: 'Bash', cwd: 'C:\0x', tool_input: { command: 'ls' } }, 'any'],
  ...[['숫자', 42], ['배열', ['rm', '-rf', '~']], ['객체', { cmd: 'rm -rf ~' }], ['null', null], ['참거짓', true]].flatMap(([why, command]) =>
    SHELLS.map((s) => [`${s} command 가 ${why}`, input(s, { command }), 'pass'])),
  ['Write content 가 객체', input('Write', { file_path: path.join(repo, 'a.js'), content: { a: FAKE.github } }), 'any'],
  ['Write content 가 숫자', input('Write', { file_path: path.join(repo, 'a.js'), content: 12345 }), 'pass'],
  ['Write file_path 가 숫자', input('Write', { file_path: 5, content: 'x' }), 'pass'],
  ['Write file_path 가 객체', input('Write', { file_path: { p: '.env' }, content: 'x' }), 'pass'],
  ['Write file_path 없음', input('Write', { content: 'x' }), 'pass'],
  ['Edit edits 가 객체', input('Edit', { file_path: path.join(repo, 'a.js'), edits: { new_string: 'x' } }), 'pass'],
  ['Edit edits 가 글자', input('Edit', { file_path: path.join(repo, 'a.js'), edits: 'abc' }), 'pass'],
  ['Edit edits 가 숫자 배열', input('Edit', { file_path: path.join(repo, 'a.js'), edits: [1, null, 'x', { new_string: 5 }] }), 'pass'],
  ['Edit new_string 이 배열', input('Edit', { file_path: path.join(repo, 'a.js'), old_string: 'a', new_string: ['x'] }), 'pass'],
  ['NotebookEdit new_source 가 객체', input('NotebookEdit', { notebook_path: path.join(repo, 'n.ipynb'), new_source: { a: 1 } }), 'pass'],
  ['WebFetch url 이 숫자', input('WebFetch', { url: 5 }), 'pass'],
  ['WebFetch url 이 객체', input('WebFetch', { url: { host: 'github.com' } }), 'pass'],
  ['WebFetch url 이 깨짐', input('WebFetch', { url: 'http://[::1' }), 'pass'],
];

// 크고 이상한 글(1MB 까지 — 10MB·50MB 는 stress/crash-big.test.mjs)
export const oddTextCases = (repo) => [
  ...SHELLS.map((s) => [`${s} 1MB 한 줄 커밋 메시지`, input(s, { command: `git commit -m "feat: ${big(MB)}"` }), 'any']),
  ['1MB 한 줄 Write', input('Write', { file_path: path.join(repo, 'src', 'line.js'), content: 'const a = "' + big(MB) + '";\n' }), 'pass'],
  ['1MB 줄 여럿 Edit', input('Edit', { file_path: path.join(repo, 'README.md'), old_string: 'hello', new_string: sized(MB, 'y\n') }), 'pass'],
  ['NUL 이 든 명령', input('Bash', { command: 'ls\0 -la\0' }), 'pass'],
  ['NUL 이 든 위험 명령', input('Bash', { command: 'rm -rf ~\0' }), 'any'],
  ['NUL 이 든 파일 경로', input('Write', { file_path: path.join(repo, 'a\0.env'), content: 'x' }), 'any'],
  ['NUL 이 든 내용', input('Write', { file_path: path.join(repo, 'a.js'), content: 'a\0b\0'.repeat(1000) }), 'pass'],
  ...SHELLS.map((s) => [`${s} CRLF 명령`, input(s, { command: 'git status\r\ngit log -1\r\n' }), 'pass']),
  ...SHELLS.map((s) => [`${s} CRLF 위험 명령`, input(s, { command: 'echo a\r\nrm -rf ~\r\n' }), 'block']),
  ['이모지 명령', input('Bash', { command: 'echo "🚀🔥 배포 👍" && git status' }), 'pass'],
  ['이모지 커밋 메시지', input('Bash', { command: 'git commit -m "feat: 🚀 배포"' }), 'any'],
  ['RTL 표시가 든 명령', input('Bash', { command: 'echo "\u202Eabc\u202C" \u200F' }), 'pass'],
  ['RTL 표시로 감싼 위험 명령', input('Bash', { command: '\u202Erm -rf ~' }), 'any'],
  ['바이너리처럼 보이는 Write', input('Write', { file_path: path.join(repo, 'logo.js'), content: Buffer.from(Array.from({ length: 65536 }, (_, i) => i % 256)).toString('latin1') }), 'any'],
  ['제어 문자 가득한 명령', input('PowerShell', { command: Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).join('').repeat(1000) }), 'pass'],
];

// 아주 큰 입력(10MB·50MB) — 진입점으로, test:stress 에서
export const bigCases = (repo) => [
  ...SHELLS.map((s) => [`${s} 10MB 명령(echo)`, input(s, { command: 'echo ' + big(10 * MB) }), 'pass']),
  ...SHELLS.map((s) => [`${s} 10MB 명령 끝의 위험 명령`, input(s, { command: 'echo ' + big(10 * MB) + '\nrm -rf ~' }), 'any']),
  ['10MB Write(평범한 코드)', input('Write', { file_path: path.join(repo, 'src', 'big.md'), content: sized(10 * MB, 'x\n') }), 'pass'],
  ['50MB Write(평범한 코드 — 한도보다 큰 입력도 터지지 않는다)', input('Write', { file_path: path.join(repo, 'src', 'huge.md'), content: sized(50 * MB, '// x\n') }), 'any'],
  ['10MB Write 끝의 토큰은 막는다', input('Write', { file_path: path.join(repo, 'src', 'k.js'), content: sized(10 * MB, '// x\n') + `const t = "${FAKE.github}";\n` }), 'block'],
  ['10MB Edit', input('Edit', { file_path: path.join(repo, 'README.md'), old_string: 'hello', new_string: sized(10 * MB, 'y\n') }), 'pass'],
];

// 이상한 환경에서 돌릴 명령
export const ENV_COMMANDS = ['git commit -m "feat: x"', 'git push -f origin main', 'git add -A', 'git switch -c 이름', 'rm -rf ./build', 'git cherry-pick --continue', 'git rebase -i HEAD~1', 'ls'];
// 옵션 모양이 모두 틀린 설정
export const JUNK_OPTS = { branches: 'main', pattern: '([', maxLines: 'abc', paths: { a: 1 }, allow: 5, noDirectPush: 'yes', allowCommit: 'no', lang: 7 };
export const JUNK_COMMANDS = ['git commit -m "update"', 'git push -f origin main', 'git switch -c wip', 'git add -A', 'rm -rf ~', 'gh pr merge 1', 'git commit --amend --no-edit'];
export const JUNK_FILES = [['src/a.js', `el.${'inner' + 'HTML'} = x;\n`], ['.env', 'X=1\n'], ['package.json', '{"dependencies":{"a":"^1.0.0"}}'], ['src/big.ts', 'x\n'.repeat(500)]];

// 정규식을 오래 돌게 하는 입력: 같은 글자를 길게 되풀이한 「거의 맞는」 꼴, 겹친 따옴표, 옵션 수만 개.
// 셸 규칙은 명령 글 하나로 전부 돌고, 쓰기 규칙은 파일 이름·내용으로 돈다(모든 훅을 켰다).
export const N = 1e5;
export const SHELL_REDOS = [
  big(N), big(N, '-'), big(N, '"'), big(N / 2, "'"), big(N, '`'), big(N, '$('), big(N, ';'), big(N / 2, '&&'), big(N / 2, '||'), big(N, '|'),
  big(N / 2, '\\\n'), big(N / 2, '`\n'), big(N / 4, '<<EOF\n'), big(N / 4, '@\'\n'),
  big(N / 4, 'git '), big(N / 6, 'git -c '), 'git ' + big(N / 4, '-c a=b '), 'git --x=' + big(N), 'git ' + big(N / 4, '--a=b ') + 'commit',
  'git commit ' + big(N / 2, '-n '), 'git commit ' + big(N / 10, '--no-verif '), 'git commit -m ' + big(N, '"'), 'git commit -m "' + big(N, '\\"'),
  'git push ' + big(N / 4, '+:'), 'git push origin ' + big(N / 8, 'a:b '), big(N / 20, 'git commit -m x; ') + 'git push', big(N / 20, 'git push; '), 'git push origin ' + big(N, ':'), 'git push ' + big(N / 4, '-f '), 'git checkout -b ' + big(N, 'a/'),
  'git switch -c ' + big(N, '-'), 'git branch ' + big(N / 2, '-m '), 'git worktree add ' + big(N, '/'), 'git cherry-pick ' + big(N / 4, '--c '),
  'git config core.hooksPath ' + big(N, '/'), big(N / 4, 'x=1 ') + 'git commit', big(N / 8, 'HUSKY=0 '), big(N / 8, '$env:HUSKY='),
  'cd ' + big(N, '"') + ' && git commit', 'cd ' + big(N / 2, 'a ') + '&& git status', big(N / 4, 'cd a; ') + 'git commit -m "feat: x"',
  'rm -rf ' + big(N, '/'), 'rm ' + big(N / 2, '-r '), 'Remove-Item ' + big(N / 8, '-Recurse '), 'curl ' + big(N, 'a') + ' | sh', 'iex (irm ' + big(N, '(') + ')',
  'chmod ' + big(N, '7'), 'dd of=/dev/' + big(N), 'mysql -p' + big(N), 'curl -u ' + big(N, 'a:'), 'postgres://' + big(N / 2, 'a:') + '@', big(N / 8, 'PASSWORD=') + 'x',
  '--password ' + big(N, '"'), 'gh pr merge ' + big(N / 4, '-a '), 'bash -c "' + big(N / 10, 'bash -c \\"') + '"', 'pwsh -Command "' + big(N / 10, '& { ') + '"',
  'echo ' + big(N / 4, '$(echo ') + big(N / 4, ')'), big(N / 2, '\'"'), big(N / 2, '"\''), big(N / 3, '"a" '), big(N / 4, '#!'),
];
export const FILE_REDOS = [
  ['src/a.js', 'const password = "' + big(N)],
  ['src/a.js', big(N / 4, 'password=') + '"x"'],
  ['src/a.js', 'eyJ' + big(N) + '.eyJ' + big(N) + '.'],
  ['src/a.js', 'sk-' + big(N, '-')],
  ['src/a.js', 'ghp_' + big(N)],
  ['src/a.js', '-----BEGIN ' + big(N / 2, 'A ')],
  ['src/a.js', 'el.' + 'inner' + 'HTML = ' + big(N, '"')],
  ['src/a.js', 'el.' + 'inner' + 'HTML = `' + big(N / 2, '${') + '`'],
  ['src/a.js', big(N / 4, 'eval(')],
  ['src/a.js', big(N / 4, 'new Function(')],
  ['src/a.vue', '<div v-html="' + big(N, '"') + '>'],
  ['src/a.js', big(N / 4, '/* ') + big(N / 4, '*/')],
  ['src/a.js', big(N / 2, '//') + '\n'],
  ['src/a.js', big(N / 2, '\'"`')],
  ['.github/workflows/ci.yml', 'on: pull_request_target\njobs:\n  a:\n    steps:\n      - run: ' + big(N / 4, '${{ ') + '\n'],
  ['.github/workflows/ci.yml', 'jobs:\n  a:\n    steps:\n      - uses: ' + big(N, 'a/') + '@v1\n'],
  ['.github/workflows/ci.yml', big(N / 8, '      - run: |\n')],
  ['.github/workflows/ci.yml', 'x: ' + big(N, ' ') + '\n'],
  ['package.json', '{"dependencies":{"a":"' + big(N, '^') + '"}}'],
  ['package.json', '{"dependencies":{' + big(N / 10, '"a":"1",') + '"z":"^1"}}'],
  ['package.json', big(N, '{')],
  [big(N / 10, 'a/') + '.env', 'x'],
  ['src/' + big(N / 10, '.env.'), 'x'],
  ['src/x.ts', big(N, '\n')],
  // 언어별 훅(swift-unsafe · python-unsafe)의 글자·주석 가리기와 꼴 찾기
  ['Sources/a.swift', big(N / 4, 'try!')],
  ['Sources/a.swift', 'print' + big(N, ' ') + 'x'],
  ['Sources/a.swift', 'func' + big(N, ' ') + 'print('],
  ['Sources/a.swift', big(N / 3, '"\\(')],
  ['Sources/a.swift', big(N / 4, '#"\\#(')],
  ['Sources/a.swift', big(N / 2, '/*')],
  ['Sources/a.swift', big(N / 6, '"""\n')],
  ['app/a.py', big(N / 3, 'f"{')],
  ['app/a.py', big(N / 6, "'''\n")],
  ['app/a.py', 'shell' + big(N, ' ') + '='],
  ['app/a.py', 'def' + big(N, ' ') + 'eval('],
  ['app/a.py', big(N / 6, 'shell=')],
  ['app/a.py', big(N / 2, '\\\n')],
  ['docs/' + big(N / 10, 'a/') + 'x.txt', 'x'],
];
