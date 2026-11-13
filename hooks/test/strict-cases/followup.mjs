// 검토 2026-11-11(역할극 10·11 회차 뒤)에서 나온 꼴. 다른 사례 파일이 400줄에 가까워 따로 둔다 — strict.test.mjs 가 같은 훅의 사례에 이어 붙인다.
// 사례마다 opts 를 따로 준다(이어 붙일 때 훅 옵션은 원래 파일의 것을 쓰므로).
import fs from 'node:fs';
import { S, W, P, keyed } from './helpers.mjs';

// 비밀값처럼 보이는 이름은 이어 붙여 만든다(이 파일을 쓸 때 비밀값 훅이 막지 않게)
const K = '_K' + 'EY';
const T = '_TO' + 'KEN';
const line = (name, value) => `${name} = "${value}"\n`;

// fastlane 레인만 적은 것과 iOS 스택 기본 묻는 명령(catalog/combos.json stackAddons 의 iOS 목록 그대로 — 독립 검토 2026-11-13)
const LANE = { commands: ['fastlane beta'] };
const combos = JSON.parse(fs.readFileSync(new URL('../../../catalog/combos.json', import.meta.url), 'utf8'));
const IOS = combos.stackAddons.find((a) => a.when.includes('iOS') && a.hookOpts?.['ask-cmd']).hookOpts['ask-cmd'];

// 보호 경로 main(파일)·config/prod.yml 을 커밋해 둔 저장소. 기본 저장소에는 main 브랜치가 있다.
const PROT = { paths: ['main', 'config/prod.yml'] };
const files = keyed('followup-files', (r) => {
  r.commit('main', 'file named main\n', 'chore: main 파일');
  r.commit('config/prod.yml', 'a: 1\n', 'chore: 설정');
  r.commit('app.log', 'x\n', 'chore: 로그');
});
const prodChanged = keyed('followup-prod-changed', (r) => {
  files(r);
  r.put('config/prod.yml', 'a: 2\n');
});
const tagged = keyed('followup-tag', (r) => {
  r.commit('v1', 'file named v1\n', 'chore: v1 파일');
  r.git('tag', 'v1');
});
const P_OPTS = { ...PROT, paths: [...PROT.paths, 'v1'] };

// 마이그레이션: 0001 을 두 번 커밋(내용이 바뀜), 또는 0001 커밋 뒤 0002 를 더함
const DJANGO = 'shop/migrations/0001_initial.py';
const changedTwice = keyed('followup-mig-twice', (r) => {
  r.commit(DJANGO, 'a\n', 'chore: 0001');
  r.commit(DJANGO, 'b\n', 'chore: 0001 고침');
});
const addedSecond = keyed('followup-mig-added', (r) => {
  r.commit(DJANGO, 'a\n', 'chore: 0001');
  r.commit('shop/migrations/0002_more.py', 'b\n', 'chore: 0002');
});
const withStatic = keyed('followup-mig-static', (r) => {
  r.commit(DJANGO, 'a\n', 'chore: 0001');
  r.commit('shop/static/a.css', 'a\n', 'chore: css');
  r.commit('shop/static/a.css', 'b\n', 'chore: css 고침');
  r.commit('app.log', 'x\n', 'chore: 로그');
});

const MAKE = { commands: ['make backfill'], remote: false };

