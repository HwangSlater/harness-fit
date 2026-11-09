// 「이미 있는 것」 작은 창: 이름표·알림 글의 링크(이미 깔린 스킬 · 이미 쓰고 있는 훅)를 누르면 뜬다.
// 전체 보기 창 위에 겹쳐 뜨는 둘째 <dialog id="info"> 라 아래 창(고르던 묶음·스크롤)은 그대로 남는다(ui.info = { kind, id }).
// 보여 주는 것은 서버가 읽기만 한 데이터(dup.js 의 found·from, 상태의 probeSaid)이고, 글은 모두 textContent 로만 넣는다
// — 이미 있는 스킬의 이름·설명은 사용자 PC 의 SKILL.md 에서 온다.
import { h } from './dom.js';
import { toggleSwitch, withCode } from './parts.js';
import { skillBy, hookBy } from './stats.js';

const $ = (id) => document.getElementById(id);
const sec = (title, ...kids) => h('section.rsec', {}, h('h3', {}, title), ...kids);
const pluginName = (id) => String(id).split('@')[0]; // installed_plugins.json 의 id 는 「이름@마켓」

// 어디에 있나: 스킬은 사용자 스킬 · 프로젝트 스킬 · ○○ 플러그인, 훅은 사용자 설정 · 프로젝트 설정 · ○○ 플러그인
export const whereOf = (t, kind, { scope, plugin }) => {
  if (plugin) return t('wherePlugin', { name: pluginName(plugin), scope: t(`scope_${scope}`) });
  return scope ? t(`where_${kind}_${scope}`) : null;
};

// 이 PC 에만 있는 것이면: 팀원 공유를 켜면 겹침으로 보지 않고, 조합·브랜치 전략이 넣던 것은 다시 넣는다(app.js syncDups)
const shareLine = ({ sel, t, defaults }, kind, scope, id, name) => {
  if (scope === 'project' || sel.share) return null;
  const back = defaults?.[kind === 'skill' ? 'skills' : 'hooks'].has(id);
  return h('p.hint', {}, t(kind === 'skill' ? 'infoShareSkill' : 'infoShareHook', { name }), back ? ` ${t('infoShareBack', { name })}` : '');
};

const foot = (c, kind, id, name) => {
  const { sel, t, act } = c;
  const set = kind === 'skill' ? 'skills' : 'hooks';
  return [h('span.muted', {}, t('infoToggle', { name })),
    h('span.rtg', {}, toggleSwitch(t, { key: `info-tg:${id}`, on: sel[set].has(id), label: name, onToggle: () => act.toggle(set, id) })),
    h('button.btn.lg.primary', { type: 'button', 'data-key': 'infoDone', on: { click: act.closeInfo } }, t('close'))];
};

// 겹침이 없어졌으면(드물다 — 창을 연 채 상태가 바뀜) 그렇게만 알린다
const gone = ({ t, act }) => ({ title: t('infoGone'), body: [h('p', {}, t('infoGoneD'))],
  foot: [h('span.muted'), h('button.btn.lg.primary', { type: 'button', 'data-key': 'infoDone', on: { click: act.closeInfo } }, t('close'))] });

function skillInfo(c, id) {
  const { S, t, dup } = c;
  const d = dup.skills.get(id);
  const k = skillBy(S, id);
  if (!d || !k) return gone(c);
  return {
    title: d.found[0]?.name || d.by[0], sub: t(d.same ? 'infoSkillSame' : 'infoSkillSimilar'),
    body: [
      d.found.map((s) => h('div.found', {},
        d.found.length > 1 ? h('b', {}, s.name) : null,
        whereOf(t, 'skill', s) ? h('p.where', {}, whereOf(t, 'skill', s)) : null,
        h('p.rdesc', {}, s.description || t('infoNoDesc')))),
      sec(t('infoWhy'), h('p', {}, t(d.same ? 'infoWhySame' : 'infoWhySimilar', { name: k.title }))),
      sec(t('infoSo'), h('p', {}, t('infoSkillSo', { name: k.title })), shareLine(c, 'skill', d.scope, id, k.title)),
    ],
    foot: foot(c, 'skill', id, k.title),
  };
}

function hookInfo(c, id) {
  const { S, t, dup } = c;
  const d = dup.hooks.get(id);
  const x = hookBy(S, id);
  if (!d || !x) return gone(c);
  // 예전 결과(from 없음)는 이름만
  const from = d.from.length ? d.from : d.by.map((label) => ({ label, scope: d.scope, plugin: null }));
  const said = S.probeSaid?.[id];
  return {
    title: t('infoHookTitle'), sub: t('infoHookSub', { name: x.name }),
    body: [
      sec(t('infoHookWho'), from.map((f) => h('div.found', {}, h('p', {}, h('code', {}, f.label)), whereOf(t, 'hook', f) ? h('p.where', {}, whereOf(t, 'hook', f)) : null))),
      sec(t('infoHookTried'), said ? h('p', {}, withCode(said)) : null, h('p.hint', {}, t('infoHookTriedNote', { name: x.name }))),
      sec(t('infoSo'), h('p', {}, t('infoHookSo', { name: x.name })), shareLine(c, 'hook', d.scope, id, x.name)),
    ],
    foot: foot(c, 'hook', id, x.name),
  };
}

// 창을 그린다. → null(닫혀 있음) · { opening }(방금 엶) · { closed }(방금 닫음 — 연 링크로 초점을 돌려줄 때)
export function renderInfo(c) {
  const dlg = $('info');
  const d = c.ui.info;
  if (!d) {
    if (!dlg.open) return null;
    dlg.close();
    return { closed: true };
  }
  const p = (d.kind === 'skill' ? skillInfo : hookInfo)(c, d.id);
  $('infoTitle').textContent = p.title;
  $('infoSub').textContent = p.sub || '';
  $('infoClose').setAttribute('aria-label', c.t('close'));
  $('infoBody').replaceChildren(...[p.body].flat(Infinity).filter(Boolean));
  $('infoFoot').replaceChildren(...p.foot.filter(Boolean));
  const opening = !dlg.open;
  if (opening) dlg.showModal();
  return { opening };
}

// 열기·닫기(app.js 의 act 에 붙는다). 닫으면 연 링크(infoOpener)로 초점을 돌려준다.
export const infoActions = ({ ui, render, lastClicked }) => ({
  openInfo(d) {
    if (!ui.info) ui.infoOpener = document.activeElement?.dataset?.key || lastClicked();
    ui.info = d;
    render();
  },
  closeInfo() {
    if (!ui.info) return;
    ui.info = null;
    render();
  },
});
