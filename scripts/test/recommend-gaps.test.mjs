// 정답지 다시 매기기에서 남은 추천 빈틈(2026-11-13): README·CI 의 명령(3·11 회차), #[ignore] 긴 시험 묻기(11), 이은 줄 속 운영 명령(10),
// vercel env pull(13). 규칙마다 아닌 경우를 함께 둔다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docCommands } from '../lib/doc-commands.mjs';
import { detectCommands } from '../lib/commands.mjs';
import { suggest, hasIgnoredTest } from '../lib/suggest.mjs';
import { ruleTexts } from '../lib/claude-md.mjs';
import { loadAll } from '../lib/catalog.mjs';
import { tmpDir, writeFiles, gitInit, gitIn } from './helpers.mjs';

const repo = (files) => writeFiles(tmpDir('harness-gaps-'), files);
const tracked = (files) => {
  const d = gitInit(tmpDir('harness-gaps-git-'), { branch: 'main' });
  writeFiles(d, files);
  gitIn(d)('add', '-A');
  return d;
};
const fence = (lang, ...lines) => ['```' + lang, ...lines, '```'].join('\n');

test('README: 셸 블록과 글 속 `…` 의 python 스크립트는 파일이 있을 때만, 설치·배포 제목 아래와 위험한 이름·manage.py 는 아님', () => {
  const r = repo({
    'scripts/eval.py': '', 'scripts/train.py': '', 'scripts/deploy_model.py': '', 'scripts/setup_env.py': '', 'manage.py': '', 'tools/report/__main__.py': '',
    'README.md': [
      '# x', '## 설치', fence('bash', 'python scripts/setup_env.py', 'pip install -e .'),
      '## 사용법', fence('bash', '$ python scripts/eval.py checkpoint=outputs/<날짜>/policy.pt   # 평가', 'python scripts/missing.py', 'python scripts/eval.py --again'),
      '1. 학습: `python scripts/train.py dataset.path=data/x.hdf5`',
      '- 배포 스크립트 `python scripts/deploy_model.py` 와 `python manage.py flush`, 이은 꼴 `python scripts/eval.py && rm -rf out`',
      '- 보고서 `python -m tools.report`, 없는 모듈 `python -m venv .venv`',
      fence('text', 'python scripts/train.py --text-block'),
      '## Deploy', '`python scripts/train.py --on-prod`',
    ].join('\n'),
  });
  assert.deepEqual(docCommands(r), ['python scripts/eval.py checkpoint=outputs/<날짜>/policy.pt', 'python scripts/train.py dataset.path=data/x.hdf5', 'python -m tools.report']);
  // README 가 없거나 꼴이 아니면 빈 목록
  assert.deepEqual(docCommands(repo({ 'README.md': fence('sh', './scripts/run.sh', 'make test', 'npm test') })), []);
  assert.deepEqual(docCommands(repo({})), []);
});

