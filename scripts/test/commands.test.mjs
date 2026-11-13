// 이 저장소 명령(CLAUDE.md 지침 「이 저장소 명령」), 뺀 줄 보기·줄을 대신 맡는 훅, 훅 종류(차단·알림), 영어 단·복수.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCommands } from '../lib/commands.mjs';
import { pickerCfg as cfg, tmpDir, writeFiles, ruleTitle, ruleLine, ruleRawLine } from './helpers.mjs';
import { renderRule, ruleTexts, ruleDropped, ruleHookTags, START, END } from '../lib/claude-md.mjs';
import { loadAll } from '../lib/catalog.mjs';
import { makeState, readStrings } from '../lib/picker-state.mjs';
import { detect } from '../detect.mjs';
import { ruleLines } from '../overlap.mjs';
import { fmt } from '../../picker/dom.js';
import { blockingHooks } from '../../picker/stats.js';

const all = loadAll();
const repo = (files) => writeFiles(tmpDir('harness-cmd-'), files);
const cmds = (files) => detectCommands(repo(files)).commands;
const pkg = (scripts, extra = {}) => ({ 'package.json': { name: 'x', scripts, ...extra } });

test('package.json: npm 이 기본, 자리표시 test 는 명령이 아니다', () => {
  assert.deepEqual(cmds(pkg({ test: 'vitest run', lint: 'eslint .', typecheck: 'tsc --noEmit', format: 'prettier -w .', build: 'vite build', dev: 'vite' })),
    { test: ['npm test'], testOne: ['npx vitest run <file>'], lint: ['npm run lint'], typecheck: ['npm run typecheck'], format: ['npm run format'], build: ['npm run build'], tools: ['npm run dev'] });
  assert.deepEqual(cmds(pkg({ test: 'echo "Error: no test specified" && exit 1' })), {});
  assert.deepEqual(cmds(pkg({ 'type-check': 'tsc', fmt: 'biome format' })), { typecheck: ['npm run type-check'], format: ['npm run fmt'] });
});

test('package.json: 잠금 파일·packageManager 로 패키지 관리자를 고른다(bun 은 늘 bun run)', () => {
  const s = { test: 'vitest', lint: 'eslint .' };
  assert.deepEqual(cmds({ ...pkg(s), 'pnpm-lock.yaml': '' }), { test: ['pnpm test'], testOne: ['pnpm exec vitest run <file>'], lint: ['pnpm run lint'] });
  assert.deepEqual(cmds({ ...pkg(s), 'yarn.lock': '' }), { test: ['yarn test'], testOne: ['yarn vitest run <file>'], lint: ['yarn run lint'] });
  assert.deepEqual(cmds({ ...pkg(s), 'bun.lockb': '' }), { test: ['bun run test'], testOne: ['bunx vitest run <file>'], lint: ['bun run lint'] });
  assert.deepEqual(cmds({ ...pkg(s), 'bun.lock': '' }).test, ['bun run test']);
  assert.deepEqual(cmds(pkg(s, { packageManager: 'pnpm@9.1.0' })).test, ['pnpm test'], 'packageManager 가 먼저');
  assert.deepEqual(cmds({ 'package.json': '{ 깨진' }), {}, '깨진 package.json 은 건너뛴다');
});

test('Makefile: 있는 대상만(변수 대입은 대상이 아니다)', () => {
  assert.deepEqual(cmds({ Makefile: 'CC := gcc\ntest: build\n\tgo test\nlint:\n\tgolint\nfmt:\n\tgofmt\nbuild:\n\tgo build\nrelease:\n' }),
    { test: ['make test'], lint: ['make lint'], format: ['make fmt'], build: ['make build'] }, 'release 는 운영에 닿는 대상이라 적지 않는다');
  assert.deepEqual(cmds({ Makefile: 'test := 1\nX=2\n' }), {});
});

