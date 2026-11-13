// 이 저장소의 시험·검사·타입 검사·형식·빌드 명령을 저장소 파일에서 읽는다(CLAUDE.md 지침 「이 저장소 명령」 — rules/commands.*.md).
// 파일에 실제로 있는 것만 낸다(지어내지 않음): package.json scripts(잠금 파일로 패키지 관리자를 고름), Makefile 대상,
// pyproject(tox·hatch 스크립트·pytest·ruff·mypy), Cargo, go.mod, 맨 뒤 차례로 README·CI 의 명령(doc-commands.mjs). 사용자가 쓴 CLAUDE.md 에 이미 적힌 명령은 뺀다.
import fs from 'node:fs';
import path from 'node:path';
import { setBlock } from './claude-md.mjs';
import { userRulesText } from './user-rules.mjs';
import { rosPackages } from './stack-scan.mjs';
import { makefileText, makeTargets, makeVars, makeRules, recipeOf, expandVars } from './makefile.mjs';
import { releaseFastlane, fastlaneLanes, readFastlane } from './fastlane.mjs';
import { docCommands } from './doc-commands.mjs';

// testOne: 시험 파일(또는 이름) 하나만 돌리는 명령. 자리표시 `<file>`·`<name>` 은 지침 글이 그 언어 말로 바꾼다.
// tools: 이 저장소가 설치해 쓰게 하는 명령(pyproject [project.scripts]·[tool.poetry.scripts] — 평가·수집 명령이 빠지던 일, 역할극 4 회차 2차)
export const COMMAND_KINDS = ['test', 'testOne', 'lint', 'typecheck', 'format', 'build', 'tools'];
const MAX_TOOLS = 10; // 설치 명령·manage.py·Procfile·make 대상은 한 줄에 조금 더(8 → 10: dbt·마이그레이션 대상이 서버 띄우기·실행을 밀어냈다, 역할극 10·14, 2026-11-13)
const MAX_PER_KIND = 3; // 한 줄에 너무 많이 늘어놓지 않게(모노레포 등)
const MAX_READ = 512 * 1024; // 설정 파일은 이 정도면 충분하다(더 크면 앞부분만)