test('README·개발 메모·CI 의 cargo: 패키지·시험·벤치·fuzz 대상이 있을 때만, +nightly 있고 없는 같은 명령은 하나, 이미 찾은 명령에 인자만 더한 꼴은 뺀다', () => {
  const r = repo({
    'Cargo.toml': '[workspace]\nmembers = ["crates/*"]\n',
    'crates/kv-raft/Cargo.toml': '[package]\nname = "kv-raft"\n', 'crates/kv-raft/tests/sim.rs': '',
    'crates/kv-engine/Cargo.toml': '[package]\nname = "kv-engine"\n', 'crates/kv-engine/benches/put_get.rs': '',
    'fuzz/fuzz_targets/wal_decode.rs': '',
    'README.md': [
      '## Build & test', fence('sh', 'cargo fmt --all -- --check', 'cargo test -p kv-raft --test sim -- --ignored', 'cargo test -p nope', 'cargo test -p kv-raft --test missing', 'cargo publish -p kv-raft'),
      '## Benchmarks', fence('sh', 'cargo bench -p kv-engine --bench put_get -- --quick', 'cargo bench -p kv-engine --bench nope'),
      fence('sh', 'cargo +nightly fuzz run wal_decode', 'cargo +nightly fuzz run nope'),
      'Miri: `cargo +nightly miri test -p kv-engine memtable`. Seed: `KV_SIM_SEED=<u64>`.',
      fence('sh', 'cargo run -p kv-raft --release -- --listen 127.0.0.1:1', 'cargo run -p kv-raft --release -- --listen 127.0.0.1:2'),
    ].join('\n'),
    'NOTES.md': '- 재현: `KV_SIM_SEED=1234 cargo test -p kv-raft --test sim`\n',
    '.github/workflows/ci.yml': 'jobs:\n  a:\n    steps:\n      - run: cargo miri test -p kv-engine memtable\n      - run: |\n          cargo test --workspace\n          cargo check -p kv-engine\n      - name: x\n        run: "cargo doc -p kv-raft"\n',
  });
  assert.deepEqual(docCommands(r, ['cargo fmt --all', 'cargo test --workspace']), [
    'cargo test -p kv-raft --test sim -- --ignored', 'cargo bench -p kv-engine --bench put_get -- --quick', 'cargo +nightly fuzz run wal_decode',
    'cargo +nightly miri test -p kv-engine memtable', 'cargo run -p kv-raft --release -- --listen 127.0.0.1:1',
    'KV_SIM_SEED=1234 cargo test -p kv-raft --test sim', 'cargo check -p kv-engine', 'cargo doc -p kv-raft',
  ]);
  // Cargo.toml 이 없으면 cargo 줄은 읽지 않는다
  assert.deepEqual(docCommands(repo({ 'README.md': fence('sh', 'cargo test -p x') })), []);
});

test('독립 검토: 운영 환경 변수·위험한 인자·CI 바꿔 넣기·setup.py·배포 워크플로·작업·단계는 읽지 않는다', () => {
  const r = repo({
    'Cargo.toml': '[package]\nname = "kv"\n',
    'scripts/seed_db.py': '', 'scripts/migrate.py': '', 'scripts/check.py': '', 'scripts/sync_data.py': '', 'setup.py': '',
    'README.md': fence('sh', 'ENV=prod python scripts/check.py', 'APP_ENV="production" python scripts/check.py --x', 'python scripts/seed_db.py', 'python scripts/migrate.py',
      'python scripts/sync_data.py', 'python setup.py sdist bdist_wheel upload', 'cargo run -p kv -- publish --token x', 'python scripts/check.py out=data/wipe.txt',
      'cargo run -p kv --release -- --listen 1', 'LOG=debug python scripts/check.py'),
    '.github/workflows/ci.yml': 'name: ci\njobs:\n  test:\n    steps:\n      - run: cargo check -p kv\n      - name: Publish crate\n        run: cargo doc -p kv\n      - run: cargo test -p kv ${{ matrix.flags }}\n  release:\n    steps:\n      - run: cargo build -p kv\n  docs:\n    name: Deploy docs\n    steps:\n      - run: |\n          cargo bench -p kv\n',
    '.github/workflows/release.yml': 'jobs:\n  a:\n    steps:\n      - run: cargo clippy -p kv\n',
    '.github/workflows/nightly.yml': 'name: Publish nightly\njobs:\n  a:\n    steps:\n      - run: cargo fmt -p kv\n',
  });
  assert.deepEqual(docCommands(r), ['cargo run -p kv --release -- --listen 1', 'LOG=debug python scripts/check.py', 'cargo check -p kv']);
});

test('「이 저장소 명령」: README 명령은 make 대상 뒤 맨 끝 차례, 묻는 명령에 든 것은 지침에서 빠진다', () => {
  const r = repo({
    'pyproject.toml': '[tool.pytest.ini_options]\n', 'scripts/train.py': '', 'scripts/eval.py': '',
    Makefile: 'test:\n\tpytest\nlint-fix:\n\truff --fix .\n',
    'README.md': fence('bash', 'python scripts/train.py', 'python scripts/eval.py ckpt=a.pt'),
  });
  const { commands } = detectCommands(r);
  assert.deepEqual(commands.tools, ['make lint-fix', 'python scripts/train.py', 'python scripts/eval.py ckpt=a.pt']);
  const sel = { lang: 'ko', hooks: ['ask-cmd'], hookOpts: { 'ask-cmd': { commands: ['python scripts/train.py'] } }, rules: ['commands'], skills: [], commands };
  const text = ruleTexts(sel).commands;
  const tools = text.split('\n').find((l) => l.startsWith('- 그 밖의 명령'));
  assert.ok(tools.includes('python scripts/eval.py ckpt=a.pt') && !tools.includes('scripts/train.py'), text);
});

