// docs/ 문서 형식(docs-check 훅). 짐작 없이 정해진 꼴만 본다:
//   docs/ 에는 문서(.md)와 그림만 / 첫 줄 `# 제목` / 위 10줄 안에 `> 최종 수정: YYYY-MM-DD`(또는 `> Last updated:`), 날짜 = 그 파일을 마지막으로 고친 날
//   / 목차(docs/README.md)에 링크 / 목차의 .md 링크는 있는 파일.
import fs from 'node:fs';
import path from 'node:path';
import { localDate } from './dates.mjs';

export const DOCS_DIR = 'docs';
export const DOCS_INDEX = `${DOCS_DIR}/README.md`;
export const DOC_FILE = /\.(?:md|png|jpe?g|gif|svg|webp)$/i;
const MD = /\.md$/i;
const HEAD_LINES = 10;
const MAX_READ = 2 * 1024 * 1024;
const TITLE = /^# \S/;
const DATE_LINE = /^> (?:최종 수정|Last updated): (\d{4}-\d{2}-\d{2})/;
// 목차의 상대 링크(주소·# 만 있는 것은 뺀다)
const LINK = /\]\(\s*<?([^)\s>#]+\.md)(?:#[^)\s]*)?>?(?:\s+"[^"]*")?\s*\)/gi;

export const slash = (p) => String(p).split(path.sep).join('/').replace(/\\/g, '/');
// 프로젝트 기준 경로가 docs/ 안인지
export const inDocs = (rel) => rel === DOCS_DIR || rel.startsWith(`${DOCS_DIR}/`);
export const isDocFile = (rel) => DOC_FILE.test(rel);

export { localDate };

const readSmall = (abs) => {
  try {
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > MAX_READ) return null;
    return { text: fs.readFileSync(abs, 'utf8').replace(/^﻿/, ''), mtime: st.mtimeMs };
  } catch {
    return null;
  }
};

// 목차가 가리키는 문서들(프로젝트 기준 경로). 목차가 없으면 null.
export const indexLinks = (project) => {
  const idx = readSmall(path.join(project, DOCS_INDEX));
  if (!idx) return null;
  const base = path.posix.dirname(DOCS_INDEX);
  const out = [];
  for (const m of idx.text.matchAll(LINK)) {
    if (/^[a-z][\w+.-]*:/i.test(m[1])) continue;
    let target;
    try {
      target = decodeURI(m[1]);
    } catch {
      target = m[1];
    }
    out.push(path.posix.normalize(path.posix.join(base, target.replace(/\\/g, '/'))));
  }
  return out;
};

// 바뀐 docs/ 파일들(프로젝트 기준 경로) → 문제 [{ key, vars }]. dateLine: 날짜 줄을 볼지
export const docsProblems = (project, changed, { dateLine = true } = {}) => {
  const problems = [];
  let links;
  const linksOnce = () => (links === undefined ? (links = indexLinks(project)) : links);
  let checkIndex = false;
  for (const rel of changed) {
    const abs = path.join(project, rel);
    if (!fs.existsSync(abs)) {
      if (MD.test(rel)) checkIndex = true; // 지운 문서: 목차에 남은 링크를 본다
      continue;
    }
    if (!isDocFile(rel)) {
      problems.push({ key: 'docs.notDoc', vars: { file: rel } });
      continue;
    }
    if (!MD.test(rel)) continue;
    const doc = readSmall(abs);
    if (!doc) continue;
    const head = doc.text.split(/\r?\n/);
    const first = head.find((l) => l.trim()) || '';
    if (!TITLE.test(first)) problems.push({ key: 'docs.title', vars: { file: rel } });
    if (dateLine) {
      const want = localDate(doc.mtime);
      const m = head.slice(0, HEAD_LINES).map((l) => l.match(DATE_LINE)).find(Boolean);
      if (!m) problems.push({ key: 'docs.dateMissing', vars: { file: rel, date: want } });
      else if (m[1] !== want) problems.push({ key: 'docs.dateOld', vars: { file: rel, date: want, was: m[1] } });
    }
    if (rel === DOCS_INDEX) {
      checkIndex = true;
      continue;
    }
    const l = linksOnce();
    if (l === null) problems.push({ key: 'docs.noIndex', vars: { file: rel, index: DOCS_INDEX } });
    else if (!l.includes(rel)) problems.push({ key: 'docs.notIndexed', vars: { file: rel, index: DOCS_INDEX } });
  }
  if (checkIndex) for (const target of linksOnce() || []) if (!fs.existsSync(path.join(project, target))) problems.push({ key: 'docs.brokenLink', vars: { index: DOCS_INDEX, file: target } });
  return problems;
};
