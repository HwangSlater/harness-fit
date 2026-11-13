// 역할극 13·14·15 회차 판정(2026-11-13)에서 나온 훅 쪽 고칠 점: ask-cmd 의 막기(block), 읽기 kubectl·helm 은 묻지 않기,
// make 변수=값, 운영 마디가 든 글자 주소로 가는 goose, vercel alias(set 없는 꼴), GitLab 저장소의 MR 글, 낙타 이름 …Key := 무작위 값.
// strict.test.mjs 가 같은 훅 사례에 이어 붙인다. c.decision 은 결정 꼴(deny·ask), c.reason 은 글을 본다.
import fs from 'node:fs';
import { S, B, W, keyed, onBranch, both } from './helpers.mjs';

const combos = JSON.parse(fs.readFileSync(new URL('../../../catalog/combos.json', import.meta.url), 'utf8'));
const VERCEL = { ...combos.stackAddons.find((a) => a.when.includes('Vercel') && a.hookOpts?.['ask-cmd']).hookOpts['ask-cmd'] };

const BLOCKED = ['terraform apply', 'make apply-prod', 'kubectl --context prod-payments', 'vercel --prod', 'scripts/drain-node.sh'];
// 막기만(원격 묻기 끔) — 통과 사례는 묻지도 막지도 않아야 한다
const BLOCK_ONLY = { commands: [], block: BLOCKED, remote: false };
// 막기 + 원격 묻기(기본) — 막기가 묻기보다 먼저
const BLOCK_REMOTE = { commands: [], block: BLOCKED };
const BOTH_LISTS = { commands: ['terraform apply'], block: ['terraform apply'], remote: false };
const DENY = { decision: 'deny', reason: /blocked from running.*ask the user to run it themselves/ };
const deny = (opts) => ({ opts, ...DENY });
const ask = (opts) => ({ opts, decision: 'ask' });
// 14 회차 정답지: 하위 명령 없이 컨텍스트만 적은 묻는 명령
const CONTEXT_ASK = { commands: ['kubectl --context prod-payments', 'helm --kube-context prod-payments'], remote: false };
const MAKE_ASK = { commands: ['make deploy-prod'], remote: false };
const REMOTE = { commands: [] };

// 원격 주소가 GitLab·GitHub 인 저장소, origin 없이 .gitlab-ci.yml 만 있는 저장소
const origin = (url) => keyed(`origin\0${url}`, (r) => r.git('remote', 'add', 'origin', url));
const GITLAB = origin('git@gitlab.example.com:team/payments.git');
const GITHUB = origin('https://github.com/team/payments.git');
const GITLAB_CI = keyed('gitlab-ci-file', (r) => r.put('.gitlab-ci.yml', 'stages: [test]\n'));
const MR = /merge request \(MR\)/;
const PR = /through a PR\.|open a PR\./;

// 비밀값처럼 생긴 글은 이어 붙여 만든다(이 파일을 쓸 때 훅이 막지 않게)
const RANDOM = 'q7Zr' + 'Xk2Lm9Pw4Tn8Vb3Hs6Jd1Fg5Ca0A1b2';
const K = 'Key';

