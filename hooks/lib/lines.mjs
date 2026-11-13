// 파일 쓰기 규칙이 함께 쓰는 도우미: 새로 들어가는 줄 고르기(와 그 줄의 파일 자리), 주석 줄 빼기. 허용 주석은 allow.mjs.
import fs from 'node:fs';
import path from 'node:path';

// 훅 입력에서 쓰는 파일 경로.
export const targetFile = (ti) => ti.file_path || ti.notebook_path || '';

// 이미 있는 파일 읽기. 너무 크거나 못 읽으면 null.
const MAX_READ = 2 * 1024 * 1024;
export const readExisting = (file, cwd) => {
  if (!file) return null;
  try {
    const abs = path.resolve(cwd || process.cwd(), file);
    if (fs.statSync(abs).size > MAX_READ) return null;
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
};

// 이번 호출로 「새로」 들어가는 줄만. 이미 있던 줄은 고치지 않았으면 막지 않는다(docs/decisions-hooks.md 「기존 코드는 막지 않는다」).
//   Edit(edits 꼴 포함): new_string 줄 가운데 old_string 에 없던 줄(앞뒤 맥락으로 다시 적은 줄은 뺀다).
//   Write: 파일이 이미 있으면 그 파일에 없던 줄, 없으면 전부.
const lineSet = (s) => new Set(String(s || '').split(/\r?\n/).map((l) => l.trim()));
const isNewLine = (before) => (l) => l.trim() && !before.has(l.trim());

// 이 호출이 넣는 글 전체(content·new_string·edits·new_source)를 줄로 나눈 것과 줄마다 실제 파일 자리
// (허용 주석의 「바로 위 줄」과 알림의 줄 번호). 고치기(Edit)의 자리는 필요할 때 한 번만 센다.
//   반환: { text, pieces, linesOf(조각), prev(i), no(i) } — i 는 text 의 몇째 줄(0부터), prev·no 는 allow.mjs 의 줄 자리 정보 꼴.
const countNl = (s, end = s.length) => {
  let n = 0;
  for (let i = s.indexOf('\n'); i !== -1 && i < end; i = s.indexOf('\n', i + 1)) n++;
  return n;
};
const editsOf = (ti) => ti.edits || (typeof ti.new_string === 'string' ? [ti] : []);
// 고치기마다 { startNo: 새 글 첫 줄의 줄 번호, prevLine: 그 위 줄 }. 앞 고치기의 자리는 뒤 고치기가 늘리고 줄인 줄 수만큼 옮긴다.
const editPositions = (ti, cwd) => {
  const pos = new Map();
  let text = readExisting(targetFile(ti), cwd);
  if (text == null) return pos;
  for (const e of editsOf(ti)) {
    const idx = typeof e.old_string === 'string' && e.old_string ? text.indexOf(e.old_string) : -1;
    if (idx === -1) break;
    const lineStart = idx === 0 ? 0 : text.lastIndexOf('\n', idx - 1) + 1;
    const startNo = countNl(text, lineStart) + 1;
    const prevStart = lineStart <= 1 ? 0 : text.lastIndexOf('\n', lineStart - 2) + 1;
    const prevLine = lineStart === 0 ? null : text.slice(prevStart, lineStart - 1);
    const delta = countNl(e.new_string || '') - countNl(e.old_string);
    for (const p of pos.values()) if (p.startNo > startNo) p.startNo += delta;
    pos.set(e, { startNo, prevLine });
    text = e.replace_all ? text.split(e.old_string).join(e.new_string ?? '') : text.replace(e.old_string, () => e.new_string ?? '');
  }
  return pos;
};
// 글을 줄로 나누는 일은 필요할 때만(50MB Write 를 비밀값 검사 하나 때문에 나눴다 붙이지 않게 — 2026-11-06 crash 시험).
export const writeRows = (ti, cwd) => {
  const pieces = [
    ...(ti.content ? [{ text: ti.content, kind: 'whole', content: true }] : []),
    ...editsOf(ti).filter((e) => e.new_string).map((e) => ({ text: e.new_string, kind: 'edit', e })),
    ...(ti.new_source ? [{ text: ti.new_source, kind: 'whole' }] : []),
  ];
  // 조각마다 첫 줄이 글 전체의 몇째 줄인지. 조각이 하나면(보통) 세지 않는다.
  let start = 0;
  for (const p of pieces) {
    p.start = start;
    if (pieces.length > 1) start += countNl(p.text) + 1;
  }
  const pieceOf = (i) => {
    for (let k = pieces.length - 1; k >= 0; k--) if (i >= pieces[k].start) return pieces[k];
    return null;
  };
  const linesOf = (p) => (p.lines ??= p.text.split('\n'));
  let pos = null;
  const at = (p) => (p.kind === 'edit' ? (pos ??= editPositions(ti, cwd)).get(p.e) : null);
  return {
    text: pieces.length === 1 ? pieces[0].text : pieces.map((p) => p.text).join('\n'),
    pieces,
    linesOf,
    prev: (i) => {
      const p = pieceOf(i);
      if (!p) return null;
      if (i > p.start) return linesOf(p)[i - p.start - 1] ?? null;
      return at(p)?.prevLine ?? null;
    },
    no: (i) => {
      const p = pieceOf(i);
      if (!p) return null;
      if (p.kind === 'whole') return i - p.start + 1;
      const where = at(p);
      return where ? where.startNo + i - p.start : null;
    },
  };
};

// 이번 호출로 새로 들어가는 줄들과 그 줄의 파일 자리. 반환: { lines, prev(j), no(j) }
export const addedRows = (ti, cwd) => {
  const base = writeRows(ti, cwd);
  const lines = [];
  const picked = []; // 고른 줄의 글 전체 기준 번호
  const pick = (p, keep) =>
    base.linesOf(p).forEach((raw, k) => {
      const l = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      if (keep(l)) {
        lines.push(l);
        picked.push(p.start + k);
      }
    });
  if (typeof ti.content === 'string') {
    const old = readExisting(targetFile(ti), cwd);
    const keep = isNewLine(old == null ? new Set() : lineSet(old));
    base.pieces.filter((p) => p.content).forEach((p) => pick(p, keep));
  } else if (editsOf(ti).length) {
    for (const p of base.pieces) if (p.kind === 'edit') pick(p, isNewLine(lineSet(p.e.old_string)));
  } else if (typeof ti.new_source === 'string') base.pieces.forEach((p) => pick(p, isNewLine(new Set())));
  return { lines, prev: (j) => base.prev(picked[j]), no: (j) => base.no(picked[j]) };
};

// 쓴 뒤 파일 내용. 고칠 글(old_string)을 못 찾으면 null — 그 고치기는 어차피 실패한다.
export const applyEdits = (before, edits) => {
  let text = before;
  for (const e of edits) {
    if (typeof e.old_string !== 'string' || !text.includes(e.old_string)) return null;
    text = e.replace_all ? text.split(e.old_string).join(e.new_string ?? '') : text.replace(e.old_string, () => e.new_string ?? '');
  }
  return text;
};

// 이 호출 뒤의 파일 전체와 그 전 파일. Write 는 content, Edit 는 디스크 파일에 고치기를 적용한 것.
export const fileAfter = (ti, cwd) => {
  const before = readExisting(targetFile(ti), cwd);
  let after = null;
  if (typeof ti.content === 'string') after = ti.content;
  else if (before != null) after = applyEdits(before, ti.edits || [ti]);
  return { before, after };
};

// 주석만 있는 줄. `#` 주석은 그 문법을 쓰는 언어에서만 본다(CSS 색 #fff 와 헷갈리지 않게).
export const commentOnly = (line, hashComments = false) =>
  /^\s*(?:\/\/|\/\*|\*|<!--)/.test(line) || (hashComments && /^\s*#/.test(line));

// 남이 만든 코드·빌드 결과물. 여기 적힌 것은 고칠 대상이 아니다.
// dist-weekly/ 처럼 이름이 붙은 빌드 폴더, 타입 선언(.d.ts — 받아 온 타입·생성된 것)도 같다(2026-11-06 fp-scan 결과).
export const OUTSIDE_CODE = /(^|\/)(node_modules|vendor|third[_-]?party|(?:dist|build|out)(?:[-_][\w-]+)?|\.next|\.nuxt|\.svelte-kit|generated|__generated__)\/|\.min\.[a-z]+$|\.d\.[mc]?ts$/i;

// 코드 파일 확장자(큰 새 파일 막기가 쓴다)
export const CODE_EXT = new Set(['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts', 'vue', 'svelte', 'astro', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'swift', 'dart', 'php', 'cs', 'scala', 'c', 'cc', 'cpp', 'h', 'hpp', 'm', 'mm', 'lua', 'ex', 'exs']);

export const extOf = (file) => path.extname(file).slice(1).toLowerCase();
export const normPath = (file) => String(file).replace(/\\/g, '/');

// 줄 수: 마지막 줄바꿈 뒤의 빈 조각은 줄이 아니다(400줄 + 끝 줄바꿈 = 400줄). git --numstat 과 같은 셈. 쓰기 검사와 커밋 검사가 같이 쓴다.
export const countLines = (text) => {
  let n = 1;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) n++;
  return text.endsWith('\n') ? n - 1 : n;
};
