// 「전체 보기」 창 하나: 스킬·자동 검사 같은 짜임(왼쪽 묶음 목록 · 오른쪽 항목 · 위 찾기 칸).
// 단계 화면의 「자세히 보기」는 모두 이 창을 그 묶음으로 연다(ui.browse = { kind, g, q }).
import { h, icon } from './dom.js';
import { onCount, link, num, isNew, btn, navItem } from './parts.js';
import { STAGES, stageOf, listable, skillBy, hookBy, recSkills, hookGroupsOf, skillTokens } from './stats.js';
import { skillItem, repoGroups } from './skills.js';
import { hookItem } from './hooks.js';
// 항목 한 줄(itemRow)·「자세히 보기」 단추(browseBtn)는 parts.js — 단계 화면(skills·hooks.js)도 쓰므로 여기 두면 서로 가져오게 된다.

// 두 종류의 묶음 정의
function kinds(c) {
  const { S, sel, t } = c;
  const fresh = new Set(S.newSince?.skills || []);
  const pool = S.skills.filter((k) => listable(S, k));
  const sortSkills = (ids) => ids.sort((a, b) => fresh.has(b) - fresh.has(a) || sel.skills.has(b) - sel.skills.has(a) || (skillBy(S, b).stars || 0) - (skillBy(S, a).stars || 0));
  const rec = recSkills(S).map((x) => x.id).filter((id) => listable(S, skillBy(S, id)));
  const stageGroups = STAGES.map((st) => ({ id: st.id, name: t(`stage.${st.id}`), desc: t(`stage.${st.id}.sub`) }));
  const hookGroups = hookGroupsOf(S, t('groupOther'));
  // 단계 안의 저장소 칸(왼쪽 목록에서 그 단계를 고르면 아래로 펼친다): id = 「단계@주인/이름」, 스킬이 많은 저장소부터.
  // 이름만으로는 겹친다(여러 주인의 skills) — 주인/이름 전체를 쓴다
  const repoSubs = (stage) => {
    const n = new Map();
    for (const k of pool) if (stageOf(k) === stage) n.set(k.repo, (n.get(k.repo) || 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1]).map(([repo]) => ({ id: `${stage}@${repo}`, name: repo, stage, desc: '' }));
  };
  return {
    skills: {
      title: t('browseSkillsTitle'), sub: t('browseSkillsSub'), hint: t('browseSkillsPh'),
      groups: [...(rec.length ? [{ id: 'rec', name: t('skRecRow'), desc: t('skRecShort') }] : []), ...stageGroups],
      allGroups: stageGroups,
      subs: (gid) => (gid === 'rec' ? [] : repoSubs(gid)),
      ids: (gid) => {
        if (gid === 'rec') return rec;
        const [stage, repo] = gid.split('@');
        return sortSkills(pool.filter((k) => stageOf(k) === stage && (!repo || k.repo === repo)).map((k) => k.id));
      },
      isOn: (id) => sel.skills.has(id),
      text: (id) => { const k = skillBy(S, id); return `${k.title} ${k.effect} ${k.when} ${k.downside} ${k.summary} ${k.id} ${k.repo}`; },
      row: (id) => skillItem(c, id),
      rows: (ids) => repoGroups(c, ids, (id) => skillItem(c, id)), // 같은 저장소끼리 묶는다
      total: pool.length,
      foot: t('browseSkillsFoot', { n: sel.skills.size, tok: num(S, skillTokens(S, sel.skills)) }),
    },
    hooks: {
      title: t('browseHooksTitle'), sub: t('browseHooksSub'), hint: t('browseHooksPh'),
      groups: hookGroups, allGroups: hookGroups,
      ids: (gid) => (hookGroups.find((g) => g.id === gid)?.hooks || []).map((x) => x.id).sort((a, b) => isNew(S, 'hooks', b) - isNew(S, 'hooks', a)),
      isOn: (id) => sel.hooks.has(id),
      text: (id) => { const x = hookBy(S, id); return `${x.name} ${x.desc} ${x.bad || ''} ${x.fix || ''} ${x.detail || ''} ${x.downside || ''} ${x.id}`; },
      row: (id) => hookItem(c, hookBy(S, id)),
      total: S.hooks.length,
      foot: t('browseHooksFoot', { n: sel.hooks.size }),
    },
  };
}

// 찾기 칸은 한 번 만든 것을 다시 쓴다. 글자마다 창을 다시 그리면서 칸을 새로 만들면, 윈도 한글 입력기는 다음 글자 조합이
// 앞 칸에서 시작돼 끊기거나 사라진다(조합 중 input 을 건너뛰어도 compositionend 뒤 새 칸으로 바뀌면 같다).
let searchBox = null;
function searchField(K, B, act) {
  if (!searchBox || searchBox.kind !== B.kind || searchBox.hint !== K.hint) { // 종류·화면 언어가 바뀌면 새로
    const input = h('input.field', { type: 'search', placeholder: K.hint, 'aria-label': K.hint, autocomplete: 'off', 'data-key': 'bq', 'data-autofocus': true, on: {
      // 한글은 글자를 조합하는 동안 찾지 않고, 조합이 끝났을 때 찾는다
      input: (e) => !e.isComposing && act.browseSearch(e.target.value),
      compositionend: (e) => act.browseSearch(e.target.value),
    } });
    searchBox = { kind: B.kind, hint: K.hint, input, el: h('label.search', {}, icon('i-search'), input) };
  }
  // 바깥에서 찾는 말이 바뀌었을 때만(묶음 링크로 찾아오면 비운다) 칸 글을 맞춘다 — 치는 중인 글은 건드리지 않는다
  if (searchBox.input.value !== B.q && document.activeElement !== searchBox.input) searchBox.input.value = B.q;
  return searchBox.el;
}

