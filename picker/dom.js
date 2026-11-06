// 화면 부품을 만드는 작은 도우미. 글자는 언제나 textContent 로만 들어간다(카탈로그 글은 외부 저장소에서 온다).

// h('div.a.b', { on: { click }, ...속성 }, ...자식)
export const h = (tag, props, ...kids) => build(document.createElement(tag.split('.')[0]), tag, props, kids);

// SVG 도형. s('path', { d: '…' })
const NS = 'http://www.w3.org/2000/svg'; // lint:allow url SVG 네임스페이스 식별자(표준 고정값, 접속하지 않음)
export const s = (tag, props, ...kids) => build(document.createElementNS(NS, tag.split('.')[0]), tag, props, kids);

function build(el, tag, props, kids) {
  const cls = tag.split('.').slice(1);
  if (cls.length) el.setAttribute('class', cls.join(' '));
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'class') el.setAttribute('class', [...cls, v].filter(Boolean).join(' '));
    else if (k === 'value') el.value = v;
    else if (k === 'style') el.style.cssText = v; // CSSOM 으로 넣어 CSP(style-src 'self')에 막히지 않게
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

// 선 아이콘: index.html 의 <symbol id="i-…"> 를 가져다 쓴다(꼴은 components.css 의 svg.i)
export const icon = (id, cls = 'i') => s('svg', { class: cls, 'aria-hidden': 'true' }, s('use', { href: `#${id}` }));

// 문구: {이름} 자리를 채운다. {이름|하나일 때|여럿일 때} 는 그 값의 수로 낱말을 고른다(영어 단·복수 — 「1 instruction」·「2 instructions」).
// 수는 Intl.PluralRules(lang) 로 가린다. 한국어 문구는 이 꼴을 쓰지 않는다(늘 other). 값이 「1,234」처럼 꾸민 글이어도 숫자만 본다.
const plurals = new Map();
const pluralOf = (lang, v) => {
  if (!plurals.has(lang)) plurals.set(lang, new Intl.PluralRules(lang));
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return plurals.get(lang).select(Number.isFinite(n) ? n : 0);
};
export const fmt = (text, vars = {}, lang = 'en') =>
  String(text).replace(/\{(\w+)(?:\|([^|{}]*)\|([^|{}]*))?\}/g, (_, k, one, other) => (one === undefined ? vars[k] ?? '' : pluralOf(lang, vars[k]) === 'one' ? one : other));
