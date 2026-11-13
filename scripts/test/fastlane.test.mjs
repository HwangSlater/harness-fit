// Fastfile 읽기(scripts/lib/fastlane.mjs) — 레인 부르기 자리, 문자열·주석·heredoc. 검토 2026-11-13 의 재현 사례.
// 같은 판정을 「이 저장소 명령」(commands.mjs)과 묻는 명령(suggest.mjs)이 쓰므로 둘 다 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFastlane, laneShips, laneCalls, codeOf, shipLanes } from '../lib/fastlane.mjs';
import { detectCommands } from '../lib/commands.mjs';
import { suggest } from '../lib/suggest.mjs';
import { withoutAsked } from '../lib/claude-md.mjs';
import { tmpDir, writeFiles } from './helpers.mjs';

const repo = (files) => writeFiles(tmpDir('harness-fastlane-'), files);

// 검토의 재현: ci 레인의 options[:release], tag 레인의 add_git_tag(tag: release), #{…} 뒤의 readonly, heredoc 속 「deliver」
const FASTFILE = [
  'platform :ios do',
  '  lane :release do',
  '    upload_to_app_store',
  '  end',
  '  lane :ci do',
  '    run_tests if options[:release]',
  '    build_app(scheme: "App") unless options[:release]',
  '  end',
  '  lane :tag do',
  '    release = get_version_number',
  '    add_git_tag(tag: release)',
  '  end',
  '  lane :keys do',
  '    match(git_url: "#{ENV[\'MATCH_URL\']}", type: "appstore", readonly: true)',
  '  end',
  '  lane :notes do',
  '    text = <<~TXT',
  '      deliver 는 리드만',
  '      release 도 리드만',
  '    TXT',
  '    File.write("notes.txt", text)',
  '  end',
  '  lane :ship do',
  '    release',
  '  end',
  'end',
  '',
].join('\n');
const MAKEFILE = 'ci:\n\tbundle exec fastlane ci\ntag:\n\tbundle exec fastlane tag\nkeys:\n\tbundle exec fastlane keys\nnotes:\n\tbundle exec fastlane notes\nship:\n\tbundle exec fastlane ship\n';

test('fastlane: 레인 이름은 부르는 자리의 낱말만 — 기호·키·값·지역 변수는 레인 부르기가 아니다', () => {
  const r = repo({ 'fastlane/Fastfile': FASTFILE });
  const fl = readFastlane(r);
  assert.deepEqual(['release', 'ci', 'tag', 'keys', 'notes', 'ship'].map((n) => laneShips(n, fl.lanes)), [true, false, false, false, false, true]);
  assert.deepEqual(shipLanes(fl), ['release', 'ship']);
  // 부르는 자리: 줄 앞·= 뒤·( 안은 맞고, :x · x: · .x · [:x] · @x · 값을 넣는 지역 변수는 아니다
  assert.deepEqual(laneCalls('beta\nx = beta2\nfoo(beta3)\n:beta4\nbeta5: 1\na.beta6\nh[:beta7]\n@beta8\nbeta9 = 1\nfoo(beta9)\n').filter((w) => w.startsWith('beta')), ['beta', 'beta2', 'beta3']);
  // == 는 값 넣기가 아니다
  assert.ok(laneCalls('beta == 1\n').includes('beta'));
});

test('fastlane: 문자열(#{…} 속 따옴표까지)을 먼저 지우고 그다음 주석, heredoc 본문은 건너뛴다', () => {
  assert.equal(codeOf('match(git_url: "#{ENV[\'U\']}", readonly: true) # deliver'), 'match(git_url: "", readonly: true) ');
  assert.equal(codeOf('x = "a \\" # b" + \'#c\' # 주석'), 'x = "" + "" ');
  assert.equal(codeOf('t = "#{a.map { |x| "#{x}" }.join}" ; deliver'), 't = "" ; deliver');
  assert.equal(codeOf("t = <<~'EOS'"), "t = <<~'EOS'");
  // 여러 heredoc·<<- ·따옴표 친 끝 표시, 그 뒤 줄은 다시 코드
  const r = repo({ 'fastlane/Fastfile': "lane :a do\n  x = <<-A + <<~'B'\n  pilot\n  A\n  deliver\n  B\n  build_app\nend\nlane :b do\n  y = <<EOS\nupload_to_app_store\nEOS\nend\nlane :c do\n  arr <<x\n  pilot\nend\n" });
  const fl = readFastlane(r);
  assert.deepEqual(['a', 'b', 'c'].map((n) => laneShips(n, fl.lanes)), [false, false, true], '소문자 <<x 는 배열 넣기 — 다음 줄은 코드');
  assert.match(fl.lanes.get('a'), /build_app/);
});

