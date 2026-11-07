// 이 저장소 명령(CLAUDE.md 지침 「이 저장소 명령」), 뺀 줄 보기·줄을 대신 맡는 훅, 훅 종류(차단·알림), 영어 단·복수.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectCommands } from '../lib/commands.mjs';
import { renderRule, ruleTexts, ruleDropped, ruleHookTags, START, END } from '../lib/claude-md.mjs';
import { loadAll, PLUGIN_ROOT } from '../lib/catalog.mjs';
import { makeState, readStrings } from '../lib/picker-state.mjs';
import { detect } from '../detect.mjs';
import { ruleLines } from '../overlap.mjs';
import { fmt } from '../../picker/dom.js';
import { blockingHooks } from '../../picker/stats.js';

const all = loadAll();
const cfg = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'config', 'picker.json'), 'utf8'));
const repo = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-cmd-'));
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), typeof text === 'string' ? text : JSON.stringify(text));
  }
  return dir;
};
const cmds = (files) => detectCommands(repo(files)).commands;
const pkg = (scripts, extra = {}) => ({ 'package.json': { name: 'x', scripts, ...extra } });

test('package.json: npm 이 기본, 자리표시 test 는 명령이 아니다', () => {
  assert.deepEqual(cmds(pkg({ test: 'vitest run', lint: 'eslint .', typecheck: 'tsc --noEmit', format: 'prettier -w .', build: 'vite build', dev: 'vite' })),
    { test: ['npm test'], testOne: ['npx vitest run <file>'], lint: ['npm run lint'], typecheck: ['npm run typecheck'], format: ['npm run format'], build: ['npm run build'] });
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
    { test: ['make test'], lint: ['make lint'], format: ['make fmt'], build: ['make build'] });
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
  assert.match(renderRule('commands', 'ko', [], [], [], c), /\n- 시험 하나만: `npx vitest run <파일>` · `go test -run <이름> \.\/\.\.\.`$/);
  assert.match(renderRule('commands', 'en', [], [], [], c), /\n- One test only: `npx vitest run <file>` · `go test -run <name> \.\/\.\.\.`/);
  assert.doesNotMatch(renderRule('commands', 'ko', [], [], [], { test: ['npm test'] }), /하나만/, '모르면 줄을 넣지 않는다');
});

test('여러 생태계가 있으면 한 줄에 함께(종류마다 3개까지), 빈 저장소는 없음', () => {
  assert.deepEqual(cmds({ ...pkg({ test: 'jest' }), Makefile: 'test:\n', 'go.mod': 'module x\n' }).test, ['npm test', 'make test', 'go test ./...']);
  assert.deepEqual(cmds({}), {});
});

test('사용자 CLAUDE.md 에 이미 적힌 명령은 뺀다(harness-fit 구역 안은 사용자 글이 아니다)', () => {
  const dir = repo({ ...pkg({ test: 'jest', build: 'tsc' }), 'CLAUDE.md': `# x\n- 시험은 \`npm test\` 로\n\n${START}\n- 빌드: \`npm run build\`\n${END}\n` });
  assert.deepEqual(detectCommands(dir), { commands: { testOne: ['npx jest <file>'], build: ['npm run build'] }, listed: ['npm test'] });
  assert.deepEqual(detect(dir).commands, { testOne: ['npx jest <file>'], build: ['npm run build'] }, 'detect 가 싣는다');
});

test('이 저장소 명령 글: 찾은 종류만, 시험 줄에 끝내기 전 안내, 명령이 없으면 통째로 뺀다', () => {
  const c = { test: ['npm test'], build: ['npm run build', 'make build'] };
  assert.equal(renderRule('commands', 'ko', [], [], [], c), '## 이 저장소 명령\n- 시험: `npm test` — 코드를 고쳤으면 끝내기 전에 돌린다.\n- 빌드: `npm run build` · `make build`');
  assert.match(renderRule('commands', 'en', [], [], [], c), /^## Commands in this repo\n- Test: `npm test` — run it before finishing/);
  assert.equal(renderRule('commands', 'ko', [], [], [], {}), '');
  assert.doesNotMatch(renderRule('commands', 'ko', [], [], [], c), /\{\{/, '표시는 남지 않는다');
  const texts = ruleTexts({ lang: 'ko', flow: 'github-flow', rules: ['lean', 'commands'], hooks: [], commands: c });
  assert.deepEqual(Object.keys(texts), ['commands', 'github-flow', 'lean'], '명령이 맨 위');
  assert.deepEqual(Object.keys(ruleTexts({ lang: 'ko', flow: 'none', rules: ['commands', 'lean'], hooks: [] })), ['lean']);
  // overlap.mjs 의 줄 번호(--skip commands:<n>)는 파일 순서 그대로
  assert.deepEqual(ruleLines('ko', ['commands'], c).commands.map((l) => l.n), [1, 6]);
  assert.equal(renderRule('commands', 'ko', [], [6], [], c), '## 이 저장소 명령\n- 시험: `npm test` — 코드를 고쳤으면 끝내기 전에 돌린다.');
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

test('훅마다 종류(block·notice)가 있고, 알리기만 하는 훅은 notice', () => {
  for (const h of all.packs.hooks) assert.ok(['block', 'notice'].includes(h.kind), `${h.id}: kind`);
  assert.deepEqual(all.packs.hooks.filter((h) => h.kind === 'notice').map((h) => h.id).sort(), ['answer-lang', 'commit-hash', 'work-checklist']);
});

test('「차단하는 것만」: 막는 훅만, 이 저장소에 맞는 것만', () => {
  const S = makeState({ all, cfg, det: detect(repo({ 'pyproject.toml': '[project]\nname = "x"\n' })) }, 'ko');
  const sel = { flow: 'none', share: false };
  const on = blockingHooks(S, sel);
  const kind = Object.fromEntries(S.hooks.map((h) => [h.id, h.kind]));
  for (const id of on) assert.equal(kind[id], 'block', id);
  for (const id of ['secrets', 'danger-cmd', 'commit-msg', 'docs-check', 'python-unsafe']) assert.ok(on.has(id), id);
  for (const id of ['commit-hash', 'work-checklist', 'answer-lang']) assert.ok(!on.has(id), `알림 훅 ${id}`);
  assert.ok(!on.has('swift-unsafe'), '다른 스택 전용 훅');
  assert.ok(!on.has('squash-push'), '어느 조합도 기본으로 켜지 않는 훅');
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
