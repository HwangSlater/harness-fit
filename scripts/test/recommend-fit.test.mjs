// 추천이 저장소에 맞는지(전체 검토 2026-11-13): 「이 저장소 명령」에 묻는 명령·배포 대상을 평소 명령으로 적지 않기, 한도를 넘으면 시험·검사부터,
// Rust 는 CI 의 옵션 그대로 · 앱 코드 없는 저장소·iOS 앱에 로그인 검사 줄을 넣지 않기 · 화면 파일 없는 TS 저장소에 unsafe-html 을 켜지 않기.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detectCommands } from '../lib/commands.mjs';
import { ruleTexts, renderRule } from '../lib/claude-md.mjs';
import { loadAll, fitOff } from '../lib/catalog.mjs';
import { detect } from '../detect.mjs';
import { tmpDir, writeFiles, gitInit } from './helpers.mjs';

const all = loadAll();
const dirs = [];
const repo = (files, git = false) => {
  const dir = tmpDir('harness-fit-');
  dirs.push(dir);
  if (git) gitInit(dir);
  return writeFiles(dir, files);
};
const cmds = (files) => detectCommands(repo(files)).commands;
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

test('Makefile: 배포·서명 레시피(fastlane beta)는 평소 명령이 아니고, 읽기만 하는 plan-prod·시험 실행 backfill-dry 는 쓸 명령', () => {
  const mk = [
    'test:', '\t./scripts/test.sh unit', 'ui-test:', '\t./scripts/test.sh ui',
    'beta:', '\tbundle exec fastlane beta', 'fl-test:', '\tbundle exec fastlane ios test',
    'plan-prod:', '\tterraform plan -out=prod.tfplan', 'apply-prod:', '\tterraform apply prod.tfplan', 'apply-plan:', '\tterraform apply x.tfplan',
    'backfill:', '\t./scripts/backfill.sh', 'backfill-dry:', '\tDRY_RUN=1 ./scripts/backfill.sh', 'test-deploy:', '\t./deploy.sh test', '',
  ].join('\n');
  const tools = cmds({ Makefile: mk }).tools;
  assert.deepEqual(tools, ['make ui-test', 'make fl-test', 'make plan-prod', 'make backfill-dry'], JSON.stringify(tools));
  // 이름이 certs 여도 로컬 인증서를 만드는 레시피는 남는다(fastlane 이 아니다)
  assert.deepEqual(cmds({ Makefile: 'certs:\n\tmkcert localhost\n' }).tools, ['make certs']);
});

// 검토 2026-11-13: 처음엔 fastlane 레인을 낱말 몇 개(test·build…)만 남겨 unit_tests·setup_tools·gym·match --readonly 가 다 빠졌다
test('Makefile 의 fastlane: 시험·빌드·준비 레인과 match --readonly 는 남고, 출시 레인·올리기 동작·readonly 없는 match 만 빠진다', () => {
  const rows = [
    ['unit', 'bundle exec fastlane unit_tests'], ['tools', 'fastlane setup_tools'], ['ipa', 'fastlane gym --scheme App'],
    ['profiles', 'bundle exec fastlane match development --readonly'], ['notes', 'fastlane release_notes'], ['shots', 'fastlane snapshot'],
    ['beta-ios', 'fastlane ios beta'], ['store', 'fastlane upload_to_app_store'], ['tf', 'fastlane pilot upload'], ['run-tf', 'fastlane run upload_to_testflight'],
    ['sign', 'fastlane match appstore'], ['nuke', 'fastlane match nuke development --readonly'], ['new-cert', 'fastlane cert'], ['newapp', 'fastlane produce -u x'],
  ];
  const tools = cmds({ Makefile: rows.map(([t, r]) => `${t}:\n\t${r}\n`).join('') }).tools;
  assert.deepEqual(tools, ['make unit', 'make tools', 'make ipa', 'make profiles', 'make notes', 'make shots'], JSON.stringify(tools));
});

test('Makefile 의 fastlane 레인은 Fastfile 본문으로도 본다: 읽기 전용 match 만 하는 certs 는 남고, 이름이 평범해도 올리는 레인은 빠진다', () => {
  const fastfile = [
    'platform :ios do', '  desc "TestFlight 로 올리기 전에 돌리는 테스트"', '  lane :test do', '    run_tests(scheme: "App")', '  end',
    '  lane :certs do', '    match(type: "development", readonly: true)', '    match(', '      type: "appstore",', '      readonly: true', '    )', '  end',
    '  lane :signing do', '    match(type: "appstore") # 새로 만든다', '  end',
    '  lane :nightly do', '    build_app(scheme: "App")', '    upload_to_testflight(skip_waiting_for_build_processing: true)', '  end',
    '  lane :bump do', '    increment_build_number', '  end', 'end', '',
  ].join('\n');
  const mk = ['test', 'certs', 'signing', 'nightly', 'bump'].map((l) => `fl-${l}:\n\tbundle exec fastlane ${l}\n`).join('');
  assert.deepEqual(cmds({ Makefile: mk, 'fastlane/Fastfile': fastfile }).tools, ['make fl-test', 'make fl-certs', 'make fl-bump']);
  // Fastfile 이 없으면 이름으로만 본다(평범한 이름은 남긴다)
  assert.deepEqual(cmds({ Makefile: mk }).tools, ['make fl-test', 'make fl-certs', 'make fl-signing', 'make fl-nightly', 'make fl-bump']);
});

