// 고르기 칸 — 버튼에는 짧은 이름만, 누르면 선택지마다 「이름 + 설명 한 줄」이 든 메뉴(드롭다운 4안, 2026-11-12 사용자 결정).
// 브라우저 기본 <select> 는 펼친 목록을 꾸밀 수 없고, 긴 선택지 글이 칸 안에서 잘리거나 꺾였다.
// 모양은 Primer ActionMenu 를 따른다: 고른 줄은 맨 앞에 체크, 설명은 이름 아래 한 줄.
// 키보드: 버튼에서 Enter·Space·↓·↑ 로 열고, 메뉴에서 ↑↓·Home·End 로 옮기고 Enter·Space 로 고르고 Esc·Tab 으로 닫는다.
// 화면 전체를 다시 그려도 열린 메뉴가 닫히지 않게 열린 칸과 가리키는 줄을 모듈에 둔다.
import { h, icon } from './dom.js';

const state = { key: null, active: 0 };
const byKey = (key) => document.querySelector(`[data-menu="${CSS.escape(key)}"]`);

// 메뉴 밖을 누르면 닫는다(한 번만 붙인다)
document.addEventListener('pointerdown', (e) => {
  if (state.key && !byKey(state.key)?.contains(e.target)) close(false);
}, true);

// 칸 key → 그 칸만 다시 그리는 함수(그릴 때마다 덮어써서 쌓이지 않는다)
const drawers = new Map();
const close = (focusButton = true) => {
  const key = state.key;
  state.key = null;
  drawers.get(key)?.();
  if (focusButton && key) byKey(key)?.querySelector('button')?.focus();
};

// props: { key, labelId(칸 이름 요소 id), describedBy, choices: [{ value, label, desc? }], value, disabled, onChange(choice) }
export function menuSelect(props) {
  const { key, labelId, describedBy, choices, value, disabled = false, onChange } = props;
  const cur = Math.max(0, choices.findIndex((c) => c.value === value));
  const open = state.key === key;
  const listId = `menu-${key}`.replace(/[^\w-]/g, '_');
  const optId = (i) => `${listId}-o${i}`;
  // 이 칸만 다시 그린다(앱 전체 render 없이 열고 닫기·옮기기)
  const self = () => {
    const el = byKey(key);
    if (!el) return;
    const next = menuSelect(props);
    el.replaceWith(next);
    if (state.key === key) next.querySelector('[role="listbox"]')?.focus({ preventScroll: true });
  };
  drawers.set(key, self);
  const openAt = (i) => {
    if (state.key && state.key !== key) close(false);
    state.key = key;
    state.active = i;
    self();
    // 메뉴 전체가 보이게 — 가리키는 줄만 보이게 하면 목록 맨 아래 칸에서 메뉴 아래쪽이 가려졌다(검토 2026-11-12)
    byKey(key)?.querySelector('[role="listbox"]')?.scrollIntoView({ block: 'nearest' });
  };
  const pick = (i) => {
    state.key = null;
    const c = choices[i];
    if (c.value !== value) onChange(c);
    else self();
    byKey(key)?.querySelector('button')?.focus();
  };
  const move = (i) => {
    state.active = (i + choices.length) % choices.length;
    self();
    byKey(key)?.querySelector(`#${CSS.escape(optId(state.active))}`)?.scrollIntoView({ block: 'nearest' });
  };

  const button = h('button.msel-btn', {
    type: 'button', 'data-key': key, disabled, 'aria-haspopup': 'listbox', 'aria-expanded': String(open),
    'aria-controls': open ? listId : null, 'aria-labelledby': labelId ? `${labelId} ${listId}-v` : null, 'aria-describedby': describedBy || null,
    on: {
      click: () => (open ? close() : openAt(cur)),
      keydown: (e) => {
        if (['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); openAt(cur); }
      },
    },
  }, h('span', { id: `${listId}-v` }, choices[cur]?.label ?? ''), icon('i-down'));

  const list = open ? h('ul.msel-menu', {
    // data-key: 미리보기 응답으로 앱 전체를 다시 그려도 초점이 메뉴에 남게(app.js render 가 data-key 로 초점을 되돌린다)
    id: listId, 'data-key': `${key}:list`, role: 'listbox', tabindex: '-1', 'aria-labelledby': labelId || null, 'aria-activedescendant': optId(state.active),
    on: {
      keydown: (e) => {
        const k = e.key;
        if (k === 'ArrowDown') { e.preventDefault(); move(state.active + 1); }
        else if (k === 'ArrowUp') { e.preventDefault(); move(state.active - 1); }
        else if (k === 'Home') { e.preventDefault(); move(0); }
        else if (k === 'End') { e.preventDefault(); move(choices.length - 1); }
        else if (k === 'Enter' || k === ' ') { e.preventDefault(); pick(state.active); }
        else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        // Tab: 초점을 버튼에 먼저 돌려 브라우저가 버튼 기준으로 다음·앞 칸을 고르게 하고, 옮긴 뒤에 닫는다.
        // 메뉴를 먼저 지우면 기준점이 사라져 초점이 한 칸씩 밀렸다(검토 2026-11-12)
        else if (k === 'Tab') { byKey(key)?.querySelector('button')?.focus(); setTimeout(() => (state.key === key ? close(false) : null), 0); }
      },
    },
  }, choices.map((c, i) => h(`li${i === state.active ? '.act' : ''}`, {
    id: optId(i), role: 'option', 'aria-selected': String(i === cur),
    on: { click: () => pick(i), pointermove: () => (state.active !== i ? move(i) : null) },
  }, i === cur ? icon('i-check') : h('span'), h('b', {}, c.label), c.desc ? h('small', {}, c.desc) : null))) : null;

  return h(`span.msel${open ? '.open' : ''}`, { 'data-menu': key }, button, list);
}