export default {
  'ask-cmd': {
    block: [
      // 1. 막기 — 앞부분만 보는 permissions.deny 가 놓치는 꼴
      S('terraform -chdir=envs/prod apply', '-chdir 옵션이 앞에', deny(BLOCK_ONLY)),
      B('cd envs/prod && terraform apply -auto-approve', 'cd … && 뒤', deny(BLOCK_ONLY)),
      S('sudo terraform apply', 'sudo 앞붙이', deny(BLOCK_ONLY)),
      B('bash -c "terraform apply"', 'bash -c 속', deny(BLOCK_ONLY)),
      S('make DEPLOY=1 apply-prod', 'make 변수=값 뒤 목표', deny(BLOCK_ONLY)),
      B('TF_CLI_ARGS=-no-color make apply-prod', '명령 앞 환경 변수', deny(BLOCK_ONLY)),
      S('npx vercel --prod', 'npx 앞붙이', deny(BLOCK_ONLY)),
      S('pnpm dlx vercel deploy --prod', 'pnpm dlx + 옵션 자리', deny(BLOCK_ONLY)),
      S('kubectl apply -k deploy/overlays/prod --context prod-payments', '--context 를 뒤에', deny(BLOCK_ONLY)),
      S('kubectl --context=prod-payments delete pod api-0', '--context= 꼴', deny(BLOCK_ONLY)),
      S('bash scripts/drain-node.sh ip-10-0-1-5', 'bash 로 부른 스크립트', deny(BLOCK_ONLY)),
      S('./scripts/drain-node.sh ip-10-0-1-5', './ 로 부른 스크립트', deny(BLOCK_ONLY)),
      // 막기가 묻기보다 먼저: 원격 묻기도 걸리는 terraform apply, 두 목록에 다 있는 명령
      S('terraform apply', '원격 묻기와 겹쳐도 막기', deny(BLOCK_REMOTE)),
      S('terraform apply -auto-approve', '두 목록에 다 있으면 막기', deny(BOTH_LISTS)),
      // 막기는 시험 실행 표시를 보지 않는다(검토 2026-11-13 — 스크립트가 무시하면 그대로 실행된다)
      S('make -n apply-prod', 'make 시험 실행 표시', deny(BLOCK_ONLY)),
      B('DRY_RUN=1 make apply-prod', 'DRY_RUN=1', deny(BLOCK_ONLY)),
      // 글 하나로 적은 block 은 한 줄짜리 목록(목록으로 안 적어 막기가 조용히 꺼지던 일 — 검토 2026-11-13)
      S('terraform apply', 'block 이 글 하나', deny({ block: 'terraform apply', remote: false })),
      // 2. 컨텍스트만 적은 묻는 명령: 바꾸는 하위 명령은 그대로 묻는다
      S('kubectl --context prod-payments apply -k deploy/overlays/prod', '바꾸는 apply', ask(CONTEXT_ASK)),
      S('kubectl --context prod-payments rollout restart deploy/api', 'rollout', ask(CONTEXT_ASK)),
      S('kubectl --context prod-payments get secret db -o yaml', '읽기라도 원격 묻기의 비밀값 찍기는 묻는다', ask({ commands: ['kubectl --context prod-payments'] })),
      S('helm --kube-context prod-payments upgrade api ./chart', 'helm upgrade', ask(CONTEXT_ASK)),
      // 3. make 변수=값
      S('make DEPLOY=1 deploy-prod', '목표 앞의 변수=값', ask(MAKE_ASK)),
      S('make DEPLOY=1 VERSION=v2 deploy-prod', '변수=값 둘', ask(MAKE_ASK)),
      S('make -C . DEPLOY=1 deploy-prod', '-C 값과 변수=값', ask(MAKE_ASK)),
      // 4. 운영 마디가 든 글자 주소로 가는 마이그레이션
      S('goose postgres "postgres://u@db.prod.internal/x" up', 'db.prod.internal', ask(REMOTE)),
      S('goose -dir db/migrations postgres "postgres://payments@payments-prod.db.internal/payments" down', 'payments-prod 마디', ask(REMOTE)),
      S('goose postgres "host=db.production.example.com user=app dbname=pay" up', 'key=value DSN 의 host=', ask(REMOTE)),
      S('migrate -path db/migrations -database postgres://u@PROD.db.example.com/x up', '대문자 PROD 마디', ask(REMOTE)),
      B('GOOSE_DBSTRING=postgres://u@db.prod.internal/x goose up', '앞의 변수=글자 주소', ask(REMOTE)),
      // 7. vercel alias 는 set 없는 꼴도(스택 기본값)
      S('vercel alias my-app-git-main.vercel.app shop.example.com', 'set 없는 alias', ask(VERCEL)),
      S('vercel alias set my-app.vercel.app shop.example.com', 'alias set', ask(VERCEL)),
      S('npx vercel alias rm shop.example.com --yes', 'alias rm', ask(VERCEL)),
    ],
    pass: [
      // 1. 막기 목록이 있어도 보기·도움말·시험 실행·다른 명령은 그대로
      S('terraform plan -out plan.tfplan', 'plan 은 다른 명령', { opts: BLOCK_ONLY }),
      S('terraform apply --help', '도움말', { opts: BLOCK_ONLY }),
      S('terraform -version', '버전', { opts: BLOCK_ONLY }),
      S('make apply-dev', '다른 목표', { opts: BLOCK_ONLY }),
      S('kubectl --context prod-payments get pods', '읽기 get', { opts: BLOCK_ONLY }),
      S('kubectl --context prod-payments logs deploy/api --tail 50', '읽기 logs', { opts: BLOCK_ONLY }),
      S('kubectl --context prod-payments -n payments describe pod api-0', '-n 값 뒤 describe', { opts: BLOCK_REMOTE }),
      S('kubectl --context prod-payments diff -k deploy/overlays/prod', 'diff', { opts: BLOCK_REMOTE }),
      S('kubectl apply -k deploy/overlays/dev --context dev', '다른 컨텍스트(원격 묻기 끔)', { opts: BLOCK_ONLY }),
      S('vercel', '프리뷰 배포', { opts: BLOCK_ONLY }),
      S('echo "terraform apply 는 사람이 해요"', 'echo 속 글', { opts: BLOCK_ONLY }),
      S('git log --oneline -3', '관계없는 명령', { opts: BLOCK_ONLY }),
      // 깨진 옵션: 숫자·null·객체 항목이 와도 터지지 않고 통과
      S('terraform apply', 'block 항목이 글이 아님', { opts: { block: [42, null, { x: 1 }, ''], remote: false } }),
      // 2. 컨텍스트만 적은 묻는 명령의 읽기 하위 명령
      S('kubectl --context prod-payments get pods', 'get', { opts: CONTEXT_ASK }),
      S('kubectl --context prod-payments -n payments logs deploy/api', '-n 뒤 logs', { opts: CONTEXT_ASK }),
      S('kubectl --context=prod-payments describe pod api-0', '--context= 꼴 describe', { opts: CONTEXT_ASK }),
      S('kubectl --context prod-payments top pods', 'top', { opts: CONTEXT_ASK }),
      S('kubectl --context prod-payments api-resources', 'api-resources', { opts: CONTEXT_ASK }),
      S('helm --kube-context prod-payments list -A', 'helm list', { opts: CONTEXT_ASK }),
      S('helm --kube-context prod-payments status api', 'helm status', { opts: CONTEXT_ASK }),
      // 3. make 변수=값이어도 다른 목표
      S('make DEPLOY=1 deploy-dev', '다른 목표', { opts: MAKE_ASK }),
      S('make deploy-prod-check', '이름이 이어진 다른 목표', { opts: MAKE_ASK }),
      // 4. 운영이 아닌 글자 주소·보기
      S('goose postgres "postgres://u@product-db.internal/x" up', 'product 는 prod 마디가 아님', { opts: REMOTE }),
      S('goose postgres "postgres://u@db:5432/x" up', 'compose 안 호스트', { opts: REMOTE }),
      S('goose postgres "postgres://u@db.prod.internal/x" status', '보기만(status)', { opts: REMOTE }),
      S('goose create add_refunds sql', '새 파일 만들기', { opts: REMOTE }),
      // 7. vercel alias 목록 보기
      S('vercel alias ls', 'alias ls', { opts: VERCEL }),
      S('vercel alias list --scope team', 'alias list', { opts: VERCEL }),
    ],
  },

  'protect-branch': {
    block: [
      // 5. GitLab 저장소에서는 MR 글로
      S('git commit -m "feat: x"', 'GitLab origin 에서 main 커밋', { setup: GITLAB, reason: MR }),
      S('git push origin main', 'GitLab origin 에서 main push', { setup: GITLAB, reason: MR }),
      S('git commit -m "feat: x"', 'origin 없이 .gitlab-ci.yml', { setup: GITLAB_CI, reason: MR }),
      S('git commit -m "feat: x"', 'GitHub origin 은 PR 글', { setup: GITHUB, reason: PR }),
      S('git push origin main', 'GitHub origin push 는 PR 글', { setup: GITHUB, reason: PR }),
    ],
    pass: [
      S('git commit -m "feat: x"', 'GitLab 저장소의 기능 브랜치 커밋', { setup: both(GITLAB, onBranch('feature/refund')) }),
      S('git push origin feature/refund', 'GitLab 저장소의 기능 브랜치 push', { setup: both(GITLAB, onBranch('feature/refund')) }),
      S('git status', '보기만', { setup: GITLAB }),
    ],
  },

  secrets: {
    block: [
      // 6. 낙타 이름이 Key·Token 으로 끝나는 무작위 값
      W('internal/webhook/handler.go', `\twebhook${K} := "${RANDOM}"\n`, 'Go := 낙타 이름 …Key'),
      W('internal/webhook/config.go', `var webhook${K} = "${RANDOM}"\n`, 'Go var 낙타 이름'),
      W('src/sign.ts', `const signing${K} = "${RANDOM}";\n`, 'TS const 낙타 이름'),
      W('internal/auth/client.go', `\trefreshToken := "${RANDOM}"\n`, '…Token'),
    ],
    pass: [
      W('internal/cache/keys.go', `\tcache${K} := "user:profile:${RANDOM}"\n`, '캐시 이름표 마디'),
      W('web/store.ts', `const storage${K} = "${RANDOM}";\n`, 'storage 마디'),
      W('internal/list/page.go', `\tnextPageToken := "${RANDOM}"\n`, '쪽 넘김 토큰'),
      W('internal/webhook/env.go', `\twebhook${K} := os.Getenv("WEBHOOK_KEY")\n`, '환경 변수 읽기'),
      W('internal/webhook/doc.go', `\twebhook${K} := "your-webhook-key-goes-here-xx"\n`, '자리표시자'),
      W('internal/webhook/name.go', `\twebhook${K} := "webhook.signing.key.name.v2"\n`, '점으로 이은 이름표'),
      W('internal/webhook/short.go', `\twebhook${K} := "Ab12Cd34Ef56"\n`, '24자 못 되는 값'),
      W('internal/webhook/handler_test.go', `\twebhook${K} := "${RANDOM}"\n`, '시험 파일'),
    ],
  },
};
