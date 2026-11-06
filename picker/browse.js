// 「전체 보기」 창 하나: 스킬·자동 검사 같은 짜임(왼쪽 묶음 목록 · 오른쪽 항목 · 위 찾기 칸).
// 단계 화면의 「자세히 보기」는 모두 이 창을 그 묶음으로 연다(ui.browse = { kind, g, q }).
import { h, icon } from './dom.js';
import { toggleSwitch, onCount, link, num, isNew } from './parts.js';
import { STAGES, stageOf, listable, skillBy, hookBy, recSkills, hookGroupsOf, skillTokens } from './stats.js';
import { skillItem } from './skills.js';
import { hookItem } from './hooks.js';

// 「자세히 보기」·「전체 보기」 단추: 그 묶음으로 연다
export const browseBtn = (c, text, kind, g = 'all', key = `browse:${kind}:${g}`) =>
  h('button.btn', { type: 'button', 'data-key': key, 'aria-haspopup': 'dialog', on: { click: () => c.act.openBrowse(kind, g) } }, text);

// 항목 한 줄(스킬·검사 같은 꼴): 이름·이름표 / 쉬운 한 줄 / 정보 · 스위치 · 옵션 · 자세히(펼침)
export function itemRow(c, { key, on, name, labels, plain, meta = [], opts = [], scope, onToggle }) {
  const { ui, t, act } = c;
  const open = ui.open.has(key);
  const safe = key.replace(/[^\w-]/g, '_');
  return h('div.item', {},
    h('div', {},
      h('div.nm', {}, h('span', { id: `nm-${safe}` }, name), labels),
      plain ? h('p.plain', {}, plain) : null,
      meta.filter(Boolean).map((m) => h('p.meta', {}, m))),
    h('div.tg', {}, toggleSwitch(t, { key: `tg:${key}`, on, labelId: `nm-${safe}`, onToggle })),
    h('div.more', {},
      opts.length ? h('div.opts', {}, opts) : null,
      link(`sc:${key}`, open ? t('scopeClose') : t('scopeOpen'), () => act.toggleOpen(key), { 'aria-expanded': String(open), class: 'scopebtn' }),
      open ? h('div.scopefull', {}, scope) : null));
}

// 두 종류의 묶음 정의
function kinds(c) {
  const { S, sel, t } = c;
  const fresh = new Set(S.newSince?.skills || []);
  const pool = S.skills.filter((k) => listable(S, k));
  const sortSkills = (ids) => ids.sort((a, b) => fresh.has(b) - fresh.has(a) || sel.skills.has(b) - sel.skills.has(a) || (skillBy(S, b).stars || 0) - (skillBy(S, a).stars || 0));
  const rec = recSkills(S).map((x) => x.id).filter((id) => listable(S, skillBy(S, id)));
  const stageGroups = STAGES.map((st) => ({ id: st.id, name: t(`stage.${st.id}`), desc: t(`stage.${st.id}.sub`) }));
  const hookGroups = hookGroupsOf(S, t('groupOther'));
  return {
    skills: {
      title: t('browseSkillsTitle'), sub: t('browseSkillsSub'), hint: t('browseSkillsPh'),
      groups: [...(rec.length ? [{ id: 'rec', name: t('skRecRow'), desc: t('skRecShort') }] : []), ...stageGroups],
      allGroups: stageGroups,
      ids: (gid) => (gid === 'rec' ? rec : sortSkills(pool.filter((k) => stageOf(k) === gid).map((k) => k.id))),
      isOn: (id) => sel.skills.has(id),
      text: (id) => { const k = skillBy(S, id); return `${k.title} ${k.when} ${k.summary} ${k.id} ${k.repo}`; },
      row: (id) => skillItem(c, id),
      total: pool.length,
      foot: t('browseSkillsFoot', { n: sel.skills.size, tok: num(S, skillTokens(S, sel.skills)) }),
    },
    hooks: {
      title: t('browseHooksTitle'), sub: t('browseHooksSub'), hint: t('browseHooksPh'),
      groups: hookGroups, allGroups: hookGroups,
      ids: (gid) => (hookGroups.find((g) => g.id === gid)?.hooks || []).map((x) => x.id).sort((a, b) => isNew(S, 'hooks', b) - isNew(S, 'hooks', a)),
      isOn: (id) => sel.hooks.has(id),
      text: (id) => { const x = hookBy(S, id); return `${x.name} ${x.desc} ${x.bad || ''} ${x.fix || ''} ${x.detail || ''} ${x.id}`; },
      row: (id) => hookItem(c, hookBy(S, id)),
      total: S.hooks.length,
      foot: t('browseHooksFoot', { n: sel.hooks.size }),
    },
  };
}

