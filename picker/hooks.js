// 3 자동 검사 단계: 묶음(packs.json hookGroups) 표 + 칩. 「자세히 보기」는 전체 보기 창(browse.js)을 그 묶음으로 연다.
// 훅이 없는 묶음은 숨기고, 새 훅·새 묶음은 데이터만 더하면 그대로 나온다. 창의 검사 한 줄도 여기서 만든다.
import { h } from './dom.js';
import { chip, shead, groupRow, onCount, alreadyNote, label, isNew, withCode, browseBtn, itemRow, dupHookLabel, btn } from './parts.js';
import { hookGroupsOf, hookBy, flowBy, comboBy } from './stats.js';
import { stepHead } from './frame.js';
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
      fitNote(c),
      shead(t('hkHead'), onCount(t, sel.hooks.size, S.hooks.length),
        btn('hooksDefault', t('hooksDefault'), act.hooksDefault),
        btn('hooksBlockOnly', t('hooksBlockOnly'), act.hooksBlockOnly, '', { title: t('hooksBlockOnlyD') }),
        browseBtn(c, t('browseAllHooks', { n: S.hooks.length }), 'hooks', 'all', 'browseAllHooks')),
      h('div.gtable', {}, groups.map((g) => groupRow({
        name: g.name, count: onCount(t, g.hooks.filter((x) => sel.hooks.has(x.id)).length, g.hooks.length),
        chips: g.hooks.map((x) => hookChip(c, x)), empty: '', more: browseBtn(c, t('details'), 'hooks', g.id),
      })))),
  ];
}

// 이 저장소 기록과 맞지 않아 기본에서 뺀 형식 훅(서버 fitOff): 이유마다 한 줄(같은 이유의 훅은 이름을 묶는다 — GitLab 안내가 훅마다 되풀이되던 일, 화면 역할 평가 2026-11-12). 사용자가 다시 켜면 숨긴다.
function fitNote({ S, sel, t }) {
  const combo = comboBy(S, sel.combo);
  const ids = [...new Set([...Object.keys(S.fit?.hooks || {}).filter((id) => combo?.fitDropped?.includes(id)), ...(flowBy(S, sel.flow)?.fitDropped || [])])];
  const byWhy = new Map();
  for (const id of ids.filter((x) => !sel.hooks.has(x))) {
    const why = S.fit.hooks[id] || S.fit.flows[sel.flow]?.[id];
    const text = t(why.key, why.vars);
    byWhy.set(text, [...(byWhy.get(text) || []), hookBy(S, id)?.name || id]);
  }
  const lines = [...byWhy].map(([text, names]) => h('p.hint', {}, `${names.join(' · ')}: ${text}`));
  return lines.length ? h('div.notes', {}, lines) : null;
}

// 전체 보기 창의 검사 한 줄: 막는 때(브랜치 방식에 따라 바뀜) · 같이 켜는 브랜치 방식 · 옵션 · 정확한 범위
// preview: 「켜지는 것 보기」 창(combo-panel.js) — 스위치·옵션 없이(바꾸면 지금 선택이 바뀐다)
export function hookItem(c, x, { preview = false } = {}) {
  const { S, sel, t, dup } = c;
  const d = dup.hooks.get(x.id);
  const o = flowBy(S, sel.flow)?.override?.[x.id] || {};
  const bad = o.bad || x.bad;
  const fix = o.fix || x.fix;
  const byFlow = S.flows.filter((f) => f.hooksOn.includes(x.id)).map((f) => f.name);
  const changed = Object.keys(sel.hookOpts?.[x.id] || {}).length > 0;
  return itemRow(c, {
    key: `h:${x.id}`, on: sel.hooks.has(x.id), name: x.name,
    labels: [isNew(S, 'hooks', x.id) ? label(t('badgeNew'), '.accent') : null, x.kind === 'notice' ? label(t('kindNotice')) : x.kind === 'ask' ? label(t('kindAsk')) : null, d ? dupHookLabel(c, x.id) : null],
    plain: x.desc,
    // 머리말(차단하는 때 · 알림 훅은 알리는 때)은 「알아 둘 점」과 같은 꼴로 진하게
    meta: [bad ? [h('span.kl', {}, t(x.kind === 'notice' ? 'hookNoticeK' : x.kind === 'ask' ? 'hookAskK' : 'hookWhenK')), ' ', t('hookWhenV', { bad, fix })] : null, byFlow.length ? t('hookFlowOn', { list: byFlow.join(' · ') }) : null],
    keep: x.downside,
    opts: preview ? [] : hookOptions(c, x),
    scope: [h('p', {}, withCode(o.detail || x.detail)), changed ? h('p.hint', {}, t('optOverrides')) : null],
    onToggle: preview ? null : () => c.act.toggle('hooks', x.id),
  });
}
