// 검사 한 줄에 붙는 옵션(packs.json hooks[].options). 값 고르기·검사는 hook-options.js(서버와 같음).
// 훅 코드가 실제로 읽는 옵션만 있다(scripts/test/hook-options.test.mjs). 돌려주는 것은 부품 배열(없으면 빈 배열).
// 배치(옵션 배치 A안, 2026-11-12 사용자 결정): 옵션마다 한 줄씩 — 이름, 그 아래 칸, 그 아래 설명이 같은 왼쪽 선에 선다.
// 목록 칸은 칩(opt-list.js), 고르기는 설명 달린 메뉴(menu-select.js), 켜고 끄기는 체크 상자.
import { h } from './dom.js';
import { withCode, checkRow, field } from './parts.js';
import { optionValue, ownedKeys } from './hook-options.js';
import { listField } from './opt-list.js';
import { menuSelect } from './menu-select.js';

export function hookOptions(c, hook) {
  const { S, sel, ui, t, act } = c;
  if (!hook.options?.length) return [];
  const flow = S.flows.find((f) => f.id === sel.flow);
  const owned = ownedKeys(S.flows, hook.id);
  return hook.options.map((opt) => {
    const v = optionValue({ id: hook.id, opt, flow, owned, prev: S.prevRules, user: sel.hookOpts, base: sel.baseOpts });
    const key = `opt:${hook.id}:${opt.key}`;
    const touched = !!sel.hookOpts?.[hook.id] && opt.key in sel.hookOpts[hook.id];
    const fromFlow = owned.has(opt.key) && !touched && flow && flow.hooks?.[hook.id]?.[opt.key] !== undefined;
    const helpId = `help-${hook.id}-${opt.key}`.replace(/[^\w-]/g, '_');
    const flowNote = fromFlow ? ` ${t('optFromFlow', { name: flow.name })}` : '';
    if (opt.type === 'list') {
      return listField(c, { hook, opt, v, bad: ui.optBad?.[key], key, helpId, help: flowNote,
        set: (values, bad) => act.setHookOpt(hook.id, opt.key, values, bad) });
    }
    const help = h('p.meta', { id: helpId }, withCode(opt.help), flowNote);
    if (opt.type === 'toggle') {
      return h('div.opt.tog', {}, checkRow({ key, on: !!v, label: opt.label, describedBy: helpId, onChange: (e) => act.setHookOpt(hook.id, opt.key, e.target.checked) }), help);
    }
    const nameId = `name-${helpId}`;
    return h('div.opt', {}, field({ name: opt.label, nameId, help,
      control: menuSelect({ key, labelId: nameId, describedBy: helpId, choices: opt.choices, value: v,
        onChange: (ch) => act.setHookOpt(hook.id, opt.key, ch.value) }) }));
  });
}
