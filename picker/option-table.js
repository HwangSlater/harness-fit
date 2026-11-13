// 확인 단계의 「훅 옵션」 표 — 옵션 칸 B안(2026-11-12). 켠 훅 가운데 기본값에서 바뀐 옵션만 한 줄씩:
// 훅 · 옵션 · 값 · 바꾸기. 목록 값은 한 줄에 하나, 저장소에서 찾은 값에는 저장소 표시(opt-list.js 와 같은 판정).
// 적용 전에 「무엇을 묻고 무엇을 지키는지」를 한눈에 보게 — 칩은 훅 창 안에 있어 확인 단계에서는 보이지 않았다.
import { h, icon } from './dom.js';
import { link } from './parts.js';
import { optionValue, ownedKeys } from './hook-options.js';
import { repoWhy, reasonLine } from './opt-list.js';

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// 받지 않은 값(빨간 값)이 남은 칸도 넣는다 — 적용 전에 빠진 값을 알 수 있게(화면 역할 평가 2026-11-12)
export const changedOptions = ({ S, sel, ui }) => {
  const flow = S.flows.find((f) => f.id === sel.flow);
  const rows = [];
  for (const hook of S.hooks) {
    if (!sel.hooks.has(hook.id) || !hook.options?.length) continue;
    const owned = ownedKeys(S.flows, hook.id);
    for (const opt of hook.options) {
      const v = optionValue({ id: hook.id, opt, flow, owned, prev: S.prevRules, user: sel.hookOpts, base: sel.baseOpts });
      const bad = ui?.optBad?.[`opt:${hook.id}:${opt.key}`] || [];
      if (!same(v, opt.default) || bad.length) rows.push({ hook, opt, v, bad });
    }
  }
  return rows;
};

const valueCell = (c, r) => {
  const { t } = c;
  const { opt, v, bad = [] } = r;
  const empty = opt.type === 'list' && !v.length && Array.isArray(opt.default) && opt.default.length > 0;
  return [listValue(c, r),
    empty ? h('p.warn', {}, t('optEmptyWarn')) : null,
    bad.length ? h('p.err', {}, t('optTableBad', { n: bad.length, list: bad.map((x) => (x.length > 40 ? `${x.slice(0, 40)}…` : x)).join(', ') })) : null];
};
const listValue = ({ S, t }, { hook, opt, v }) => {
  if (opt.type === 'toggle') return t(v ? 'optOn' : 'optOff');
  if (opt.type === 'select') return opt.choices.find((ch) => ch.value === v)?.label ?? String(v);
  if (!v.length) return t('optEmpty');
  return h('ul', {}, v.map((x) => {
    const why = repoWhy(S, hook.id, opt.key, x);
    return h('li', why ? { title: reasonLine(t, why) } : {}, why ? icon('i-repo') : h('span'), h('code', {}, x));
  }));
};

export function optionTable(c) {
  const { S, t, act } = c;
  const rows = changedOptions(c);
  if (!rows.length) return null;
  const anyRepo = rows.some(({ hook, opt, v }) => opt.type === 'list' && v.some((x) => repoWhy(S, hook.id, opt.key, x)));
  // 바꾸기: 훅 전체 보기 창에서 그 훅으로 가서 그 옵션 칸에 초점
  const go = (hook, opt) => () => {
    act.browseTo('hooks', hook.id);
    document.querySelector(`#panel [data-key="${CSS.escape(`opt:${hook.id}:${opt.key}`)}"]`)?.focus({ preventScroll: true });
  };
  return h('div.box.otab', {},
    h('div.box-h', {}, h('span', {}, t('optTableTitle')), h('span.muted', {}, t('optTableCount', { n: rows.length }))),
    h('table', {},
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, t('optColHook')), h('th', { scope: 'col' }, t('optColOpt')), h('th', { scope: 'col' }, t('optColValue')), h('th', { scope: 'col' }, h('span.sr', {}, t('change'))))),
      h('tbody', {}, rows.map((r) => h('tr', {},
        h('th', { scope: 'row' }, r.hook.name),
        h('td.o', {}, r.opt.label),
        h('td.vv', {}, valueCell(c, r)),
        h('td.c', {}, link(`optEdit:${r.hook.id}:${r.opt.key}`, t('change'), go(r.hook, r.opt), { 'aria-label': t('optEditLabel', { hook: r.hook.name, opt: r.opt.label }), 'aria-haspopup': 'dialog' })))))),
    anyRepo ? h('p.legend', {}, icon('i-repo'), t('optLegend')) : null);
}
