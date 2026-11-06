// package.json 의존성 버전이 범위(^1.2.3, ~1, *, latest, >=1 …)로 들어가는지 본다.
// 쓰기 전 파일과 쓴 뒤 파일을 둘 다 읽어, 새로 생기거나 바뀐 항목만 본다(이미 범위로 적힌 것은 막지 않는다).
// peerDependencies 는 보지 않는다: 라이브러리가 「이 범위와 같이 쓸 수 있다」고 밝히는 자리라 범위가 맞다.
// overrides·resolutions·engines 도 보지 않는다(버전 요구이지 설치 고정이 아니다).
import path from 'node:path';
import { fileAfter, targetFile } from './lines.mjs';

const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'];

export const isPackageJson = (file) => {
  const p = String(file).replace(/\\/g, '/');
  return path.posix.basename(p) === 'package.json' && !/(^|\/)node_modules\//.test(p);
};

// 버전 글이 아닌 것(로컬·작업 공간·git·주소·pnpm catalog)은 고정 여부를 따지지 않는다.
const NOT_REGISTRY = /^(?:workspace:|file:|link:|portal:|patch:|catalog:|git\+|git:|github:|gitlab:|bitbucket:|https?:|\.{0,2}\/)|^[\w.-]+\/[\w.-]+(?:#.*)?$/;
const EXACT = /^=?v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

// 고정이면 null, 범위면 그 글. `npm:이름@버전` 별칭은 @ 뒤 버전을 본다.
export const unpinned = (spec) => {
  if (typeof spec !== 'string') return null;
  let v = spec.trim();
  if (v.startsWith('npm:')) {
    const at = v.lastIndexOf('@');
    if (at <= 4) return spec; // 버전 없는 별칭 = 최신
    v = v.slice(at + 1);
  }
  if (NOT_REGISTRY.test(v)) return null;
  return EXACT.test(v) ? null : spec;
};

const parse = (text) => {
  try {
    const j = JSON.parse(text);
    return j && typeof j === 'object' ? j : null;
  } catch {
    return null;
  }
};

const depsOf = (pkg) => {
  const out = new Map();
  for (const s of SECTIONS) {
    const d = pkg?.[s];
    if (d && typeof d === 'object') for (const [name, spec] of Object.entries(d)) out.set(`${s}\u0000${name}`, { name, spec });
  }
  return out;
};

// 전·후 package.json 글 → 새로 생기거나 바뀐 범위 버전 ['이름@범위', …]. 쓰기 검사와 커밋 검사가 같이 쓴다.
export const unpinnedChanges = (before, after) => {
  const next = after == null ? null : parse(after);
  if (!next) return [];
  const prev = depsOf(before == null ? null : parse(before));
  const hits = [];
  for (const [key, { name, spec }] of depsOf(next)) {
    if (prev.get(key)?.spec === spec) continue;
    if (unpinned(spec)) hits.push(`${name}@${spec}`);
  }
  return hits;
};

// 반환: ['이름@범위', …]
export const findUnpinned = (ti, cwd) => {
  const file = targetFile(ti);
  if (!isPackageJson(file)) return [];
  const { before, after } = fileAfter(ti, cwd);
  return unpinnedChanges(before, after);
};
