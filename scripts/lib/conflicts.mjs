// 사용자 규칙과 반대인 것(harness-fit 이 넣을 CLAUDE.md 줄·켤 훅이 사용자가 쓴 규칙과 거꾸로 말할 때).
// 견주기는 setup 때 Claude 가 한다(skills/setup/SKILL.md 겹침 단계). 사용자가 고른 쪽을 --conflicts 로 받아
//   - mine: 사용자 규칙을 따른다 → 그 줄은 넣지 않고(--skip 과 같은 효과) 그 훅은 끈다
//   - harness: harness-fit 쪽을 쓴다 → 그대로 넣는다(사용자가 자기 규칙을 고친다 — harness-fit 은 사용자 파일을 고치지 않는다)
// 고른 것은 .claude/harness.json selection.conflicts 에 남겨 다음 적용 때 다시 묻지 않는다. 사용자 글이 바뀌거나 없어지면 그 기록은 버리고(gone),
// 「내 규칙」 기록이었으면 그 훅·줄은 이번 추천대로 되돌린다(restored — 꺼진 채 이름표 없이 남지 않게).
// 기록 꼴: { kind: 'rule'|'hook', id, line·lang·hash(rule 만), choice: 'mine'|'harness', userText(8~200자), file(표준 이름 — conflict-files.mjs) }
//   rule 은 줄 글의 지문(hash, lang 파일의 줄)으로 다시 찾는다. line 은 지금 번호(표시·짝 이름용) — 플러그인 업데이트로 줄이 끼어들어도 엉뚱한 줄을 빼지 않게.
// 팀 저장소(share)에서는 ~/ 파일(사람마다 다른 전역 글) 기록을 받지 않는다 — 같은-말 겹침 단계가 전역 글을 보지 않는 것과 같다.
import fs from 'node:fs';
import { bulletLines, lineHash, lineByHash, TAG, PR_SLOT, prWord } from './rule-files.mjs';
import { normFile, isGlobalFile, fileReader } from './conflict-files.mjs';
import { conflictKey, mineHooks } from '../../picker/conflict.js';

export const MAX_CONFLICTS = 40;
export const MAX_USER_TEXT = 200;
// 이보다 짧은 사용자 글은 받지 않는다(「main」처럼 짧으면 어디에나 있어 「글이 아직 있나」가 늘 참이 된다)
export const MIN_USER_TEXT = 8;
const MAX_FILE = 200;
// 명령줄 값(JSON 글 또는 그 글을 담은 파일)의 크기 한도
export const MAX_CONFLICTS_BYTES = 32 * 1024;
const CHOICES = new Set(['mine', 'harness']);
const LANGS = new Set(['ko', 'en']);
const HASH = /^[0-9a-f]{12}$/;

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
// 공백·줄바꿈을 한 칸으로(CRLF 파일과 견줄 때도 같게)
const squash = (s) => String(s).replace(/\s+/g, ' ').trim();
// 제어 문자(C0·C1)는 한 칸으로, 글 방향을 바꾸는 글자(bidi)는 뺀다 — 화면·대화에 그대로 보이는 글이라(보이는 것과 다른 순서로 읽히지 않게).
// 파일 글도 같게 맞춰 견준다(norm)
const CTRL = /[\u0000-\u001f\u007f-\u009f]/g;
const BIDI = /[؜‎‏‪-‮⁦-⁩]/g;
export const norm = (s) => squash(String(s).replace(BIDI, '').replace(CTRL, ' '));
const plain = (s, max) => norm(s).slice(0, max);
const langOf = (x, fallback) => (LANGS.has(x) ? x : LANGS.has(fallback) ? fallback : 'en');

// 짝 이름·「내 규칙」 훅은 화면과 같은 것(picker/conflict.js)
export { conflictKey, mineHooks };