test('pyproject: pytest·ruff·mypy 설정, 잠금 파일이면 그 도구로 돌린다', () => {
  const py = '[project]\nname = "x"\n\n[tool.pytest.ini_options]\naddopts = "-q"\n\n[tool.ruff]\nline-length = 100\n\n[tool.ruff.format]\nquote-style = "double"\n\n[tool.mypy]\nstrict = true\n';
  assert.deepEqual(cmds({ 'pyproject.toml': py, 'uv.lock': '' }), { test: ['uv run pytest'], testOne: ['uv run pytest <file>'], lint: ['uv run ruff check .'], typecheck: ['uv run mypy .'], format: ['uv run ruff format .'] });
  assert.deepEqual(cmds({ 'pyproject.toml': py, 'poetry.lock': '' }).test, ['poetry run pytest']);
  assert.deepEqual(cmds({ 'pyproject.toml': '[project]\nname = "x"\ndependencies = []\n[project.optional-dependencies]\ndev = ["pytest>=8"]\n' }), { test: ['pytest'], testOne: ['pytest <file>'] });
  assert.deepEqual(cmds({ 'pyproject.toml': '[project]\nname = "x"\n' }), {}, '설정이 없으면 아무것도 지어내지 않는다');
  assert.deepEqual(cmds({ 'requirements.txt': 'flask==3\n', 'conftest.py': '' }), { test: ['pytest'], testOne: ['pytest <file>'] });
});

test('pyproject: [project.scripts]·[tool.poetry.scripts] 는 「이 저장소가 설치하는 명령」(역할극 4 회차 2차)', () => {
  assert.deepEqual(cmds({ 'pyproject.toml': '[project]\nname = "x"\n[project.scripts]\nbot-eval = "bot.eval:main"\n"bot-ingest" = "bot.ingest:main"\n', 'uv.lock': '' }).tools, ['uv run bot-eval', 'uv run bot-ingest']);
  assert.deepEqual(cmds({ 'pyproject.toml': '[tool.poetry.scripts]\nserve = "app:run"\n' }).tools, ['serve']);
  assert.equal(cmds({ 'pyproject.toml': '[project]\nname = "x"\n' }).tools, undefined);
  // 이미 적혔는지는 낱말 경계로(「training」 글이 train 명령을 가리지 않게 — 검토 2026-11-11)
  assert.deepEqual(cmds({ 'pyproject.toml': '[project.scripts]\ntrain = "m:main"\n', 'CLAUDE.md': '# 메모\ntraining 은 오래 걸린다\n' }).tools, ['train']);
  assert.equal(cmds({ 'pyproject.toml': '[project.scripts]\ntrain = "m:main"\n', 'CLAUDE.md': '- 학습: `train`\n' }).tools, undefined);
});

test('pyproject: tox·hatch 스크립트가 있으면 그것을 쓴다', () => {
  assert.deepEqual(cmds({ 'pyproject.toml': '[tool.pytest.ini_options]\n', 'tox.ini': '[tox]\n' }).test, ['tox']);
  const hatch = '[tool.hatch.envs.default.scripts]\ntest = "pytest"\ntypes = "mypy src"\n\n[tool.hatch.envs.lint.scripts]\nlint = "ruff check"\nfmt = "ruff format"\n';
  assert.deepEqual(cmds({ 'pyproject.toml': hatch }), { test: ['hatch run test'], lint: ['hatch run lint:lint'], typecheck: ['hatch run types'], format: ['hatch run lint:fmt'] });
});

test('Cargo·Go: 도구에 들어 있는 명령 + 설정 파일이 있을 때만 clippy·rustfmt·golangci-lint', () => {
  assert.deepEqual(cmds({ 'Cargo.toml': '[package]\nname = "x"\n' }), { test: ['cargo test'], testOne: ['cargo test <name>'], build: ['cargo build'] });
  assert.deepEqual(cmds({ 'Cargo.toml': '', 'clippy.toml': '', 'rustfmt.toml': '' }), { test: ['cargo test'], testOne: ['cargo test <name>'], lint: ['cargo clippy'], format: ['cargo fmt'], build: ['cargo build'] });
  assert.deepEqual(cmds({ 'go.mod': 'module x\n' }), { test: ['go test ./...'], testOne: ['go test -run <name> ./...'], lint: ['go vet ./...'], build: ['go build ./...'] });
  assert.deepEqual(cmds({ 'go.mod': 'module x\n', '.golangci.yml': '' }).lint, ['golangci-lint run']);
});