export default {
  'protected-files': {
    block: [
      S('git rm -r .', 'git rm -r . 이 보호 파일을 지움', { opts: PROT, setup: files }),
      S('git rm -r "*"', 'git rm -r "*"(git 의 * 는 / 를 넘음)', { opts: PROT, setup: files }),
      S('git rm "m*"', 'git rm 글롭이 보호 파일 main 에 맞음', { opts: PROT, setup: files }),
      S('git rm "config/*.yml"', 'git rm 폴더 글롭', { opts: PROT, setup: files }),
      S('git checkout -- "config/*.yml"', 'checkout 글롭이 고친 보호 파일을 되돌림', { opts: PROT, setup: prodChanged }),
      S('git restore :/', 'restore :/ 가 고친 보호 파일을 되돌림', { opts: PROT, setup: prodChanged }),
      S('git checkout config/prod.yml', '파일만 있고 같은 이름 브랜치가 없으면 경로', { opts: PROT, setup: prodChanged }),
      // 클라우드에서 보호 폴더로 내려받으며 지우기(역할극 7 회차 다시 — 원격 묻기에서 내려받기를 뺀 뒤 지나갔다)
      S('aws s3 sync s3://bucket/raw data/raw/ --delete', 'aws s3 sync --delete 로 보호 폴더 지우기', { opts: { paths: ['data/raw/'] } }),
      S('rclone sync remote:raw data/raw', 'rclone sync 로 보호 폴더 덮어쓰기', { opts: { paths: ['data/raw/'] } }),
      S('aws --region us-east-1 s3 sync s3://bucket/raw data/raw --delete --page-size 100', 'aws 전역 옵션 앞·값 옵션 뒤', { opts: { paths: ['data/raw/'] } }),
      S('rclone --config x.conf sync remote:raw data/raw --max-depth 2', 'rclone 전역 옵션 앞·모르는 값 옵션 뒤', { opts: { paths: ['data/raw/'] } }),
      S('gsutil cp gs://b/a.csv gs://b/b.csv data/raw/', 'gsutil 원본 여럿(마지막 원격 주소 다음이 받는 쪽)', { opts: { paths: ['data/raw/'] } }),
    ],
    pass: [
      S('aws s3 sync data/raw/ s3://bucket/raw', '보호 폴더에서 올리기(읽기만)', { opts: { paths: ['data/raw/'] } }),
      S('aws s3 sync s3://bucket/raw data/raw --dryrun --delete', 'aws --dryrun 시험 실행', { opts: { paths: ['data/raw/'] } }),
      S('rclone sync remote:raw data/raw --dry-run', 'rclone --dry-run', { opts: { paths: ['data/raw/'] } }),
      S('rclone sync -n remote:raw data/raw', 'rclone -n(시험 실행 짧은 꼴)', { opts: { paths: ['data/raw/'] } }),
      S('gsutil rsync -n -d gs://bucket/raw data/raw', 'gsutil rsync -n', { opts: { paths: ['data/raw/'] } }),
      S('git checkout main', '파일 main 이 있어도 브랜치 main 으로 바꿈', { opts: PROT, setup: files }),
      S('git checkout -q main', '-q 브랜치 바꾸기', { opts: PROT, setup: files }),
      S('git checkout --recurse-submodules main', '--recurse-submodules 브랜치 바꾸기', { opts: PROT, setup: files }),
      S('git checkout v1', '파일 v1 이 있어도 태그 v1', { opts: P_OPTS, setup: tagged }),
      S('git rm "*.log"', '보호 파일에 맞지 않는 글롭', { opts: PROT, setup: files }),
      S('git checkout -- "config/*.yml"', '글롭에 맞는 보호 파일이 바뀌지 않았으면 그대로', { opts: PROT, setup: files }),
      S('git rm .', '-r 없는 git rm . 은 지우지 않음', { opts: PROT, setup: files }),
    ],
  },

  'migration-edit': {
    block: [
      S('git checkout HEAD~1 -- shop/migrations', '다른 커밋에서 폴더째 — 커밋한 0001 이 바뀜', { setup: changedTwice }),
      S('git restore --source HEAD~1 shop/migrations', 'restore 폴더 — 0002 가 지워짐', { setup: addedSecond }),
      S('cd shop/migrations && git rm -r --cached .', '하위 폴더의 --cached . 은 그 폴더 마이그레이션만 뺀다(검토 2026-11-11)', { setup: changedTwice }),
      P('Set-Location shop; git rm -r --cached .', 'PowerShell Set-Location 뒤 하위 폴더', { setup: changedTwice }),
      S('git restore -s HEAD~1 -- shop', 'restore -s 품은 폴더', { setup: addedSecond }),
      S('git rm -r .', 'git rm -r . 이 마이그레이션을 지움', { setup: addedSecond }),
      S('git rm -r "*"', 'git rm 글롭 *', { setup: addedSecond }),
      S('git rm "shop/*"', 'git 글롭은 / 를 넘어 shop/migrations 까지', { setup: addedSecond }),
    ],
    pass: [
      S('git checkout HEAD~1 -- shop/migrations', 'checkout 은 그 커밋에 없는 0002 를 두고 0001 은 같음', { setup: addedSecond }),
      S('git restore --source HEAD~1 shop/static', '마이그레이션 없는 폴더', { setup: withStatic }),
      S('git rm "*.log"', '마이그레이션에 맞지 않는 글롭', { setup: withStatic }),
    ],
  },

  'ask-cmd': {
    block: [
      S('./scripts/backfill.sh --dry-run=false', '--dry-run=false 는 실제 실행', { opts: { commands: ['./scripts/backfill.sh'] } }),
      S('./scripts/backfill.sh --dry-run=0', '--dry-run=0', { opts: { commands: ['./scripts/backfill.sh'] } }),
      S('./scripts/backfill.sh --dry-run=off', '--dry-run=off', { opts: { commands: ['./scripts/backfill.sh'] } }),
      S('make backfill', 'make 적은 대상', { opts: MAKE }),
      // 적은 스크립트는 그대로 묻는다(아래 pass 의 다른 .sh 와 짝 — 정답지 다시 매기기 2026-11-13)
      S('./scripts/release.sh', '적은 .sh 스크립트', { opts: { commands: ['./scripts/release.sh'] } }),
      S('bash scripts/release.sh v1.2', 'bash 로 부른 적은 스크립트', { opts: { commands: ['./scripts/release.sh'] } }),
      S('make -C sub backfill', 'make -C 값 뒤', { opts: MAKE }),
      // fastlane 의 platform :ios 블록 속 레인(독립 검토 2026-11-13)
      S('fastlane ios beta', '적은 fastlane beta 를 플랫폼 낱말 붙여 부름', { opts: LANE }),
      S('bundle exec fastlane ios beta', 'bundle exec + 플랫폼 낱말', { opts: LANE }),
      S('fastlane android beta', 'android 플랫폼', { opts: LANE }),
      S('fastlane beta', '적은 그대로', { opts: LANE }),
      S('fastlane ios release', '플랫폼 낱말까지 적은 것', { opts: { commands: ['fastlane ios release'] } }),
      S('xcrun notarytool submit app.zip --wait', 'iOS 기본 묻는 명령', { opts: IOS }),
      S('xcrun altool --upload-app -f app.ipa', 'altool 올리기', { opts: IOS }),
      S('fastlane ios cert', 'fastlane cert 를 플랫폼 붙여', { opts: IOS }),
    ],
    pass: [
      // 다른 .sh 스크립트는 묻지 않는다 — release.sh 가 「sh.py」 꼴로도 맞춰져 모든 .sh 를 묻던 일(정답지 다시 매기기 2026-11-13)
      S('./scripts/test.sh', '적지 않은 .sh(test)', { opts: { commands: ['./scripts/release.sh'] } }),
      S('bash scripts/lint.sh', '적지 않은 .sh(lint)', { opts: { commands: ['./scripts/release.sh'] } }),
      P('./scripts/build.ps1', '적지 않은 .ps1', { opts: { commands: ['./scripts/deploy.ps1'] } }),
      S('make -n backfill', 'make -n(보기만)', { opts: MAKE }),
      S('make --just-print backfill', 'make --just-print', { opts: MAKE }),
      S('make --dry-run backfill', 'make --dry-run', { opts: MAKE }),
      S('./scripts/backfill.sh --dry-run=true', '--dry-run=true', { opts: { commands: ['./scripts/backfill.sh'] } }),
      S('./scripts/backfill.sh --dry-run=server', '--dry-run=server', { opts: { commands: ['./scripts/backfill.sh'] } }),
      S('fastlane ios test', 'beta 만 적었으면 플랫폼 붙은 다른 레인은 아님', { opts: LANE }),
      S('bundle exec fastlane ios test', 'bundle exec 다른 레인', { opts: LANE }),
      S('fastlane test', '플랫폼 없는 다른 레인', { opts: LANE }),
      S('fastlane android release', '적은 것은 ios release — 다른 플랫폼', { opts: { commands: ['fastlane ios release'] } }),
      S('xcrun notarytool history', '공증 기록 보기는 묻지 않음', { opts: IOS }),
      S('xcrun altool --validate-app -f app.ipa', '검사만', { opts: IOS }),
      S('agvtool what-marketing-version', '버전 보기', { opts: IOS }),
      S('security find-identity -v -p codesigning', '인증서 보기', { opts: IOS }),
    ],
  },

  secrets: {
    block: [
      W('detctl/feed.py', line('ORDERS_FEED' + T, 'q8W3e9R2t7Y1u6I4o0P5'), '대문자 상수 _TOKEN 무작위 값'),
      W('enricher/feed.go', 'os.environ["THREAT_INTEL' + K + '"] = "a1b2c3d4e5f6g7h8i9j0"\n', 'os.environ["…_KEY"] 무작위 값'),
      W('src/hooks.ts', 'const PAYMENT_WEBHOOK' + K + ' = "Zx9Qw8Er7Ty6Ui5Op4As";\n', '공개 낱말이 없는 이름의 무작위 값'),
      // 다섯 번째 이후 검토(2026-11-11): / 가 든 base64·STORAGE·COOKIE·ROUTING 이 든 진짜 비밀 이름
      W('src/crypto.py', line('APP_ENCRYPTION' + K, 'q3x/Zk8LmN2oP7rS9tUv1wXy4zAb6cDe0fGh'), '/ 가 든 base64 키'),
      W('src/azure.py', line('AZURE_STORAGE' + K, 'Zx8kLmN2oP3qRs4tUv5wXy6zAb7cDe8fGh9i'), 'Azure Storage 키'),
      W('src/session.py', line('SESSION_COOKIE' + K, 'k8s9dF3jw0qPz7LmN2vBq1'), '세션 쿠키 서명 키'),
      // 역할극 13(2026-11-12): 공개 접두에 비밀 이름 — 값이 없어도 번들에 실린다
      W('web/pay.ts', 'const s = process.env.NEXT_PUBLIC_PAYMENT_SEC' + 'RET;\n', 'NEXT_PUBLIC_ + SECRET 이름'),
      W('web/db.ts', 'const k = import.meta.env.VITE_SUPABASE_SERVICE_' + 'ROLE_KEY;\n', 'VITE_ + service_role'),
      // 역할극 14(2026-11-12): Go := 대입, 접속 주소 속 비밀번호
      W('internal/db/conn.go', '\tdbPass' + 'word := "Qw8rT3zX9vLp"\n', 'Go := 대입'),
      W('web/stripe.ts', 'const k = process.env.NEXT_PUBLIC_STRIPE_SEC' + 'RET_KEY;\n', '공개 접두 + SECRET_KEY'),
      W('internal/db/dsn.go', 'const dsn = "postgres://app:Xk29fPq7Lm3' + 'z@db.prod.internal:5432/pay"\n', '주소 속 무작위 비밀번호'),
    ],
    pass: [
      W('web/env.js', line('NEXT_PUBLIC_MAPS' + K, 'AbCdEf1234567890GhIj'), 'NEXT_PUBLIC_ 은 브라우저에 공개'),
      W('web/pay.js', line('STRIPE_PUBLISHABLE' + K, 'pk_test_51H8abcDEF1234567890'), '공개 키(publishable)'),
      W('web/form.js', line('RECAPTCHA_SITE' + K, '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI'), 'reCAPTCHA 사이트 키'),
      W('web/search.js', line('ALGOLIA_SEARCH' + K, '6be0576ff61c053d5f9a3225e2a90f76'), 'Algolia 검색 전용 키'),
      W('web/map.js', line('MAPBOX' + T, 'pk.eyJ1IjoibXl1c2VyIiwiYSI6ImNrMTIzIn0'), 'Mapbox 공개 토큰(pk.)'),
      W('web/store.js', line('LOCALSTORAGE' + K, 'myAppAuthStateV2'), 'localStorage 이름표'),
      W('web/flags.js', line('FEATURE_FLAG' + K, 'enableNewCheckout2024'), '기능 플래그 이름'),
      W('web/list.js', line('SORT' + K, 'createdAt_desc_v123'), '정렬 키'),
      W('web/csrf.js', line('CSRF_COOKIE' + K, 'XSRF-TOKEN-2024-v1'), '쿠키 이름'),
      W('web/upload.js', line('S3' + K, 'uploads/2024/11/report.pdf'), 'S3 객체 경로'),
      W('web/settings.js', line('STORAGE' + K, 'appSettingsV3_2024'), '저장소 이름표(낱말 + 버전 꼬리)'),
      W('src/paths.py', line('DB_PATH' + T, '/opt/MyApp/data/AppData'), '대문자 마디가 든 실제 경로(검토 2026-11-11)'),
      W('src/win.js', line('BACKUP_DIR' + T, 'C:\\\\app\\\\data\\\\backups'), '코드 문자열의 겹친 역슬래시 경로'),
      W('web/events.js', line('ROUTING' + K, 'orders.Created.v2024'), '메시지 라우팅 키(점으로 이은 낱말)'),
      W('web/state.js', line('SESSION' + K, 'checkoutDraftState2024'), '낙타 표기 낱말 + 숫자 꼬리'),
      W('web/api.ts', 'const u = process.env.NEXT_PUBLIC_API_BASE;\n', '공개 접두의 보통 이름'),
      W('web/sb.ts', 'const k = import.meta.env.VITE_SUPABASE_ANON_KEY;\n', 'anon 키는 공개용'),
      W('docker/dev.go', 'const dsn = "postgres://postgres:postgres@localhost:5432/dev"\n', '개발 기본 비밀번호'),
      W('cmd/dsn.go', 'dsn := "postgres://app:${DB_PASS}@db:5432/pay"\n', '주소 속 변수 참조'),
      W('cmd/env.go', '\tpass := os.Getenv("DB_PASS' + 'WORD")\n', 'Go := 로 환경 변수 읽기'),
      // 검토 2026-11-12: 비밀 낱말로 끝나지 않는 공개 설정 이름, 문서, 이 PC 주소·아이디가 든 개발 비밀번호
      W('web/auth.ts', 'const u = process.env.REACT_APP_PASS' + 'WORD_RESET_URL;\n', '비밀번호 재설정 주소 이름'),
      W('web/rules.ts', 'const n = import.meta.env.VITE_PASS' + 'WORD_MIN_LENGTH;\n', '비밀번호 길이 설정 이름'),
      W('docs/env.md', '`NEXT_PUBLIC_PAYMENT_SEC' + 'RET` 처럼 이름 짓지 마세요\n', '문서 속 나쁜 예'),
      W('docker-compose.yml', 'DATABASE_URL: postgres://app:app12345@localhost:5432/app\n', 'localhost 개발 주소'),
      W('cmd/dev.go', 'const dsn = "postgres://postgres:postgres123@db:5432/dev"\n', '아이디가 든 개발 비밀번호'),
    ],
  },
};
