// 확인 단계 알림: 한 줄(제목) + 「자세히」로 나머지 설명을 편다. 알림이 여럿이어도 한눈에 훑을 수 있게, 정보는 그대로 둔다.
// 펼친 상태는 ui.open(app.js toggleOpen)에 둬서 미리보기가 다시 그려도 닫히지 않는다.
import { h, icon } from './dom.js';
import { link } from './parts.js';

// 「자세히」 단추와 펼친 내용. 내용이 없으면 [null, null]
export function moreToggle({ ui, t, act }, key, body) {
  const kids = [body].flat(Infinity).filter((x) => x != null && x !== false && x !== '');
  if (!kids.length) return [null, null];
  const k = `more:${key}`;
  const open = ui.open.has(k);
  const id = `more-${key}`;
  return [
    link(k, open ? t('moreHide') : t('more'), () => act.toggleOpen(k), { class: 'more', 'aria-expanded': String(open), 'aria-controls': id }),
    open ? h('div.more-b', { id }, kids.map((x) => (typeof x === 'string' ? h('p', {}, x) : x))) : null,
  ];
}

// 알림 띠 한 줄: 아이콘 · 제목(+ 짧은 덧말) · 자세히 · (단추)
export function noteFlash(c, { key, title, aside = null, body, btn = null, cls = '', role = 'note', attrs = {} }) {
  const [toggle, more] = moreToggle(c, key, body);
  return h(`div.flash.compact${cls}`, { role, ...attrs }, icon(cls.includes('info') ? 'i-info' : 'i-warn'),
    h('div.sp', {},
      h('div.one', {}, h('b', {}, title), aside ? h('span.aside', {}, aside) : null, toggle),
      more),
    btn);
}