test('#[ignore] 긴 시험이 git 이 아는 .rs 에 있으면 cargo test -- --ignored 를 묻는다(까닭과 함께), 없으면 묻지 않는다', () => {
  const r = tracked({ 'Cargo.toml': '[package]\nname = "a"\n', 'tests/sim.rs': '#[test]\n#[ignore = "long"]\nfn many_seeds() {}\n' });
  const s = suggest(r);
  assert.deepEqual(s.ask, ['cargo test -- --ignored', 'cargo test -- --include-ignored']);
  assert.deepEqual(s.why['cargo test -- --ignored'], { k: 'ignored', at: 'tests/sim.rs' });
  // 주석 속 #[ignore], Cargo.toml 없는 저장소, git 이 모르는 파일
  assert.deepEqual(suggest(tracked({ 'Cargo.toml': '[package]\nname = "a"\n', 'src/lib.rs': '// #[ignore] 는 쓰지 않는다\n#[test]\nfn t() {}\n' })).ask, []);
  assert.deepEqual(suggest(tracked({ 'tests/sim.rs': '#[ignore]\nfn t() {}\n' })).ask, []);
  // 남의 코드(vendor/)의 #[ignore] 는 아니다
  assert.deepEqual(suggest(tracked({ 'Cargo.toml': '[package]\nname = "a"\n', 'vendor/x/tests/t.rs': '#[ignore]\nfn t() {}\n' })).ask, []);
  const untracked = tracked({ 'Cargo.toml': '[package]\nname = "a"\n' });
  writeFiles(untracked, { 'tests/sim.rs': '#[ignore]\nfn t() {}\n' });
  assert.deepEqual(suggest(untracked).ask, []);
});

test('역슬래시로 이은 ssh 안의 운영 명령: spark-submit --env prod 를 묻고 ssh --env prod 는 만들지 않는다', () => {
  const r = repo({
    'scripts/backfill.sh': [
      '#!/bin/bash', 'for job in a b; do', '  ssh -i "$KEY" "hadoop@${HOST}" \\', '    spark-submit \\', '      --master yarn \\',
      '      --date-range "${S}:${E}" --env prod "${extra[@]}"', 'done',
      '# 주석 끝 역슬래시는 잇지 않는다 \\', 'tool run --env prod',
      'ssh host \\', '  --env prod',
    ].join('\n'),
  });
  const ask = suggest(r).ask;
  assert.ok(ask.includes('spark-submit --env prod'), ask.join(' | '));
  assert.ok(ask.includes('tool run --env prod'), '주석 다음 줄은 따로 읽는다');
  assert.ok(!ask.some((x) => x.startsWith('ssh ')), ask.join(' | '));
  // 원격 글이 여러 명령이면 운영 옵션이 든 조각만(cd --env prod 를 만들지 않는다 — 독립 검토 2026-11-13)
  const multi = suggest(repo({ 'scripts/run.sh': 'ssh deploy@host "cd /srv && spark-submit job.py --env prod"\nssh h "cd /a; dbt run -t prod"\n' })).ask;
  assert.ok(multi.includes('spark-submit --env prod') && !multi.some((x) => x.startsWith('cd ')), multi.join(' | '));
  // dry-run 으로 이은 줄은 아님
  const dry = repo({ 'scripts/b.sh': 'ssh host \\\n  spark-submit --dry-run \\\n  --env prod\n' });
  assert.ok(!suggest(dry).ask.includes('spark-submit --env prod'));
});

test('Vercel 기본 묻는 명령에 vercel env pull(까닭과 함께), vercel env ls 는 없다', () => {
  const a = loadAll().combos.stackAddons.find((x) => x.when.includes('Vercel'));
  const asks = a.hookOpts['ask-cmd'].commands;
  assert.ok(asks.includes('vercel env pull'));
  assert.ok(!asks.some((x) => /env (?:ls|list)/.test(x)));
  assert.ok(a.optWhy.ko && a.optWhy.en);
});

