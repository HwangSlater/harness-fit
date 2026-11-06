// 코드 쓰기 규칙: 위험한 HTML 넣기·문자열 실행, 의존성 버전 범위, 워크플로 구멍.
// 모두 이번 호출로 새로 들어가는 줄·항목만 본다(이미 있던 코드는 막지 않는다).
// 셸로 쓴 파일은 이 검사가 못 보므로, 커밋할 때 같은 함수로 다시 본다(rules/commit.mjs).
import { addedRows, targetFile } from '../lib/lines.mjs';
import { findUnsafeHtml, unsafeHtmlTarget } from '../lib/unsafe-html.mjs';
import { findUnpinned } from '../lib/pin-deps.mjs';
import { findGhaInject } from '../lib/gha-inject.mjs';
import { allowFor, allowHint } from '../lib/allow.mjs';

const MAX_SHOWN = 3;
export const list = (items, t) =>
  items.length > MAX_SHOWN ? `${items.slice(0, MAX_SHOWN).join(', ')} ${t('list.more', { n: items.length - MAX_SHOWN })}` : items.join(', ');

// 찾은 것 → 문구. 쓰기 검사와 커밋 검사가 같은 문구를 쓴다.
export const unsafeHtmlMessage = (hits, t) => t('unsafeHtml.write', { hits: hits.join(', '), hint: allowHint('unsafe-html', t) });
export const pinDepsMessage = (hits, t) => t('pinDeps.write', { hits: list(hits, t) });
export const ghaMessage = (hits, t) => {
  const kinds = [...new Set(hits.map((h) => h.kind))];
  const lines = kinds.map((k) => t(`gha.${k}`, { hits: list(hits.filter((h) => h.kind === k).map((h) => `\`${h.value}\``), t) }));
  return t('gha.write', { hits: lines.join(' '), hint: allowHint('gha-inject', t) });
};

export const unsafeHtml = {
  id: 'unsafe-html',
  on: 'write',
  check({ input, cwd, t, allows }) {
    const ti = input.tool_input || {};
    const file = targetFile(ti);
    if (!unsafeHtmlTarget(file)) return null;
    const rows = addedRows(ti, cwd);
    const hits = findUnsafeHtml(rows.lines, file, allowFor(allows, 'unsafe-html', file, rows));
    return hits.length ? unsafeHtmlMessage(hits, t) : null;
  },
};

export const pinDeps = {
  id: 'pin-deps',
  on: 'write',
  check({ input, cwd, t }) {
    const hits = findUnpinned(input.tool_input || {}, cwd);
    return hits.length ? pinDepsMessage(hits, t) : null;
  },
};

// GitHub Actions 워크플로: run: 에 바깥 값 넣기, pull_request_target + PR 코드 checkout, 고정 안 한 남의 액션
export const ghaInject = {
  id: 'gha-inject',
  on: 'write',
  check({ input, cwd, t, allows }) {
    const hits = findGhaInject(input.tool_input || {}, cwd, allows);
    return hits.length ? ghaMessage(hits, t) : null;
  },
};

export default [unsafeHtml, pinDeps, ghaInject];
