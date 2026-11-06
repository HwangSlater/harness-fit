// 검사 한 줄에 붙는 옵션(packs.json hooks[].options). 값 고르기·검사는 hook-options.js(서버와 같음).
// 훅 코드가 실제로 읽는 옵션만 있다(scripts/test/hook-options.test.mjs). 돌려주는 것은 부품 배열(없으면 빈 배열).
import { h } from './dom.js';
import { withCode } from './parts.js';
import { optionValue, ownedKeys, parseList } from './hook-options.js';

export function hookOptions({ S, sel, ui, t, act }, hook) {
  if (!hook.options?.length) return [];
  const flow = S.flows.find((f) => f.id === sel.flow);
  const owned = ownedKeys(S.flows, hook.id);
  return hook.options.map((opt) => {
    const v = optionValue({ id: hook.id, opt, flow, owned, prev: S.prevRules, user: sel.hookOpts });
    const key = `opt:${hook.id}:${opt.key}`;
    const touched = !!sel.hookOpts?.[hook.id] && opt.key in sel.hookOpts[hook.id];
    const fromFlow = owned.has(opt.key) && !touched && flow && flow.hooks?.[hook.id]?.[opt.key] !== undefined;
    const bad = ui.optBad?.[key];
    const helpId = `help-${hook.id}-${opt.key}`.replace(/[^\w-]/g, '_');
    const control = opt.type === 'toggle'
      ? h('input', { type: 'checkbox', checked: !!v, 'data-key': key, 'aria-describedby': helpId, on: { change: (e) => act.setHookOpt(hook.id, opt.key, e.target.checked) } })
      : opt.type === 'select'
        ? h('select.field', { 'data-key': key, 'aria-describedby': helpId, on: { change: (e) => act.setHookOpt(hook.id, opt.key, opt.choices[e.target.selectedIndex].value) } },
          opt.choices.map((ch) => h('option', { selected: ch.value === v }, ch.label)))
        // 목록은 입력을 마쳤을 때(change) 반영한다 — 글자마다 다시 그리면 입력이 끊긴다
        : h('input.field', { type: 'text', 'data-key': key, value: (v || []).join(', '), placeholder: t('optListPh'), 'aria-describedby': helpId, on: { change: (e) => {
          const { values, bad: wrong } = parseList(opt, e.target.value);
          act.setHookOpt(hook.id, opt.key, values, wrong);
        } } });
    return h(`div.opt${opt.type === 'toggle' ? '.tog' : ''}`, {},
      h('label.optl', {}, opt.type === 'toggle' ? [control, h('span', {}, opt.label)] : [h('span', {}, opt.label), control]),
      h('p.meta', { id: helpId }, withCode(opt.help), fromFlow ? ` ${t('optFromFlow', { name: flow.name })}` : ''),
      bad?.length ? h('p.err', { role: 'alert' }, t('optBad', { list: bad.join(', ') })) : null);
  });
}
