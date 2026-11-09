// 쓰기 검사(rules/files·code·lang)와 커밋 검사(rules/commit)가 같이 쓰는 문구 만들기와 판정 도우미.
// 규칙 파일끼리 서로 가져오지 않도록 여기 모았다 — 같은 것을 찾으면 같은 문구로 알린다.
import { allowHint, allowAtTop, recordAllow, allowFor } from './allow.mjs';
import { extOf, normPath, OUTSIDE_CODE, CODE_EXT, countLines } from './lines.mjs';
import { findLangUnsafe, langTarget } from './lang-unsafe.mjs';

const MAX_SHOWN = 3;
// 찾은 것 목록: 앞 몇 개만 보이고 나머지는 「외 N개」
export const list = (items, t) =>
  items.length > MAX_SHOWN ? `${items.slice(0, MAX_SHOWN).join(', ')} ${t('list.more', { n: items.length - MAX_SHOWN })}` : items.join(', ');

// 코드 쓰기(위험한 HTML·의존성 범위·워크플로)
export const unsafeHtmlMessage = (hits, t) => t('unsafeHtml.write', { hits: hits.join(', '), hint: allowHint('unsafe-html', t) });
export const pinDepsMessage = (hits, t) => t('pinDeps.write', { hits: list(hits, t) });
export const ghaMessage = (hits, t) => {
  const kinds = [...new Set(hits.map((h) => h.kind))];
  const lines = kinds.map((k) => t(`gha.${k}`, { hits: list(hits.filter((h) => h.kind === k).map((h) => `\`${h.value}\``), t) }));
  return t('gha.write', { hits: lines.join(' '), hint: allowHint('gha-inject', t) });
};

// 언어별(swift-unsafe·python-unsafe)
export const trimmedSet = (lines) => new Set(lines.map((l) => l.trim()).filter(Boolean));
export const langWhere = (h, t) => (h.no ? t('lang.at', { what: h.label, no: h.no }) : h.label);
export const langMessage = (id, hits, t) => t(`${id}.write`, { hits: list(hits, t), hint: allowHint(id, t) });
// 커밋 계획(lib/staged.mjs)에서: 그 언어 파일마다 이번 커밋이 더하는 줄
export const langCommitHits = (id, plan, t, allows) =>
  plan.files.filter((f) => langTarget(id, f)).flatMap((f) => {
    const added = plan.added.get(f) || [];
    if (!added.length) return [];
    const after = plan.after(f);
    const text = after ?? added.join('\n');
    return findLangUnsafe(id, text, after == null ? null : trimmedSet(added), (rows) => allowFor(allows, id, f, rows), after != null).map((h) => `${f}: ${langWhere(h, t)}`);
  });

// 비밀값은 허용 주석을 옵션(allowComment)을 켰을 때만 받는다 — 진짜 키에 주석 하나 달아 넘기기 쉬워서(사용자 결정 2026-11-06).
export const secretsAllowOn = (opts = {}) => opts.allowComment === true;
export const secretsHint = (opts, t) => allowHint('secrets', t, { on: secretsAllowOn(opts) });

// 큰 새 파일: 코드 파일만 본다 — 문서·JSON·잠금 파일·SVG 는 길어도 나눌 일이 아니다.
export const DEFAULT_MAX_LINES = 400;
export const sizeTarget = (file) => CODE_EXT.has(extOf(file)) && !OUTSIDE_CODE.test(normPath(file));
export { countLines as lineCount };

// 한도를 넘은 새 파일: 파일 맨 위 몇 줄 안의 `lint:allow file-size <이유>` 가 있으면 통과(줄 하나가 아니라 파일 전체를 보는 검사라서).
// 반환: 막는 글 또는 null.
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