// 팀원과 나눠 쓰는 저장소인가: 이번에 --team 을 줬으면 그렇고, 전에 적용했으면 그때 답(share), 아니면 작성자가 여럿인가
export const shareOf = (det, raw) => (det?.hinted?.team ? true : typeof raw?.selection?.share === 'boolean' ? raw.selection.share : !!det?.team);

// 규칙 기록의 줄 → { line(지금 번호), lang, hash } · { gone: true }(지문으로 못 찾음 — 그 줄이 바뀌었거나 없어졌다) · null(틀린 꼴)
// 지문이 없는 옛 기록·명령줄 값은 지금 그 번호의 줄로 지문을 만든다(읽을 때 한 번 — 다음부터는 지문으로 찾는다). ko·en 은 줄 차례가 같다(시험이 본다)
const ruleLine = (id, c, fallbackLang) => {
  const lang = langOf(c.lang, fallbackLang);
  if (c.hash !== undefined) {
    if (typeof c.hash !== 'string' || !HASH.test(c.hash)) return null;
    const line = lineByHash(id, lang, c.hash);
    return line ? { line, lang, hash: c.hash } : { gone: true };
  }
  const lines = bulletLines(id, lang);
  if (!Number.isInteger(c.line) || c.line < 1 || c.line > lines.length) return null;
  return { line: c.line, lang, hash: lineHash(lines[c.line - 1]) };
};

// 기록 하나 검사 → 고친 기록 또는 null(이유는 why 에). all: loadAll() 결과
// ctx: { lang(지문 없는 기록의 줄을 읽을 언어), share(팀 저장소 — ~/ 파일 기록을 받지 않는다) }
export const cleanConflict = (all, c, why = [], ctx = {}) => {
  if (!isObj(c)) return why.push('not-object'), null;
  const kind = c.kind;
  if (kind !== 'rule' && kind !== 'hook') return why.push('kind'), null;
  const id = typeof c.id === 'string' ? c.id : '';
  const ruleIds = new Set([...all.packs.rules.map((r) => r.id), ...all.packs.flows.filter((f) => f.id !== 'none').map((f) => f.id)]);
  if (kind === 'hook' ? !all.packs.hooks.some((h) => h.id === id) : !ruleIds.has(id)) return why.push(`id:${id.slice(0, 40)}`), null;
  let rule = null;
  if (kind === 'rule') {
    rule = ruleLine(id, c, ctx.lang);
    if (!rule) return why.push(`line:${id}`), null;
    if (rule.gone) return why.push(`gone:${id}`), null;
  }
  if (!CHOICES.has(c.choice)) return why.push('choice'), null;
  const userText = typeof c.userText === 'string' ? plain(c.userText, MAX_USER_TEXT) : '';
  if (userText.length < MIN_USER_TEXT) return why.push('userText'), null;
  const file = normFile(c.file);
  if (!file) return why.push('file'), null;
  if (ctx.share && isGlobalFile(file)) return why.push(`team-global:${file}`), null;
  return { kind, id, ...(rule ? { line: rule.line, lang: rule.lang, hash: rule.hash } : {}), choice: c.choice, userText, file };
};

// 목록 검사(화면이 보낸 선택 — 틀린 것은 조용히 뺀다). 같은 짝은 뒤의 것이 이긴다.
export const cleanConflicts = (all, list, ctx = {}) => {
  const out = new Map();
  for (const c of (Array.isArray(list) ? list : []).slice(0, MAX_CONFLICTS * 2)) {
    const ok = cleanConflict(all, c, [], ctx);
    if (ok) out.delete(conflictKey(ok)), out.set(conflictKey(ok), ok);
  }
  return [...out.values()].slice(-MAX_CONFLICTS);
};

