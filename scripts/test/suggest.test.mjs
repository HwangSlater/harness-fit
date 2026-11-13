// 저장소 단서로 훅 옵션 미리 채우기(scripts/lib/suggest.mjs)와 JVM·Django 명령 읽기 — 역할극 7·8·9 회차(2026-11-11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggest } from '../lib/suggest.mjs';
import { detectCommands } from '../lib/commands.mjs';
import { loadAll, expandCombo, recommend } from '../lib/catalog.mjs';
import { tmpDir, writeFiles } from './helpers.mjs';

const repo = (files) => writeFiles(tmpDir('harness-suggest-'), files);

test('긴 학습·탐색 명령과 원격 배포 스크립트는 묻는 명령으로, 표본·빠른 꼴은 넣지 않는다', () => {
  const r = repo({
    'pyproject.toml': '[project]\nname = "c"\n[project.scripts]\nchurn-train = "c.train:main"\nchurn-eval = "c.evaluate:main"\nchurn-tune = "c.tune:main"\n',
    Makefile: 'train:\n\tchurn-train\ntrain-sample:\n\tchurn-train --data s.csv\ntune:\n\tchurn-tune\ntest:\n\tpytest\n',
    'deploy.sh': '#!/bin/sh\nssh deploy@app.example.com "cd app && git pull"\n',
    'scripts/build.sh': '#!/bin/sh\nnpm run build\n',
    'scripts/sync.sh': '#!/bin/sh\nrsync -av dist/ web@host:/srv/\n',
  });
  assert.deepEqual(suggest(r).ask, ['churn-train', 'churn-tune', 'make train', 'make tune', './deploy.sh', './scripts/sync.sh']);
  assert.deepEqual(suggest(r).why['churn-train'], { k: 'long', at: 'pyproject.toml' });
  assert.deepEqual(suggest(r).why['./scripts/sync.sh'], { k: 'remote', at: 'scripts/sync.sh' });
  // 독립 검토 2026-11-12: 이름이 겹치는 로컬 스크립트(predeploy.sh)를 부르는 대상은 원격 스크립트를 부른다고 보지 않는다
  const near = repo({
    'deploy.sh': '#!/bin/sh\nssh deploy@app.example.com "cd app && git pull"\n',
    'predeploy.sh': '#!/bin/sh\nnpm run build\n',
    Makefile: 'build:\n\t./predeploy.sh\nship:\n\tbash ./deploy.sh\n',
  });
  assert.deepEqual(suggest(near).ask, ['./deploy.sh', 'make ship']);
  assert.deepEqual(suggest(near).why['make ship'], { k: 'make-script', at: 'Makefile', ref: './deploy.sh' });
  // 검토 2026-11-11: 로컬 빌드만 하는 deploy.sh, 안내 글(echo·주석)의 ssh, build:tune·pre 스크립트는 아님
  const quiet = repo({
    'deploy.sh': '#!/bin/sh\nnpm run build\n',
    'ssh_tunnel.sh': '#!/bin/sh\n# ssh 로 접속하세요\necho "use ssh to connect"\n',
    'package.json': JSON.stringify({ scripts: { pretrain: 'x', 'build:tune': 'x', 'storybook:tune': 'x', 'train:full': 'python t.py' } }),
  });
  assert.deepEqual(suggest(quiet).ask, ['npm run train:full']);
});

