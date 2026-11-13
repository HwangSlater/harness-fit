// 정답지 다시 매기기 뒤 검토(2026-11-13)에서 나온 ask-cmd 꼴: python -m 모듈 꼴, 버전 태그 올리기, iOS 기본 묻는 명령 더함,
// 읽기 전용 fastlane match, 이름이 운영인 환경 변수로 가는 DB 클라이언트·마이그레이션 도구. strict.test.mjs 가 같은 훅 사례에 이어 붙인다.
import fs from 'node:fs';
import { S, B, P, keyed } from './helpers.mjs';

// 버전 꼴 이름의 태그·브랜치가 있는 저장소(검토 2026-11-13 — CPython·Symfony 꼴 유지보수 브랜치)
const VERSION_REFS = keyed('version-refs', (r) => {
  for (const b of ['2.0-dev', '2.0', '3.12', '1.2.3-hotfix', '2024.11', '4.0.0']) r.git('branch', b);
  for (const tg of ['v2.0', '5.1', 'v1.3.0-rc.1']) r.git('tag', tg);
  r.git('update-ref', 'refs/remotes/origin/v2.0-dev', 'HEAD');
  r.git('update-ref', 'refs/remotes/origin/6.0.0', 'HEAD');
});

const combos = JSON.parse(fs.readFileSync(new URL('../../../catalog/combos.json', import.meta.url), 'utf8'));
const IOS = combos.stackAddons.find((a) => a.when.includes('iOS') && a.hookOpts?.['ask-cmd']).hookOpts['ask-cmd'];
// Matchfile 이 있는 저장소의 묻는 명령(scripts/lib/suggest.mjs 가 「fastlane match」 를 더한다)
const IOS_MATCH = { ...IOS, commands: [...IOS.commands, 'fastlane match'] };
const PY = { commands: ['python tools/cmd.py'], remote: false };
const PY_M = { commands: ['python -m tools.cmd'], remote: false };
const OUT = { commands: ['./a.out'], remote: false };
// 원격 묻기만(적은 명령 없음)
const REMOTE = { commands: [] };