export function browsePanel(c) {
  const { S, ui, t, act } = c;
  const B = ui.browse;
  const K = kinds(c)[B.kind];
  if (!K.groups.some((g) => g.id === B.g)) B.g = 'all'; // 묶음이 사라졌으면(예: 추천이 없어짐) 전체로
  const q = B.q.trim().toLowerCase();
  const match = (id) => !q || K.text(id).toLowerCase().includes(q);
  const allIds = [...new Set(K.allGroups.flatMap((g) => K.ids(g.id)))];
  const navBtn = (g, name, ids) => h('button', { type: 'button', 'aria-current': String(B.g === g), 'data-key': `bn:${g}`, on: { click: () => act.browseGroup(g) } },
    h('span', {}, name), h('span.n', {}, `${ids.filter(K.isOn).length}/${ids.length}`));
  const nav = [navBtn('all', t('addAll'), allIds), h('hr'), ...K.groups.map((g) => navBtn(g.id, g.name, K.ids(g.id)))];

  // 오른쪽: 고른 묶음(전체면 묶음마다 소제목)
  const secs = B.g === 'all' ? K.allGroups : K.groups.filter((g) => g.id === B.g);
  let shown = 0;
  const list = secs.flatMap((g) => {
    const ids = K.ids(g.id).filter(match);
    shown += ids.length;
    if (!ids.length && B.g === 'all') return [];
    return [h('div.gsec', {}, h('h3', {}, g.name), h('span', {}, [g.desc, onCount(t, ids.filter(K.isOn).length, ids.length)].filter(Boolean).join(' · '))), ...ids.map(K.row)];
  });
  if (!shown) {
    const elsewhere = q && B.g !== 'all' ? allIds.filter(match).length : 0;
    list.push(h('div.gempty', {}, h('p', {}, q ? t('browseNoMatch', { q: B.q }) : t('browseEmpty')),
      elsewhere ? link('bn:elsewhere', t('browseElsewhere', { n: elsewhere }), () => act.browseGroup('all')) : null));
  }
  // 훅과 같은 일을 하는 스킬은 목록에서 뺐다고 밝힌다(뺀 스킬이 겹치는 검사 이름은 훅 데이터에서)
  if (B.kind === 'skills') {
    const hidden = S.skills.filter((k) => !listable(S, k) && (B.g === 'all' || stageOf(k) === B.g));
    const names = [...new Set(hidden.map((k) => k.overlapsHook))].map((id) => t('quote', { name: hookBy(S, id)?.name || id })).join(', ');
    if (hidden.length) list.push(h('p.hint.gnote', {}, t('hiddenOverlap', { n: hidden.length, hooks: names })));
  }
  const inGroup = B.g === 'all' ? [] : K.ids(B.g);
  const many = B.kind === 'hooks' && inGroup.length > 1;
  return {
    title: K.title, sub: K.sub, tall: true,
    tools: [
      h('label.search', {}, icon('i-search'),
        h('input.field', { type: 'search', value: B.q, placeholder: K.hint, 'aria-label': K.hint, autocomplete: 'off', 'data-key': 'bq', 'data-autofocus': true, on: {
          // 한글은 글자를 조합하는 동안 다시 그리면 조합이 깨진다. 조합이 끝났을 때 찾는다.
          input: (e) => !e.isComposing && act.browseSearch(e.target.value),
          compositionend: (e) => act.browseSearch(e.target.value),
        } })),
      h('span.muted', { 'aria-live': 'polite' }, t('browseShown', { total: K.total, n: shown }))],
    nav, list,
    foot: [h('span.muted', {}, K.foot),
      many ? h('button.btn.lg', { type: 'button', 'data-key': 'groupOn', on: { click: () => act.setHooks(inGroup, true) } }, t('groupAllOn')) : null,
      many ? h('button.btn.lg', { type: 'button', 'data-key': 'groupOff', on: { click: () => act.setHooks(inGroup, false) } }, t('groupAllOff')) : null,
      h('button.btn.lg.primary', { type: 'button', 'data-key': 'browseDone', on: { click: act.closePanel } }, t('done2'))],
  };
}
