// 다섯째 검토(2026-11-13, 평소 명령 1,002개)의 헛막음 — 진입점(hooks/run.mjs)에서 통과 쪽과 그대로 막는 쪽을 함께 본다.
// 자세한 꼴은 hooks/test/review5.test.mjs. strict.test.mjs 가 같은 훅 사례에 이어 붙인다.
import { S, B, P, keyed } from './helpers.mjs';

// .env 가 이미 있는 저장소(덮어쓰기 막기와 확인한 처음 만들기)
const ENV = keyed('br4-env', (r) => {
  r.put('.env', 'A=1\n');
  r.put('.env.example', 'A=\n');
});
const env = { setup: ENV };
const REMOTE = { opts: { commands: [], remote: true }, decision: 'ask' };
const remote = { opts: { commands: [], remote: true } };

export default {
  'protected-files': {
    block: [
      B('cp .env.example .env', '확인 없이 덮어쓰기', env),
      B('if [ -f .env ]; then cp .env.example .env; fi', '있을 때 도는 쪽', env),
      B('if [ ! -f other ]; then cp .env.example .env; fi', '다른 경로 확인', env),
      B('if [ ! -f .env ]; then echo A=2 > .env; fi', '확인해도 값 쓰기', env),
      P('if (Test-Path .env) { Copy-Item .env.example .env }', '있을 때 도는 쪽', env),
      B('env -i PATH="$PATH" git commit -m "feat: x"', 'env -i 로 커밋'),
    ],
    pass: [
      B('if [ ! -f .env ]; then cp .env.example .env; fi', 'if 없을 때만', env),
      B('if [ -f .env ]; then echo ok; else cp .env.example .env; fi', 'else 쪽', env),
      B('[ -f .env ] || cp .env.example .env', '[ ] ||', env),
      B('test -f .env || cp .env.example .env', 'test ||', env),
      B('[ -e .env ] || cp .env.example .env', '-e', env),
      B('[ -f .env ] && echo ok || cp .env.example .env', '&& … ||', env),
      P('if (-not (Test-Path .env)) { Copy-Item .env.example .env }', '-not Test-Path', env),
      P('if (!(Test-Path .env)) { Copy-Item .env.example .env }', '!(Test-Path)', env),
      P('if (!(Test-Path .env)) { New-Item .env -ItemType File }', '빈 .env 만들기', env),
      B('env -i PATH="$PATH" make test', '깨끗한 환경 시험'),
    ],
  },
  'ask-cmd': {
    block: [
      B('kubectl rollout restart deploy/api', 'rollout restart', REMOTE),
      B('kubectl rollout undo deploy/api', 'rollout undo', REMOTE),
      B('terraform apply', 'terraform apply', REMOTE),
    ],
    pass: [
      B('kubectl rollout status deploy/api', 'rollout status', remote),
      B('kubectl rollout history deploy/api', 'rollout history', remote),
      B('terraform apply --help', '--help', remote),
      B('terraform apply -help', '-help', remote),
      B('terraform import -help', 'import -help', remote),
    ],
  },
  'password-cli': {
    block: [
      S('psql postgres://admin:' + 'hunter2x' + '@db.example.com:5432/app', '밖의 주소'),
    ],
    pass: [
      S("psql postgres://postgres:postgres@localhost:5432/app -c 'select 1'", 'localhost'),
      S("psql postgres://postgres:postgres@127.0.0.1:5432/app -c 'select 1'", '127.0.0.1'),
      S('psql postgres://postgres:postgres@db:5432/app', 'compose 서비스의 개발 기본값'),
    ],
  },
  'commit-msg': {
    block: [
      P('git commit -m @"\nfeat: 경로 $(pwd) 보이기\n"@', '@"…"@ 속 $( ) 는 실행된다', { reason: /PowerShell/ }),
      B('git commit -m "feat: `whoami` 추가"', '큰따옴표 속 백틱', { reason: /bash/ }),
    ],
    pass: [
      P("git commit -m @'\nfeat: 경로 $(pwd) 보이기\n'@", '@\'…\'@ 는 글자 그대로'),
    ],
  },
  'danger-cmd': {
    block: [
      B('git clean -fd', '추적 안 된 파일을 지움', { setup: keyed('br4-untracked', (r) => r.put('tmp/n.txt', 'x\n')) }),
    ],
    pass: [
      B('git clean -fd dist', '그 경로에 지울 것이 없음', { setup: keyed('br4-tracked-change', (r) => { r.put('README.md', 'changed\n'); r.put('tmp/n.txt', 'x\n'); }) }),
    ],
  },
};
