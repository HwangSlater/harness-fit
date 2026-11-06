// 이 저장소의 시험·검사·타입 검사·형식·빌드 명령을 저장소 파일에서 읽는다(CLAUDE.md 지침 「이 저장소 명령」 — rules/commands.*.md).
// 파일에 실제로 있는 것만 낸다(지어내지 않음): package.json scripts(잠금 파일로 패키지 관리자를 고름), Makefile 대상,
// pyproject(tox·hatch 스크립트·pytest·ruff·mypy), Cargo, go.mod. 사용자가 쓴 CLAUDE.md 에 이미 적힌 명령은 뺀다.
import fs from 'node:fs';
import path from 'node:path';
import { setBlock } from './claude-md.mjs';

export const COMMAND_KINDS = ['test', 'lint', 'typecheck', 'format', 'build'];
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
    const name = SCRIPT_NAMES[kind].find((n) => typeof scripts[n] === 'string' && scripts[n].trim() && !(n === 'test' && PLACEHOLDER_TEST.test(scripts[n])));
    if (name) out[kind] = [runScript(pm, name)];
  }
  return out;
};

// Makefile 대상(`test:` 꼴, 변수 대입 `x := …` 는 빼고)
const MAKE_NAMES = { test: ['test'], lint: ['lint'], typecheck: ['typecheck'], format: ['format', 'fmt'], build: ['build'] };
const fromMakefile = (root) => {
  const text = ['Makefile', 'makefile', 'GNUmakefile'].map((f) => readText(path.join(root, f))).find(Boolean) || '';
  const targets = new Set([...text.matchAll(/^([A-Za-z][\w-]*)[ \t]*:(?![=:])/gm)].map((m) => m[1]));
  const out = {};
  for (const kind of COMMAND_KINDS) {
    const name = MAKE_NAMES[kind].find((n) => targets.has(n));
    if (name) out[kind] = [`make ${name}`];
  }
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
  const ruff = hasTable('tool.ruff') || has('ruff.toml') || has('.ruff.toml');
  const lint = hatchOf(['lint']) || (ruff ? `${prefix}ruff check .` : null);
  if (lint) put('lint', lint);
  const typecheck = hatchOf(['typecheck', 'types']) || (hasTable('tool.mypy') || has('mypy.ini') ? `${prefix}mypy .` : null);
  if (typecheck) put('typecheck', typecheck);
  const format = hatchOf(['format', 'fmt']) || (hasTable('tool.ruff.format') ? `${prefix}ruff format .` : null);
  if (format) put('format', format);
  const build = hatchOf(['build']);
  if (build) put('build', build);
  return out;
};

// Cargo: 시험·빌드는 늘 있다. clippy·rustfmt 는 설정 파일이 있을 때만(쓰기로 한 저장소)
const fromCargo = (root, has) => {
  if (!has('Cargo.toml')) return {};
  return {
    test: ['cargo test'], build: ['cargo build'],
    ...(has('clippy.toml') || has('.clippy.toml') ? { lint: ['cargo clippy'] } : {}),
    ...(has('rustfmt.toml') || has('.rustfmt.toml') ? { format: ['cargo fmt'] } : {}),
  };
};

// Go: 시험·빌드·vet 은 go 에 들어 있다. golangci-lint 설정이 있으면 그것을 검사로
const fromGo = (root, has) => {
  if (!has('go.mod')) return {};
  const golangci = ['.golangci.yml', '.golangci.yaml', '.golangci.toml', '.golangci.json'].some(has);
  return { test: ['go test ./...'], lint: [golangci ? 'golangci-lint run' : 'go vet ./...'], build: ['go build ./...'] };
};

// 사용자가 쓴 CLAUDE.md(harness-fit 관리 구역은 뺀다 — 지난번에 넣은 명령을 「이미 있음」으로 보지 않게)
const ownClaudeText = (root) => {
  const text = readText(path.join(root, 'CLAUDE.md'));
  return text ? setBlock(text, '') || '' : '';
};

// → { commands: { test: ['npm test'], … }(찾은 종류만, 이미 CLAUDE.md 에 있는 명령은 뺌), listed: ['make build', …](이미 있어 뺀 것) }
export const detectCommands = (root) => {
  const has = (f) => fs.existsSync(path.join(root, f));
  const found = [fromPackageJson(root, has), fromMakefile(root), fromPython(root, has), fromCargo(root, has), fromGo(root, has)];
  const own = ownClaudeText(root);
  const commands = {};
  const listed = [];
  for (const kind of COMMAND_KINDS) {
    const all = [...new Set(found.flatMap((f) => f[kind] || []))].slice(0, MAX_PER_KIND);
    const fresh = all.filter((c) => !own.includes(c));
    listed.push(...all.filter((c) => own.includes(c)));
    if (fresh.length) commands[kind] = fresh;
  }
  return { commands, listed };
};