// 독립 검토 2026-11-13(두 번째): README·CI 명령이 「평소 돌려도 되는 명령」 목록에 잘못 들어가던 꼴들. 넣는 쪽을 좁게
const PY = ['eval', 'train', 'check', 'cleanup', 'init_db', 'run_migrations', 'apply_migrations', 'deployModel', 'flush_redis', 'rebuild_db', 'clean', 'ship', 'send_emails', 'collect_demos', 'plot']
  .reduce((o, n) => ({ ...o, [`scripts/${n}.py`]: '' }), {});
const readme = (...lines) => repo({ ...PY, 'Cargo.toml': '[package]\nname = "kv"\n', 'README.md': lines.join('\n') });

test('README 명령: 옵션 이름·이름 조각(_ - . camelCase)·인자의 위험한 낱말 뿌리는 뺀다, 난수 시드·dropout·cargo --release 는 둔다', () => {
  const bad = ['python scripts/cleanup.py --delete --force', 'python scripts/init_db.py --drop-existing', 'cargo run -- --reset-db', 'python scripts/run_migrations.py',
    'python scripts/apply_migrations.py', 'python scripts/deployModel.py', 'python scripts/flush_redis.py', 'python scripts/rebuild_db.py', 'python scripts/clean.py --all',
    'python scripts/ship.py', 'cargo run --bin nuke_db', 'python scripts/check.py --url $PROD_URL', 'python scripts/check.py --env=PROD', 'python scripts/check.py --env PROD', 'python scripts/check.py -y'];
  assert.deepEqual(docCommands(readme(fence('sh', ...bad))), []);
  const good = ['python scripts/train.py --seed 42 --dropout 0.1', 'python scripts/eval.py seed=7', 'cargo run -p kv --release -- --listen 1', 'python scripts/check.py --env dev'];
  assert.deepEqual(docCommands(readme(fence('sh', ...good))), good);
});

test('README 명령: 끝 주석에 주의 낱말이 있으면 빼고, 글 속 `…` 는 주의·부정 문장이면 뺀다', () => {
  const r = readme(fence('sh', 'python scripts/eval.py   # WARNING: overwrites the production database', 'python scripts/check.py  # 운영 DB 에 닿아요', 'python scripts/plot.py   # 그림 그리기'),
    'Never run `python scripts/send_emails.py` outside staging.', '주의: `python scripts/train.py --big` 는 하루 걸려요.', '- 학습: `python scripts/train.py`');
  assert.deepEqual(docCommands(r), ['python scripts/plot.py', 'python scripts/train.py']);
  // 주의 문장 바로 뒤의 코드 블록도 아니다
  assert.deepEqual(docCommands(readme('Do not run these against prod:', '', fence('sh', 'python scripts/eval.py'))), []);
});

test('README 제목: 하위 제목도 건너뛰기를 잇고, 밑줄 제목(----·====)도 제목이다, README.rst 는 읽지 않는다', () => {
  const r = readme('## Deployment', '### Steps', fence('sh', 'python scripts/check.py --a'), '## Usage', fence('sh', 'python scripts/eval.py --b'),
    'Release', '-------', fence('sh', 'python scripts/train.py --c'), 'Examples', '========', fence('sh', 'python scripts/plot.py --d'));
  assert.deepEqual(docCommands(r), ['python scripts/eval.py --b', 'python scripts/plot.py --d']);
  assert.deepEqual(docCommands(repo({ ...PY, 'README.rst': 'Deploy\n------\n\n::\n\n    python scripts/eval.py\n\n``python scripts/eval.py``\n' })), []);
});