test('역할극 10·11·12 회차: 주석이 민감하다고 한 묶음, *.env, dbt profiles.yml, 확장자 글롭, 운영 옵션 명령, Makefile 의 원격·운영 대상', () => {
  const r = repo({
    '.gitignore': '.env\n\n# 실제 로그는 저장소에 올리지 않는다(고객 개인정보, IP)\nreal-logs/\n*.evtx\n*.pcap\nlogs/\n\n# lab server (host, user, key path) — never commit\nscripts/lab.env\n\n# dbt\ntarget/\nprofiles.yml\n\n# build\nout/\n',
    'dbt_project.yml': 'name: x\n',
    Makefile: 'deploy-dev:\n\tdetctl deploy rules/ --env dev\ndeploy-prod:\n\tdetctl deploy rules/ --env prod --change $(CHANGE)\nbackfill:\n\t./scripts/backfill.sh $(START)\nbackfill-dry:\n\tDRY_RUN=1 ./scripts/backfill.sh $(START)\n',
    'scripts/backfill.sh': '#!/bin/sh\nssh hadoop@emr-master "spark-submit job.py"\nuv run dbt build --target prod --select fct+\n',
  });
  const s = suggest(r);
  assert.deepEqual(s.protect, ['real-logs/', '.evtx', '.pcap', 'scripts/lab.env', 'profiles.yml'], '.env 는 늘 막는 것이라 빼고, logs/·target/·out/ 은 결과물');
  // dbt 운영 명령이 하나라도 있으면 같은 대상의 run·seed 도(역할극 10 회차 다시, 2026-11-13). 한도 10 이라 build -t 도 남는다(검토 2026-11-13)
  assert.deepEqual(s.ask, ['./scripts/backfill.sh', 'make deploy-prod', 'detctl deploy --env prod', 'make backfill', 'dbt build --target prod', 'dbt run --target prod', 'dbt seed --target prod', 'dbt run -t prod', 'dbt build -t prod']);
  assert.deepEqual(s.why['dbt run --target prod'], { k: 'dbt-prod', at: 'scripts/backfill.sh' });
});

test('검토 2026-11-11: 주석 낱말·보기만 하는 운영 옵션·문서 폴더는 단서가 아니다', () => {
  const r = repo({
    '.gitignore': '# HuggingFace tokenizer cache\n.cache/huggingface/\nmodels/\n\n# Personal IDE settings\n.idea/\n.vscode/\n\n# IP 주소 목록 생성 결과\ngenerated/\n',
    Makefile: 'build:\n\tnpx webpack --env production\nls:\n\taws s3 ls --profile prod\ndocs:\n\tuv run dbt docs generate --target prod\n',
  });
  assert.deepEqual(suggest(r), { ask: [], protect: [], why: {} });
});

test('--fresh 로 새로 추천해도 지난번에 적어 둔 목록 옵션은 남기고, 브랜치 방식이 정하는 칸은 새 값', async () => {
  const { keepListOptions } = await import('../recommend.mjs');
  const all = loadAll();
  const sel = { hookOpts: { 'ask-cmd': { commands: ['make train'] }, 'protect-branch': { branches: ['main'] } } };
  keepListOptions(sel, { rules: { 'ask-cmd': { commands: ['python long.py'], remote: false }, 'protect-branch': { branches: ['main', 'develop'] }, secrets: true } }, all);
  assert.deepEqual(sel.hookOpts['ask-cmd'].commands, ['python long.py', 'make train']);
  assert.deepEqual(sel.hookOpts['protect-branch'].branches, ['main']);
});

test('.gitignore 의 원본 데이터 폴더·비밀 설정 파일·키 폴더만 보호 경로로', () => {
  const r = repo({ '.gitignore': '# 데이터\ndata/raw/\ndata/processed/\nmodels/\n.env\napplication-secret.yml\nsrc/main/resources/keys/\n*.log\n!keep.txt\n' });
  assert.deepEqual(suggest(r).protect, ['data/raw/', 'application-secret.yml', 'src/main/resources/keys/']);
  assert.deepEqual(suggest(repo({ 'README.md': '# x\n' })), { ask: [], protect: [], why: {} });
});

