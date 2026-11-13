// 쓰기 검사(rules/files·code·lang)와 커밋 검사(rules/commit)가 같이 쓰는 문구 만들기와 판정 도우미.
// 규칙 파일끼리 서로 가져오지 않도록 여기 모았다 — 같은 것을 찾으면 같은 문구로 알린다.
import { allowHint, allowAtTop, recordAllow, allowFor } from './allow.mjs';
import { extOf, normPath, OUTSIDE_CODE, CODE_EXT, countLines } from './lines.mjs';
import { findLangUnsafe, langTarget, LANGS } from './lang-unsafe.mjs';
import { EXEC_IDS, TEMPLATE_IDS } from './unsafe-html.mjs';

const MAX_SHOWN = 3;
// 찾은 것 목록: 앞 몇 개만 보이고 나머지는 「외 N개」
export const list = (items, t) =>
  items.length > MAX_SHOWN ? `${items.slice(0, MAX_SHOWN).join(', ')} ${t('list.more', { n: items.length - MAX_SHOWN })}` : items.join(', ');

// 코드 쓰기(위험한 HTML·의존성 범위·워크플로)
// 찾은 것이 코드 실행(eval·new Function)뿐이면 실행 문구, HTML 넣기뿐이면 HTML 문구 — 서버 코드의 eval 에 「textContent·DOMPurify」 안내가 나와
// 화면 규칙으로 읽히던 일(역할극 6 회차 2차, 2026-11-11). 찾은 것은 「id」 또는 「파일: id」.
const idOf = (h) => String(h).replace(/^.*: /, '');
const isExec = (h) => EXEC_IDS.has(idOf(h));
// 서버 템플릿의 |safe·autoescape off 는 템플릿 문구(format_html·escape) — textContent 안내는 브라우저 코드에만 맞는다(역할극 9 회차)
const isTemplate = (h) => TEMPLATE_IDS.has(idOf(h));
export const unsafeHtmlMessage = (hits, t) => {
  const rest = hits.filter((h) => !isTemplate(h));
  const hint = allowHint('unsafe-html', t);
  if (!rest.length) return t('unsafeHtml.template', { hits: hits.join(', '), hint });
  const key = rest.every(isExec) ? 'unsafeHtml.exec' : rest.some(isExec) ? 'unsafeHtml.write' : 'unsafeHtml.html';
  return t(key, { hits: hits.join(', '), hint: rest.length < hits.length ? `${t('unsafeHtml.templateHint')} ${hint}` : hint });
};
export const pinDepsMessage = (hits, t) => t('pinDeps.write', { hits: list(hits, t) });
export const ghaMessage = (hits, t) => {
  const kinds = [...new Set(hits.map((h) => h.kind))];
  const lines = kinds.map((k) => t(`gha.${k}`, { hits: list(hits.filter((h) => h.kind === k).map((h) => `\`${h.value}\``), t) }));
  return t('gha.write', { hits: lines.join(' '), hint: allowHint('gha-inject', t) });
};

// 언어별(swift-unsafe·python-unsafe)
export const trimmedSet = (lines) => new Set(lines.map((l) => l.trim()).filter(Boolean));
export const langWhere = (h, t) => (h.no ? t('lang.at', { what: h.label, no: h.no }) : h.label);
// Django 꼴(mark_safe·csrf_exempt)만 걸리면 Django 문구, 섞이면 기본 문구 + Django 안내. 찾은 것은 「…줄 이름」 글이라 이름이 들었는지로 본다.
const DJANGO = LANGS['python-unsafe'].patterns.filter((p) => p.kind === 'django').map((p) => p.label);
const isDjango = (h) => DJANGO.some((l) => String(h).includes(l));
export const langMessage = (id, hits, t) => {
  const hint = allowHint(id, t);
  if (id !== 'python-unsafe' || !hits.some(isDjango)) return t(`${id}.write`, { hits: list(hits, t), hint });
  if (hits.every(isDjango)) return t('python-unsafe.django', { hits: list(hits, t), hint });
  return t(`${id}.write`, { hits: list(hits, t), hint: `${t('python-unsafe.djangoHint')} ${hint}` });
};
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