test('시험 하나만: 시험 도구를 그대로 부르는 test 스크립트일 때만, 각 도구 문서의 꼴로', () => {
  const one = (script, extra = {}) => cmds({ ...pkg({ test: script }), ...extra }).testOne;
  assert.deepEqual(one('jest --coverage'), ['npx jest <file>']);
  assert.deepEqual(one('playwright test'), ['npx playwright test <file>']);
  assert.deepEqual(one('bun test'), ['bun test ./<file>'], 'bun 은 ./ 가 있어야 파일로 읽는다');
  assert.deepEqual(one('node --test'), ['node --test <file>']);
  assert.deepEqual(one('node --test scripts/test/'), ['node --test <file>']);
  // 모르면 넣지 않는다: 이어 붙인 명령, 설정 경로, 환경 변수 앞붙이, 다른 도구·하위 명령, mocha(.mocharc spec 과 합쳐진다)
  for (const s of ['tsc && vitest run', 'vitest run --config vitest.unit.ts', 'jest -c jest.e2e.js', 'cross-env CI=1 jest', 'vitest bench',
    'node --test --import tsx', 'mocha', 'turbo test', 'npm run test:unit', 'jest "src"']) assert.equal(one(s), undefined, s);
  assert.equal(cmds({ 'pyproject.toml': '[tool.pytest.ini_options]\n', 'tox.ini': '[tox]\n' }).testOne, undefined, 'tox 는 모른다');
  assert.equal(cmds({ Makefile: 'test:\n' }).testOne, undefined, 'make 는 모른다');
});

test('시험 하나만 글: 자리표시를 그 언어 말로 바꾼다', () => {
  const c = { test: ['npm test'], testOne: ['npx vitest run <file>', 'go test -run <name> ./...'] };
  for (const lang of ['ko', 'en']) {
    // 규칙 파일이 정한 말(`{{cmd:testOne|file=파일|name=이름}}`, 없으면 그대로)
    const raw = ruleRawLine('commands', lang, 'cmd:testOne');
    const words = Object.fromEntries([...raw.matchAll(/\|(\w+)=([^|}]+)/g)].map((m) => [m[1], m[2]]));
    const say = (k) => `<${words[k] || k}>`;
    const want = `${raw.split('{{')[0]}\`npx vitest run ${say('file')}\` · \`go test -run ${say('name')} ./...\``;
    const out = renderRule('commands', lang, [], [], [], c);
    assert.ok(out.split('\n').includes(want), `${lang}: ${out}`);
    assert.ok(!renderRule('commands', lang, [], [], [], { test: ['npm test'] }).includes(raw.split('{{')[0].trim()), '모르면 줄을 넣지 않는다');
  }
  assert.equal(renderRule('commands', 'ko', [], [], [], c).split('\n').at(-1), ruleLine('commands', 'ko', 'cmd:testOne', c), '줄 순서는 파일 그대로');
});

