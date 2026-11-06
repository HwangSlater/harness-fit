#!/usr/bin/env node
// 잘못 막기(헛막음) 찾기 — npm test 에 넣지 않는 개발용 도구.
// 쓰기 훅(secrets · protected-files · file-size · unsafe-html · pin-deps · gha-inject · swift-unsafe · python-unsafe · docs-check 의 쓰기 쪽)을 주어진 폴더의 모든 파일에
// 「지금 처음 쓰는 것처럼」 돌려 무엇이 막힐지 보여 준다. 실제 프로젝트에서 훅이 약속 밖의 것을 막는지 확인할 때 쓴다.
//   node scripts/dev/fp-scan.mjs <폴더> [폴더 …] [--all]   (--all: 걸린 것을 모두 적는다. 없으면 훅마다 10건까지)
// 남의 코드·빌드 결과(node_modules, dist, .git, .claude/worktrees …)는 건너뛴다.
import fs from 'node:fs';
import path from 'node:path';
import { findSecrets, forbiddenFile } from '../../hooks/lib/secrets.mjs';
import { findUnsafeHtml, unsafeHtmlTarget } from '../../hooks/lib/unsafe-html.mjs';
import { isPackageJson, unpinnedChanges } from '../../hooks/lib/pin-deps.mjs';
import { isWorkflow, newWorkflowHits } from '../../hooks/lib/gha-inject.mjs';
import { sizeTarget, lineCount, DEFAULT_MAX_LINES } from '../../hooks/rules/files.mjs';
import { allowReport, allowFor, allowAtTop, wholeRows } from '../../hooks/lib/allow.mjs';
import { findLangUnsafe, langTarget } from '../../hooks/lib/lang-unsafe.mjs';
import { inDocs, isDocFile } from '../../hooks/lib/docs-format.mjs';

// 허용 주석은 훅의 기본값대로 본다: 위험한 HTML·워크플로·큰 새 파일은 받고, 비밀값은 받지 않는다(옵션 allowComment 기본 꺼짐).
const allows = allowReport();

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', 'coverage', '.venv', 'venv', '__pycache__', 'target', 'Pods', '.gradle', '.dart_tool', 'vendor']);
const MAX_BYTES = 1024 * 1024;
const SHOWN = 10;

const args = process.argv.slice(2);
const showAll = args.includes('--all');
const roots = args.filter((a) => a !== '--all');
if (!roots.length) {
  console.error('사용: node scripts/dev/fp-scan.mjs <폴더> [폴더 …] [--all]');
  process.exit(1);
}

// 폴더 안 파일들(건너뛸 폴더·.claude/worktrees 는 빼고)
const walk = function* (dir) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || (e.name === 'worktrees' && path.basename(dir) === '.claude')) continue;
      yield* walk(p);
    } else if (e.isFile()) yield p;
  }
};

const read = (file) => {
  try {
    return fs.statSync(file).size <= MAX_BYTES ? fs.readFileSync(file, 'utf8') : null;
  } catch {
    return null;
  }
};

// 훅 id → 파일 하나를 새로 쓴다고 칠 때 찾은 것들
const CHECKS = {
  secrets: (rel, text) => findSecrets(text, rel),
  'protected-files': (rel) => {
    const why = forbiddenFile(rel);
    return why ? [why] : [];
  },
  'file-size': (rel, text) => (sizeTarget(rel) && lineCount(text) > DEFAULT_MAX_LINES && !allowAtTop(text, 'file-size')?.reason ? [`${lineCount(text)}줄`] : []),
  'unsafe-html': (rel, text) => {
    if (!unsafeHtmlTarget(rel)) return [];
    const lines = text.split(/\r?\n/);
    return findUnsafeHtml(lines, rel, allowFor(allows, 'unsafe-html', rel, wholeRows(lines)));
  },
  'pin-deps': (rel, text) => (isPackageJson(rel) ? unpinnedChanges(null, text) : []),
  'swift-unsafe': (rel, text) => (langTarget('swift-unsafe', rel) ? findLangUnsafe('swift-unsafe', text, null, (rows) => allowFor(allows, 'swift-unsafe', rel, rows)).map((h) => `${h.no}: ${h.label}`) : []),
  'python-unsafe': (rel, text) => (langTarget('python-unsafe', rel) ? findLangUnsafe('python-unsafe', text, null, (rows) => allowFor(allows, 'python-unsafe', rel, rows)).map((h) => `${h.no}: ${h.label}`) : []),
  // docs/ 의 .md·그림이 아닌 파일(폴더 기준 경로의 맨 앞 폴더를 뺀 경로로 본다)
  'docs-check': (rel) => { const inner = rel.split('/').slice(1).join('/'); return inDocs(inner) && !isDocFile(inner) ? ['문서·그림 아님'] : []; },
  'gha-inject': (rel, text) => (isWorkflow(rel) ? newWorkflowHits(null, text, null, allows, rel).map((h) => `${h.kind}: ${h.value}`) : []),
};

const found = Object.fromEntries(Object.keys(CHECKS).map((k) => [k, []]));
let files = 0;
for (const root of roots) {
  for (const file of walk(path.resolve(root))) {
    const text = read(file);
    if (text == null || text.includes('\u0000')) continue;
    files++;
    const rel = path.relative(path.resolve(root, '..'), file).split(path.sep).join('/');
    for (const [id, check] of Object.entries(CHECKS)) {
      const hits = check(rel, text);
      if (hits.length) found[id].push(`${rel}: ${hits.slice(0, 3).join(', ')}`);
    }
  }
}

console.log(`파일 ${files}개를 새로 쓴다고 쳤을 때 막히는 것`);
for (const [id, list] of Object.entries(found)) {
  console.log(`\n## ${id} — ${list.length}건`);
  for (const line of showAll ? list : list.slice(0, SHOWN)) console.log(`  ${line}`);
  if (!showAll && list.length > SHOWN) console.log(`  … 외 ${list.length - SHOWN}건 (--all 로 모두)`);
}
// 허용 주석으로 넘긴 것(파일 맨 위 큰 파일 허용은 세지 않는다) — 훅이 실제로 알릴 줄들
console.log(`\n## 허용 주석으로 통과 — ${allows.used.length}건`);
for (const u of showAll ? allows.used : allows.used.slice(0, SHOWN)) console.log(`  ${u.id} ${u.file}:${u.no} ${u.reason}`);
