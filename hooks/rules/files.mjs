// 파일 쓰기(Write/Edit/MultiEdit/NotebookEdit) 규칙.
import { findSecrets, forbiddenFile } from '../lib/secrets.mjs';

const writtenText = (ti) =>
  [ti.content, ti.new_string, ti.new_source, ...(ti.edits || []).map((e) => e.new_string)].filter(Boolean).join('\n');

export const secretsWrite = {
  id: 'secrets',
  on: 'write',
  check({ input, t }) {
    const ti = input.tool_input || {};
    const file = ti.file_path || ti.notebook_path || '';
    const hits = findSecrets(writtenText(ti), file);
    return hits.length ? t('secrets.write', { hits: hits.join(', ') }) : null;
  },
};

export const protectedFiles = {
  id: 'protected-files',
  on: 'write',
  check({ input, opts, t }) {
    const ti = input.tool_input || {};
    const file = ti.file_path || ti.notebook_path || '';
    const why = file && forbiddenFile(file, opts.paths || []);
    return why ? t('protected.write', { file, why: t(why) }) : null;
  },
};

// 새로 쓰는 파일(Write)이 한도를 넘으면 막는다. 고치기(Edit)는 막지 않는다 — 이미 큰 파일 손보는 일을 막지 않게.
export const fileSize = {
  id: 'file-size',
  on: 'write',
  check({ input, opts, t }) {
    const ti = input.tool_input || {};
    if (typeof ti.content !== 'string') return null;
    const max = opts.maxLines || 400;
    const lines = ti.content.split('\n').length;
    return lines > max ? t('size.write', { lines, max }) : null;
  },
};

export default [secretsWrite, protectedFiles, fileSize];
