// migration-edit 엄격 사례: 이미 커밋한 마이그레이션 고치기·이름 바꾸기·지우기는 막고, 새 마이그레이션·R__·아직 커밋 안 한 것·다른 파일은 둔다.
import fs from 'node:fs';
import path from 'node:path';
import { S, B, P, W, E, keyed, stage, both } from './helpers.mjs';

const FLYWAY = 'src/main/resources/db/migration/V1__init.sql';
const DJANGO = 'shop/migrations/0001_initial.py';
const RAILS = 'db/migrate/20240101000000_create_users.rb';
const ALEMBIC = 'alembic/versions/3f2a1b_add_email.py';
const PRISMA = 'prisma/migrations/20240101_init/migration.sql';
const JAVA = 'src/main/java/db/migration/V2__Seed.java';
const GOOSE = 'db/migrations/00001_create_payments.sql';

// 그 파일을 커밋해 둔 저장소
const committed = (file, text = 'x\n') => keyed(`migration\0${file}`, (r) => r.commit(file, text, 'chore: 마이그레이션'));

export default {
  'migration-edit': {
    block: [
      // 역할극 14(2026-11-12): goose·golang-migrate
      E(GOOSE, 'x', 'y', 'goose: 커밋한 00001 고치기', { setup: committed(GOOSE) }),
      S('rm db/migrations/000003_add_index.up.sql', 'golang-migrate: up.sql 지우기', { setup: committed('db/migrations/000003_add_index.up.sql') }),
      E(FLYWAY, 'id INT', 'id INT, email TEXT', 'Flyway: 커밋한 V1 고치기', { setup: committed(FLYWAY, 'CREATE TABLE users (id INT);\n') }),
      W(DJANGO, 'operations = [1]\n', 'Django: 커밋한 0001 통째로 다시 쓰기', { setup: committed(DJANGO) }),
      E(JAVA, 'x', 'y', 'Flyway Java 마이그레이션', { setup: committed(JAVA) }),
      E(ALEMBIC, 'x', 'y', 'Alembic versions', { setup: committed(ALEMBIC) }),
      S(`sed -i 's/a/b/' ${RAILS}`, 'Rails: sed -i', { setup: committed(RAILS) }),
      S(`echo "x" >> ${PRISMA}`, 'Prisma: >> 덧붙이기', { setup: committed(PRISMA) }),
      S(`rm ${DJANGO}`, 'rm 으로 지우기', { setup: committed(DJANGO) }),
      S('rm -rf shop/migrations', '마이그레이션 폴더 통째로 지우기', { setup: committed(DJANGO) }),
      B('rm shop/migrations/*.py', '글롭으로 지우기', { setup: committed(DJANGO) }),
      S(`git rm ${DJANGO}`, 'git rm', { setup: committed(DJANGO) }),
      S(`git mv ${RAILS} db/migrate/20240102000000_create_users.rb`, 'git mv 로 이름 바꾸기', { setup: committed(RAILS) }),
      S(`mv ${FLYWAY} src/main/resources/db/migration/V1__first.sql`, 'mv 로 이름 바꾸기', { setup: committed(FLYWAY) }),
      B(`cp other.sql ${FLYWAY}`, 'cp 로 덮어쓰기', { setup: committed(FLYWAY) }),
      P('Remove-Item shop\\migrations\\0001_initial.py', 'PowerShell Remove-Item(\\ 경로)', { setup: committed(DJANGO) }),
      P(`Set-Content -Path ${FLYWAY} -Value 'x'`, 'PowerShell Set-Content', { setup: committed(FLYWAY) }),
      S(`cd shop && rm migrations/0001_initial.py`, 'cd 한 폴더 기준 경로', { setup: committed(DJANGO) }),
      // Claude 의 커밋이 HEAD 의 마이그레이션을 고치거나 지우기
      S('git commit -am "fix: 열 이름"', '커밋: commit -a 가 고친 마이그레이션을 넣음', { setup: both(committed(FLYWAY), (r) => r.put(FLYWAY, 'changed\n')) }),
      B(`git add ${RAILS} && git commit -m "fix: x"`, '커밋: 같은 명령의 git add 로 고친 것', { setup: both(committed(RAILS), (r) => r.put(RAILS, 'changed\n')) }),
      // 폴더·글롭(검토 2026-11-11): 폴더째 지우기와 마이그레이션 이름에 맞는 글롭은 막는다
      S('git rm -r shop/migrations', 'git rm -r 폴더', { setup: committed(DJANGO) }),
      B('rm src/main/resources/db/migration/V*', '글롭 V* 가 커밋한 V1 에 맞음', { setup: committed(FLYWAY) }),
      S('mv shop/migrations shop/old_migrations', 'mv 로 폴더째 옮기기', { setup: committed(DJANGO) }),
      // 폴더 안으로 복사·옮기기인데 이름이 커밋한 마이그레이션과 같음(덮어쓰기)
      S('cp tmp/V1__init.sql src/main/resources/db/migration/', '폴더 안으로 복사 — 같은 이름 덮어쓰기', { setup: committed(FLYWAY) }),
      S('git mv tmp/0001_initial.py shop/migrations/', 'git mv 폴더 안으로 — 같은 이름 덮어쓰기', { setup: committed(DJANGO) }),
      // 앞 명령에서 stage 하는 git add·git rm --cached 도(따로 커밋하면 그때는 보지 않으므로)
      S('git add -A', 'git add -A 가 고친 마이그레이션을 올림', { setup: both(committed(FLYWAY), (r) => r.put(FLYWAY, 'changed\n')) }),
      S('git add shop/migrations', 'git add 폴더가 지운 마이그레이션을 올림', { setup: both(committed(DJANGO), (r) => fs.rmSync(path.join(r.dir, DJANGO))) }),
      S(`git rm --cached ${DJANGO}`, 'git rm --cached 로 저장소에서 빼기', { setup: committed(DJANGO) }),
      // 검토 2026-11-11: 글롭으로 보낸 것이 폴더 안 같은 이름을 덮어씀, install, 마이그레이션 폴더를 품은 폴더 지우기
      B('cp -r tmp/* shop/migrations/', '글롭 복사가 커밋한 0001 을 덮어씀', { setup: both(committed(DJANGO), (r) => r.put('tmp/0001_initial.py', 'y\n')) }),
      B('install tmp/0001_initial.py shop/migrations/', 'install 로 폴더 안 같은 이름', { setup: committed(DJANGO) }),
      B('install -m 644 tmp/0001_initial.py shop/migrations/', 'install -m 값 뒤', { setup: committed(DJANGO) }),
      S('rm -rf shop', '마이그레이션 폴더를 품은 폴더 지우기', { setup: committed(DJANGO) }),
      S('git rm -r shop', 'git rm -r 품은 폴더', { setup: committed(DJANGO) }),
      P('Remove-Item -Recurse shop', 'PowerShell 품은 폴더', { setup: committed(DJANGO) }),
      S(`git checkout other -- ${DJANGO}`, '다른 브랜치의 내용으로 바꾸기', { setup: committed(DJANGO) }),
      S(`git restore --source=HEAD~1 ${DJANGO}`, 'restore --source 다른 커밋', { setup: committed(DJANGO) }),
    ],
    pass: [
      W('db/migrations/00002_add_refunds.sql', '-- +goose Up\n', 'goose: 새 마이그레이션', { setup: committed(GOOSE) }),
      E('db/queries/payments.sql', 'x', 'y', 'sqlc 질의 파일은 마이그레이션이 아님', { setup: committed('db/queries/payments.sql') }),
      W('src/main/resources/db/migration/V2__add_email.sql', 'ALTER TABLE users ADD email TEXT;\n', '새 Flyway 마이그레이션', { setup: committed(FLYWAY) }),
      E('src/main/resources/db/migration/R__views.sql', 'SELECT 1', 'SELECT 2', 'R__ 반복 마이그레이션은 바뀌라고 있는 것', { setup: committed('src/main/resources/db/migration/R__views.sql', 'CREATE VIEW v AS SELECT 1;\n') }),
      E('shop/migrations/__init__.py', 'x', 'y', 'Django __init__.py', { setup: committed('shop/migrations/__init__.py') }),
      E('shop/models.py', 'x', 'y', '마이그레이션 아닌 파일', { setup: committed('shop/models.py') }),
      E('shop/migrations/0002_add_email.py', 'x', 'y', '아직 커밋하지 않은 새 마이그레이션 고치기', { setup: both(committed(DJANGO), (r) => r.put('shop/migrations/0002_add_email.py', 'x\n')) }),
      W('alembic/versions/__init__.py', '\n', 'Alembic versions 의 __init__.py', { setup: committed(ALEMBIC) }),
      S(`cat ${FLYWAY}`, '읽기만', { setup: committed(FLYWAY) }),
      S(`cp ${FLYWAY} src/main/resources/db/migration/V2__copy.sql`, '커밋한 마이그레이션을 보내는 쪽으로만 쓰는 복사', { setup: committed(FLYWAY) }),
      S('rm -rf build', '다른 폴더 지우기', { setup: committed(FLYWAY) }),
      S(`git rm shop/migrations/0002_add_email.py`, '커밋 안 한 마이그레이션 git rm', { setup: both(committed(DJANGO), stage('shop/migrations/0002_add_email.py', 'x\n')) }),
      S('git commit -m "feat: 새 마이그레이션"', '커밋: 새 마이그레이션만 넣음', { setup: both(committed(DJANGO), stage('shop/migrations/0002_add_email.py', 'x\n')) }),
      S('git commit -am "fix: 모델"', '커밋: 마이그레이션 아닌 파일만 고침', { setup: both(committed(DJANGO), committed('shop/models.py'), (r) => r.put('shop/models.py', 'changed\n')) }),
      W('docs/migrations/0001_notes.md', 'x\n', '마이그레이션 폴더 이름이지만 .py 가 아님', { setup: committed('docs/migrations/0001_notes.md') }),
      // 폴더 안으로 복사·옮기기는 새 파일을 만든다(검토 2026-11-11 — 폴더를 「안의 마이그레이션 전부」로 보아 막던 것)
      S('cp tools/helper.py shop/migrations/', '폴더 안으로 복사(끝 /)', { setup: committed(DJANGO) }),
      S('cp tools/helper.py shop/migrations', '폴더 안으로 복사(끝 / 없음, 있는 폴더)', { setup: committed(DJANGO) }),
      S('git mv tools/helper.py shop/migrations/', 'git mv 폴더 안으로', { setup: committed(DJANGO) }),
      S('mv tools/0002_add_email.py shop/migrations/', 'mv 로 새 마이그레이션을 폴더 안으로', { setup: committed(DJANGO) }),
      S('cp new.sql src/main/resources/db/migration/', 'Flyway 폴더 안으로 복사', { setup: committed(FLYWAY) }),
      // 마이그레이션 이름에 맞을 수 없는 글롭
      B('rm shop/migrations/*.pyc', '글롭 *.pyc', { setup: committed(DJANGO) }),
      B('rm -f src/main/resources/db/migration/*.bak', '글롭 *.bak', { setup: committed(FLYWAY) }),
      P('Remove-Item shop\\migrations\\*.pyc', 'PowerShell 글롭 *.pyc', { setup: committed(DJANGO) }),
      S('rm shop/migrations', '-r 없는 rm 은 폴더를 지우지 않는다', { setup: committed(DJANGO) }),
      // 이미 stage 돼 있던 것(사용자가 손으로 올렸을 수 있음)은 Claude 의 다른 커밋을 막지 않는다(decisions.md)
      S('git commit -m "chore: 정리"', '사용자가 stage 해 둔 마이그레이션 지우기', { setup: both(committed(DJANGO), (r) => r.git('rm', '-q', '--cached', DJANGO)) }),
      S('git commit -m "fix: x"', '사용자가 stage 해 둔 마이그레이션 고침', { setup: both(committed(FLYWAY), stage(FLYWAY, 'changed\n')) }),
      B('git add shop/models.py && git commit -m "fix: 모델"', '다른 파일만 올리는 명령(고친 마이그레이션은 안 올림)', { setup: both(committed(DJANGO), committed('shop/models.py'), (r) => r.put(DJANGO, 'changed\n'), (r) => r.put('shop/models.py', 'changed\n')) }),
      // 되살리기(커밋한 내용으로 돌아감)·새 이름 복사·마이그레이션 없는 폴더 지우기·보기만
      S(`git checkout -- ${DJANGO}`, 'checkout -- 로 되살리기', { setup: both(committed(DJANGO), (r) => r.put(DJANGO, 'changed\n')) }),
      S(`git checkout HEAD -- ${DJANGO}`, 'checkout HEAD -- 로 되살리기', { setup: both(committed(DJANGO), (r) => r.put(DJANGO, 'changed\n')) }),
      S(`git restore ${DJANGO}`, 'restore 로 되살리기', { setup: both(committed(DJANGO), (r) => r.put(DJANGO, 'changed\n')) }),
      B('cp -r tmp/* shop/migrations/', '글롭 복사가 새 이름만 만듦', { setup: both(committed(DJANGO), (r) => r.put('tmp/0002_add_email.py', 'y\n')) }),
      B('install tmp/0002_add_email.py shop/migrations/', 'install 새 이름', { setup: committed(DJANGO) }),
      S('rm -rf shop/static', '마이그레이션 없는 폴더 지우기', { setup: both(committed(DJANGO), (r) => r.put('shop/static/a.css', 'x\n')) }),
      S(`git rm -n ${DJANGO}`, 'git rm -n(보기만)', { setup: committed(DJANGO) }),
    ],
  },
};
