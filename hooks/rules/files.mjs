// 파일 쓰기(Write/Edit/NotebookEdit) 규칙. 셸로 쓴 파일은 커밋할 때 같은 함수로 다시 본다(rules/commit.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { findSecrets, forbiddenFile } from '../lib/secrets.mjs';
import { writeRows, targetFile } from '../lib/lines.mjs';
import { allowFor } from '../lib/allow.mjs';
import { secretsAllowOn, secretsHint, DEFAULT_MAX_LINES, sizeTarget, lineCount, sizeVerdict } from '../lib/messages.mjs';

// 판정·문구 도우미는 커밋 검사와 같이 쓰려고 lib/messages.mjs 에 있다(예전 가져오기를 위해 여기서도 내보낸다).
export { secretsAllowOn, secretsHint, DEFAULT_MAX_LINES, sizeTarget, lineCount, sizeVerdict };

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
