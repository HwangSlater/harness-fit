// 저장소 훑기 도우미(scripts/detect.mjs 와 scripts/lib/commands.mjs 가 함께 쓴다).
// 의존성은 「의존성 칸」만 읽는다 — 주석·keywords·description 글에 든 이름을 스택으로 세던 일(검토 2026-11-11).
// 폴더는 맨 위 + 패키지가 놓일 만한 한 단계 아래(src/·packages/·apps/·libs/·services/ + package.json workspaces·pnpm-workspace.yaml)만, 개수 상한을 둔다.
import fs from 'node:fs';
import path from 'node:path';

// max: 앞에서 이만큼(바이트)만 읽는다 — 큰 README·Cargo.toml·.rs 를 통째로 읽고 자르던 일(독립 검토 2026-11-13). 없으면 전부
export const readText = (f, max = Infinity) => {
  try {
    if (!Number.isFinite(max)) return fs.readFileSync(f, 'utf8');
    const fd = fs.openSync(f, 'r');
    try {
      const buf = Buffer.alloc(Math.max(0, Math.min(fs.fstatSync(fd).size, max)));
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      return buf.subarray(0, n).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
};
const readJson = (f) => {
  try {
    return JSON.parse(readText(f));
  } catch {
    return null;
  }
};
export const filesIn = (root, rel) => {
  try {
    return fs.readdirSync(path.join(root, rel));
  } catch {
    return [];
  }
};
const subdirs = (root, rel, max) => {
  try {
    return fs.readdirSync(path.join(root, rel), { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .slice(0, max).map((e) => (rel === '.' ? e.name : `${rel}/${e.name}`));
  } catch {
    return [];
  }
};

// ── 패키지 폴더 ──────────────────────────────────────────────
const PACKAGE_PARENTS = ['src', 'packages', 'apps', 'libs', 'services'];
const PER_PARENT = 40;
const MAX_DIRS = 200;
// workspaces 꼴: "packages/*" · "packages/**" · "frontend" · "packages/@acme/*"(scope 폴더)
const expandWorkspace = (root, pattern) => {
  const p = String(pattern).replace(/^\.\//, '').replace(/\/+$/, '');
  if (!p || p.startsWith('!') || p.includes('..')) return [];
  const star = p.match(/^(.*?)\/\*{1,2}$/);
  if (star) return subdirs(root, star[1] || '.', PER_PARENT).flatMap((d) => (path.basename(d).startsWith('@') ? subdirs(root, d, PER_PARENT) : [d]));
  return p.includes('*') ? [] : [p];
};
const workspacePatterns = (root, pkg) => {
  const ws = Array.isArray(pkg?.workspaces) ? pkg.workspaces : Array.isArray(pkg?.workspaces?.packages) ? pkg.workspaces.packages : [];
  const pnpm = readText(path.join(root, 'pnpm-workspace.yaml')).split(/\r?\n/).map((l) => l.match(/^\s*-\s*["']?([^"'#\s]+)["']?/)?.[1]).filter(Boolean);
  return [...ws, ...pnpm];
};
// → ['.', 'apps/web', 'packages/ui', …]
// Gradle 멀티 프로젝트: settings.gradle(.kts) 의 include("app", ":core:util") / include ':app' → app, core/util (검토 2026-11-11)
// 주석(// … · /* … */)을 먼저 지우고, 괄호 안이면 여러 줄도(include(\n ':app',\n ':core'\n) — 검토 2026-11-11)
const gradleIncludes = (root) => {
  const text = (readText(path.join(root, 'settings.gradle.kts')) || readText(path.join(root, 'settings.gradle')))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const out = [];
  for (const m of text.matchAll(/(?:^|\n)\s*include\b\s*(?:\(([^)]*)\)|([^\n]*))/g)) {
    for (const q of (m[1] ?? m[2] ?? '').matchAll(/["']:?([\w.-]+(?::[\w.-]+)*)["']/g)) out.push(q[1].replace(/:/g, '/'));
  }
  return out.filter((d) => fs.existsSync(path.join(root, d)));
};
// 맨 위 바로 아래 폴더 가운데 빌드 파일이 있는 것(enricher/go.mod 같은 곁 서비스 — 역할극 12 회차: Go 를 놓쳤다)
const MANIFESTS = ['go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'package.json', 'pyproject.toml'];
// 문서 사이트·예제·시험 폴더(docs/package.json 의 Docusaurus, examples/ 의 Next.js, e2e/ 의 Playwright)는 이 저장소의 스택이 아니다(검토 2026-11-11)
const SIDE_DIRS = /^(?:docs?|website|site|examples?|samples?|demos?|e2e|tests?|benchmarks?|bench|fixtures?|playground|scripts|tools)$/i;
const manifestDirs = (root) => subdirs(root, '.', PER_PARENT).filter((d) => !SIDE_DIRS.test(d) && MANIFESTS.some((f) => fs.existsSync(path.join(root, d, f))));
export const packageDirs = (root, pkg) => {
  const out = new Set(['.']);
  for (const d of gradleIncludes(root)) out.add(d);
  for (const d of manifestDirs(root)) out.add(d);
  for (const p of PACKAGE_PARENTS) for (const d of subdirs(root, p, PER_PARENT)) out.add(d);
  for (const pat of workspacePatterns(root, pkg)) for (const d of expandWorkspace(root, pat)) out.add(d);
  return [...out].slice(0, MAX_DIRS);
};

// ── ROS 2 ────────────────────────────────────────────────────
// ament_cmake 는 <buildtool_depend>, ament_python 은 <export><build_type> 에만 적힌다(ros2 pkg create 템플릿 — 검토 2026-11-11).
const AMENT = /<buildtool_depend>\s*ament_|<build_type>\s*ament_/;
const ROS_SCAN_MAX = 300;
// 맨 위(패키지 하나짜리 저장소), 맨 위 하위 폴더(패키지 여럿을 올린 저장소), src/*, src/*/*(워크스페이스에 받아 둔 저장소) → ROS 2 패키지 폴더들
export const rosPackages = (root) => {
  const cand = ['.', ...subdirs(root, '.', 60)];
  for (const d of subdirs(root, 'src', 100)) cand.push(d, ...subdirs(root, d, 20));
  return [...new Set(cand)].slice(0, ROS_SCAN_MAX).filter((d) => AMENT.test(readText(path.join(root, d, 'package.xml'))));
};

// ── Python 의존성 이름 ───────────────────────────────────────
const norm = (n) => String(n).toLowerCase().replace(/_/g, '-');
const reqName = (line) => {
  const s = String(line).replace(/(^|\s)#.*$/, '').trim();
  if (!s || s.startsWith('-')) return null;
  return s.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)/)?.[1] || null;
};
const quoted = (text) => [...text.matchAll(/["']([^"'\n]+)["']/g)].map((m) => m[1]);
// 아주 작은 TOML 읽기: 표 이름 → 그 표의 줄들
const tomlTables = (text) => {
  const tables = new Map();
  let cur = '';
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/);
    if (h) cur = h[1];
    else {
      if (!tables.has(cur)) tables.set(cur, []);
      tables.get(cur).push(line);
    }
  }
  return tables;
};
// 표 안 `키 = [ … ]`(여러 줄) 의 따옴표 글들. keys 를 주면 그 키만.
// 배열 끝은 따옴표 밖의 「]」 — "psycopg[binary]" 의 [] 에서 끊기지 않게
const arraysIn = (lines, keys = null) => {
  const out = [];
  const text = lines.map((l) => l.replace(/(^|\s)#.*$/, '')).join('\n');
  for (const m of text.matchAll(/^\s*([\w.-]+)\s*=\s*\[/gm)) {
    if (keys && !keys.includes(m[1])) continue;
    let q = null;
    let i = m.index + m[0].length;
    const from = i;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (q) q = ch === q ? null : q;
      else if (ch === '"' || ch === "'") q = ch;
      else if (ch === ']') break;
    }
    out.push(...quoted(text.slice(from, i)));
  }
  return out;
};
const keysIn = (lines) => lines.map((l) => l.match(/^\s*([A-Za-z0-9][\w.-]*)\s*=/)?.[1]).filter(Boolean);
const fromPyproject = (text) => {
  if (!text) return [];
  const t = tomlTables(text);
  const out = [];
  for (const [name, lines] of t) {
    if (name === 'project') out.push(...arraysIn(lines, ['dependencies']));
    else if (name === 'project.optional-dependencies' || name === 'dependency-groups') out.push(...arraysIn(lines));
    else if (name === 'tool.uv') out.push(...arraysIn(lines, ['dev-dependencies']));
    else if (/^tool\.poetry\.(?:dev-)?dependencies$|^tool\.poetry\.group\.[\w-]+\.dependencies$/.test(name)) out.push(...keysIn(lines).filter((k) => k !== 'python'));
  }
  return out;
};
const fromSetupPy = (text) => quoted(text.match(/install_requires\s*=\s*\[([\s\S]*?)\]/)?.[1] || '');
const fromSetupCfg = (text) => {
  const m = text.match(/^install_requires\s*=\s*\n((?:[ \t]+\S.*\n?)+)/m);
  return m ? m[1].split(/\r?\n/) : [];
};
const fromPipfile = (text) => {
  const t = tomlTables(text);
  return [...(t.get('packages') || []), ...(t.get('dev-packages') || [])].flatMap((l) => keysIn([l]));
};
// conda environment.yml: dependencies 아래 `- 이름=버전`, 그 안 `- pip:` 아래 `  - 이름`
const fromCondaEnv = (text) => {
  const at = text.search(/^dependencies:\s*$/m);
  if (at < 0) return [];
  return text.slice(at).split(/\r?\n/).slice(1).map((l) => l.match(/^\s+-\s+([A-Za-z0-9][\w.-]*)/)?.[1]).filter((n) => n && n !== 'pip');
};
const PY_FILES = ['pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg', 'Pipfile', 'environment.yml', 'environment.yaml'];
export const isPythonDir = (root, d) => PY_FILES.some((f) => fs.existsSync(path.join(root, d, f))) || filesIn(root, path.join(d, 'requirements')).some((f) => f.endsWith('.txt'));
// → Set(정규화한 이름)
export const pythonDeps = (root, dirs) => {
  const names = [];
  for (const d of dirs) {
    const at = (f) => readText(path.join(root, d, f));
    const reqFiles = [...filesIn(root, d).filter((f) => /^requirements.*\.txt$/i.test(f)), ...filesIn(root, path.join(d, 'requirements')).filter((f) => f.endsWith('.txt')).map((f) => `requirements/${f}`)];
    for (const f of reqFiles) names.push(...at(f).split(/\r?\n/));
    names.push(...fromPyproject(at('pyproject.toml')), ...fromSetupPy(at('setup.py')), ...fromSetupCfg(at('setup.cfg')), ...fromPipfile(at('Pipfile')),
      ...fromCondaEnv(at('environment.yml') || at('environment.yaml')));
  }
  return new Set(names.map(reqName).filter(Boolean).map(norm));
};