test('조합에 저장소 단서를 넣고 이유 줄을 단다', () => {
  const all = loadAll();
  const det = { stack: ['Python'], kinds: ['data'], authors: 1, commits: 10, team: false, existing: {}, history: {}, suggest: { ask: ['churn-train'], protect: ['data/raw/'] } };
  const sel = expandCombo(all, 'solo', det);
  assert.ok(sel.hooks.includes('ask-cmd') && sel.hooks.includes('protected-files'));
  assert.deepEqual(sel.hookOpts['ask-cmd'].commands, ['churn-train']);
  assert.deepEqual(sel.hookOpts['protected-files'].paths, ['data/raw/']);
  const why = recommend(all, det, 'ko').why.join('\n');
  assert.match(why, /저장소에서 찾은 오래 걸리거나 원격에 닿는 명령 → .*churn-train/);
  assert.match(why, /\.gitignore 의 원본 데이터·비밀 파일 → .*data\/raw\//);
});

test('독립 검토 2026-11-13: iOS 면 출시·서명·버전 명령을 기본으로 묻고, 값마다 까닭(optWhy)을 단다', () => {
  const all = loadAll();
  const det = { stack: ['iOS'], kinds: ['mobile'], authors: 1, commits: 10, team: false, existing: {}, history: {}, suggest: { ask: ['fastlane beta'], protect: [] } };
  const sel = expandCombo(all, 'solo', det);
  const asks = sel.hookOpts['ask-cmd'].commands;
  for (const v of ['xcrun altool --upload-app', 'xcrun notarytool submit', 'agvtool new-marketing-version', 'agvtool new-version', 'fastlane cert', 'security delete-certificate', 'security delete-identity', 'fastlane beta']) assert.ok(asks.includes(v), v);
  const a = sel.addons.find((x) => x.stacks.includes('iOS') && x.hookOpts?.['ask-cmd']);
  assert.ok(a.optWhy.ko && a.optWhy.en, '화면이 값마다 보일 까닭');
  assert.ok(sel.addons.find((x) => x.stacks.includes('ROS 2')) === undefined, 'iOS 저장소에 ROS 기본값 없음');
  assert.match(recommend(all, det, 'ko').why.join('\n'), /iOS → .*xcrun altool --upload-app/);
  // iOS 가 아니면 넣지 않는다
  assert.equal(expandCombo(all, 'solo', { ...det, stack: ['React'], suggest: {} }).hookOpts['ask-cmd'], undefined);
});

test('역할극 3 회차: README 의 학습 입구 스크립트, 맨 위 /data/·데이터 확장자·체크포인트 폴더', () => {
  const r = repo({
    'README.md': '학습: `python scripts/train.py dataset.path=data/demos.hdf5`\n평가: `python scripts/eval.py`\n미세 조정: python -m scripts.finetune_bc\n',
    'scripts/train.py': '', 'scripts/eval.py': '', 'scripts/finetune_bc.py': '',
    '.gitignore': 'outputs/\ncheckpoints/\n*.ckpt\n*.pt\n\n# 시연 데이터\n/data/\n*.hdf5\n*.h5\n*.parquet\n*.npz\n',
  });
  const s = suggest(r);
  assert.deepEqual(s.ask, ['python scripts/train.py', 'python scripts/finetune_bc.py']);
  assert.deepEqual(s.why['python scripts/train.py'], { k: 'long', at: 'README.md' });
  assert.deepEqual(s.protect, ['checkpoints/', '.ckpt', 'data/', '.hdf5', '.h5', '.parquet', '.npz']);
  assert.deepEqual(s.why['.hdf5'], { k: 'data', at: '.gitignore' });
  assert.deepEqual(s.why['data/'], { k: 'raw', at: '.gitignore' });
  // 아님: 없는 파일, 학습 실행이 아닌 모듈(trainer·train_utils), 빠른 꼴, 앞 / 없는 data/(하위 소스 폴더일 수 있다), 하위 체크포인트 폴더·예시 데이터
  const no = repo({
    'README.md': 'python scripts/train_all.py\npython scripts/trainer.py\npython scripts/train_utils.py\npython scripts/train_quick.py\n',
    'scripts/trainer.py': '', 'scripts/train_utils.py': '', 'scripts/train_quick.py': '',
    '.gitignore': 'data/\nmodels/checkpoints/\n*.h5.tmp\nsample.example.parquet\n',
  });
  assert.deepEqual(suggest(no), { ask: [], protect: [], why: {} });
  // 역할극 11 회차: 서버·시험이 만드는 /data/ 는 원본 데이터가 아니다
  assert.deepEqual(suggest(repo({ '.gitignore': '# local data dirs created by kv-server / tests\n/data/\n*.wal\n' })).protect, []);
});

test('역할극 10 회차: dbt 운영 대상의 run·build·seed, 증분 모델의 --full-refresh', () => {
  const profiles = 'p:\n  target: local\n  outputs:\n    local:\n      type: postgres\n    prod:\n      type: redshift\n';
  const r = repo({
    'dbt_project.yml': 'name: x\n', 'profiles.yml.example': profiles,
    'models/marts/fct.sql': "{{ config(materialized='incremental') }}\nselect 1\n",
  });
  const s = suggest(r);
  assert.deepEqual(s.ask, ['dbt run --target prod', 'dbt build --target prod', 'dbt seed --target prod', 'dbt run -t prod', 'dbt build -t prod', 'dbt --full-refresh']);
  assert.deepEqual(s.why['dbt seed --target prod'], { k: 'dbt-prod', at: 'profiles.yml.example' });
  assert.deepEqual(s.why['dbt --full-refresh'], { k: 'dbt-refresh', at: 'models/marts/fct.sql' });
  // 아님: 운영 출력이 없는 프로필·table 모델만, dbt 프로젝트가 아닌 저장소의 profiles 예시
  const no = repo({ 'dbt_project.yml': 'name: x\n', 'profiles.yml.example': 'p:\n  outputs:\n    local:\n      type: postgres\n    ci:\n      type: postgres\n', 'models/a.sql': "{{ config(materialized='table') }}\n" });
  assert.deepEqual(suggest(no).ask, []);
  assert.deepEqual(suggest(repo({ 'profiles.yml.example': profiles })).ask, []);
});

test('역할극 16 회차: fastlane 출시 레인·match, xcrun 올리기, Makefile 설명의 「리드만」', () => {
  const r = repo({
    'fastlane/Fastfile': 'platform :ios do\n  private_lane :asc_key do\n  end\n  lane :test do\n  end\n  lane :certs do\n  end\n  lane :beta do\n  end\n  lane :release do\n  end\n  lane :release_notes do\n  end\nend\n',
    'fastlane/Matchfile': 'git_url("x")\nreadonly(true)\n',
    Makefile: 'certs: ## 인증서 받기(match, 읽기 전용)\n\tbundle exec fastlane certs\nbeta: ## TestFlight 내부 배포 — 리드만\n\tbundle exec fastlane beta\nbuild: ## 운영체제별 빌드\n\txcodebuild build\nnotarize: ## 공증 올리기\n\txcrun notarytool submit app.zip --wait\n',
    'scripts/bootstrap.sh': '#!/bin/sh\nbundle exec fastlane match development --readonly\n',
    'scripts/upload.sh': '#!/bin/sh\nxcrun altool --upload-app -f app.ipa -t ios\n',
    'scripts/history.sh': '#!/bin/sh\nxcrun notarytool history\nxcrun altool --validate-app -f app.ipa\n',
  });
  const s = suggest(r);
  assert.deepEqual(s.ask, ['./scripts/upload.sh', 'make beta', 'make notarize', 'fastlane beta', 'fastlane release', 'fastlane match']);
  assert.deepEqual(s.why['make beta'], { k: 'remote', at: 'Makefile' });
  assert.deepEqual(s.why['fastlane beta'], { k: 'fastlane', at: 'fastlane/Fastfile' });
  assert.deepEqual(s.why['fastlane match'], { k: 'fastlane-match', at: 'fastlane/Matchfile' });
  // 설명만으로: 레시피가 원격에 닿지 않아도 「리드만」 이면 묻는다. 「prod」·「운영체제」·dry 대상은 아님(독립 검토 2026-11-13)
  const notes = repo({ Makefile: 'release: ## 심사 제출 — 리드만\n\t./scripts/release.sh $(V)\nseed-prod: ## prod DB 씨앗 넣기\n\tpython seed.py\nseed-dry: ## prod 시험 실행\n\tpython seed.py --dry\nos: ## 운영체제 확인\n\tuname -a\n' });
  assert.deepEqual(suggest(notes).ask, ['make release']);
  assert.deepEqual(suggest(notes).why['make release'], { k: 'make-note', at: 'Makefile', ref: '리드만' });
  // Fastfile 이 없으면 레인을 짓지 않는다
  assert.deepEqual(suggest(repo({ 'fastlane/Matchfile': 'x\n' })).ask, []);
});

test('Gradle·Maven 은 래퍼가 있으면 래퍼로, Django 는 manage.py 명령과 Procfile', () => {
  assert.deepEqual(detectCommands(repo({ 'build.gradle.kts': 'plugins {}\n', gradlew: '#!/bin/sh\n' })).commands, { test: ['./gradlew test'], testOne: ['./gradlew test --tests <name>'], build: ['./gradlew build'] });
  assert.deepEqual(detectCommands(repo({ 'pom.xml': '<project/>\n' })).commands.test, ['mvn test']);
  assert.deepEqual(detectCommands(repo({ 'settings.gradle.kts': 'include("app")\n', 'app/build.gradle.kts': 'plugins {}\n' })).commands.test, ['gradle test'], '멀티 프로젝트');
  const dj = detectCommands(repo({ 'manage.py': '', 'requirements.txt': 'django==5\n', Procfile: 'release: python manage.py migrate --noinput\nweb: gunicorn app.wsgi\nworker: celery -A app worker\n' })).commands;
  assert.deepEqual(dj.test, ['python manage.py test'], 'pytest 가 없으면 manage.py test');
  assert.deepEqual(dj.tools, ['python manage.py makemigrations', 'python manage.py migrate', 'python manage.py runserver', 'gunicorn app.wsgi', 'celery -A app worker']);
  assert.deepEqual(detectCommands(repo({ 'manage.py': '', 'requirements.txt': 'django==5\npytest-django\n', 'conftest.py': '' })).commands.test, ['pytest'], 'pytest 가 있으면 manage.py test 는 빼기');
});

test('역할극 15 회차: 인프라 비밀 파일 글롭, make 변수 값으로 명령 알아보기', () => {
  const r = repo({
    '.gitignore': '.terraform/\n*.tfstate\n*.tfstate.*\n*.tfplan\ncrash.log\n*.tfvars\n!*.tfvars.example\nkubeconfig*\n.kube/\nansible/.vault_pass*\n*.retry\n',
    Makefile: 'TF ?= terraform\n\nplan-prod:\n\tcd envs/prod && $(TF) plan -out=prod.tfplan\napply-prod:\n\tcd envs/prod && $(TF) apply prod.tfplan\nfmt:\n\t$(TF) fmt -recursive\n',
  });
  const s = suggest(r);
  assert.deepEqual(s.protect, ['.tfstate', '*.tfstate.*', '.tfplan', 'kubeconfig*', '.kube/', 'ansible/.vault_pass*'], '.tfvars 는 비밀 파일 꼴이 아니고 .terraform/·crash.log·*.retry 는 결과물');
  assert.deepEqual(s.ask, ['make apply-prod']);
  // 검토 2026-11-12: 맨 위 기준(/이름)은 / 를 남기고, make 변수는 뒤 정의가 이기며 export 앞말도 읽는다
  const r2 = repo({
    '.gitignore': '/kubeconfig*\n/secrets.yml\n/secrets/\n',
    Makefile: 'TF := echo\nexport TF := terraform\nTF ?= tofu\napply:\n\t$(TF) apply\n',
  });
  const s2 = suggest(r2);
  assert.deepEqual(s2.protect, ['/kubeconfig*', '/secrets.yml', 'secrets/']);
  assert.deepEqual(s2.ask, ['make apply']);
  // 화면 평가 2026-11-12: 마이그레이션 되돌리기는 묻고, 쓸 명령에는 넣지 않는다(make down 은 docker compose down 이라 둔다)
  const r3 = repo({ Makefile: 'down:\n\tdocker compose down\nmigrate-up:\n\tgoose up\nmigrate-down:\n\tgoose down\n' });
  assert.deepEqual(suggest(r3).ask, ['make migrate-down']);
  // 옵션 칸 2안(2026-11-12): 값마다 찾은 까닭과 파일
  assert.deepEqual(s.why['make apply-prod'], { k: 'remote', at: 'Makefile' });
  assert.deepEqual(s.why['kubeconfig*'], { k: 'infra', at: '.gitignore' });
  assert.deepEqual(suggest(r3).why['make migrate-down'], { k: 'migrate-down', at: 'Makefile' });
  assert.deepEqual(detectCommands(r3).commands.tools, ['make down', 'make migrate-up']);
});

test('독립 검토 2026-11-13: Makefile 설명은 리드·관리자만 쓰는 대상만, 운영·prod 낱말은 아님', () => {
  const no = repo({ Makefile: 'build: ## Build production bundle\n\tvite build\nenv: ## prod-like env\n\tdocker compose up\nops: ## 운영 서버 상태 보기\n\tcurl -s localhost/health\n' });
  assert.deepEqual(suggest(no).ask, []);
  const yes = repo({ Makefile: 'ship: ## lead only\n\t./x.sh\nrotate: ## admin only\n\t./y.sh\ncut: ## maintainers only\n\t./z.sh\nkeys: ## 관리자만\n\t./k.sh\n' });
  assert.deepEqual(suggest(yes).ask, ['make ship', 'make rotate', 'make cut', 'make keys']);
});

test('독립 검토 2026-11-13: 디버그 기호 올리기 레인은 출시가 아니다', () => {
  const r = repo({ 'fastlane/Fastfile': 'platform :ios do\n  lane :upload_symbols do\n  end\n  lane :upload_dsyms do\n  end\n  lane :upload_symbols_to_crashlytics do\n  end\n  lane :upload_testflight do\n  end\n  lane :upload do\n  end\nend\n' });
  assert.deepEqual(suggest(r).ask, ['fastlane upload_testflight', 'fastlane upload']);
});

test('독립 검토 2026-11-13: dbt 운영 대상은 outputs: 바로 아래만, 스크립트의 -t prod 도', () => {
  // outputs: 밖(vars:)·한 칸 더 아래의 prod: 는 운영 출력이 아니다
  const vars = 'p:\n  target: dev\n  outputs:\n    dev:\n      type: postgres\n      prod:\n        x: 1\n  vars:\n    prod:\n      schema: x\n';
  assert.deepEqual(suggest(repo({ 'dbt_project.yml': 'name: x\n', 'profiles.yml.example': vars })).ask, []);
  // 주석·빈 줄이 끼어도 outputs: 바로 아래 칸이면 맞다
  const ok = 'p:\n  outputs:\n    # 개발\n    dev:\n      type: postgres\n\n    production:\n      type: snowflake\n';
  assert.ok(suggest(repo({ 'dbt_project.yml': 'name: x\n', 'profiles.yml.example': ok })).ask.includes('dbt run --target production'));
  // 스크립트의 짧은 꼴 -t prod → 운영 대상(긴 꼴과 짧은 꼴 둘 다 묻는다)
  const s = suggest(repo({ 'dbt_project.yml': 'name: x\n', 'scripts/nightly.sh': '#!/bin/sh\nuv run dbt run -t prod\n' }));
  for (const v of ['dbt run -t prod', 'dbt run --target prod', 'dbt build -t prod', 'dbt seed --target prod']) assert.ok(s.ask.includes(v), `${v}: ${s.ask}`);
  // 다른 도구의 -t prod(docker 이름표)는 운영 명령이 아니다
  assert.deepEqual(suggest(repo({ 'scripts/img.sh': '#!/bin/sh\ndocker build -t prod .\n' })).ask, []);
});

// 검토 2026-11-13: 출시 레인 판정이 「이 저장소 명령」(commands.mjs)과 묻는 명령(suggest.mjs)에서 갈라져, make ship 이 평소 명령에서는 빠지고 묻는 명령에도 없었다.
// 이제 둘 다 scripts/lib/fastlane.mjs 하나(레인 이름·본문·부르는 레인, fastlane 뒤 ios·android·mac 건너뛰기)를 쓴다
const SHIP_FASTFILE = 'platform :ios do\n  private_lane :asc_key do\n    upload_to_testflight\n  end\n  lane :test do\n    run_tests\n  end\n  lane :certs do\n    match(type: "appstore", readonly: true)\n  end\n'
  + '  lane :ship do\n    build_app(scheme: "App")\n    upload_to_testflight(skip_waiting_for_build_processing: true)\n  end\n  lane :upload_testflight do\n    upload_to_testflight\n  end\n'
  + '  lane :nightly do\n    ship\n  end\nend\n';
test('검토 2026-11-13: 이름이 평범한 출시 레인(ship)·플랫폼 낱말 — make 대상·스크립트·레인 모두 묻고 평소 명령에서는 뺀다', () => {
  const r = repo({
    'fastlane/Fastfile': SHIP_FASTFILE,
    Makefile: 'ship:\n\tbundle exec fastlane ship\ncerts:\n\tbundle exec fastlane certs\nunit:\n\tbundle exec fastlane ios test\n',
    'scripts/tf.sh': '#!/bin/sh\nset -e\nbundle exec fastlane ios upload_testflight\n',
    'scripts/ship.sh': '#!/bin/sh\nfastlane ship\n',
    'scripts/certs.sh': '#!/bin/sh\nbundle exec fastlane ios certs\nfastlane match development --readonly\n',
    'scripts/note.sh': '#!/bin/sh\necho "fastlane ship 은 리드가 돌린다"\n# fastlane ship\n',
  });
  const s = suggest(r);
  assert.deepEqual(s.ask, ['./scripts/ship.sh', './scripts/tf.sh', 'make ship', 'fastlane ship', 'fastlane upload_testflight', 'fastlane nightly']);
  assert.deepEqual(s.why['make ship'], { k: 'remote', at: 'Makefile' });
  assert.deepEqual(s.why['./scripts/tf.sh'], { k: 'remote', at: 'scripts/tf.sh' });
  assert.deepEqual(s.why['fastlane ship'], { k: 'fastlane', at: 'fastlane/Fastfile' });
  // 같은 판정: 묻는 make 대상은 「이 저장소 명령」에 없고, 시험·읽기 전용 받기 대상은 남는다
  const tools = detectCommands(r).commands.tools || [];
  assert.ok(!tools.includes('make ship') && tools.includes('make certs') && tools.includes('make unit'), `tools: ${tools}`);
});

test('검토 2026-11-13: Fastfile 이 없으면 fastlane 은 이름으로만, 평범한 레인 이름은 배포가 아니다', () => {
  const r = repo({ 'scripts/ship.sh': '#!/bin/sh\nfastlane ship\n', 'scripts/b.sh': '#!/bin/sh\nbundle exec fastlane android deploy\n', Makefile: 'ship:\n\tfastlane ship\n' });
  assert.deepEqual(suggest(r).ask, ['./scripts/b.sh']);
});

test('검토 2026-11-13: 묻는 명령이 한도를 넘으면 까닭마다 하나씩 먼저 남긴다', () => {
  const scripts = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`scripts/d${String(i).padStart(2, '0')}.sh`, '#!/bin/sh\nssh deploy@host true\n']));
  const s = suggest(repo({ ...scripts, 'fastlane/Fastfile': 'lane :beta do\nend\n', 'fastlane/Matchfile': 'x\n' }));
  assert.equal(s.ask.length, 10);
  assert.ok(s.ask.includes('fastlane beta') && s.ask.includes('fastlane match'), `${s.ask}`);
  assert.deepEqual(s.ask.slice(0, 2), ['./scripts/d00.sh', './scripts/d01.sh'], '차례는 그대로');
});