const readText = (f) => {
  try {
    const fd = fs.openSync(f, 'r');
    try {
      const buf = Buffer.alloc(Math.min(fs.fstatSync(fd).size, MAX_READ));
      fs.readSync(fd, buf, 0, buf.length, 0);
      return buf.toString('utf8').replace(/^﻿/, '');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
};

// package.json 스크립트 이름 → 종류. 앞에 있는 이름이 먼저.
const SCRIPT_NAMES = {
  test: ['test'], lint: ['lint'], typecheck: ['typecheck', 'type-check', 'check-types', 'types', 'tsc'], format: ['format', 'fmt'], build: ['build'],
};
// npm init 이 넣는 자리표시 test 스크립트는 명령이 아니다
const PLACEHOLDER_TEST = /no test specified/i;

// 패키지 관리자: package.json 의 packageManager → 잠금 파일 → npm
const packageManager = (pkg, has) => {
  const pm = String(pkg.packageManager || '').split('@')[0];
  if (['pnpm', 'yarn', 'bun', 'npm'].includes(pm)) return pm;
  if (has('pnpm-lock.yaml')) return 'pnpm';
  if (has('yarn.lock')) return 'yarn';
  if (has('bun.lockb') || has('bun.lock')) return 'bun';
  return 'npm';
};
// `bun test` 는 스크립트가 아니라 bun 의 시험 도구라 bun 은 늘 `bun run`
const runScript = (pm, name) => {
  if (pm === 'npm') return name === 'test' ? 'npm test' : `npm run ${name}`;
  if (pm === 'bun') return `bun run ${name}`;
  return name === 'test' ? `${pm} test` : `${pm} run ${name}`;
};

// 시험 하나만: test 스크립트가 시험 도구 하나를 그대로 부를 때만 안다(&&·파이프·환경 변수 앞붙이·설정 경로 옵션이 있으면 모른다 —
// 도구를 바로 부르면 그 옵션이 빠져 다르게 돌 수 있다). 각 도구 문서의 「파일 하나」 꼴:
//   vitest run <파일 이름 거르기>(vitest.dev/guide/cli) · jest <경로 꼴>(jestjs.io/docs/cli) · playwright test <파일>(playwright.dev/docs/running-tests)
//   bun test ./<경로>(bun.sh/docs/cli/test) · node --test <파일>(nodejs.org/api/test.html).
//   mocha 는 뺐다 — 명령줄 파일이 .mocharc 의 spec 에 더해져 다른 시험도 함께 돈다(mochajs.org/running/configuring, 2026-11-07 확인).
const EXEC = { npm: 'npx', pnpm: 'pnpm exec', yarn: 'yarn', bun: 'bunx' };
const CONFIG_FLAG = /^(?:-c|--config|--root|--rootDir|--dir|--project|--projects|--workspace|--selectProjects)(?:=|$)/;
const testOneJs = (pm, script) => {
  const s = String(script || '').trim();
  if (!s || /[&|;<>`$()'"]/.test(s)) return null;
  const [a, b, ...rest] = s.split(/\s+/);
  if ([b, ...rest].some((x) => x && CONFIG_FLAG.test(x))) return null;
  const x = EXEC[pm];
  if (a === 'vitest' && !['bench', 'watch', 'dev', 'list', 'related', 'init'].includes(b)) return `${x} vitest run <file>`;
  if (a === 'jest') return `${x} jest <file>`;
  if (a === 'playwright' && b === 'test') return `${x} playwright test <file>`;
  if (a === 'bun' && b === 'test') return 'bun test ./<file>'; // ./ 없이 주면 파일이 아니라 이름 거르기로 읽는다
  if (a === 'node' && b === '--test' && rest.every((r) => !r.startsWith('-'))) return 'node --test <file>';
  return null;
};

const fromPackageJson = (root, has) => {
  let pkg;
  try {
    pkg = JSON.parse(readText(path.join(root, 'package.json')));
  } catch {
    return {};
  }
  const scripts = pkg && typeof pkg.scripts === 'object' && pkg.scripts ? pkg.scripts : {};
  const pm = packageManager(pkg, has);
  const out = {};
  for (const kind of COMMAND_KINDS) {
    if (!SCRIPT_NAMES[kind]) continue;
    const name = SCRIPT_NAMES[kind].find((n) => typeof scripts[n] === 'string' && scripts[n].trim() && !(n === 'test' && PLACEHOLDER_TEST.test(scripts[n])));
    if (name) out[kind] = [runScript(pm, name)];
  }
  const one = out.test ? testOneJs(pm, scripts.test) : null;
  if (one) out.testOne = [one];
  // 그 밖에 자주 쓰는 스크립트(dev·e2e·storybook — 역할극 13 회차: 「이 저장소 명령」에 빠졌다). 배포·운영 꼴(deploy·release…)은 적지 않는다
  const EXTRA = /^(?:dev|start|preview|e2e|test:e2e|e2e:ui|storybook|test:watch|db:migrate|db:generate|generate|codegen)$/;
  const extra = Object.keys(scripts).filter((n) => EXTRA.test(n) && typeof scripts[n] === 'string' && scripts[n].trim());
  if (extra.length) out.tools = extra.map((n) => runScript(pm, n));
  // Playwright 브라우저 받기 — 새로 clone 한 PC 에서 e2e 가 「브라우저 없음」으로 멈춘다(역할극 13 회차 M8, 2026-11-13). 그 패키지 관리자의 실행 꼴로
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  if (deps['@playwright/test'] || deps.playwright) out.tools = [...(out.tools || []), `${EXEC[pm]} playwright install`];
  return out;
};

// Makefile 대상(`test:` 꼴, 변수 대입 `x := …` 는 빼고)
const MAKE_NAMES = { test: ['test'], lint: ['lint'], typecheck: ['typecheck'], format: ['format', 'fmt'], build: ['build'] };
// 마이그레이션을 되돌리는 대상(migrate-down·db-rollback·migration-reset) — 데이터를 지운다(역할극 14 화면 평가, 2026-11-12). suggest.mjs 가 묻는 명령으로 넣는다
export const migrateBack = (t) => { const w = t.toLowerCase().split(/[-_.:]/); return w.some((x) => /^(?:migrate|migrations?|db|schema)$/.test(x)) && w.some((x) => /^(?:down|rollback|reset|drop|undo|redo)$/.test(x)); };
// 읽기만 하거나 시험으로 돌리는 꼴은 운영 낱말이 있어도 쓸 명령이다(make plan-prod·backfill-dry — 역할극 10·15 회차 다시, 2026-11-13).
// 맨 앞 마디가 plan·check… 이거나 어느 마디가 dry 일 때. 맨 앞이 apply 인 apply-plan, 시험 환경에 올리는 test-deploy 는 그대로 운영 쪽
const READ_FIRST = /^(?:plan|check|validate|lint|diff|template|verify)$/;
const readOnly = (w) => READ_FIRST.test(w[0]) || w.some((x) => /^dry(?:run)?$/.test(x));
// 이름에 운영 낱말이 없어도 레시피가 배포·서명을 하면 적지 않는다: fastlane 출시 레인·올리기 동작·readonly 없는 match(fastlane.mjs — 묻는 명령과 같은 기준),
// 앱 올리기·공증·버전 올리기(역할극 16 회차: make beta 가 평소 명령으로 들어갔다, 2026-11-13).
// 시험·빌드·준비 레인(unit_tests·gym·setup_tools·match --readonly)은 남긴다 — 처음엔 낱말 몇 개만 남겨 이것들이 다 빠졌다(검토 2026-11-13)
const RELEASE_RECIPE = /\bxcrun\s+(?:altool|notarytool)\b|\bagvtool\s+new/;
const fromMakefile = (text, recipe = () => [], lanes = new Map()) => {
  const targets = new Set(makeTargets(text));
  const out = {};
  for (const kind of COMMAND_KINDS) {
    const name = MAKE_NAMES[kind]?.find((n) => targets.has(n)); // make 대상 하나만 돌리는 꼴은 Makefile 마다 달라 모른다
    if (name) out[kind] = [`make ${name}`];
  }
  // 그 밖의 대상(test-all·train-sample·eval — 역할극 7 회차 다시)은 「그 밖의 명령」 줄에. 설치·청소·도움말 같은 흔한 잡일은 뺀다
  const used = new Set(Object.values(MAKE_NAMES).flat());
  const CHORE = /^(?:all|help|clean|install|setup|deps|init|default|phony|venv|dev-deps|distclean|fmt-check)$/;
  // 운영에 닿거나 지우는 대상(deploy·release·push·rollback·prod·reset·drop·destroy·backfill·upload)은 「쓸 명령」으로 적지 않는다 — Claude 에게 쓸 명령으로 알리지 않으려고. 원격에 닿는 레시피만 묻는 명령(suggest.mjs)에 들어간다(검토 2026-11-11)
  // 낱말(- · _ 로 나눈 마디) 단위로 — reproduce·presets·dropout-sweep 이 걸리던 일(검토 2026-11-11). prod·push 는 끝 마디일 때만(deploy-prod·docker-push, test-prod-config·push-notif-test 는 아님)
  // migrate·seed 는 로컬 개발에도 쓰여(make migrate-new·seed-dev) 빼지 않는다 — 운영은 끝 마디 prod 가 거른다(검토 2026-11-11)
  const RISKY_WORD = new Set(['deploy', 'release', 'publish', 'rollback', 'destroy', 'backfill', 'upload', 'reset', 'drop', 'restore', 'apply', 'rollout', 'promote', 'ship']);
  const risky = (t) => {
    const w = t.toLowerCase().split(/[-_]/);
    if (migrateBack(t)) return true;
    if (readOnly(w)) return false;
    return w.some((x) => RISKY_WORD.has(x)) || /^(?:prod|production|push)$/.test(w.at(-1)) || recipe(t).some((l) => RELEASE_RECIPE.test(l) || releaseFastlane(l, lanes));
  };
  const rest = [...targets].filter((t) => !used.has(t) && !CHORE.test(t) && !risky(t));
  if (rest.length) out.toolsLate = rest.map((t) => `make ${t}`); // 설치 명령·manage.py 뒤에(자리가 모자라면 이것부터 빠진다)
  return out;
};

// pyproject.toml 의 표 머리([tool.x])와 그 아래 키. 이 정도만 읽는다(값은 보지 않음).
const tomlTables = (text) => {
  const tables = new Map();
  let cur = '';
  tables.set(cur, new Set());
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const head = line.match(/^\[\s*([^\][]+?)\s*\]$/);
    if (head) {
      cur = head[1].replace(/\s+/g, '').replace(/"/g, '');
      if (!tables.has(cur)) tables.set(cur, new Set());
      continue;
    }
    const key = line.match(/^"?([\w.-]+)"?\s*=/);
    if (key) tables.get(cur).add(key[1]);
  }
  return tables;
};

const fromPython = (root, has) => {
  const py = readText(path.join(root, 'pyproject.toml'));
  if (!py && !['setup.py', 'setup.cfg', 'tox.ini', 'pytest.ini', 'conftest.py', 'requirements.txt'].some(has)) return {};
  const tables = tomlTables(py);
  const hasTable = (name) => [...tables.keys()].some((k) => k === name || k.startsWith(`${name}.`));
  // 잠금 파일이 있으면 그 도구로 돌린다(가상 환경 밖에서 그냥 pytest 를 부르면 다른 판이 돈다)
  const prefix = has('uv.lock') ? 'uv run ' : has('poetry.lock') ? 'poetry run ' : has('pdm.lock') ? 'pdm run ' : '';
  const out = {};
  const put = (kind, cmd) => (out[kind] ||= []).push(cmd);
  // hatch 스크립트: [tool.hatch.envs.<env>.scripts] 의 키. default 환경은 `hatch run <이름>`, 다른 환경은 `hatch run <env>:<이름>`
  const hatch = {};
  for (const [name, keys] of tables) {
    const m = name.match(/^tool\.hatch\.envs\.([\w-]+)\.scripts$/);
    if (m) for (const k of keys) hatch[k] ??= m[1] === 'default' ? `hatch run ${k}` : `hatch run ${m[1]}:${k}`;
  }
  const hatchOf = (names) => names.map((n) => hatch[n]).find(Boolean);
  const pytest = hasTable('tool.pytest') || has('pytest.ini') || has('conftest.py') || /\[tool:pytest\]/.test(readText(path.join(root, 'setup.cfg')))
    || /^\s*["']?pytest\b/m.test(py) || /["']pytest\b/.test(py) || /^pytest\b/im.test(readText(path.join(root, 'requirements-dev.txt')) + readText(path.join(root, 'requirements.txt')));
  const test = hatchOf(['test', 'tests']) || (has('tox.ini') || hasTable('tool.tox') ? 'tox' : pytest ? `${prefix}pytest` : null);
  if (test) put('test', test);
  // 시험 하나만은 pytest 를 바로 부를 때만(docs.pytest.org 「Specifying which tests to run」). tox·hatch 는 환경·인자 넘기는 꼴이 설정마다 달라 모른다
  if (test === `${prefix}pytest`) put('testOne', `${prefix}pytest <file>`);
  const ruff = hasTable('tool.ruff') || has('ruff.toml') || has('.ruff.toml');
  const lint = hatchOf(['lint']) || (ruff ? `${prefix}ruff check .` : null);
  if (lint) put('lint', lint);
  const typecheck = hatchOf(['typecheck', 'types']) || (hasTable('tool.mypy') || has('mypy.ini') ? `${prefix}mypy .` : null);
  if (typecheck) put('typecheck', typecheck);
  const format = hatchOf(['format', 'fmt']) || (hasTable('tool.ruff.format') ? `${prefix}ruff format .` : null);
  if (format) put('format', format);
  const build = hatchOf(['build']);
  if (build) put('build', build);
  for (const t of ['project.scripts', 'project.gui-scripts', 'tool.poetry.scripts']) for (const k of tables.get(t) || []) put('tools', `${prefix}${k}`);
  return out;
};

// CI 설정 글(GitHub Actions 워크플로·.gitlab-ci.yml) — 팀이 CI 에서 돌리는 옵션을 따르려고
const ciText = (root) => {
  const dir = path.join(root, '.github', 'workflows');
  let flows = [];
  try {
    flows = fs.readdirSync(dir).filter((f) => /\.ya?ml$/i.test(f)).slice(0, 20).map((f) => path.join(dir, f));
  } catch {}
  return [...flows, path.join(root, '.gitlab-ci.yml')].map(readText).join('\n');
};
// CI·Makefile 에 적힌 cargo <하위 명령> 의 옵션 가운데 범위·검사 강도를 정하는 것만(-p 로 한 패키지만 도는 꼴·출력 옵션은 따르지 않는다).
// -- 뒤의 lint 수준(-D warnings)은 clippy 만. 없으면 null
const CARGO_FLAG = /^--(?:workspace|all|all-targets|all-features|locked)$/;
const cargoFlags = (text, sub) => {
  const re = new RegExp(`(?:^|[\\s;&|(])cargo\\s+(?:\\+\\S+\\s+)?${sub}(?=\\s|$)([^#\\n]*)`);
  for (const line of text.split(/\r?\n/)) {
    const m = re.exec(line);
    if (!m) continue;
    const [before, after = ''] = m[1].split(/\s--(?:\s|$)/);
    const words = after.trim().split(/\s+/);
    const lints = words.flatMap((w, i) => (/^-[DWF]$/.test(w) && /^[\w:-]+$/.test(words[i + 1] || '') ? [`${w} ${words[i + 1]}`] : /^-[DWF][\w:-]+$/.test(w) ? [w] : []));
    return { flags: before.trim().split(/\s+/).filter((w) => CARGO_FLAG.test(w)), lints };
  }
  return null;
};
// Cargo: 시험·빌드는 늘 있다. clippy·rustfmt 는 설정 파일이 있거나 CI 가 돌릴 때만(쓰기로 한 저장소).
// 옵션은 CI·Makefile 과 같게 — 워크스페이스인데 cargo test 만, clippy 는 -D warnings 없이 적어 CI 에서만 깨지던 일(역할극 11 회차, 2026-11-13).
// 그 하위 명령이 CI 에 없으면 다른 cargo 줄의 --workspace 를 따른다(워크스페이스 전체가 기준인 저장소)
const fromCargo = (root, has, makeText = '') => {
  if (!has('Cargo.toml')) return {};
  const text = `${ciText(root)}\n${makeText}`;
  const found = Object.fromEntries(['test', 'build', 'clippy', 'fmt'].map((s) => [s, cargoFlags(text, s)]));
  const ws = Object.values(found).some((f) => f?.flags.some((x) => x === '--workspace' || x === '--all')) && /^\s*\[workspace\]/m.test(readText(path.join(root, 'Cargo.toml')));
  const cmd = (sub, extra = '') => {
    const f = found[sub];
    const flags = f ? f.flags.filter((x) => sub !== 'fmt' || x === '--all') : ws && sub !== 'fmt' ? ['--workspace'] : [];
    const lints = sub === 'clippy' && f?.lints.length ? ['--', ...f.lints] : [];
    return ['cargo', sub, ...flags, ...(extra ? [extra] : []), ...lints].join(' ');
  };
  return {
    // cargo test <이름> 은 이름에 그 글이 든 시험만 돈다(doc.rust-lang.org/cargo/commands/cargo-test.html)
    test: [cmd('test')], testOne: [cmd('test', '<name>')], build: [cmd('build')],
    ...(has('clippy.toml') || has('.clippy.toml') || found.clippy ? { lint: [cmd('clippy')] } : {}),
    ...(has('rustfmt.toml') || has('.rustfmt.toml') || found.fmt ? { format: [cmd('fmt')] } : {}),
  };
};

// Go: 시험·빌드·vet 은 go 에 들어 있다. golangci-lint 설정이 있으면 그것을 검사로
// testRecipe: Makefile test 대상의 레시피 줄(변수를 값으로 바꾼 것)
const fromGo = (has, testRecipe = []) => {
  if (!has('go.mod')) return {};
  const golangci = ['.golangci.yml', '.golangci.yaml', '.golangci.toml', '.golangci.json'].some(has);
  // -run 은 시험 이름 정규식(pkg.go.dev/cmd/go 「Testing flags」). go test <파일>.go 는 같은 패키지 파일이 빠져 깨지므로 쓰지 않는다.
  // Makefile 의 test 레시피가 go test -race -count=1 이면 하나만 돌릴 때도 같은 옵션으로(역할극 14 회차: -race 가 빠졌다, 2026-11-12).
  // 앞에 환경 변수가 붙거나(CGO_ENABLED=1 go test) $(GO) test 꼴도(검토 2026-11-12)
  const flags = testRecipe.map((l) => { const m = GO_TEST.exec(l); return m?.[1] || m?.[2]; }).find(Boolean)?.split(/\s+/).filter((f) => GO_TEST_FLAG.test(f)) || [];
  return { test: ['go test ./...'], testOne: [['go test', ...flags, '-run <name> ./...'].join(' ')], lint: [golangci ? 'golangci-lint run' : 'go vet ./...'], build: ['go build ./...'] };
};
// go test … · /usr/local/go/bin/go test … · $(GO) test … · gotestsum … -- -race …(검토 2026-11-12)
const GO_TEST = /(?:^|[\s;&|(])(?:(?:\S*\/)?go|\$[({]GO[)}])\s+test\s+(.*)$|(?:^|[\s;&|(])gotestsum\b.*?\s--\s+(.*)$/;
// 하나만 돌릴 때도 따를 go test 옵션(결과를 바꾸는 것만 — -coverprofile·-v 같은 출력 옵션은 아님)
const GO_TEST_FLAG = /^-(?:race|short|count=\d+|tags=[\w,.-]+|timeout=\w+|p=\d+|shuffle=\w+)$/;
// 언어 기본값을 Makefile 대상이 대신 맡았는지 — 레시피가 그 언어 도구를 부를 때만(build: 가 docker build 면 go build ./... 는 남긴다 — 검토 2026-11-12)
// go 쪽은 경로로 부른 go·gotestsum·golangci-lint 도(make lint 가 golangci-lint 면 golangci-lint run 을 따로 내지 않는다)
const LANG_TOOL = {
  go: /(?:^|[\s;&|(])(?:(?:\S*\/)?go|\$[({]GO[)}]|gotestsum|golangci-lint|staticcheck)\s/,
  cargo: /(?:^|[\s;&|(])(?:(?:\S*\/)?cargo|\$[({]CARGO[)}]|cargo-nextest|clippy-driver)\s/,
};

// ROS 2 colcon 워크스페이스: src/<패키지>/package.xml 이 ament 로 빌드하면. 시험은 빌드한 뒤라 둘을 함께,
// 하나만은 --packages-select(docs.ros.org colcon 튜토리얼). 역할극 2 회차에서 명령이 하나도 안 들어갔다(2026-11-11).
// 패키지 찾기는 detect 와 같은 함수(stack-scan.mjs rosPackages — 맨 위·맨 위 하위·src/*·src/*/*, 개수 상한).
// colcon test 는 실패해도 0 을 돌려주므로 결과는 test-result 로 본다. 하나만도 빌드 → 시험 → 결과(검토 2026-11-11).
const fromColcon = (root) => {
  if (!rosPackages(root).length) return {};
  return {
    test: ['colcon build && colcon test && colcon test-result --verbose'],
    testOne: ['colcon build --packages-select <pkg> && colcon test --packages-select <pkg> && colcon test-result --verbose'],
    build: ['colcon build'],
  };
};

// JVM: 래퍼(gradlew·mvnw)가 있으면 그것으로 — 저장소가 정한 판으로 돈다. 시험 하나는 Gradle --tests(docs.gradle.org 「Test filtering」),
// Maven -Dtest(maven.apache.org/surefire 「Running a Single Test」). 역할극 8 회차.
const fromJvm = (root, has) => {
  // 멀티 프로젝트는 맨 위에 settings.gradle 만 있다(app/build.gradle.kts — 검토 2026-11-11). check·verify 는 통합 시험까지 도는 긴 명령이라 검사 칸에 넣지 않는다
  if (['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'].some(has)) {
    // 래퍼 스크립트가 없어도 래퍼 설정이 있으면 저장소는 ./gradlew 를 쓴다(CI·README 와 같게 — 역할극 8 회차 다시)
    const g = has('gradlew') || has('gradle/wrapper/gradle-wrapper.properties') ? './gradlew' : 'gradle';
    return { test: [`${g} test`], testOne: [`${g} test --tests <name>`], build: [`${g} build`] };
  }
  if (has('pom.xml')) {
    const m = has('mvnw') || has('.mvn/wrapper/maven-wrapper.properties') ? './mvnw' : 'mvn';
    return { test: [`${m} test`], testOne: [`${m} test -Dtest=<name>`], build: [`${m} package`] };
  }
  return {};
};

// Django: manage.py 가 있으면 시험 도구가 따로 없을 때 manage.py test, 그리고 자주 쓰는 명령(마이그레이션 만들기·적용, 개발 서버).
// Procfile 의 프로세스(web·worker·beat)는 「설치하는 명령」 줄에 — 배포에서 무엇이 도는지 알게(역할극 9 회차)
const fromDjango = (root, has) => {
  if (!has('manage.py')) return {};
  return { test: ['python manage.py test'], tools: ['python manage.py makemigrations', 'python manage.py migrate', 'python manage.py runserver'] };
};
// pre-commit 프레임워크 설정이 있으면 그 검사를 한 번에 돌리는 명령(역할극 15 회차 M8 — 팀이 PR 전에 돌리는 검사가 빠졌다, 2026-11-13)
const fromPreCommit = (has) => (has('.pre-commit-config.yaml') || has('.pre-commit-config.yml') ? { lint: ['pre-commit run -a'] } : {});
// Fastfile 의 test 레인(명령줄에서 부를 수 있는 것) — Gemfile 이 있으면 bundle exec 로(역할극 16 회차 M9, 2026-11-13)
const fromFastlane = (root, has) => {
  const fl = readFastlane(root);
  if (!fl.lanes.has('test') || fl.privates.has('test')) return {};
  return { test: [`${has('Gemfile') ? 'bundle exec ' : ''}fastlane test`] };
};
const fromProcfile = (root) => {
  // release: 는 배포 때 도는 일(마이그레이션 적용 등)이라 평소 명령이 아니다(검토 2026-11-11)
  const lines = readText(path.join(root, 'Procfile')).split(/\r?\n/).map((l) => /^([\w-]+):\s*(.+)$/.exec(l.trim())).filter((m) => m && m[1] !== 'release').map((m) => m[2]);
  return lines.length ? { tools: lines.slice(0, MAX_PER_KIND) } : {};
};

// 사용자가 쓴 CLAUDE.md(harness-fit 관리 구역은 뺀다 — 지난번에 넣은 명령을 「이미 있음」으로 보지 않게)
// + 사용자가 쓴 .claude/rules/ 규칙 파일(프로젝트·~/.claude) — 거기 적힌 명령도 이미 있는 것으로 본다
const ownClaudeText = (root, home) => {
  const text = readText(path.join(root, 'CLAUDE.md'));
  return `${text ? setBlock(text, '') || '' : ''}\n${userRulesText(root, home)}`;
};

// 이미 적힌 명령인지: 낱말 경계로 본다(짧은 명령 train 이 「training」 글에 걸려 빠지던 일 — 검토 2026-11-11)
const mentioned = (text, cmd) => {
  let i = text.indexOf(cmd);
  const edge = (ch) => !ch || !/[\w-]/.test(ch);
  while (i >= 0) {
    if (edge(text[i - 1]) && edge(text[i + cmd.length])) return true;
    i = text.indexOf(cmd, i + 1);
  }
  return false;
};

// 「그 밖의 명령」이 한도를 넘으면 시험·검사·빌드·시험 실행(dry·plan) 명령을 먼저 남기고, 개발 서버 띄우기·내리기(up·down·dev·serve·watch)를
// 맨 나중에 뺀다 — 앞에서부터 자르니 make up·down 이 자리를 먹고 make dbt-build·dbt-test 가 빠졌다(역할극 10 회차 다시, 2026-11-13).
// 한도 안이면 순서를 바꾸지 않는다. 남긴 것은 원래 순서대로.
// 개발 고리 낱말은 대상 이름 전체이거나 끝 마디일 때만(make up·consume-local) — 아무 마디나 보니 make migrate-up 이 빠지고 make up 은 남았다(검토 2026-11-13).
// 마이그레이션·시드 대상은 개발 고리로 보지 않는다. 서버 띄우기 하나(up·start·dev·serve·run 가운데 처음 것)는 보통 명령과 같은 차례로 남긴다(10 회차 정답지 M7 의 make up)
const CHECK_WORD = /^(?:test|tests|e2e|lint|check|typecheck|build|compile|dry|dryrun|plan|validate|fmt|format|verify|template|bench)$/;
const LOOP_WORD = /^(?:up|down|run|serve|server|start|stop|restart|dev|watch|local|runserver|logs|shell|preview|storybook)$/;
const START_WORD = /^(?:up|start|dev|serve|run|runserver)$/;
const MIGRATION_WORD = /^(?:migrate|migration|migrations|db|schema|seed|seeds)$/;
const nameWords = (cmd) => cmd.split(/\s+/).at(-1).toLowerCase().split(/[-_:.]/);
const toolRank = (cmd) => {
  const w = nameWords(cmd);
  if (w.includes('watch')) return 2; // test:watch 는 끝나지 않는 개발 고리
  if (w.some((x) => CHECK_WORD.test(x))) return 0;
  return !w.some((x) => MIGRATION_WORD.test(x)) && LOOP_WORD.test(w.at(-1)) ? 2 : 1;
};
const keepChecksFirst = (list, max) => {
  if (list.length <= max) return list;
  const ranked = list.map((c, i) => [toolRank(c), i, c]);
  const start = ranked.find(([r, , c]) => r === 2 && START_WORD.test(nameWords(c).at(-1)));
  if (start) start[0] = 1;
  return ranked.sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, max).sort((a, b) => a[1] - b[1]).map((x) => x[2]);
};

// → { commands: { test: ['npm test'], … }(찾은 종류만, 이미 CLAUDE.md 에 있는 명령은 뺌), listed: ['make build', …](이미 있어 뺀 것) }
// protect: 지킬 경로(suggest.mjs 의 protect) — README·CI 명령 가운데 결과를 그리로 쓰는 것은 뺀다(doc-commands.mjs)
export const detectCommands = (root, { home, protect = [] } = {}) => {
  const has = (f) => fs.existsSync(path.join(root, f));
  const py = fromPython(root, has);
  const django = fromDjango(root, has);
  // 시험 도구(pytest 등)를 이미 찾았으면 manage.py test 는 내지 않는다(pytest-django 저장소에서 다른 시험 도구가 돈다)
  if (py.test) delete django.test;
  // Makefile 이 그 일을 맡으면(make test) 언어 기본값(go test ./...·cargo test)은 내지 않는다 — 팀이 레시피에 옵션(-race)을 담아 둔다.
  // 둘 다 내면 Claude 가 옵션 없는 쪽을 쓰거나, 세션이 하나를 빼려다 줄을 통째로 뺐다(역할극 14 회차, 2026-11-12). 하나만 돌리기(testOne)는 남긴다
  const mk = makefileText(root);
  const vars = makeVars(mk);
  const rules = makeRules(mk);
  // 그 일을 맡은 make 대상이 실제로 돌리는 줄(의존 대상의 레시피 포함 — test: test-unit 꼴)
  const recipe = (kind) => recipeOf(rules, MAKE_NAMES[kind]?.find((n) => rules.has(n))).map((l) => expandVars(l, vars));
  const make = fromMakefile(mk, (t) => recipeOf(rules, t).map((l) => expandVars(l, vars)), mk ? fastlaneLanes(root) : new Map());
  const lang = [['cargo', fromCargo(root, has, mk)], ['go', fromGo(has, recipe('test'))]];
  for (const [tool, l] of lang) for (const kind of Object.keys(MAKE_NAMES)) if (make[kind] && recipe(kind).some((x) => LANG_TOOL[tool].test(x))) delete l[kind];
  const found = [fromPackageJson(root, has), make, py, ...lang.map(([, l]) => l), fromColcon(root), fromJvm(root, has), django, fromPreCommit(has), fromProcfile(root), fromFastlane(root, has)];
  // SwiftLint 설정만 있고 검사 명령을 못 찾았으면 swiftlint 를 바로(역할극 16 회차 M10)
  if (!found.some((f) => f.lint) && (has('.swiftlint.yml') || has('.swiftlint.yaml'))) found.push({ lint: ['swiftlint lint'] });
  // README·개발 메모·CI 에만 적힌 명령은 맨 뒤 차례로(doc-commands.mjs — 자리가 모자라면 이것부터 빠진다). 설정 파일에서 찾은 명령과 같은 것은 뺀다
  found.push({ toolsLate: docCommands(root, found.flatMap((f) => Object.values(f).flat()), protect) });
  const own = ownClaudeText(root, home);
  const commands = {};
  const listed = [];
  for (const kind of COMMAND_KINDS) {
    // 이미 CLAUDE.md 에 있는 것을 먼저 거른 뒤 자른다 — 거르기 전에 자르면 적어 둔 명령이 자리를 먹어 make migrate-new 가 밀려났다(역할극 14 회차)
    const all = [...new Set([...found.flatMap((f) => f[kind] || []), ...(kind === 'tools' ? found.flatMap((f) => f.toolsLate || []) : [])])];
    const unlisted = all.filter((c) => !mentioned(own, c));
    const fresh = kind === 'tools' ? keepChecksFirst(unlisted, MAX_TOOLS) : unlisted.slice(0, MAX_PER_KIND);
    listed.push(...all.filter((c) => mentioned(own, c)));
    if (fresh.length) commands[kind] = fresh;
  }
  return { commands, listed };
};
