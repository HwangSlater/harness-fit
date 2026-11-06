// 파일 쓰기(Write/Edit/NotebookEdit) 규칙. 셸로 쓴 파일은 커밋할 때 같은 함수로 다시 본다(rules/commit.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { findSecrets, forbiddenFile } from '../lib/secrets.mjs';
import { writeRows, targetFile, extOf, normPath, OUTSIDE_CODE, CODE_EXT } from '../lib/lines.mjs';
import { allowFor, allowHint, allowAtTop, recordAllow } from '../lib/allow.mjs';

// 비밀값은 허용 주석을 옵션(allowComment)을 켰을 때만 받는다 — 진짜 키에 주석 하나 달아 넘기기 쉬워서(사용자 결정 2026-11-06).
export const secretsAllowOn = (opts = {}) => opts.allowComment === true;
export const secretsHint = (opts, t) => allowHint('secrets', t, { on: secretsAllowOn(opts) });

export const secretsWrite = {
  id: 'secrets',
  on: 'write',
  check({ input, cwd, opts, t, allows }) {
    const ti = input.tool_input || {};
    const file = targetFile(ti);
    const rows = writeRows(ti, cwd);
    const hits = findSecrets(rows.text, file, allowFor(allows, 'secrets', file, rows, secretsAllowOn(opts)));
    return hits.length ? t('secrets.write', { hits: hits.join(', '), hint: secretsHint(opts, t) }) : null;
  },
};

export const protectedFiles = {
  id: 'protected-files',
  on: 'write',
  check({ input, opts, t }) {
    const file = targetFile(input.tool_input || {});
    const why = file && forbiddenFile(file, opts.paths || []);
    return why ? t('protected.write', { file, why: t(why) }) : null;
  },
};

// 큰 새 파일: 코드 파일만 본다 — 문서·JSON·잠금 파일·SVG 는 길어도 나눌 일이 아니다.
export const DEFAULT_MAX_LINES = 400;
export const sizeTarget = (file) => CODE_EXT.has(extOf(file)) && !OUTSIDE_CODE.test(normPath(file));
// 줄 수: 마지막 줄바꿈 뒤의 빈 조각은 줄이 아니다(400줄 + 끝 줄바꿈 = 400줄). 커밋 검사와 같은 함수.
export { countLines as lineCount } from '../lib/staged.mjs';
import { countLines as lineCount } from '../lib/staged.mjs';

// 한도를 넘은 새 파일: 파일 맨 위 몇 줄 안의 `lint:allow file-size <이유>` 가 있으면 통과(줄 하나가 아니라 파일 전체를 보는 검사라서).
// 반환: 막는 글 또는 null. 쓰기 검사와 커밋 검사가 같이 쓴다.
export const sizeVerdict = (file, text, lines, max, { t, allows }) => {
  if (lines <= max) return null;
  const a = allowAtTop(text, 'file-size');
  if (a?.reason && allows) {
    recordAllow(allows, 'file-size', file, a.no, a.reason);
    return null;
  }
  if (a?.noReason) allows?.noReason.add('file-size');
  return t('size.write', { lines, max, hint: allowHint('file-size', t, { top: true }) });
};

// 새로 쓰는 파일(Write)이 한도를 넘으면 막는다. 고치기(Edit)는 막지 않는다 — 이미 큰 파일 손보는 일을 막지 않게.
// 이미 있는 파일을 통째로 다시 쓰는 것도 새 파일이 아니다(2026-11-05 검토).
export const fileSize = {
  id: 'file-size',
  on: 'write',
  check({ input, cwd, opts, t, allows }) {
    const ti = input.tool_input || {};
    if (typeof ti.content !== 'string') return null;
    const file = targetFile(ti);
    if (!sizeTarget(file)) return null;
    if (fs.existsSync(path.resolve(cwd || process.cwd(), file))) return null;
    const max = opts.maxLines || DEFAULT_MAX_LINES;
    return sizeVerdict(file, ti.content, lineCount(ti.content), max, { t, allows });
  },
};

export default [secretsWrite, protectedFiles, fileSize];