// 명령줄 --conflicts 값: JSON 배열 글, 또는 그 글을 담은 파일 경로(따옴표가 든 줄을 셸로 넘기기 어려울 때).
// → { list } · { error } (args.mjs 는 카탈로그를 모르므로 꼴만 본다 — id 는 strictConflicts 가 본다)
export const parseConflictsArg = (v) => {
  if (v == null) return { list: [] };
  let text = String(v).trim();
  if (!text.startsWith('[')) {
    try {
      if (fs.statSync(text).size > MAX_CONFLICTS_BYTES) return { error: 'too-large' };
      text = fs.readFileSync(text, 'utf8').replace(/^﻿/, '').trim();
    } catch {
      return { error: 'unreadable' };
    }
  }
  if (Buffer.byteLength(text) > MAX_CONFLICTS_BYTES) return { error: 'too-large' };
  let list;
  try {
    list = JSON.parse(text);
  } catch {
    return { error: 'bad-json' };
  }
  if (!Array.isArray(list)) return { error: 'not-array' };
  if (list.length > MAX_CONFLICTS) return { error: 'too-many' };
  return { list };
};

// 명령줄 값은 엄격하게: 하나라도 틀리면 { error, why } — Claude 가 고쳐 다시 넘긴다(조용히 빼면 고른 쪽이 사라진다).
// ctx.root 가 있으면 사용자 글이 지금 그 파일에 있는지도 본다(다시 확인할 때와 같은 맞춤 — norm). 없으면 not-in-file
export const strictConflicts = (all, parsed, ctx = {}) => {
  if (parsed?.error) return { error: parsed.error };
  const why = [];
  const read = ctx.read || (ctx.root ? fileReader(ctx.root, ctx.home, norm) : null);
  const list = (parsed?.list || []).map((c) => {
    const ok = cleanConflict(all, c, why, ctx);
    if (ok && read && !read(ok.file).includes(ok.userText)) why.push(`not-in-file:${ok.file}`);
    return ok;
  });
  return why.length ? { error: 'bad-entry', why: why.slice(0, 10) } : { list: cleanConflicts(all, list, ctx) };
};

// 그 파일에 사용자 글이 아직 있나 → true · false · null(받지 않는 파일 꼴). read: 실행마다 하나(fileReader — 같은 파일은 한 번만 읽는다)
export const textStillThere = (root, c, home, read = fileReader(root, home, norm)) => {
  const text = read(c.file);
  return text == null ? null : text.includes(norm(c.userText));
};

// 기록들 → { live: 그대로 쓸 것, gone: 사용자 글이 바뀌었거나 없어졌거나 확인할 수 없는 것(버린다 — 다시 반대면 Claude 가 다시 묻는다) }
export const liveConflicts = (root, list, home, read = fileReader(root, home, norm)) => {
  const live = [];
  const gone = [];
  for (const c of list || []) (textStillThere(root, c, home, read) === true ? live : gone).push(c);
  return { live, gone };
};

// 버린 기록을 보일 꼴로(대화·화면에 보이는 글이라 맞춰 자른다). 꼴을 알 수 없는 것은 null
const brief = (c) => (isObj(c) && (c.kind === 'rule' || c.kind === 'hook') && typeof c.id === 'string'
  ? { kind: c.kind, id: c.id.slice(0, 40), ...(c.kind === 'rule' && Number.isInteger(c.line) ? { line: c.line } : {}), choice: CHOICES.has(c.choice) ? c.choice : '', file: plain(c.file ?? '', MAX_FILE), userText: plain(c.userText ?? '', MAX_USER_TEXT) }
  : null);