test('그 밖의 명령이 한도(10)를 넘으면 시험·검사·빌드·dry 를 먼저 남기고 down·serve·*-local 을 뺀다, 서버 띄우기 하나는 남긴다, 한도 안이면 순서 그대로', () => {
  const names = ['up', 'down', 'serve', 'consume-local', 'topics', 'test-spark', 'dbt-deps', 'dbt-build', 'dbt-test', 'dbt-compile', 'job-dry', 'package', 'docs', 'clean-cache'];
  const tools = cmds({ Makefile: names.map((n) => `${n}:\n\techo ${n}\n`).join('') }).tools;
  assert.equal(tools.length, 10);
  for (const n of ['test-spark', 'dbt-build', 'dbt-test', 'dbt-compile', 'job-dry', 'up']) assert.ok(tools.includes(`make ${n}`), `${n}: ${tools}`);
  for (const n of ['down', 'serve', 'consume-local']) assert.ok(!tools.includes(`make ${n}`), `${n} 는 먼저 빠진다: ${tools}`);
  assert.deepEqual(tools, [...tools].sort((a, b) => names.indexOf(a.slice(5)) - names.indexOf(b.slice(5))), '남긴 것은 원래 순서');
  // 한도 안: 개발 고리 명령도 그대로, 순서도 그대로
  assert.deepEqual(cmds({ Makefile: 'up:\n\tx\ndown:\n\tx\ndbt-build:\n\tx\n' }).tools, ['make up', 'make down', 'make dbt-build']);
});

// 검토 2026-11-13: 개발 고리 낱말을 아무 마디에서나 보아 make migrate-up 이 빠지고 make up·down·run 은 남았다(14 회차)
test('개발 고리 낱말은 이름 전체나 끝 마디일 때만, 마이그레이션·시드는 개발 고리가 아니다', () => {
  const names = ['up', 'down', 'run', 'sqlc', 'sqlc-diff', 'migrate-up', 'db-up', 'seed-run', 'migrate-status', 'migrate-new', 'run-report', 'local-sync', 'logs'];
  const tools = cmds({ Makefile: names.map((n) => `${n}:\n\techo ${n}\n`).join('') }).tools;
  for (const n of ['migrate-up', 'db-up', 'seed-run', 'migrate-status', 'migrate-new', 'run-report', 'local-sync', 'up']) assert.ok(tools.includes(`make ${n}`), `${n}: ${tools}`);
  // 개발 고리는 서버 띄우기 하나(up)만 보통 차례, 나머지(down·run·logs)가 먼저 빠진다
  for (const n of ['down', 'run', 'logs']) assert.ok(!tools.includes(`make ${n}`), `${n}: ${tools}`);
});

test('Cargo: CI 의 --workspace·clippy -D warnings 를 따르고, CI 가 없으면 예전 그대로', () => {
  const ws = '[workspace]\nmembers = ["crates/a", "crates/b"]\n';
  const ci = 'jobs:\n  fmt:\n    steps:\n      - run: cargo fmt --all -- --check\n  clippy:\n    steps:\n      - run: cargo clippy --workspace --all-targets -- -D warnings\n  test:\n    steps:\n      - run: cargo test --workspace\n        env:\n          X: "1"\n  miri:\n    steps:\n      - run: cargo miri test -p a\n';
  assert.deepEqual(cmds({ 'Cargo.toml': ws, '.github/workflows/ci.yml': ci }), {
    test: ['cargo test --workspace'], testOne: ['cargo test --workspace <name>'], build: ['cargo build --workspace'],
    lint: ['cargo clippy --workspace --all-targets -- -D warnings'], format: ['cargo fmt --all'],
  });
  // CI 가 없으면 지어내지 않는다(설정 파일이 없으면 clippy·fmt 도 없음)
  assert.deepEqual(cmds({ 'Cargo.toml': ws }), { test: ['cargo test'], testOne: ['cargo test <name>'], build: ['cargo build'] });
  // 한 패키지만 도는 CI(-p)·출력 옵션은 따르지 않는다. 워크스페이스가 아니면 다른 줄의 --workspace 를 퍼뜨리지 않는다
  const one = cmds({ 'Cargo.toml': '[package]\nname = "a"\n', '.gitlab-ci.yml': 'test:\n  script:\n    - cargo test -p a --release -q\n    - cargo clippy --workspace\n' });
  assert.deepEqual([one.test, one.build, one.lint], [['cargo test'], ['cargo build'], ['cargo clippy --workspace']]);
});

