// 3 자동 검사 단계: 묶음(packs.json hookGroups) 표 + 칩. 「자세히 보기」는 전체 보기 창(browse.js)을 그 묶음으로 연다.
// 훅이 없는 묶음은 숨기고, 새 훅·새 묶음은 데이터만 더하면 그대로 나온다. 창의 검사 한 줄도 여기서 만든다.
import { h } from './dom.js';
import { chip, shead, groupRow, onCount, alreadyNote, label, isNew, withCode } from './parts.js';
import { hookGroupsOf, hookBy, flowBy } from './stats.js';
import { stepHead } from './frame.js';
import { browseBtn, itemRow } from './browse.js';
import { hookOptions } from './options.js';

// 훅 칩(지침 단계 「줄을 대신 맡는 훅」도 같은 칩)
export function hookChip(c, x) {
  const { S, sel, t, act, dup } = c;
  return chip({ key: `hook:${x.id}`, on: sel.hooks.has(x.id), label: x.name, note: dup.hooks.get(x.id) ? t('chipDupHook') : null,
    badge: isNew(S, 'hooks', x.id) ? t('badgeNewShort') : null, title: x.desc, onClick: () => act.toggle('hooks', x.id) });
}

export function hooksStep(c) {
  const { S, sel, t, act } = c;
  const groups = hookGroupsOf(S, t('groupOther'));
  return [
    ...stepHead(c, 'hooks'),
    h('p.qs', {}, t('s3p')),
    h('div.qb', {},
      alreadyNote(c, 'hooks', (id) => hookBy(S, id)?.name || id),
      shead(t('hkHead'), onCount(t, sel.hooks.size, S.hooks.length),
        h('button.btn', { type: 'button', 'data-key': 'hooksDefault', on: { click: act.hooksDefault } }, t('hooksDefault')),
        h('button.btn', { type: 'button', 'data-key': 'hooksBlockOnly', title: t('hooksBlockOnlyD'), on: { click: act.hooksBlockOnly } }, t('hooksBlockOnly')),
        browseBtn(c, t('browseAllHooks', { n: S.hooks.length }), 'hooks', 'all', 'browseAllHooks')),
      h('div.gtable', {}, groups.map((g) => groupRow({
        name: g.name, count: onCount(t, g.hooks.filter((x) => sel.hooks.has(x.id)).length, g.hooks.length),
        chips: g.hooks.map((x) => hookChip(c, x)), empty: '', more: browseBtn(c, t('details'), 'hooks', g.id),
      })))),
  ];
}

// 전체 보기 창의 검사 한 줄: 막는 때(브랜치 방식에 따라 바뀜) · 같이 켜는 브랜치 방식 · 옵션 · 정확한 범위
export function hookItem(c, x) {
  const { S, sel, t, dup } = c;
  const d = dup.hooks.get(x.id);
  const o = flowBy(S, sel.flow)?.override?.[x.id] || {};
  const bad = o.bad || x.bad;
  const fix = o.fix || x.fix;
  const byFlow = S.flows.filter((f) => f.hooksOn.includes(x.id)).map((f) => f.name);
  const changed = Object.keys(sel.hookOpts?.[x.id] || {}).length > 0;
  return itemRow(c, {
    key: `h:${x.id}`, on: sel.hooks.has(x.id), name: x.name,
    labels: [isNew(S, 'hooks', x.id) ? label(t('badgeNew'), '.accent') : null, x.kind === 'notice' ? label(t('kindNotice')) : null, d ? h('span.label.warn', { title: t(`scope_${d.scope}`) }, t('dupHook', { by: d.by.join(', ') })) : null],
    plain: x.desc,
    meta: [bad ? t('hookWhen', { bad, fix }) : null, byFlow.length ? t('hookFlowOn', { list: byFlow.join(' · ') }) : null],
    opts: hookOptions(c, x),
    scope: [h('p', {}, withCode(o.detail || x.detail)), changed ? h('p.hint', {}, t('optOverrides')) : null],
    onToggle: () => c.act.toggle('hooks', x.id),
  });
}