export function browsePanel(c) {
  const { S, ui, t, act } = c;
  const B = ui.browse;
  const K = kinds(c)[B.kind];
  // 단계 안 저장소 칸까지(고른 묶음 찾기용)
  const navGroups = [...K.groups, ...K.groups.flatMap((g) => K.subs?.(g.id) || [])];
  if (!navGroups.some((g) => g.id === B.g)) B.g = 'all'; // 묶음이 사라졌으면(예: 추천이 없어짐) 전체로
  const q = B.q.trim().toLowerCase();
  // 낱말마다 들어 있으면(순서 상관없이 「푸시 강제」), 또는 띄어쓰기를 빼고 같으면(「코드리뷰」 ↔ 「코드 리뷰」) 맞음
  const words = q.split(/\s+/).filter(Boolean);
  const bare = q.replace(/\s+/g, '');
  const match = (id) => {
    if (!q) return true;
    const text = K.text(id).toLowerCase();
    return words.every((w) => text.includes(w)) || text.replace(/\s+/g, '').includes(bare);
  };
  const allIds = [...new Set(K.allGroups.flatMap((g) => K.ids(g.id)))];
  const navBtn = (g, name, ids, cls = '') => navItem({ key: `bn:${g}`, cls, current: B.g === g, name, count: `${ids.filter(K.isOn).length}/${ids.length}`, onClick: () => act.browseGroup(g) });
  // 고른 단계(또는 그 안 저장소)만 저장소 칸을 펼친다 — 목록이 길어지지 않게
  const openStage = B.g.split('@')[0];
  const nav = [navBtn('all', t('addAll'), allIds), h('hr'), ...K.groups.flatMap((g) => [navBtn(g.id, g.name, K.ids(g.id)),
    ...(g.id === openStage ? (K.subs?.(g.id) || []).map((s) => navBtn(s.id, s.name, K.ids(s.id), '.sub')) : [])])];

  // 오른쪽: 고른 묶음(전체면 묶음마다 소제목)
  const secs = B.g === 'all' ? K.allGroups : navGroups.filter((g) => g.id === B.g);
  let shown = 0;
  const list = secs.flatMap((g) => {
    const ids = K.ids(g.id).filter(match);
    shown += ids.length;
    if (!ids.length && B.g === 'all') return [];
    // 단계 안 저장소 칸이면 제목은 단계 이름(저장소는 아래 머리줄이 보여 준다)
    return [h('div.gsec', {}, h('h3', {}, g.stage ? K.groups.find((x) => x.id === g.stage)?.name : g.name), h('span', {}, [g.desc, onCount(t, ids.filter(K.isOn).length, ids.length)].filter(Boolean).join(' · '))), ...(K.rows ? K.rows(ids) : ids.map(K.row))];
  });
  if (!shown) {
    const elsewhere = q && B.g !== 'all' ? allIds.filter(match).length : 0;
    list.push(h('div.gempty', {}, h('p', {}, q ? t('browseNoMatch', { q: B.q }) : t('browseEmpty')),
      elsewhere ? link('bn:elsewhere', t('browseElsewhere', { n: elsewhere }), () => act.browseGroup('all')) : null));
  }
  // 훅과 같은 일을 하는 스킬은 목록에서 뺐다고 밝힌다(뺀 스킬이 겹치는 검사 이름은 훅 데이터에서)
  if (B.kind === 'skills') {
    const hidden = S.skills.filter((k) => !listable(S, k) && (B.g === 'all' || stageOf(k) === openStage));
    const names = [...new Set(hidden.map((k) => k.overlapsHook))].map((id) => t('quote', { name: hookBy(S, id)?.name || id })).join(', ');
    if (hidden.length) list.push(h('p.hint.gnote', {}, t('hiddenOverlap', { n: hidden.length, hooks: names })));
  }
  const inGroup = B.g === 'all' ? [] : K.ids(B.g);
  const many = B.kind === 'hooks' && inGroup.length > 1;
  return {
    title: K.title, sub: K.sub, tall: true,
    tools: [
      searchField(K, B, act),
      h('span.muted', { 'aria-live': 'polite' }, t('browseShown', { total: K.total, n: shown }))],
    nav, list,
    foot: [h('span.muted', {}, K.foot),
      many ? btn('groupOn', t('groupAllOn'), () => act.setHooks(inGroup, true), '.lg') : null,
      many ? btn('groupOff', t('groupAllOff'), () => act.setHooks(inGroup, false), '.lg') : null,
      btn('browseDone', t('done2'), act.closePanel, '.lg.primary')],
  };
}