test('fastlane: 검토 재현 저장소 — make ci·tag·keys·notes 는 평소 명령에 남고 묻지 않는다', () => {
  const r = repo({ 'fastlane/Fastfile': FASTFILE, Makefile: MAKEFILE });
  const tools = detectCommands(r).commands.tools || [];
  for (const t of ['make ci', 'make tag', 'make keys', 'make notes']) assert.ok(tools.includes(t), `${t} 가 평소 명령에: ${tools}`);
  assert.ok(!tools.includes('make ship'), 'release 를 부르는 ship 은 뺀다');
  const ask = suggest(r).ask;
  for (const v of ['make ci', 'make tag', 'make keys', 'make notes', 'fastlane ci', 'fastlane tag', 'fastlane keys', 'fastlane notes']) assert.ok(!ask.includes(v), `${v} 를 묻지 않음: ${ask}`);
  for (const v of ['make ship', 'fastlane release', 'fastlane ship']) assert.ok(ask.includes(v), `${v} 는 묻는다: ${ask}`);
});

test('fastlane: 여러 줄 문자열(desc "…⏎ deliver …")은 앞 레인 본문에 새지 않는다', () => {
  const r = repo({
    'fastlane/Fastfile': [
      'lane :test do', '  run_tests', 'end', '', 'desc "Ship to the store.', '  deliver runs after review.', '  pilot too"',
      'lane :beta_ship do', '  build_app', 'end',
      "desc 'single quoted", "  upload_to_app_store here'", 'lane :lint_all do', '  swiftlint', 'end',
      // 닫힌 뒤의 코드는 다시 본다
      'lane :push do', '  x = "a', 'b"; deliver', 'end', '',
    ].join('\n'),
  });
  const fl = readFastlane(r);
  assert.doesNotMatch(fl.lanes.get('test'), /deliver|pilot/);
  assert.doesNotMatch(fl.lanes.get('beta_ship'), /upload_to_app_store/);
  assert.deepEqual(['test', 'lint_all', 'push'].map((n) => laneShips(n, fl.lanes)), [false, false, true], '닫힌 뒤의 deliver 는 동작');
  // 줄을 넘는 상태: 닫히지 않으면 그 줄은 빈 코드, 다음 줄에서 닫히면 "" 하나
  const st = { quote: '', depth: 0 };
  assert.equal(codeOf('desc "a', st), 'desc ');
  assert.equal(codeOf('deliver b"; pilot', st), '""; pilot');
  assert.equal(st.quote, '');
  // 짝 없는 따옴표는 레인 머리에서 끊는다 — 다음 레인까지 삼키지 않는다
  const r2 = repo({ 'fastlane/Fastfile': "lane :a do\n  c = ?'\nend\nlane :b do\n  deliver\nend\n" });
  assert.equal(laneShips('b', readFastlane(r2).lanes), true);
});