// harness.json 의 지난 기록(살아 있는 것) + 이번에 고른 것(같은 짝이면 이번 것). all 로 다시 검사한다(카탈로그에서 없어진 id·줄).
// ctx: { home, lang, share, read } → { conflicts, gone(버린 지난 기록 — 이번 값이 대신한 짝은 뺀다), saved(지난번에 고른 짝 이름) }
export const resolveConflicts = (all, root, raw, given = [], ctx = {}) => {
  const read = ctx.read || fileReader(root, ctx.home, norm);
  const stored = isObj(raw?.selection) && Array.isArray(raw.selection.conflicts) ? raw.selection.conflicts.slice(0, MAX_CONFLICTS * 2) : [];
  const kept = [];
  const dropped = [];
  for (const c of stored) {
    const ok = cleanConflict(all, c, [], ctx);
    if (ok && textStillThere(root, ok, ctx.home, read) === true) kept.push(ok);
    else if (brief(c)) dropped.push(brief(c));
  }
  const live = cleanConflicts(all, kept, ctx);
  const conflicts = cleanConflicts(all, [...live, ...given], ctx);
  const now = new Set(conflicts.map(conflictKey));
  const givenKeys = new Set(given.map(conflictKey));
  return { conflicts, gone: dropped.filter((c) => !now.has(conflictKey(c))), saved: live.filter((c) => !givenKeys.has(conflictKey(c))).map(conflictKey) };
};

// 버린 「내 규칙」 기록 → 되돌린 것(훅·줄이 이번 추천대로 돌아간다 — overlap.mjs restored, 확인 단계가 한 줄로 알린다)
export const restoredOf = (gone) => (gone || []).filter((c) => c.choice === 'mine').map((c) => ({ kind: c.kind, id: c.id, ...(c.line ? { line: c.line } : {}) }));

// 지난번 선택에 다시 켤 훅: 버린 「내 규칙」 훅 기록 중 이번 추천(rec)이 켜는 것(지금도 「내 규칙」인 것·이미 켠 것은 빼고)
export const restoreHooks = (hooks, gone, rec, conflicts) => {
  const mine = mineHooks(conflicts);
  return [...new Set((gone || []).filter((c) => c.kind === 'hook' && c.choice === 'mine' && rec.includes(c.id) && !mine.has(c.id) && !hooks.includes(c.id)).map((c) => c.id))];
};

// recommend.mjs·picker.mjs: 명령줄 값(parsed — args.mjs)을 엄격히 보고 지난 기록과 합쳐 감지 결과에 붙인다 → det 또는 { error, why }
// conflictsSaved: 지난번에 고른 짝(확인 단계가 「지난번에 정함」으로 보인다) · conflictsGone: 사용자 글이 없어져 버린 기록. opts: { home, lang }
export const withConflictHints = (det, all, root, raw, parsed, opts = {}) => {
  const ctx = { home: opts.home, lang: opts.lang, share: shareOf(det, raw), read: fileReader(root, opts.home, norm) };
  const given = strictConflicts(all, parsed, { ...ctx, root });
  if (given.error) return given;
  const { conflicts, gone, saved } = resolveConflicts(all, root, raw, given.list, ctx);
  return { ...det, conflicts, conflictsSaved: saved, conflictsGone: gone };
};

// 화면에 보일 harness-fit 쪽 글: 규칙 기록마다 그 줄 글({ 짝 이름: 글 }) — 「내 규칙과 반대」 창이 사용자 줄과 나란히 보인다.
// 줄은 지문으로 찾고(기록의 언어 파일), 글은 화면 언어로
export const conflictLines = (list, lang, host = null) => Object.fromEntries((list || []).filter((c) => c.kind === 'rule').map((c) => {
  const n = typeof c.hash === 'string' ? lineByHash(c.id, langOf(c.lang, lang), c.hash) : c.line;
  const line = (n && bulletLines(c.id, lang)[n - 1]) || '';
  return [conflictKey(c), line.replace(TAG, '').replace(PR_SLOT, prWord(host, lang)).replace(/\{\{cmd:\w+[^}]*\}\}/g, '…').slice(2)];
}));

// 선택에 붙인다: 사용자 규칙을 따르기로 한 훅은 끈다(줄은 claude-md.mjs renderAll 이 conflicts 를 보고 뺀다)
export const withConflicts = (sel, list) => {
  const off = mineHooks(list);
  return { ...sel, hooks: (sel.hooks || []).filter((id) => !off.has(id)), conflicts: list || [] };
};