export default {
  'ask-cmd': {
    block: [
      // python -m 모듈 ↔ 파일 — 끝 마디가 cmd·go·r·md 여도(확장자 목록으로 거르던 회귀)
      S('python -m tools.cmd', '적은 파일을 모듈 꼴로', { opts: PY }),
      S('python3 -m tools.cmd --all', 'python3 -m 과 인자', { opts: PY }),
      S('uv run python -m tools.cmd', 'uv run 뒤 모듈 꼴', { opts: PY }),
      S('python tools/cmd.py', '적은 그대로', { opts: PY }),
      S('python tools/cmd.py', '적은 모듈을 파일 꼴로', { opts: PY_M }),
      S('python -m tools.cmd', '적은 모듈 그대로', { opts: PY_M }),
      S('./a.out', '적은 a.out 그대로', { opts: OUT }),
      // 버전 태그 올리기(원격 묻기) — 16 회차 정답지 M2
      S('git push --tags', '모든 태그 올리기', { opts: REMOTE }),
      S('git push origin v1.3.0', '버전 태그 하나', { opts: REMOTE }),
      S('git push origin tag v1.3.0', 'tag <이름> 꼴', { opts: REMOTE }),
      S('git push origin refs/tags/release-7', 'refs/tags/ 경로', { opts: REMOTE }),
      S('git push --delete origin v1.0.0', '원격 태그 지우기', { opts: REMOTE }),
      S('git -C ios push origin 2.0.1', 'git -C 뒤, v 없는 버전', { opts: REMOTE }),
      // iOS 기본 묻는 명령에 더한 것
      S('git push origin main --follow-tags', 'iOS: 태그 함께 올리기', { opts: IOS }),
      S('xcrun altool --upload-package app.ipa --type ios', 'altool --upload-package', { opts: IOS }),
      S('bundle exec fastlane deliver', 'fastlane deliver 바로', { opts: IOS }),
      S('fastlane ios pilot upload --ipa app.ipa', 'pilot upload(플랫폼 낱말)', { opts: IOS }),
      S('fastlane sigh', 'sigh', { opts: IOS }),
      S('fastlane produce -u lead@example.com', 'produce', { opts: IOS }),
      S('fastlane match nuke development', 'match nuke(Matchfile 없어도)', { opts: IOS }),
      S('fastlane match nuke development --readonly', 'nuke 는 readonly 여도', { opts: IOS_MATCH }),
      S('fastlane match appstore', 'readonly 없는 match', { opts: IOS_MATCH }),
      S('security import dist.p12 -k login.keychain', '키체인에 넣기', { opts: IOS }),
      // 이름이 운영인 환경 변수로 가는 DB 클라이언트·마이그레이션 — 14 회차 정답지 M2
      S('psql "$PROD_DATABASE_URL"', 'psql 운영 변수', { opts: REMOTE }),
      S('psql $PROD_DB_URL -c "select 1"', 'psql 운영 변수 -c', { opts: REMOTE }),
      S('psql "${DB_PROD_URL}" -f fix.sql', '가운데 _PROD_', { opts: REMOTE }),
      S('pg_dump "$PRODUCTION_DATABASE_URL" -f out.sql', 'PRODUCTION_', { opts: REMOTE }),
      P('psql $env:PROD_DATABASE_URL', 'PowerShell $env:', { opts: REMOTE }),
      S('goose -dir db postgres "$PROD_DATABASE_URL" up', 'goose up', { opts: REMOTE }),
      S('goose -dir db/migrations postgres "$PROD_DATABASE_URL" down', 'goose down', { opts: REMOTE }),
      B('GOOSE_DBSTRING=$PROD_DATABASE_URL goose -dir db up', '앞 변수로 운영 주소', { opts: REMOTE }),
      S('migrate -database "$PROD_DATABASE_URL" -path db/migrations up', 'golang-migrate', { opts: REMOTE }),
      S('dbmate --url "$PROD_DATABASE_URL" migrate', 'dbmate migrate', { opts: REMOTE }),
      // 버전 꼴 이름: 저장소에 태그로 있으면 묻는다(브랜치 꼴 이름이어도), 찾지 못하면 N.N.N 만
      S('git push origin v2.0', '로컬 태그 v2.0(두 마디)', { opts: REMOTE, setup: VERSION_REFS }),
      S('git push gitlab 5.1', '로컬 태그 5.1', { opts: REMOTE, setup: VERSION_REFS }),
      S('git push origin v1.3.0-rc.1', '뒤붙이 있는 로컬 태그', { opts: REMOTE, setup: VERSION_REFS }),
      S('git push origin +v2.0:v2.0', '+src:dst 의 src 가 태그', { opts: REMOTE, setup: VERSION_REFS }),
      S('git push origin --delete v1.3.0-rc.1', '로컬 태그 이름 지우기', { opts: REMOTE, setup: VERSION_REFS }),
      S('git push origin HEAD:refs/tags/v9', 'dst 가 refs/tags/', { opts: REMOTE }),
      S('git push -u origin refs/tags/v3.0.0', '-u 여도 refs/tags/ 는 태그', { opts: REMOTE }),
      S('git push origin :v1.0.0', '지우기(로컬에 없음 — N.N.N 꼴)', { opts: REMOTE }),
      // 운영 변수는 접속 자리에서만(SQL 글 속은 아님)
      S('psql -d "$PROD_DATABASE_URL" -c "select 1"', '-d 운영 변수', { opts: REMOTE }),
      S('psql --dbname=$PROD_DB_URL', '--dbname= 운영 변수', { opts: REMOTE }),
      S('psql -v ON_ERROR_STOP=1 "$PROD_DATABASE_URL" -f fix.sql', '-v 값을 건너뛴 위치 인자', { opts: REMOTE }),
      S('mysql -h $PROD_DB_HOST -e "select 1"', '-h 운영 변수', { opts: REMOTE }),
      B('PGDATABASE=$PROD_DB psql -c "select 1"', '앞 변수=값', { opts: REMOTE }),
    ],
    pass: [
      // 모듈 꼴은 -m 뒤에서만 — 끝 마디가 확장자 같은 실행 파일은 모듈이 아니다
      S('./a.out', '적지 않은 a.out(예전엔 out.py 꼴)', { opts: { commands: ['python -m tools.out'], remote: false } }),
      S('./run.ksh', '.ksh', { opts: { commands: ['python -m tools.ksh'], remote: false } }),
      S('node tool.mts', '.mts', { opts: { commands: ['python -m tools.mts'], remote: false } }),
      S('./b.out', '다른 실행 파일', { opts: OUT }),
      S('python -m tools.other', '다른 모듈', { opts: PY }),
      S('./scripts/test.sh', '적지 않은 .sh 는 그대로 통과', { opts: { commands: ['./scripts/release.sh'], remote: false } }),
      // 버전 태그가 아닌 push
      S('git push origin main', '브랜치 push', { opts: REMOTE }),
      S('git push -u origin feature/refunds', '새 브랜치', { opts: REMOTE }),
      S('git push origin release/1.3', '이름에 숫자가 든 브랜치', { opts: REMOTE }),
      S('git push origin main:main', 'src:dst 브랜치', { opts: REMOTE }),
      S('git push --dry-run --tags', '시험 실행', { opts: REMOTE }),
      S('git push origin main --follow-tags', 'iOS 가 아니면 --follow-tags 는 평소 push', { opts: REMOTE }),
      // iOS: 보기만 하는 것, 읽기 전용 match
      S('fastlane pilot list', 'pilot list', { opts: IOS }),
      S('security find-identity -v -p codesigning', 'find-identity', { opts: IOS }),
      S('fastlane match development --readonly', 'match --readonly', { opts: IOS_MATCH }),
      S('bundle exec fastlane ios match appstore --readonly', '플랫폼 낱말 + --readonly', { opts: IOS_MATCH }),
      S('fastlane run match readonly:true', 'run match readonly:true', { opts: IOS_MATCH }),
      B('MATCH_READONLY=true fastlane match appstore', 'MATCH_READONLY=true', { opts: IOS_MATCH }),
      S('fastlane certs', '읽기 전용 받기 레인', { opts: IOS_MATCH }),
      // 운영이라 말하지 않는 변수·보기만 하는 마이그레이션
      S('psql "$DATABASE_URL"', '어디인지 모르는 DATABASE_URL', { opts: REMOTE }),
      S('psql $DEV_DATABASE_URL -c "select 1"', 'DEV_', { opts: REMOTE }),
      S('psql "$TEST_DATABASE_URL"', 'TEST_', { opts: REMOTE }),
      S('psql "$PRODUCT_DB_URL"', 'PRODUCT_ 는 운영이 아님', { opts: REMOTE }),
      S('goose -dir db postgres "$PROD_DATABASE_URL" status', 'goose status(보기)', { opts: REMOTE }),
      S('goose -dir db postgres "$DATABASE_URL" up', '운영 변수가 아닌 goose up', { opts: REMOTE }),
      S('goose -dir db postgres "postgres://app:app@localhost:5432/app" up', '로컬 주소 goose up', { opts: REMOTE }),
      S('atlas migrate status --url "$PROD_DATABASE_URL"', 'atlas migrate status', { opts: REMOTE }),
      S('echo "$PROD_DATABASE_URL"', 'DB 도구가 아님', { opts: REMOTE }),
      // 버전 꼴 브랜치(CPython 3.12·Symfony 6.4 꼴 유지보수 브랜치)
      S('git push origin 2.0-dev', '버전 꼴 브랜치', { opts: REMOTE, setup: VERSION_REFS }),
      S('git push -u origin 2.0', '-u 는 브랜치', { opts: REMOTE }),
      S('git push --set-upstream origin 4.0.0', '--set-upstream 은 브랜치(N.N.N 꼴이어도)', { opts: REMOTE }),
      S('git push gitlab 3.12', '브랜치 3.12', { opts: REMOTE, setup: VERSION_REFS }),
      S('git push origin HEAD:v2.1', 'src 가 HEAD', { opts: REMOTE }),
      S('git push origin 1.2.3-hotfix', '뒤붙이 있는 브랜치', { opts: REMOTE, setup: VERSION_REFS }),
      S('git push origin --delete v2.0-dev', '원격 추적 브랜치 지우기', { opts: REMOTE, setup: VERSION_REFS }),
      S('git push origin 2024.11', '날짜 꼴 브랜치', { opts: REMOTE, setup: VERSION_REFS }),
      S('git push origin 4.0.0', 'N.N.N 꼴이어도 로컬 브랜치', { opts: REMOTE, setup: VERSION_REFS }),
      S('git push origin --delete 6.0.0', 'N.N.N 꼴 원격 추적 브랜치 지우기', { opts: REMOTE, setup: VERSION_REFS }),
      S('git push origin 2.0-dev', '찾지 못한 애매한 이름(뒤붙이)', { opts: REMOTE }),
      S('git push origin 2024.11', '찾지 못한 두 마디 이름', { opts: REMOTE }),
      // SQL·스크립트 글 속 $PROD 는 접속이 아니다
      S(`psql "$DATABASE_URL" -c "select '$PROD'"`, '-c SQL 속 $PROD', { opts: REMOTE }),
      S('psql -d app -c "update t set env = \'$PROD_ENV\'"', '-c SQL 속 $PROD_ENV', { opts: REMOTE }),
      S('psql -d app -v env=$PROD -f seed.sql', '-v 값', { opts: REMOTE }),
      S('psql -d app --command="select \'$PROD\'"', '--command= 값', { opts: REMOTE }),
      S('mysql -e "select \'$PROD_X\'" app', 'mysql -e 값', { opts: REMOTE }),
      S('mongosh "$DATABASE_URL" --eval "db.x.find({env: \'$PROD\'})"', 'mongosh --eval 값', { opts: REMOTE }),
    ],
  },
};