test('fastlane: 레인이 많아도 판정은 한 번 — 레인 1500개 × 부르기 50개, 3000개 사슬(시간 한도)', (t) => {
  // 1500개: 레인 i 가 i+1 … i+50 을 부른다. 끝 레인만 deliver
  const N = 1500;
  const wide = [];
  for (let i = 0; i < N; i++) {
    wide.push(`lane :l${i} do`);
    for (let k = 1; k <= 50 && i + k < N; k++) wide.push(`  l${i + k}`);
    if (i === N - 1) wide.push('  deliver');
    wide.push('end');
  }
  let t0 = Date.now();
  const fl = readFastlane(repo({ 'fastlane/Fastfile': `${wide.join('\n')}\n` }));
  const ships = shipLanes(fl);
  const wideMs = Date.now() - t0;
  assert.equal(ships.length, N);
  assert.ok(wideMs < 5000, `1500×50: ${wideMs}ms`);
  // 3000개 사슬(재귀였으면 호출 스택이 넘쳤다): 맨 끝만 올린다 → 전부 출시, 끝을 지우면 전부 아님
  const M = 3000;
  const chain = (last) => Array.from({ length: M }, (_, i) => `lane :c${i} do\n  ${i + 1 < M ? `c${i + 1}` : last}\nend`).join('\n');
  t0 = Date.now();
  const yes = readFastlane(repo({ 'fastlane/Fastfile': `${chain('deliver')}\n` }));
  assert.equal(shipLanes(yes).length, M);
  const no = readFastlane(repo({ 'fastlane/Fastfile': `${chain('build_app')}\n` }));
  assert.equal(shipLanes(no).length, 0);
  assert.equal(laneShips('c0', no.lanes), false);
  const chainMs = Date.now() - t0;
  assert.ok(chainMs < 5000, `사슬 3000: ${chainMs}ms`);
  // 서로 부르는 레인: a ↔ b, a → c(출시) 이면 둘 다 출시(먼저 본 쪽이 거짓으로 굳지 않는다)
  const loop = readFastlane(repo({ 'fastlane/Fastfile': 'lane :a do\n  b\n  c\nend\nlane :b do\n  a\nend\nlane :c do\n  pilot\nend\nlane :d do\n  e\nend\nlane :e do\n  d\nend\n' }));
  assert.deepEqual(['a', 'b', 'c', 'd', 'e'].map((n) => laneShips(n, loop.lanes)), [true, true, true, false, false]);
  t.diagnostic(`fastlane 시간: 1500×50 ${wideMs}ms, 사슬 3000 ${chainMs}ms`);
});

test('fastlane: 묻는 명령 「fastlane match」 가 있어도 읽기 전용 match 는 「이 저장소 명령」에 남는다(훅이 묻지 않는 꼴)', () => {
  const cmds = { tools: ['bundle exec fastlane match development --readonly', 'fastlane match appstore', 'fastlane match nuke development --readonly', 'make -n backfill'] };
  assert.deepEqual(withoutAsked(cmds, ['fastlane match', 'make backfill']), { tools: ['bundle exec fastlane match development --readonly', 'make -n backfill'] });
});

// 검토 2026-11-13: 막는 명령(block)에만 적은 것이 「그 밖의 명령」 에 남고 「사람이 직접 실행」 줄에 없었다
test('막는 명령도 「이 저장소 명령」에서 빼고 「사람이 직접 실행」 줄에 넣는다(시험 실행 꼴도 막으므로 뺀다)', async () => {
  const { ruleTexts, askedCmds } = await import('../lib/claude-md.mjs');
  const cmds = { test: ['make test'], tools: ['make deploy-prod', 'make -n deploy-prod', 'make db-reset'] };
  assert.deepEqual(withoutAsked(cmds, [], ['make deploy-prod']), { test: ['make test'], tools: ['make db-reset'] });
  assert.deepEqual(withoutAsked(cmds, [], 'make deploy-prod'), { test: ['make test'], tools: ['make db-reset'] }, '글 하나');
  assert.deepEqual(askedCmds(['make a'], ['make b', 'make a']), ['make b', 'make a'], '막는 명령이 먼저');
  // 묻는 명령이 많아도 막는 명령은 앞 5개 안에 보인다(역할극 16 회차 다시 — make release·release.sh 가 23개 뒤라 빠졌다)
  const many = Array.from({ length: 23 }, (_, i) => `fastlane lane${i}`);
  const shown = askedCmds(many, ['make release', './scripts/release.sh']);
  assert.deepEqual(shown.slice(0, 2), ['make release', './scripts/release.sh']);
  assert.equal(shown.length, 5);
  assert.deepEqual(askedCmds(['make a', 'make b'], []), ['make a', 'make b'], '막는 명령이 없으면 묻는 명령 그대로');
  const sel = { lang: 'en', rules: ['commands'], flow: 'none', hooks: ['ask-cmd'], skills: [], kinds: ['general'], commands: { test: ['make test'], tools: ['make deploy-prod', 'make db-reset'] } };
  const text = ruleTexts({ ...sel, hookOpts: { 'ask-cmd': { commands: [], block: ['make deploy-prod'] } } }).commands;
  assert.match(text, /Other commands: `make db-reset`/);
  assert.match(text, /Run by a person: `make deploy-prod`/);
  // 막는 명령도 묻는 명령도 없으면 그 줄은 없다
  assert.doesNotMatch(ruleTexts({ ...sel, hookOpts: { 'ask-cmd': { commands: [] } } }).commands, /Run by a person/);
});
