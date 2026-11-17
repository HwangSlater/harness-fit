// 커밋·PR 형식 감지(지침 「커밋·PR 형식」 — rules/vcs-format.*.md, 글은 scripts/lib/vcs-text.mjs).
// 사용자가 「커밋해 줘」·「PR 올려 줘」 할 때 Claude 가 이 저장소 꼴로 쓰게, 최근 기록에서 분명히 많은 꼴만 알아낸다(2026-11-17).
// 로컬 git 만 읽는다(네트워크 없음). git 부르기는 둘 — merge 아닌 커밋(제목·본문)과 첫 부모 줄의 merge 커밋.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { findSecrets } from '../../hooks/lib/secrets.mjs';
import { CONVENTIONAL, ANY_CONVENTIONAL } from '../../hooks/rules/message.mjs';

// 읽는 기록 크기. 본문은 커밋마다 앞부분만 본다(꼬리 줄은 끝에 있으니 끝부분도 — BODY_HEAD·BODY_TAIL)
export const FORMAT_SUBJECTS = 50;
const MERGES = 30;
const BODY_HEAD = 400;
const BODY_TAIL = 600;
// git 출력 상한 — 본문이 아주 긴 커밋이 몇 개 있어도 넘지 않게(넘으면 기록을 통째로 못 읽는다)
const LOG_BUFFER = 16 * 1024 * 1024;
// 「분명히 많은 꼴」: 표본 MIN 개 이상에서 SHARE 이상일 때만 말한다. 아니면 아무 말도 하지 않는다
export const FORMAT_MIN = 8;
export const FORMAT_SHARE = 0.6;
const EXAMPLES = 3;
const EXAMPLE_MAX = 72;
const TOP = 4;
export const BOT = /\[bot\]|dependabot|renovate|github-actions|greenkeeper/i;

const git = (root, args) => {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: LOG_BUFFER });
  } catch {
    return '';
  }
};
const clip = (b) => (b.length > BODY_HEAD + BODY_TAIL ? `${b.slice(0, BODY_HEAD)}\n${b.slice(-BODY_TAIL)}` : b);

// 최근 merge 아닌 커밋 → [{ name, mail, s(제목), b(본문, 잘라 둠) }](새것부터). detect.mjs 의 history 도 이것을 쓴다
export const readLog = (root, n = FORMAT_SUBJECTS) => git(root, ['log', '-n', String(n), '--no-merges', '--format=%an%x1f%ae%x1f%s%x1f%b%x1e'])
  .split('\x1e').map((x) => x.replace(/^\s+/, '')).filter(Boolean)
  .map((x) => { const [name = '', mail = '', s = '', b = ''] = x.split('\x1f'); return { name, mail, s: s.trim(), b: clip(b.trim()), hb: HANGUL.test(b) }; });
// 첫 부모 줄(기본 브랜치에 들어온 차례)의 merge 커밋 → [{ s, b }]
const readMerges = (root) => git(root, ['log', '-n', String(MERGES), '--merges', '--first-parent', '--format=%s%x1f%b%x1e'])
  .split('\x1e').map((x) => x.replace(/^\s+/, '')).filter(Boolean)
  .map((x) => { const [s = '', b = ''] = x.split('\x1f'); return { s: s.trim(), b: clip(b.trim()) }; });

// 메시지 언어 세기(커밋 메시지 언어 검사 기본값 — catalog.mjs commitLang 과 같은 규칙):
// 한국어는 제목에 한글이 있으면, 영어는 제목·본문 어디에도 한글이 없을 때만(commit-msg 의 en 은 본문의 한글도 막아서)
const HANGUL = /[가-힣]/;
export const isKorean = (r) => HANGUL.test(r.s);
// hb: 자르기 전 본문에 한글이 있었는지(readLog)
export const isEnglish = (r) => !HANGUL.test(r.s) && !(r.hb ?? HANGUL.test(r.b || '')) && /[A-Za-z]{3,}/.test(r.s);