test('여러 생태계가 있으면 한 줄에 함께(종류마다 3개까지), 빈 저장소는 없음', () => {
  assert.deepEqual(cmds({ ...pkg({ test: 'jest' }), Makefile: 'test:\n', 'Cargo.toml': '[package]\n', 'go.mod': 'module x\n' }).test, ['npm test', 'make test', 'cargo test'], '레시피가 비어 무엇을 부르는지 모르면 언어 기본값도 낸다(종류마다 3개까지)');
  // Makefile 이 맡으면 언어 기본값(go test ./...·cargo test)은 내지 않고, 하나만 돌리기는 레시피 옵션을 따른다(역할극 14 회차)
  const go = cmds({ Makefile: 'test:\n\tgo test -race -count=1 -coverprofile=c.out ./...\nlint:\n\tgolangci-lint run\n', 'go.mod': 'module x\n' });
  assert.deepEqual([go.test, go.testOne, go.lint, go.build], [['make test'], ['go test -race -count=1 -run <name> ./...'], ['make lint'], ['go build ./...']], 'make lint 가 golangci-lint 를 부르면 go 쪽 검사 기본값은 내지 않는다');
  assert.deepEqual(cmds({ 'go.mod': 'module x\n', 'Cargo.toml': '[package]\n' }).test, ['cargo test', 'go test ./...'], 'Makefile 이 없으면 언어 기본값');
  // 검토 2026-11-12: 레시피가 그 언어 도구를 부를 때만 빼고, $(GO)·앞 환경 변수·\ 이어 쓴 줄·두 콜론·한 줄 여러 대상도 따른다
  const mixed = cmds({ Makefile: 'build:\n\tdocker build -t x .\ntest:\n\tcd web && npm test\n', 'go.mod': 'module x\n' });
  assert.deepEqual([mixed.build, mixed.test], [['make build', 'go build ./...'], ['make test', 'go test ./...']]);
  const vars = cmds({ Makefile: 'GO ?= go\nunit test::\n\tCGO_ENABLED=1 $(GO) test \\\n\t  -race -count=1 ./...\n', 'go.mod': 'module x\n' });
  assert.deepEqual([vars.test, vars.testOne], [['make test'], ['go test -race -count=1 -run <name> ./...']]);
  // 검토 2026-11-12(셋째): ifeq 가 레시피를 끊지 않고, 주석 줄은 빼고, 의존 대상의 레시피·gotestsum·경로로 부른 go·golangci-lint 도 따른다
  const cond = cmds({ Makefile: 'test:\nifeq ($(CI),1)\n\tgo test -race ./...\nelse\n\tgo test -race -short ./...\nendif\n', 'go.mod': 'module x\n' });
  assert.deepEqual([cond.test, cond.testOne], [['make test'], ['go test -race -run <name> ./...']]);
  const note = cmds({ Makefile: 'test:\n\t# go test -race ./...\n\t./scripts/test.sh\n', 'go.mod': 'module x\n' });
  assert.deepEqual([note.test, note.testOne], [['make test', 'go test ./...'], ['go test -run <name> ./...']], '주석 줄은 레시피가 아니다');
  const deps = cmds({ Makefile: 'GO := /usr/local/go/bin/go\ntest: test-unit\ntest-unit:\n\tgotestsum -- -race ./...\nlint:\n\tgolangci-lint run ./...\nbuild:\n\t$(GO) build ./cmd/api\n', 'go.mod': 'module x\n', '.golangci.yml': 'x: 1\n' });
  assert.deepEqual([deps.test, deps.testOne, deps.lint, deps.build], [['make test'], ['go test -race -run <name> ./...'], ['make lint'], ['make build']]);
  assert.deepEqual(cmds({}), {});
});

test('사용자 CLAUDE.md 에 이미 적힌 명령은 뺀다(harness-fit 구역 안은 사용자 글이 아니다)', () => {
  const dir = repo({ ...pkg({ test: 'jest', build: 'tsc' }), 'CLAUDE.md': `# x\n- 시험은 \`npm test\` 로\n\n${START}\n- 빌드: \`npm run build\`\n${END}\n` });
  assert.deepEqual(detectCommands(dir), { commands: { testOne: ['npx jest <file>'], build: ['npm run build'] }, listed: ['npm test'] });
  assert.deepEqual(detect(dir).commands, { testOne: ['npx jest <file>'], build: ['npm run build'] }, 'detect 가 싣는다');
});

