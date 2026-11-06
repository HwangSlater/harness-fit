// 쓰기 훅 엄격 사례: secrets · protected-files · file-size. 커밋할 때 다시 보기(셸로 쓴 파일) 사례를 함께 둔다.
import path from 'node:path';
import { S, B, P, W, E, N, FAKE, assign, linesOf, stage, both, gitHook, PLUGIN } from './helpers.mjs';

const tokenLine = `export const token = "${FAKE.github}";\n`;
const commitMsg = 'git commit -m "feat: x"';

export default {
  secrets: {
    block: [
      W('src/config.js', tokenLine, 'GitHub 토큰(ghp_)'),
      W('src/aws.py', `KEY = "${FAKE.aws}"\n`, 'AWS 키(AKIA)'),
      W('src/ai.ts', `const k = '${FAKE.openai}';\n`, 'OpenAI 키(sk-)'),
      W('deploy/key.txt', `${FAKE.privateKey}\nMIIE\n`, '개인 키 머리'),
      W('src/slack.js', `const s = "${FAKE.slack}";\n`, 'Slack 토큰'),
      W('src/maps.js', `const g = "${FAKE.google}";\n`, 'Google API 키'),
      W('src/auth.js', `const t = "${FAKE.jwt}";\n`, 'JWT 모양'),
      W('src/pay.rb', `KEY = "${FAKE.stripe}"\n`, 'Stripe live 키'),
      W('src/db.py', assign('password', FAKE.password) + '\n', 'password = "실제값" 대입'),
      W('src/db.ts', assign('const DB_PASSWORD', FAKE.password) + ';\n', '앞에 낱말이 붙은 이름(DB_PASSWORD)'),
      W('app/settings.py', assign('SECRET_KEY', FAKE.password) + '\n', '뒤에 낱말이 붙은 이름(Django SECRET_KEY)'),
      W('src/aws.ts', assign('const AWS_SECRET_ACCESS_KEY', FAKE.password) + ';\n', 'AWS_SECRET_ACCESS_KEY'),
      W('src/pay.ts', assign('const STRIPE_SECRET_KEY', FAKE.password) + ';\n', 'STRIPE_SECRET_KEY'),
      W('src/k.ts', assign('const API_KEY_PROD', FAKE.password) + ';\n', '뒤 낱말이 이름을 가리키지 않으면 값으로 본다(_PROD)'),
      B('git add app/settings.py && git commit -m "feat: x"', '커밋: SECRET_KEY', { setup: (r) => r.put('app/settings.py', assign('SECRET_KEY', FAKE.password) + '\n') }),
      E('src/a.js', 'const a = 1;', tokenLine, 'Edit 로 넣기', { setup: (r) => r.put('src/a.js', 'const a = 1;\n') }),
      N('nb/a.ipynb', `key = "${FAKE.aws}"`, 'NotebookEdit 로 넣기'),
      W('src/a.ts', `const k = "${FAKE.aws}"; // lint:allow secrets 문서 예시\n`, '허용 주석은 옵션 allowComment 를 켜야 받는다'),
      W('src/a.ts', `const k = "${FAKE.aws}"; // lint:allow secrets\n`, '옵션을 켜도 이유 없는 허용 주석은 받지 않는다', { opts: { allowComment: true } }),
      S(commitMsg, '커밋: 셸로 쓴 뒤 stage 한 파일의 토큰', { setup: stage('src/k.js', tokenLine) }),
      S('git add src/k.js && git commit -m "feat: x"'.replace('&&', ';'), '커밋: 같은 명령의 git add 가 올리는 파일(; 로 이음)', { setup: (r) => r.put('src/k.js', tokenLine) }),
      B('git add src/k.js && git commit -m "feat: x"', '커밋: git add && commit', { setup: (r) => r.put('src/k.js', tokenLine) }),
      S('git commit -am "feat: x"', '커밋: commit -a 가 넣는 추적 파일의 토큰', { setup: (r) => r.put('README.md', tokenLine) }),
      S(commitMsg, '커밋: stage 한 .env 파일', { setup: stage('.env', 'X=1\n') }),
      S(commitMsg, '커밋: 한글 경로의 키 파일', { setup: stage('설정/서버.pem', 'x\n') }),
      B('echo "x" > src/new.js && git add src/new.js && git commit -m "feat: a"', '커밋: 같은 명령 앞에서 파일을 쓰면 내용을 볼 수 없어 막음'),
      P("Set-Content src/new.js 'x'; git add src/new.js; git commit -m 'feat: a'", '커밋: PowerShell 로 쓰고 같은 명령에서 커밋'),
      B("sed -i 's/a/b/' README.md && git commit -am 'feat: a'", '커밋: sed -i 뒤 commit -a'),
      B('bash -c "git add src/k.js && git commit -m \'feat: x\'"', '커밋: bash -c 안의 커밋', { setup: (r) => r.put('src/k.js', tokenLine) }),
      B('npx prettier --write src/ok.js && git add src/ok.js && git commit -m "feat: x"', '커밋: 앞에서 파일을 고치는 도구(볼 수 없어 막음)', { setup: (r) => r.put('src/ok.js', 'export const a = 1;\n') }),
      B('git checkout -b feature/x origin/main && git add src/ok.js && git commit -m "feat: x"', '커밋: 시작점을 준 새 브랜치(내용이 바뀔 수 있어 막음)', { setup: (r) => r.put('src/ok.js', 'export const a = 1;\n') }),
      B('git add src/k.js \\\n  && git commit -m "feat: x"', '커밋: 줄 이어 쓰기', { setup: (r) => r.put('src/k.js', tokenLine) }),
      // git 훅이 있어도 그 훅을 건너뛰거나 바꾸는 커밋은 PreToolUse 가 미리 본다
      S('git commit -n -m "feat: x"', 'git 훅: -n 은 훅을 건너뛰므로 PreToolUse 가 본다', { setup: both(stage('src/k.js', tokenLine), gitHook()) }),
      S('git commit --no-verify -m "feat: x"', 'git 훅: --no-verify', { setup: both(stage('src/k.js', tokenLine), gitHook()) }),
      S('git commit --no-veri -m "feat: x"', 'git 훅: 줄인 --no-veri', { setup: both(stage('src/k.js', tokenLine), gitHook()) }),
      S('git -c core.hooksPath=/dev/null commit -m "feat: x"', 'git 훅: -c core.hooksPath', { setup: both(stage('src/k.js', tokenLine), gitHook()) }),
      B('rm .git/hooks/pre-commit && git commit -m "feat: x"', 'git 훅: 훅 파일을 지우고 커밋', { setup: both(stage('src/k.js', tokenLine), gitHook()) }),
      P('Remove-Item .git\\hooks\\pre-commit; git commit -m "feat: x"', 'git 훅: PowerShell 로 훅 파일 지우기', { setup: both(stage('src/k.js', tokenLine), gitHook()) }),
      B('GIT_INDEX_FILE=/tmp/other git commit -m "feat: x"', 'git 훅: 다른 색인', { setup: both(stage('src/k.js', tokenLine), gitHook()) }),
      S(commitMsg, 'git 훅: 우리 훅이 있어도 core.hooksPath 가 다른 폴더면 git 은 그 훅을 돌린다', { setup: both(stage('src/k.js', tokenLine), gitHook(), (r) => r.git('config', 'core.hooksPath', '.husky')) }),
      S(commitMsg, 'git 훅: 남의 pre-commit 이면 PreToolUse 가 본다', { setup: both(stage('src/k.js', tokenLine), (r) => r.put('.git/hooks/pre-commit', '#!/bin/sh\nexit 0\n')) }),
      B('echo "x" > src/new.js && git add src/new.js && git commit -m "feat: a"', 'git 훅: 우리 훅이 있어도 플러그인을 못 찾으면(옮김) PreToolUse 가 다시 맡는다', { setup: gitHook(path.join(PLUGIN, 'no-such-plugin')) }),
    ],
    pass: [
      W('src/config.js', 'export const token = process.env.GH_TOKEN;\n', '환경 변수에서 읽기'),
      W('src/db.py', assign('password', 'your-password-here') + '\n', '자리표시자 값'),
      W('src/db.py', assign('password', '${DB_PASSWORD}') + '\n', '${} 참조'),
      W('src/login.test.js', assign('password', FAKE.password) + '\n', '테스트 파일은 대입 검사 제외'),
      W('src/a.ts', `const k = "${FAKE.aws}"; // lint:allow secrets 문서 예시\n`, '허용 주석(옵션을 켰을 때)', { opts: { allowComment: true } }),
      W('src/paths.sh', assign('pwd', '/var/www/html') + '\n', '경로 모양 값'),
      W('src/a.ts', assign('const secretName', FAKE.password) + ';\n', '이름만 비슷한 것(secretName)'),
      W('src/locales/en.json', '{ "password": "Password" }\n', '화면 문구(Password)'),
      W('src/form.ts', "const errors = { password: 'Required' };\n", '검사 문구(Required)'),
      W('src/http.ts', assign('const api_key_header', 'X-Api-Key') + ';\n', '값을 가리키는 이름(_header)'),
      W('src/vault.py', assign('DB_PASSWORD_ENV', 'DB_PASSWORD') + '\n', '값을 가리키는 이름(_ENV)'),
      // git 훅이 돌면 커밋 내용은 그 훅이 실제 커밋 때 본다(hooks/test/git-hook.test.mjs) — PreToolUse 는 「미리 볼 수 없다」로 막지 않는다
      B('echo "x" > src/new.js && git add src/new.js && git commit -m "feat: a"', 'git 훅: 같은 명령에서 쓰고 커밋', { setup: gitHook() }),
      P("Set-Content src/new.js 'x'; git add src/new.js; git commit -m 'feat: a'", 'git 훅: PowerShell 로 쓰고 같은 명령에서 커밋', { setup: gitHook() }),
      B("python test_shop.py; git add src/ok.js; git commit -m 'test: 상점'", 'git 훅: 스크립트 실행 뒤 커밋(사용자가 겪은 헛막음)', { setup: both((r) => r.put('src/ok.js', 'export const a = 1;\n'), gitHook()) }),
      B("sed -i 's/a/b/' README.md && git commit -am 'feat: a'", 'git 훅: sed -i 뒤 commit -a', { setup: gitHook() }),
      S(commitMsg, 'git 훅: stage 한 토큰도 PreToolUse 는 넘긴다(git 훅이 커밋 때 막는다)', { setup: both(stage('src/k.js', tokenLine), gitHook()) }),
      S('git commit -m "fix: pre-commit 훅 설명"', 'git 훅: 메시지 속 pre-commit 낱말은 훅 건드리기가 아니다', { setup: both(stage('src/ok.js', 'export const a = 1;\n'), gitHook()) }),
      B('npm test && git add src/ok.js && git commit -m "feat: x"', '커밋: 시험 뒤 커밋', { setup: (r) => r.put('src/ok.js', 'export const a = 1;\n') }),
      B('npm run lint && node --test && git add src/ok.js && git commit -m "feat: x"', '커밋: 린트·node --test 뒤 커밋', { setup: (r) => r.put('src/ok.js', 'export const a = 1;\n') }),
      B('mkdir -p docs && git add src/ok.js && git commit -m "feat: x"', '커밋: mkdir 뒤 커밋', { setup: (r) => r.put('src/ok.js', 'export const a = 1;\n') }),
      P('npm test; if ($?) { git add src/ok.js; git commit -m "feat: x" }', '커밋: PowerShell 시험 뒤 커밋', { setup: (r) => r.put('src/ok.js', 'export const a = 1;\n') }),
      S(commitMsg, '커밋: 문제없는 파일', { setup: stage('src/ok.js', 'export const a = 1;\n') }),
      S('git rm --cached .env && git commit -m "chore: .env 빼기"', '커밋: .env 를 저장소에서 빼기', { setup: (r) => r.commit('.env', 'X=1\n', 'chore: 시작') }),
      B('npm test && git commit -m "feat: x"', '커밋: stage 한 것만 넣는 커밋 앞의 명령은 내용을 못 바꾼다', { setup: stage('src/ok.js', 'export const a = 1;\n') }),
      P('npm test; git commit -m "feat: x"', '커밋: PowerShell 같은 꼴', { setup: stage('src/ok.js', 'export const a = 1;\n') }),
      S('cd src && git add ok.js && git commit -m "feat: x"'.replace(/&&/g, ';'), '커밋: cd 뒤 add', { setup: (r) => r.put('src/ok.js', 'export const a = 1;\n') }),
      S('git status && git diff --cached'.replace('&&', ';'), '커밋이 아님'),
      B('git switch -c feature/x && git add src/ok.js && git commit -m "feat: x"', '커밋: 시작점 없는 새 브랜치는 내용을 안 바꾼다', { setup: (r) => r.put('src/ok.js', 'export const a = 1;\n') }),
      P('git add src/ok.js; if ($?) { git commit -m "feat: x" }', '커밋: PowerShell if ($?) { }', { setup: (r) => r.put('src/ok.js', 'export const a = 1;\n') }),
      B('set -e && git add src/ok.js && git status && git commit -m "feat: x"', '커밋: set -e·status', { setup: (r) => r.put('src/ok.js', 'export const a = 1;\n') }),
      S('git restore --staged README.md && git commit -m "feat: x"'.replace('&&', ';'), '커밋: stage 비우기', { setup: stage('src/ok.js', 'export const a = 1;\n') }),
      S(commitMsg, '커밋: 이미 HEAD 에 있던 토큰은 막지 않는다(이번에 더한 줄만)', {
        setup: (r) => {
          r.commit('src/old.js', tokenLine + '// harness:allow secret 옛 기록\n', 'chore: 옛 파일');
          r.put('src/old.js', tokenLine + '// harness:allow secret 옛 기록\nexport const b = 2;\n');
          r.git('add', 'src/old.js');
        },
      }),
    ],
  },

  'protected-files': {
    opts: { paths: ['credentials.json'] },
    block: [
      W('.env', 'DB_HOST=localhost\n', '.env'),
      W('config/.env.local', 'X=1\n', '.env.local'),
      E('.env.production', 'X=1', 'X=2', '.env.production 고치기', { setup: (r) => r.put('.env.production', 'X=1\n') }),
      W('certs/server.pem', 'x\n', '.pem'),
      W('keys/app.p12', 'x\n', '.p12'),
      W('android/release.keystore', 'x\n', '.keystore'),
      W('.ssh/id_ed25519', 'x\n', 'SSH 개인 키'),
      W('deploy/.ssh/id_rsa_deploy', 'x\n', 'SSH 개인 키(이름 뒤에 덧붙임)'),
      W('gcp/credentials.json', '{}\n', '옵션 paths 의 파일'),
      S('git commit -m "chore: x"', '커밋: 셸로 만든 .env 를 stage', { setup: stage('.env', 'X=1\n') }),
      B('git add .env.local && git commit -m "chore: x"', '커밋: 같은 명령의 add', { setup: (r) => r.put('.env.local', 'X=1\n') }),
      P('git add .env.local; git commit -m "chore: x"', '커밋: PowerShell 같은 꼴', { setup: (r) => r.put('.env.local', 'X=1\n') }),
    ],
    pass: [
      W('.env.example', 'DB_HOST=\n', '.env.example'),
      W('.env.sample', 'DB_HOST=\n', '.env.sample'),
      W('src/env.js', 'export const host = process.env.HOST;\n', '이름에 env 가 든 코드'),
      W('.envrc', 'use node\n', '.envrc 는 .env 가 아니다'),
      W('src/.env.d.ts', 'interface ImportMetaEnv {}\n', '.env.d.ts 는 코드'),
      W('deploy/.ssh/id_rsa_deploy.pub', 'ssh-rsa x\n', '공개 키'),
      W('docs/keys.md', '# 키 관리\n', '문서'),
      S('git commit -m "chore: x"', '커밋: 보통 파일', { setup: stage('src/a.js', 'export const a = 1;\n') }),
      S('git rm --cached .env && git commit -m "chore: x"'.replace('&&', ';'), '커밋: .env 빼기', { setup: (r) => r.commit('.env', 'X=1\n', 'chore: 시작') }),
    ],
  },

  'file-size': {
    block: [
      W('src/big.js', linesOf(450), '새 코드 파일 450줄'),
      W('app/big.py', linesOf(401, 'x = 1'), '새 파이썬 파일 401줄'),
      W('src/mid.ts', linesOf(150), '옵션 maxLines 100', { opts: { maxLines: 100 } }),
      S('git commit -m "feat: x"', '커밋: 셸로 만든 500줄 새 파일', { setup: stage('src/gen.ts', linesOf(500)) }),
      B('git add src/gen.ts && git commit -m "feat: x"', '커밋: 같은 명령의 add', { setup: (r) => r.put('src/gen.ts', linesOf(500)) }),
      P('git add src/gen.ts; git commit -m "feat: x"', '커밋: PowerShell 같은 꼴', { setup: (r) => r.put('src/gen.ts', linesOf(500)) }),
      W('src/e401.ts', linesOf(401).replace(/\n$/, ''), '401줄(끝 줄바꿈 없음)'),
      W('src/c401.ts', linesOf(401).replace(/\n/g, '\r\n'), '401줄(CRLF)'),
      B('git add src/e.ts && git commit -m "feat: x"', '커밋: 401줄(끝 줄바꿈 없음)', { setup: (r) => r.put('src/e.ts', linesOf(401).replace(/\n$/, '')) }),
    ],
    pass: [
      W('src/small.js', linesOf(20), '작은 새 파일'),
      W('src/edge.ts', linesOf(400), '딱 400줄(끝 줄바꿈은 줄이 아니다)'),
      W('src/edge-crlf.ts', linesOf(400).replace(/\n/g, '\r\n'), '딱 400줄(CRLF)'),
      B('git add src/e.ts && git commit -m "feat: x"', '커밋: 딱 400줄', { setup: (r) => r.put('src/e.ts', linesOf(400)) }),
      P('git add src/e.ts; git commit -m "feat: x"', '커밋: 딱 400줄(CRLF)', { setup: (r) => r.put('src/e.ts', linesOf(400).replace(/\n/g, '\r\n')) }),
      W('src/old.js', linesOf(450), '이미 있는 파일 다시 쓰기', { setup: (r) => r.put('src/old.js', 'x\n') }),
      W('docs/guide.md', linesOf(450), '문서'),
      W('data/big.json', linesOf(450), 'JSON'),
      W('dist/bundle.js', linesOf(900), '빌드 결과'),
      S('git commit -am "feat: x"', '커밋: 이미 있던 큰 파일 고치기', {
        setup: (r) => {
          r.commit('src/big.js', linesOf(450), 'chore: 큰 파일');
          r.put('src/big.js', linesOf(460));
        },
      }),
      S('git commit -m "feat: x"', '커밋: 작은 새 파일', { setup: stage('src/s.js', linesOf(10)) }),
      S('git commit -m "feat: x"', '커밋: 큰 문서', { setup: stage('docs/long.md', linesOf(900)) }),
      S('git commit -m "refactor: 옮기기"', '커밋: git mv 로 옮긴 큰 파일은 새 파일이 아니다', {
        setup: (r) => {
          r.commit('src/big.js', linesOf(450), 'chore: 큰 파일');
          r.git('mv', 'src/big.js', 'src/moved.js');
        },
      }),
    ],
  },
};

export { both };