test('CI: environment: 작업·cd.yml·태그 push·release 로 도는 워크플로·단계 끝의 name: Deploy·steps: 뒤 작업 name: 은 읽지 않는다', () => {
  const wf = (files) => repo({ 'Cargo.toml': '[package]\nname = "kv"\n', ...Object.fromEntries(Object.entries(files).map(([k, v]) => [`.github/workflows/${k}`, v])) });
  const r = wf({
    'ci.yml': [
      'name: ci', 'on: [push, pull_request]', 'jobs:',
      '  test:', '    runs-on: ubuntu-latest', '    steps:', '      - run: cargo check -p kv', '      - run: cargo doc -p kv', '        name: Deploy docs',
      '  ship-it:', '    steps:', '      - run: cargo build -p kv', '    name: Publish',
      '  staging:', '    environment: staging', '    steps:', '      - run: cargo bench -p kv',
      '  env-prod:', '    env:', '      TARGET: PRODUCTION', '    steps:', '      - run: cargo clippy -p kv',
      '  tagged:', "    if: startsWith(github.ref, 'refs/tags/')", '    steps:', '      - run: cargo fmt -p kv',
      'steps-flat:', '  steps:', '  - run: cargo test -p kv',
    ].join('\n'),
    'cd.yml': 'jobs:\n  a:\n    steps:\n      - run: cargo test -p kv\n',
    'tags.yml': 'on:\n  push:\n    tags:\n      - "v*"\njobs:\n  a:\n    steps:\n      - run: cargo test -p kv\n',
    'rel.yml': 'on:\n  release:\n    types: [published]\njobs:\n  a:\n    steps:\n      - run: cargo test -p kv\n',
  });
  assert.deepEqual(docCommands(r), ['cargo check -p kv']);
  // 같은 들여쓰기 목록(steps:\n- run:) 꼴도 읽는다
  assert.deepEqual(docCommands(wf({ 'ci.yml': 'jobs:\n  a:\n    steps:\n    - run: cargo test -p kv\n' })), ['cargo test -p kv']);
});

test('지킬 경로(suggest protect)에 결과를 쓰는 명령은 뺀다 — 읽는 쪽 인자는 그대로', () => {
  const r = readme(fence('sh', 'python scripts/collect_demos.py --out data/demos.hdf5', 'python scripts/collect_demos.py output_dir=data/raw/a',
    'python scripts/collect_demos.py -o results/x.csv', 'python scripts/train.py dataset.path=data/x.hdf5'));
  assert.deepEqual(docCommands(r, [], ['data/', '.hdf5']), ['python scripts/collect_demos.py -o results/x.csv', 'python scripts/train.py dataset.path=data/x.hdf5']);
  // 지킬 경로가 없으면 그대로(같은 스크립트는 처음 것 하나)
  assert.deepEqual(docCommands(r), ['python scripts/collect_demos.py --out data/demos.hdf5', 'python scripts/train.py dataset.path=data/x.hdf5']);
  // detectCommands 가 받은 protect 를 넘긴다(.gitignore 의 *.hdf5 → suggest protect .hdf5)
  const g = repo({ ...PY, '.gitignore': '*.hdf5\n', 'README.md': fence('sh', 'python scripts/collect_demos.py --out demos.hdf5', 'python scripts/plot.py') });
  assert.deepEqual(detectCommands(g, { protect: suggest(g).protect }).commands.tools, ['python scripts/plot.py']);
});

test('느린 입력: 빈칸 4만 개 줄·빈 줄 4만 개 Cargo.toml·빈 줄 8만 개 .rs 도 200ms 안에', () => {
  const time = (fn) => { const t = performance.now(); fn(); return performance.now() - t; };
  const spaces = readme(fence('sh', `python scripts/eval.py${' '.repeat(40000)}x`), `\`python scripts/eval.py${' '.repeat(40000)}x\``);
  assert.ok(time(() => docCommands(spaces)) < 200);
  const toml = repo({ 'Cargo.toml': `[package]\n${'\n'.repeat(40000)}name = "big"\n`, 'tests/t.rs': '', 'README.md': fence('sh', 'cargo test -p big --test t') });
  let got;
  assert.ok(time(() => { got = docCommands(toml); }) < 200);
  assert.deepEqual(got, ['cargo test -p big --test t'], '먼 name 도 찾는다');
  const rs = `${'\n'.repeat(80000)}fn x() {}\n`;
  assert.ok(time(() => assert.equal(hasIgnoredTest(rs), false)) < 200);
  assert.equal(hasIgnoredTest('  #[ignore]\nfn t() {}'), true);
});