test('이 저장소 명령 글: 찾은 종류만, 시험 줄에 끝내기 전 안내, 명령이 없으면 통째로 뺀다', () => {
  const c = { test: ['npm test'], build: ['npm run build', 'make build'] };
  for (const lang of ['ko', 'en']) {
    const want = [ruleTitle('commands', lang), ruleLine('commands', lang, 'cmd:test', c), ruleLine('commands', lang, 'cmd:build', c)].join('\n');
    assert.equal(renderRule('commands', lang, [], [], [], c), want);
    assert.ok(want.includes('`npm run build` · `make build`'), '같은 종류 명령은 한 줄에');
  }
  assert.equal(renderRule('commands', 'ko', [], [], [], {}), '');
  assert.doesNotMatch(renderRule('commands', 'ko', [], [], [], c), /\{\{/, '표시는 남지 않는다');
  const texts = ruleTexts({ lang: 'ko', flow: 'github-flow', rules: ['lean', 'commands'], hooks: [], commands: c });
  assert.deepEqual(Object.keys(texts), ['commands', 'github-flow', 'lean'], '명령이 맨 위');
  assert.deepEqual(Object.keys(ruleTexts({ lang: 'ko', flow: 'none', rules: ['commands', 'lean'], hooks: [] })), ['lean']);
  // overlap.mjs 의 줄 번호(--skip commands:<n>)는 파일 순서 그대로
  assert.deepEqual(ruleLines('ko', ['commands'], c).commands.map((l) => l.n), [1, 6]);
  assert.equal(renderRule('commands', 'ko', [], [6], [], c), [ruleTitle('commands', 'ko'), ruleLine('commands', 'ko', 'cmd:test', c)].join('\n'));
});

test('구조 지침에서 뻔한 일반론 3줄을 뺐다', () => {
  for (const [lang, re] of [['ko', /섞지 않는다|감싸는 층|미리 만들지 않는다/], ['en', /same file|wrapper layer|ahead of time/]]) {
    const text = renderRule('structure', lang, []);
    assert.doesNotMatch(text, re);
    assert.equal(text.split('\n').filter((l) => l.startsWith('- ')).length, 3);
  }
});

test('뺀 줄: 훅·스킬이 맡거나 이미 CLAUDE.md 에 있는 줄을 이유와 자리와 함께 낸다', () => {
  const sel = { lang: 'ko', flow: 'none', rules: ['lean', 'security'], hooks: ['pin-deps'], skills: ['caveman'], skipLines: { lean: [1] } };
  const d = ruleDropped(sel);
  assert.deepEqual(d.lean.map((x) => [x.by, x.who, x.at]), [['existing', [], 1], ['skill', ['caveman'], 1]]);
  assert.deepEqual(d.security.map((x) => [x.by, x.who]), [['hook', ['pin-deps']]]);
  const rows = ruleTexts(sel).security.split('\n');
  assert.ok(d.security[0].at <= rows.length, '자리는 들어간 글의 줄 번호');
  assert.match(d.security[0].text, /^- /);
  // 꺼진 훅 전용 줄이 훅을 꺼서 안 들어가는 것은 「뺀 줄」이 아니다({{hook:id}} 줄)
  assert.equal(ruleDropped({ ...sel, hooks: [], skills: [], skipLines: {} }).security, undefined);
});

test('줄을 대신 맡는 훅: rules/*.md 의 {{!hook:id}} 를 지침마다 모은다(있는 훅만)', () => {
  const ids = new Set(all.packs.hooks.map((h) => h.id));
  for (const lang of ['ko', 'en']) {
    const tags = ruleHookTags(lang);
    assert.ok(tags.security.includes('pin-deps'));
    assert.ok(tags['github-flow'].includes('pr-merge'));
    for (const list of Object.values(tags)) for (const id of list) assert.ok(ids.has(id), id);
  }
  assert.deepEqual(ruleHookTags('ko'), ruleHookTags('en'));
});

test('화면 상태: 명령이 없으면 「이 저장소 명령」을 숨기고, 있으면 기본으로 켜고 토큰을 센다', () => {
  const none = makeState({ all, cfg, det: detect(repo({})) }, 'ko');
  assert.ok(!none.rules.some((r) => r.id === 'commands'));
  assert.ok(none.combos.every((k) => !k.rules.includes('commands')));
  const has = makeState({ all, cfg, det: detect(repo(pkg({ test: 'jest' }))) }, 'ko');
  assert.equal(has.rules[0].id, 'commands');
  assert.ok(has.combos.every((k) => k.rules.includes('commands')), '모든 조합 기본 켜짐');
  assert.ok(has.ruleTokens.commands > 0);
  assert.deepEqual(has.ruleHooks, ruleHookTags('ko'));
});

test('훅마다 종류(block·notice·ask)가 있고, 알리기만 하는 훅은 notice, 묻는 훅은 ask', () => {
  for (const h of all.packs.hooks) assert.ok(['block', 'notice', 'ask'].includes(h.kind), `${h.id}: kind`);
  assert.deepEqual(all.packs.hooks.filter((h) => h.kind === 'ask').map((h) => h.id), ['ask-cmd']);
  assert.deepEqual(all.packs.hooks.filter((h) => h.kind === 'notice').map((h) => h.id).sort(), ['answer-lang', 'commit-hash', 'prefer-gh', 'stale-scratch', 'work-checklist']);
});

test('「차단하는 것만」: 막는 훅만, 이 저장소에 맞는 것만', () => {
  const S = makeState({ all, cfg, det: detect(repo({ 'pyproject.toml': '[project]\nname = "x"\n' })) }, 'ko');
  const sel = { flow: 'none', share: false };
  const on = blockingHooks(S, sel);
  const kind = Object.fromEntries(S.hooks.map((h) => [h.id, h.kind]));
  for (const id of on) assert.equal(kind[id], 'block', id);
  for (const id of ['secrets', 'danger-cmd', 'commit-msg', 'python-unsafe']) assert.ok(on.has(id), id);
  for (const id of ['commit-hash', 'work-checklist', 'answer-lang']) assert.ok(!on.has(id), `알림 훅 ${id}`);
  assert.ok(!on.has('swift-unsafe'), '다른 스택 전용 훅');
  for (const id of ['squash-push', 'docs-check']) assert.ok(!on.has(id), `어느 조합도 기본으로 켜지 않는 훅 ${id}`);
  for (const id of ['protect-branch', 'branch-name', 'pr-merge']) assert.ok(!on.has(id), `브랜치 전략 「정하지 않음」이 끄는 ${id}`);
  assert.ok(blockingHooks(S, { flow: 'github-flow', share: false }).has('pr-merge'));
});

// 영어 단·복수: 수가 든 문구마다 0·1·2 를 넣어 「1 instructions」·「2 instruction」 같은 꼴이 없는지 본다
const NOUNS = ['skill', 'hook', 'instruction', 'line', 'token', 'file', 'item', 'setting', 'repositor(?:y|ie)', 'star'];
test('영어 수 문구는 0·1·2 에서 단·복수가 맞다(한국어는 그대로)', () => {
  const en = readStrings('en');
  const ko = readStrings('ko');
  const noun = `(?:${NOUNS.join('|')})`;
  let checked = 0;
  for (const [key, text] of Object.entries(en)) {
    const vars = [...new Set([...text.matchAll(/\{(\w+)[}|]/g)].map((m) => m[1]))];
    if (!vars.length || !new RegExp(`\\{\\w+[}|][^{]*?\\b${noun}`, 'i').test(text) && !text.includes('|')) continue;
    // 수 자리: 단·복수 꼴({n|…}) 이 있거나 바로 뒤에 셀 낱말이 오는 것. 나머지(이름·목록)는 글자
    const counted = new Set(vars.filter((v) => text.includes(`{${v}|`) || new RegExp(`\\{${v}\\} (?:\\w+ ){0,3}?${noun}s\\b`, 'i').test(text)));
    for (const n of [0, 1, 2]) {
      const out = fmt(text, Object.fromEntries(vars.map((v) => [v, counted.has(v) ? n : 'Acme'])), 'en');
      assert.doesNotMatch(out, /[{}|]/, `${key}: 자리표시가 남음 — ${out}`);
      if (n === 1) assert.doesNotMatch(out, new RegExp(`\\b1 (?:\\w+ ){0,3}?${noun}s\\b`, 'i'), `${key}(1): ${out}`);
      else assert.doesNotMatch(out, new RegExp(`\\b${n} (?:\\w+ ){0,3}?${noun}(?!s|ies)\\b(?! ${noun})`, 'i'), `${key}(${n}): ${out}`);
    }
    checked++;
  }
  assert.ok(checked >= 30, `수 문구 ${checked}개`);
  for (const text of Object.values(ko)) assert.doesNotMatch(text, /\{\w+\|/, '한국어는 단·복수 꼴을 쓰지 않는다');
  assert.equal(fmt('{n} {n|instruction|instructions}', { n: 1 }, 'en'), '1 instruction');
  assert.equal(fmt('{n} {n|instruction|instructions}', { n: '1,234' }, 'en'), '1,234 instructions');
  assert.equal(fmt('{n} {n|instruction|instructions}', { n: 0 }, 'en'), '0 instructions');
  assert.equal(fmt('지침 {n}개', { n: 1 }, 'ko'), '지침 1개');
});

// fastlane 출시·서명 판정(scripts/lib/fastlane.mjs — 「이 저장소 명령」에서 빼는 기준). 검토 2026-11-13
test('fastlane: 출시 레인·올리기 동작·readonly 없는 match 만 출시·서명, 시험·빌드·준비·읽기 전용 받기는 아니다', async () => {
  const { releaseFastlane, shipLane } = await import('../lib/fastlane.mjs');
  for (const l of ['fastlane beta', 'bundle exec fastlane ios release', 'fastlane upload_testflight', 'fastlane beta_testflight', 'fastlane deliver --force', 'fastlane run pilot',
    'fastlane match', 'fastlane match appstore', 'fastlane match nuke development --readonly', 'fastlane sigh', 'cd ios && fastlane android deploy']) {
    assert.ok(releaseFastlane(l), `출시·서명이어야: ${l}`);
  }
  for (const l of ['fastlane unit_tests', 'fastlane setup_tools', 'fastlane gym', 'fastlane match development --readonly', 'fastlane ios test',
    'fastlane release_notes', 'fastlane screenshots', 'fastlane scan', 'echo fastlane-beta', 'xcodebuild test', 'fastlane certs']) {
    assert.ok(!releaseFastlane(l), `평소 명령이어야: ${l}`);
  }
  // Fastfile 본문을 알면 레인 이름이 평범해도 본문으로(문자열·주석 속 낱말은 동작이 아니다)
  const lanes = new Map([['certs', 'match(type: "", readonly: true)\n'], ['signing', 'match(type: "")\n'], ['test', 'run_tests(scheme: "")\n'], ['nightly', 'upload_to_testflight\n']]);
  assert.deepEqual(['certs', 'signing', 'test', 'nightly'].map((n) => releaseFastlane(`fastlane ${n}`, lanes)), [false, true, false, true]);
  assert.deepEqual(['beta', 'beta_lint', 'release_notes', 'internal_build'].map(shipLane), [true, false, false, true]);
  // 디버그 기호 올리기는 출시가 아니다 — 「이 저장소 명령」에 남고 묻지도 않는다(독립 검토 2026-11-13)
  assert.deepEqual(['upload_symbols', 'upload_dsyms', 'upload_symbols_to_crashlytics', 'upload_testflight'].map(shipLane), [false, false, false, true]);
  assert.equal(releaseFastlane('fastlane ios upload_symbols', new Map([['upload_symbols', 'upload_symbols_to_crashlytics(dsym_path: "")\n']])), false);
});

// 검토 2026-11-13: 묻는 명령(suggest.mjs)도 같은 판정을 쓰게 하면서 — 다른 레인을 부르는 레인, 플랫폼 낱말, private_lane
test('fastlane: 출시 레인을 부르는 레인도 출시, private_lane 은 명령줄 레인 목록에서 뺀다', async () => {
  const { releaseFastlane, laneShips, shipLanes, readFastlane } = await import('../lib/fastlane.mjs');
  const lanes = new Map([['ship', 'build_app\nupload_to_testflight\n'], ['nightly', 'ship\n'], ['loop_a', 'loop_b\n'], ['loop_b', 'loop_a\n'], ['build', 'build_app\n'], ['ci', 'build\nrun_tests\n']]);
  assert.deepEqual(['ship', 'nightly', 'loop_a', 'build', 'ci'].map((n) => laneShips(n, lanes)), [true, true, false, false, false], '서로 부르는 레인도 끝난다');
  for (const l of ['bundle exec fastlane ios ship', 'fastlane android nightly', 'cd ios && bundle exec fastlane mac ship']) assert.ok(releaseFastlane(l, lanes), l);
  for (const l of ['fastlane ios ci', 'fastlane ship', 'echo fastlane-ship']) assert.equal(releaseFastlane(l, l === 'fastlane ship' ? new Map() : lanes), false, l);
  const root = writeFiles(tmpDir('harness-fl-'), { 'fastlane/Fastfile': 'platform :ios do\n  private_lane :keys do\n    upload_to_testflight\n  end\n  lane :test do\n  end\n  lane :ship do\n    keys\n  end\nend\n' });
  const fl = readFastlane(root);
  assert.deepEqual([fl.at, [...fl.privates]], ['fastlane/Fastfile', ['keys']]);
  assert.deepEqual(shipLanes(fl), ['ship'], 'private 레인은 부르는 레인을 통해서만');
});

test('겹침 확인: 이 저장소 종류에 들어가지 않을 줄(로그인·정확한 버전)은 보이지 않는다 — 번호는 그대로', () => {
  const fe = ruleLines('ko', ['security'], {}, ['web', 'html', 'js']).security;
  const be = ruleLines('ko', ['security'], {}, ['backend', 'general']).security;
  assert.ok(!fe.some((l) => /로그인/.test(l.text)), '프론트엔드에 로그인 줄이 보임');
  assert.ok(!fe.some((l) => /정확한 버전/.test(l.text)), '고정하지 않는 저장소에 정확한 버전 줄이 보임');
  assert.ok(be.some((l) => /로그인/.test(l.text)), '서버 저장소에 로그인 줄이 없음');
  const login = be.find((l) => /로그인/.test(l.text));
  const all = ruleLines('ko', ['security'], {}).security.find((l) => /로그인/.test(l.text));
  assert.equal(login.n, all.n, '번호가 바뀜');
});