// 제목 한 줄 뜯어보기. 앞에서부터 그림 글자 → 이슈 번호 → 타입(범위) → 설명 → 끝 이슈 번호
const SQUASH = /\s*\(#\d+\)$/;
const EMOJI = /^(?:(:[a-z0-9_+-]+:)|(\p{Extended_Pictographic}️?))\s*/u;
const TICKET_HEAD = [
  ['bracket', /^\[([A-Z][A-Z0-9]{1,9})-\d+\]:?\s*/],
  ['colon', /^([A-Z][A-Z0-9]{1,9})-\d+:\s+/],
  ['bare', /^([A-Z][A-Z0-9]{1,9})-\d+\s+/],
  ['hash', /^(#)\d+:?\s+/],
];
const TICKET_TAIL = [
  ['bracket', /\s+\[([A-Z][A-Z0-9]{1,9})-\d+\]$/],
  ['paren', /\s+\(([A-Z][A-Z0-9]{1,9})-\d+\)$/],
  ['bare', /\s+([A-Z][A-Z0-9]{1,9})-\d+$/],
  ['hash', /\s+(#)\d+$/],
];
// Go 식 「net/http: …」「runtime: …」 — 바꾼 영역 이름표(타입 아님)
const AREA = /^([a-z][\w.-]*(?:\/[\w.-]+)*(?:,\s*[\w./-]+)*):\s+\S/;
const headTicket = (s) => {
  for (const [form, re] of TICKET_HEAD) {
    const m = s.match(re);
    if (m) return { t: { pos: 'prefix', form, key: m[1] }, rest: s.slice(m[0].length) };
  }
  return { t: null, rest: s };
};
export const parseSubject = (subject) => {
  const squash = SQUASH.test(subject);
  let s = subject.replace(SQUASH, '').trim();
  const e = s.match(EMOJI);
  const emoji = e ? (e[1] ? 'code' : 'char') : null;
  if (e) s = s.slice(e[0].length);
  let { t: ticket, rest } = headTicket(s);
  s = rest;
  const c = s.match(ANY_CONVENTIONAL);
  const type = c ? c[1] : null;
  const scope = c?.[2] ? c[2].slice(1, -1) : null;
  const std = CONVENTIONAL.test(s);
  const area = !std ? s.match(AREA)?.[1] || null : null;
  let desc = c ? s.slice(s.indexOf(':') + 1).trim() : area ? s.slice(area.length + 1).trim() : s;
  // 타입 바로 뒤의 이슈 번호(feat: [ABC-1] …)도 앞 번호로 친다
  if (!ticket) ({ t: ticket, rest: desc } = headTicket(desc));
  if (!ticket) {
    for (const [form, re] of TICKET_TAIL) {
      const m = desc.match(re);
      if (m) { ticket = { pos: 'suffix', form, key: m[1] }; desc = desc.slice(0, m.index); break; }
    }
  }
  const first = desc.match(/^[A-Za-z]/) ? (/^[a-z]/.test(desc) ? 'lower' : 'upper') : null;
  return { squash, emoji, ticket, type, scope, std, area, desc, first, period: /[^.]\.$/.test(desc) };
};

// 가장 많은 값과 그 수
const most = (vals) => {
  const n = {};
  for (const v of vals) if (v != null) n[v] = (n[v] || 0) + 1;
  return Object.entries(n).sort((a, b) => b[1] - a[1]);
};
const dominant = (k, n) => n >= FORMAT_MIN && k / n >= FORMAT_SHARE;
// 자유 꼴로 볼 앞붙이 없는 제목 비율
const FREE_SHARE = 0.8;
const marked = (p) => !!(p.type || p.area || p.ticket || p.emoji);
const topOf = (vals, min = 1) => most(vals).filter(([, k]) => k >= min).slice(0, TOP).map(([v]) => v);
const TRAILERS = ['Co-authored-by', 'Signed-off-by', 'Reviewed-by', 'Refs', 'Closes', 'Fixes', 'Change-Id'];

// 제목 목록(+본문) → 분명히 많은 꼴. 아무것도 많지 않으면 null.
// { n, conventional?: { types, scopes? }, area?: [이름표], ticket?: { pos, form, key }, emoji?: 'code'|'char', lang?: 'ko'|'en',
//   first?: 'lower'|'upper', period?: true|false, trailers?: [키], examples: [제목] }
export const analyze = (rows) => {
  const n = rows.length;
  if (n < FORMAT_MIN) return null;
  const ps = rows.map((r) => parseSubject(r.s));
  const out = { n };
  // 타입: 표준 타입(feat·fix…)이 절반 넘을 때만 표준 밖 타입도 센다(detect.mjs history 와 같은 판정 — Go 식 영역 이름표는 타입이 아니다)
  const std = ps.filter((p) => p.std).length;
  const conv = ps.filter((p) => p.std || (p.type && std * 2 > n));
  if (dominant(conv.length, n)) {
    out.conventional = { types: topOf(conv.map((p) => p.type)) };
    const scoped = conv.filter((p) => p.scope);
    if (dominant(scoped.length, conv.length)) out.conventional.scopes = topOf(scoped.map((p) => p.scope), 2);
  } else {
    const areas = ps.filter((p) => p.area);
    if (dominant(areas.length, n)) out.area = topOf(areas.map((p) => p.area), 2);
  }
  const [tk] = most(ps.map((p) => (p.ticket ? `${p.ticket.pos}|${p.ticket.form}` : null)));
  if (tk && dominant(tk[1], n)) {
    const [pos, form] = tk[0].split('|');
    const same = ps.filter((p) => p.ticket?.pos === pos && p.ticket.form === form);
    out.ticket = { pos, form, key: most(same.map((p) => p.ticket.key))[0][0] };
  }
  const [em] = most(ps.map((p) => p.emoji));
  if (em && dominant(ps.filter((p) => p.emoji).length, n)) out.emoji = em[0];
  const ko = rows.filter(isKorean).length;
  const en = rows.filter(isEnglish).length;
  if (dominant(ko, n)) out.lang = 'ko';
  else if (dominant(en, n)) out.lang = 'en';
  // 첫 낱말 대소문자는 라틴 글자로 시작하는 제목에서만(한국어 제목은 셈에서 뺀다)
  const latin = ps.filter((p) => p.first);
  const [fc] = most(latin.map((p) => p.first));
  if (fc && dominant(fc[1], latin.length)) out.first = fc[0];
  const dots = ps.filter((p) => p.period).length;
  if (dominant(dots, n)) out.period = true;
  else if (dominant(n - dots, n)) out.period = false;
  const trailers = TRAILERS.filter((k) => dominant(rows.filter((r) => new RegExp(`^${k}:\\s*\\S`, 'mi').test(r.b || '')).length, n));
  if (trailers.length) out.trailers = trailers;
  // 앞붙이(타입·영역·이슈 번호·그림 글자)가 많은 꼴이 없으면 「자유 꼴」 — 앞붙이 없는 제목이 FREE_SHARE 이상일 때만 언어·대소문자 같은
  // 약한 꼴을 말한다. 앞붙이가 제각각인 기록(feat: · [ABC-1] · :bug: 이 섞임)에 「영어로, 소문자로」 + 엉뚱한 예를 내지 않게
  const shaped = ['conventional', 'area', 'ticket', 'emoji'].some((k) => out[k]);
  if (!shaped && ps.filter(marked).length > n * (1 - FREE_SHARE)) return null;
  out.free = !shaped;
  // 말할 꼴이 하나도 없으면 null(마침표 없음 하나만으로는 꼴이라 하지 않는다 — 거의 모든 저장소가 그렇다)
  const said = shaped || ['lang', 'first', 'trailers'].some((k) => out[k]) || out.period === true;
  if (!said) return null;
  out.examples = examplesOf(rows, ps, out);
  return out;
};

// 예로 보일 제목: 말한 꼴을 모두 따르는 최근 제목 2~3개. 비밀값처럼 보이는 것은 빼고, 글은 다듬고 길이를 자른다
const LONG_TOKEN = /(?=[A-Za-z0-9+/_=-]{32,})(?=[^\s]*\d)(?=[^\s]*[A-Za-z])[A-Za-z0-9+/_=-]{32,}/;
const NAMED = /\b(?:password|passwd|pwd|secret|token|api[_-]?key|private[_-]?key)\s*[:=]\s*\S/i;
const looksSecret = (s) => LONG_TOKEN.test(s) || NAMED.test(s) || /:\/\/[^\s/@]+:[^\s/@]+@/.test(s) || findSecrets(s).length > 0;
// 마크다운·관리 구역·지침 표시를 깨지 않게: 백틱·{{ }}·<!-- --> 와 제어 글자를 뺀다
export const cleanExample = (s) => {
  const t = s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/`/g, "'").replace(/\{\{[^}]{0,80}\}\}/g, '').replace(/\{\{|\}\}/g, '').replace(/<!--|-->/g, '').replace(/\s+/g, ' ').trim();
  return t.length > EXAMPLE_MAX ? `${t.slice(0, EXAMPLE_MAX - 1).trimEnd()}…` : t;
};
const fits = (p, r, f) => (!f.free || !marked(p)) && (!f.conventional || p.std || !!p.type) && (!f.conventional?.scopes || !!p.scope) && (!f.area || !!p.area)
  && (!f.ticket || (p.ticket?.pos === f.ticket.pos && p.ticket.form === f.ticket.form)) && (!f.emoji || p.emoji === f.emoji)
  && (!f.lang || (f.lang === 'ko' ? isKorean(r) : isEnglish(r))) && (!f.first || p.first === f.first) && (f.period == null || p.period === f.period);
const examplesOf = (rows, ps, f) => {
  const out = [];
  rows.forEach((r, i) => {
    if (out.length >= EXAMPLES || !fits(ps[i], r, f) || looksSecret(r.s)) return;
    const ex = cleanExample(r.s.replace(SQUASH, ''));
    if (ex && !out.includes(ex)) out.push(ex);
  });
  return out;
};

// PR·MR 양식 파일(저장소 기준 경로, 많아야 5개). GitHub 은 이름의 대소문자를 가리지 않는다
const TEMPLATE_DIRS = ['.github', 'docs', '.'];
const TEMPLATE_MAX = 5;
const entries = (root, d) => {
  try {
    return fs.readdirSync(path.join(root, d), { withFileTypes: true });
  } catch {
    return [];
  }
};
const posix = (d, f) => (d === '.' ? f : `${d}/${f}`);
const nonEmpty = (root, rel) => {
  try {
    const st = fs.statSync(path.join(root, rel));
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
};
const mdIn = (root, d) => entries(root, d).filter((e) => e.isFile() && /\.md$/i.test(e.name)).map((e) => posix(d, e.name)).sort();
export const prTemplates = (root) => {
  const out = [];
  for (const d of TEMPLATE_DIRS) {
    for (const e of entries(root, d)) {
      if (e.isFile() && /^pull_request_template\.md$/i.test(e.name)) out.push(posix(d, e.name));
      if (e.isDirectory() && /^pull_request_template$/i.test(e.name)) out.push(...mdIn(root, posix(d, e.name)));
    }
  }
  const gl = entries(root, '.gitlab').find((e) => e.isDirectory() && /^merge_request_templates$/i.test(e.name));
  if (gl) out.push(...mdIn(root, `.gitlab/${gl.name}`));
  return [...new Set(out)].filter((f) => nonEmpty(root, f)).slice(0, TEMPLATE_MAX);
};

// PR 제목: 기본 브랜치의 squash 제목(끝 「(#123)」)과 merge 커밋(GitHub 「Merge pull request #12 from …」,
// GitLab 「Merge branch '…' into '…'」 + 본문 「See merge request …!12」)의 본문 첫 줄
const GH_MERGE = /^Merge pull request #\d+ from /;
const GL_MERGE = /^See merge request \S+!\d+/m;
const firstLine = (b) => (b.split('\n').map((l) => l.trim()).find(Boolean) || '');
export const prTitles = (rows, merges) => {
  const squash = rows.filter((r) => SQUASH.test(r.s)).map((r) => ({ s: r.s.replace(SQUASH, '').trim(), b: '' }));
  const merged = merges.filter((m) => GH_MERGE.test(m.s) || GL_MERGE.test(m.b))
    .map((m) => ({ s: firstLine(m.b), b: '' })).filter((t) => t.s && !GL_MERGE.test(t.s));
  return squash.length >= merged.length ? squash : merged;
};
// pr-writer 스킬의 제목 꼴(<type>(<scope>): <subject>)과 다른지 — 다르면 「저장소 형식이 앞선다」 줄
export const titleDiffers = (t) => !!t && (!t.conventional || !!t.ticket || !!t.emoji);

// 저장소 → { commit, pr: { templates, title, own } }. own: pr-writer 기본 꼴과 다른 저장소 형식이 있는지
// rows: 이미 읽은 커밋(readLog — detect.mjs 가 저장소 맨 위에서 한 번 읽어 넘긴다). 없으면 읽고, 양식 파일은 저장소 맨 위에서 찾는다
// (apply.mjs 는 하위 폴더에서 부를 수 있다). 봇 커밋은 세지 않는다
export const vcsOf = (root, rows) => {
  const top = rows ? root : git(root, ['rev-parse', '--show-toplevel']).trim() || root;
  rows ||= readLog(root);
  const people = rows.filter((r) => !BOT.test(`${r.name} ${r.mail}`));
  const commit = analyze(people);
  const templates = prTemplates(top);
  const title = analyze(prTitles(people, readMerges(root)));
  return { commit, pr: { templates, title, own: templates.length > 0 || titleDiffers(title) } };
};
