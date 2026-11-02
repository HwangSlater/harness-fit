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

// 선 아이콘(24×24, 선 굵기 2)
export const icon = (d, size = 16) =>
  s('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
    s('path', { d }));

// 문구: {이름} 자리를 채운다
export const fmt = (text, vars = {}) => String(text).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
