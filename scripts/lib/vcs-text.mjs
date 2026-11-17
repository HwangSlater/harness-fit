// 감지한 커밋·PR 형식(scripts/lib/vcs-format.mjs) → 지침 줄의 자리({{fmt:commit}}·{{fmt:prTemplate}}·{{fmt:prTitle}}·{{fmt:prOwn}} —
// rules/vcs-format.*.md, 채우기는 claude-md.mjs fillCmd). 감지가 말한 것만 글로 만든다. 없으면 그 자리는 비고 줄이 빠진다.
import { cleanExample, titleDiffers } from './vcs-format.mjs';

const code = (s) => `\`${cleanExample(s)}\``;
const W = {
  ko: {
    sep: ', ', ex: ' — 예: ', same: '최근 기록과 같은 꼴', and: '·',
    conv: (scopes, types) => `${scopes ? '`타입(범위): 요약`' : '`타입: 요약`'}(타입 ${types}${scopes ? `, 범위 ${scopes} 등` : ''})`,
    scopeOnly: (scopes) => `타입 뒤에 범위(${scopes} 등)`,
    area: (areas) => `앞에 바꾼 영역과 쌍점(${areas} 등)`,
    ticket: (pos, t) => `${pos === 'prefix' ? '앞에' : '끝에'} 이슈 번호 ${t}`,
    emoji: { code: '앞에 gitmoji 이름(`:sparkles:` 꼴)', char: '앞에 gitmoji 그림 글자(✨ 꼴)' },
    lang: { ko: '한국어로', en: '영어로' },
    first: { lower: '첫 낱말은 소문자로', upper: '첫 글자는 대문자로' },
    period: { true: '마침표로 끝낸다', false: '끝에 마침표 없이' },
    trailers: (list) => `본문 끝에 ${list} 줄${list.includes('Signed-off-by') ? '(`git commit -s`)' : ''}`,
    many: (list) => `${list} 가운데 맞는`,
    ownTemplate: (t) => `${t} 양식`, ownTitle: '제목 꼴',
  },
  en: {
    sep: ', ', ex: ' — e.g. ', same: 'the same shape as recent history', and: ' and ',
    conv: (scopes, types) => `${scopes ? '`type(scope): summary`' : '`type: summary`'} (types ${types}${scopes ? `; scopes such as ${scopes}` : ''})`,
    scopeOnly: (scopes) => `a scope after the type (such as ${scopes})`,
    area: (areas) => `the changed area and a colon first (such as ${areas})`,
    ticket: (pos, t) => `issue key ${t} ${pos === 'prefix' ? 'first' : 'at the end'}`,
    emoji: { code: 'a gitmoji shortcode first (`:sparkles:`)', char: 'a gitmoji first (✨)' },
    lang: { ko: 'in Korean', en: 'in English' },
    first: { lower: 'lowercase first word', upper: 'capitalised first word' },
    period: { true: 'ending with a period', false: 'no trailing period' },
    trailers: (list) => `a ${list} trailer${list.includes('Signed-off-by') ? ' (`git commit -s`)' : ''}`,
    many: (list) => `the matching one of ${list}`,
    ownTemplate: (t) => `the ${t} template`, ownTitle: 'the title style',
  },
};
// 예로 보일 번호(이슈 번호 자리)
const NO = '123';
const TICKET = { bracket: (k) => `[${k}-${NO}]`, colon: (k) => `${k}-${NO}:`, bare: (k) => `${k}-${NO}`, paren: (k) => `(${k}-${NO})`, hash: () => `#${NO}` };
const list = (xs, w = ' · ') => xs.map(code).join(w);

// 꼴 하나(커밋 또는 PR 제목) → 한 줄 글. enforced: 커밋 형식 훅이 이미 막는 것(type·lang)은 적지 않는다(훅과 겹치지 않게).
// 말할 꼴도 예도 없으면 ''
export const describe = (f, lang, enforced = {}) => {
  if (!f) return '';
  const w = W[lang] || W.en;
  const parts = [];
  const c = f.conventional;
  if (c && !enforced.type) parts.push(w.conv(c.scopes ? list(c.scopes) : '', c.types.join('·')));
  else if (c?.scopes) parts.push(w.scopeOnly(list(c.scopes)));
  if (f.area) parts.push(w.area(list(f.area)));
  if (f.ticket) parts.push(w.ticket(f.ticket.pos, code(TICKET[f.ticket.form](f.ticket.key))));
  if (f.emoji) parts.push(w.emoji[f.emoji]);
  if (f.lang && !enforced.lang) parts.push(w.lang[f.lang]);
  if (f.first) parts.push(w.first[f.first]);
  if (f.period != null) parts.push(w.period[f.period]);
  if (f.trailers) parts.push(w.trailers(list(f.trailers.map((k) => `${k}:`), w.and)));
  const ex = f.examples?.length ? `${w.ex}${list(f.examples)}` : '';
  if (!parts.length && !ex) return '';
  return `${parts.length ? parts.join(w.sep) : w.same}${ex}`;
};

// 커밋 형식 훅(commit-msg)이 켜졌을 때 막는 것: 타입(style 이 free 가 아니면), 언어(lang 이 ko·en 이면)
export const enforcedBy = (hooks = [], opts = {}) => {
  if (!hooks.includes('commit-msg')) return {};
  return { type: (opts.style || 'conventional') !== 'free', lang: opts.lang === 'ko' || opts.lang === 'en' };
};

// 감지 결과 → { commit, prTemplate, prTitle, prOwn }(빈 것은 뺀다). enforced: enforcedBy 결과
export const vcsTexts = (vcs, lang, enforced = {}) => {
  if (!vcs || typeof vcs !== 'object') return {};
  const w = W[lang] || W.en;
  const out = {};
  const commit = describe(vcs.commit, lang, enforced);
  if (commit) out.commit = commit;
  const t = Array.isArray(vcs.pr?.templates) ? vcs.pr.templates : [];
  if (t.length) out.prTemplate = t.length === 1 ? code(t[0]) : w.many(list(t));
  const title = describe(vcs.pr?.title, lang);
  if (title) out.prTitle = title;
  if (vcs.pr?.own) {
    const own = [...(t.length ? [w.ownTemplate(code(t[0]))] : []), ...(title && titleDiffers(vcs.pr.title) ? [w.ownTitle] : [])];
    if (own.length) out.prOwn = own.join(w.and);
  }
  return out;
};
