// 답 언어 판정(answer-lang 훅). 짐작이다 — 낱말 수로 견주므로 100% 는 아니다(packs.json detail 에 적어 둔다).
// 놓쳐도 위험하지 않아 「사용자가 고른 언어로 답하게」 하는 옵션으로 둔다(2026-11-06 사용자 결정).
// 세지 않는 것: 코드 블록·인라인 코드·HTML 태그·「>」 인용 줄·주소·링크 주소·경로, 따옴표·낫표 속 인용, 한글·한자 뒤 괄호 속 원어,
//   표 구분 줄, 이름표(sec-check, Chart.js), 숫자 섞인 말(v2, 1280px), 낙타 표기(tapSite), 대문자 줄임말(AI, CSS).
// 사용자 전역 korean-check 의 기준(2,105턴 기록으로 맞춘 값)을 언어 여럿으로 넓혔다.
export const ANSWER_LANGS = ['ko', 'en', 'ja', 'zh'];
export const DEFAULT_ANSWER_LANG = 'ko';
export const LIMITS = { msgWords: 6, msgShare: 3, turnWords: 25, turnFn: 3 };

// 영어 문장에 거의 늘 들어가는 기능어(이름만 나열한 줄과 문장을 가른다)
const FUNCTION_WORDS = new Set(('the a an to of and or in on for with is are was were be been it its this that these those now then so ' +
  "i i'll i'm i've we let me my our next first from by at as not no all both will can just before after into up out than also " +
  'but if when while what which there here do does did has have had get got').split(' '));

export const cleanForCount = (t) =>
  String(t)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/<[^>\n]+>/g, ' ')
    .replace(/^\s*>.*$/gm, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\]\([^)\n]*\)/g, '] ')
    .replace(/[A-Za-z]:[\\/][^\s)]*/g, ' ')
    .replace(/(^|\s)[~.]?\/[\w./-]+/g, ' ')
    .replace(/「[^」\n]*」|『[^』\n]*』|“[^”\n]*”|‘[^’\n]*’|"[^"\n]*"/g, ' ')
    .replace(/([가-힣぀-ヿ一-鿿])[(（][^)）\n]*[)）]/g, '$1 ')
    .replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, ' ')
    .replace(/[A-Za-z0-9]*[A-Za-z][A-Za-z0-9]*(?:[-_.:#@/=+][A-Za-z0-9]+)+/g, ' ')
    .replace(/\b[A-Za-z]*\d[A-Za-z\d]*\b/g, ' ')
    .replace(/\b[a-z]+[A-Z][A-Za-z]*\b/g, ' ')
    .replace(/\b[A-Z]{2,}s?\b/g, ' ');

const count = (re, s) => (s.match(re) || []).length;
// 글자 모양별 낱말 수. 한국어는 띄어 쓴 덩어리, 일본어·중국어는 띄어 쓰지 않아 두 글자를 한 낱말로 친다.
// 메시지 하나에서 보는 글의 길이(아주 긴 답은 앞부분만 — 끝낼 때마다 도는 훅이 몇 초씩 걸리지 않게)
export const MAX_TEXT = 64 * 1024;
export const countWords = (t) => {
  const s = cleanForCount(String(t).slice(0, MAX_TEXT));
  const kana = count(/[぀-ヿ]/g, s);
  const han = count(/[一-鿿]/g, s);
  const latin = s.match(/[A-Za-z']+/g) || [];
  return {
    ko: count(/[가-힣]+/g, s),
    // 가나가 있으면 한자도 일본어로 친다(일본어 글에는 한자가 섞인다)
    ja: kana ? Math.ceil((kana + han) / 2) : 0,
    zh: kana ? 0 : Math.ceil(han / 2),
    en: latin.filter((w) => w.length >= 2).length,
    fn: latin.filter((w) => FUNCTION_WORDS.has(w.toLowerCase())).length,
  };
};

// 고른 언어(want)가 아닌 낱말 수. 영어 낱말은 문장일 때만(기능어가 있을 때) 다른 언어로 친다 — 이름 나열은 문장이 아니다.
const others = (w, want, minFn) => ANSWER_LANGS.filter((l) => l !== want).reduce((n, l) => n + (l === 'en' && w.fn < minFn ? 0 : w[l]), 0);

// texts: 마지막 답(메시지마다 하나) → { block, bad }
export const judgeLang = (texts, want = DEFAULT_ANSWER_LANG) => {
  const lang = ANSWER_LANGS.includes(want) ? want : DEFAULT_ANSWER_LANG;
  const bad = texts.filter((t) => {
    const w = countWords(t);
    const other = others(w, lang, 1);
    return other >= LIMITS.msgWords && w[lang] * LIMITS.msgShare < other;
  });
  const tot = texts.map(countWords).reduce((a, w) => {
    for (const k of Object.keys(w)) a[k] = (a[k] || 0) + w[k];
    return a;
  }, {});
  const other = texts.length ? others(tot, lang, LIMITS.turnFn) : 0;
  const lowShare = other >= LIMITS.turnWords && other > (tot[lang] || 0);
  return { block: bad.length > 0 || lowShare, bad };
};