test('묻는 명령(ask-cmd)에 든 것은 「이 저장소 명령」에 적지 않는다 — 비슷한 이름(backfill-dry)은 남고, ask-cmd 를 끄면 다시 적는다', () => {
  const commands = { test: ['make test'], tools: ['make backfill', 'make backfill-dry', 'pnpm run train', 'make up'] };
  const sel = (hooks, ask) => ({ lang: 'ko', flow: 'none', rules: ['commands'], hooks, skills: [], commands, hookOpts: { 'ask-cmd': { commands: ask } } });
  const text = ruleTexts(sel(['ask-cmd'], ['make backfill', 'pnpm train'])).commands;
  assert.match(text, /`make backfill-dry` · `make up`/);
  assert.doesNotMatch(text.split('\n').find((l) => l.startsWith('- 그 밖의 명령')), /`make backfill`|pnpm run train/);
  assert.match(text, /사람이 직접 실행하는 명령: `make backfill` · `pnpm train`/, '묻는 명령은 사람이 실행하는 줄에');
  assert.match(ruleTexts(sel([], ['make backfill'])).commands, /`make backfill` · `make backfill-dry`/, 'ask-cmd 가 꺼져 있으면 묻지 않으니 그대로');
  // 그 종류가 다 빠지면 줄째 빠진다(빈 자리 없이)
  assert.doesNotMatch(ruleTexts(sel(['ask-cmd'], ['make test'])).commands, /테스트:/);
});

const LOGIN = /로그인이 필요한 곳/;
const security = (kinds) => renderRule('security', 'ko', [], [], [], {}, kinds);
test('로그인 검사 줄: 앱 코드 없는 인프라 저장소·iOS 앱에는 넣지 않고, 웹·서버·모르는 앱에는 넣는다', () => {
  const infra = detect(repo({ 'main.tf': 'resource "x" "y" {}\n', 'scripts/rotate.sh': 'echo\n' }, true));
  assert.equal(infra.code, false);
  assert.ok(!infra.kinds.includes('general'), JSON.stringify(infra.kinds));
  assert.doesNotMatch(security(infra.kinds), LOGIN);
  const ios = detect(repo({ 'App.xcodeproj/project.pbxproj': '// x\n', 'App/ContentView.swift': 'import SwiftUI\n' }, true));
  assert.ok(ios.stack.includes('iOS') && ios.kinds.includes('mobile') && !ios.kinds.includes('general'), JSON.stringify(ios.kinds));
  assert.doesNotMatch(security(ios.kinds), LOGIN);
  // 음성 사례: Terraform 옆에 앱 코드가 있으면(모르는 앱 — general) 넣는다, 웹·서버는 늘 넣는다
  const mixed = detect(repo({ 'main.tf': 'x\n', 'app/server.rb': 'puts 1\n' }, true));
  assert.ok(mixed.code && mixed.kinds.includes('general'), JSON.stringify(mixed.kinds));
  assert.match(security(mixed.kinds), LOGIN);
  // 웹은 로그인 단서(auth)가 있을 때만(역할극 13 회차 — 로그인 없는 쇼핑몰 화면)
  for (const k of [['web', 'auth'], ['backend'], ['general']]) assert.match(security(k), LOGIN, k.join());
  assert.doesNotMatch(security(['web', 'html', 'js']), LOGIN);
});

test('unsafe-html: 화면 파일 없는 TS 저장소는 기본에서 빼고(이유 fitNoUi), 화면 파일·웹 스택이 있으면 켠다', () => {
  const pkg = (deps) => ({ 'package.json': { name: 'a', private: true, devDependencies: deps } });
  const agent = detect(repo({ ...pkg({ typescript: '5.6.0' }), 'src/server.ts': 'export {}\n' }, true));
  assert.equal(fitOff(all, agent).hooks['unsafe-html']?.key, 'fitNoUi');
  const ui = detect(repo({ ...pkg({ typescript: '5.6.0' }), 'src/App.tsx': 'export {}\n' }, true));
  assert.ok(!fitOff(all, ui).hooks['unsafe-html'], 'tsx 가 있으면 켠다');
  const site = detect(repo({ ...pkg({}), 'src/main.ts': 'x\n', 'index.html': '<!doctype html>\n' }, true));
  assert.ok(!fitOff(all, site).hooks['unsafe-html'], 'index.html 이 있으면 켠다');
  assert.ok(!fitOff(all, { kinds: ['web', 'js'], js: true }).hooks['unsafe-html'], '웹 스택이면 켠다');
  assert.ok(!fitOff(all, {}).hooks['unsafe-html'], '옛 감지 결과(칸 없음)는 그대로');
});
