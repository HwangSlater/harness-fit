// 창은 한 꼴(<dialog> + showModal): 넓은 「전체 보기」 틀. 넓은 화면은 가운데, 좁은 화면은 아래에서 올라오는 꽉 찬 창.
// 한 번에 하나만 뜬다(ui.panel = { kind, … }). Esc·바깥 누르기·✕·닫기 단추는 모두 act.closePanel 로 모인다.
// 내용: { title, sub, tall, size('sm'·'md'), tools: [], body: [] 또는 nav: [] + list: [], foot: [] }
import { h } from './dom.js';
import { label } from './parts.js';
import { comboBy, flowBy, hookGroupsOf, skillBy, diffOf, ruleIds, stageOf } from './stats.js';
import { browsePanel } from './browse.js';
import { rulePanel } from './rule-dialog.js';
import { api, errText } from './api.js';

const btn = (key, text, onClick, cls = '', extra = {}) => h(`button.btn.lg${cls}`, { type: 'button', 'data-key': key, on: { click: onClick }, ...extra }, text);

// 「켜지는 것 보기」 — 전체 보기와 같은 틀, 넓이를 써서 두 칸
function comboPanel(c, id) {
  const { S, sel, t, act } = c;
  const k = comboBy(S, id);
  const add = new Set((k.addons || []).flatMap((a) => a.skills));
  const tags = (names) => h('div.tags', {}, names.length ? names.map((n) => label(n)) : h('span.muted', {}, t('sumNone')));
  const sec = (title, n, ...kids) => h('section.psec', {}, h('h3', {}, h('span', {}, title), h('span', {}, n)), ...kids);
  const hooks = new Set(k.hooks);
  const rules = ruleIds({ flow: k.flow, rules: new Set(k.rules) }, null);
  const cur = sel.combo === id;
  const diff = diffOf(sel, k);
  return {
    title: t('comboPanelTitle', { name: k.name }), sub: `${k.for} · ${t('comboPanelSub')}`,
    body: [h('div.pgrid', {},
      sec(t('step_skills'), t('nItems', { n: k.skills.length }), tags(k.skills.filter((s) => !add.has(s)).map((s) => skillBy(S, s)?.title || s)),
        h('p.note', {}, add.size ? t('comboAddons') : t('comboNoAddons')),
        add.size ? tags((k.addons || []).flatMap((a) => a.skills.map((s) => `${skillBy(S, s)?.title || s} · ${a.stacks.join(' · ')}`))) : null),
      sec(t('step_hooks'), t('nItems', { n: hooks.size }), hookGroupsOf(S, t('groupOther')).map((g) => {
        const names = g.hooks.filter((x) => hooks.has(x.id)).map((x) => x.name);
        return names.length ? h('div.pline', {}, h('span.k', {}, g.name), h('span', {}, names.join(' · '))) : null;
      })),
      sec(t('step_rules'), t('nItems', { n: rules.length }), rules.map((rid) => h('div.pline', {},
        h('span.k', {}, S.rules.find((r) => r.id === rid)?.name || t('flowRule', { name: flowBy(S, rid)?.name || rid })), h('span', {}, t('aboutTok', { n: S.ruleTokens[rid] || 0 }))))),
      sec(t('comboFlow'), flowBy(S, k.flow)?.name || '', h('p.note', {}, t('comboFlowNote'))))],
    foot: [h('span.muted', {}, cur ? t('comboCur') : diff.length ? `${t('diffLabel')} ${diff.map(([n, v]) => `${t(n)} ${v}`).join(' · ')}` : t('diffSame')),
      btn('panelDone', t('close'), act.closePanel),
      btn('pickHere', cur ? t('comboPicked') : t('comboPick'), () => act.pickCombo(k, true), '.primary', { disabled: cur })],
  };
}

// 「그만두기」 확인: 실수로 눌러 고른 것을 잃지 않게. 기본 초점은 「계속 고르기」.
const cancelPanel = ({ t, act }) => ({
  title: t('cancelTitle'), size: 'sm', body: h('p', {}, t('cancelBody')),
  foot: [h('span.muted'), btn('keep', t('cancelKeep'), act.closePanel, '', { 'data-autofocus': true }), btn('cancelGo', t('cancelGo'), act.confirmCancel, '.danger')],
});

// 적용·그만두기가 실패했을 때. 적용이었다면 파일이 이미 바뀌었을 수 있으니 되돌리는 방법을 같이 알린다.
const failedPanel = ({ S, t, act }, d) => ({
  title: d.maybeChanged ? t('applyFailTitle') : t('errorTitle'), size: 'sm',
  body: [h('p.err', { role: 'alert' }, d.text), d.maybeChanged ? h('p.undo', {}, t('applyFailMaybe', { cmd: S.undoCommand })) : null, d.detail ? h('p.hint', {}, t('errDetail', { detail: d.detail })) : null],
  foot: [h('span.muted'), btn('failedOk', t('close'), act.closePanel, '.primary', { 'data-autofocus': true })],
});

const PANELS = { combo: (c, d) => comboPanel(c, d.id), browse: browsePanel, cancel: cancelPanel, failed: failedPanel, rule: rulePanel };

const $ = (id) => document.getElementById(id);
const SCROLLERS = ['#panelBody', '.gnav', '.glist'];

// 창을 그린다. 다시 그려도 읽던 자리(스크롤)를 지킨다. fresh = 처음 열거나 묶음을 바꿀 때(맨 위로)
export function renderPanel(c, { fresh = false } = {}) {
  const dlg = $('panel');
  const d = c.ui.panel;
  if (!d) {
    if (dlg.open) dlg.close();
    return null;
  }
  const p = PANELS[d.kind](c, d);
  const ys = fresh ? [] : SCROLLERS.map((s) => dlg.querySelector(s)?.scrollTop || 0);
  dlg.classList.toggle('tall', !!p.tall);
  dlg.classList.toggle('sm', p.size === 'sm');
  dlg.classList.toggle('md', p.size === 'md');
  $('panelTitle').textContent = p.title;
  $('panelSub').textContent = p.sub || '';
  $('panelClose').setAttribute('aria-label', c.t('close'));
  $('panelTools').replaceChildren(...(p.tools || []));
  const body = $('panelBody');
  body.classList.toggle('split', !!p.nav);
  body.replaceChildren(...(p.nav ? [h('nav.gnav', { 'aria-label': c.t('groupsLabel') }, p.nav), h('div.glist', {}, p.list)] : [p.body].flat().filter(Boolean)));
  $('panelFoot').replaceChildren(...(p.foot || []).filter(Boolean));
  SCROLLERS.forEach((s, i) => { const el = dlg.querySelector(s); if (el) el.scrollTop = ys[i] || 0; });
  const opening = !dlg.open;
  if (opening) dlg.showModal();
  return { dlg, opening };
}

// 창 동작(app.js 의 act 에 붙는다): 열기·전체 보기 묶음·찾기·닫기·원문 불러오기.
// lastClicked(): 마지막으로 누른 조작 요소의 data-key — 초점을 받지 않는 환경에서도 닫은 뒤 돌아갈 곳을 알게. state(): 서버 상태
const HIT_MS = 1600; // 링크로 찾아온 줄을 밝혀 두는 시간
let hitTimer;
export const panelActions = ({ ui, t, render, lastClicked, state }) => {
  const a = {
    openPanel(d) {
      if (!ui.panel) ui.opener = document.activeElement?.dataset?.key || lastClicked(); // 닫으면 이 단추로 초점을 돌려준다
      ui.panel = d;
      ui.panelFresh = true;
      render();
    },
    openBrowse(kind, g) {
      ui.browse = { kind, g, q: '' };
      ui.raw = null;
      a.openPanel({ kind: 'browse' });
    },
    browseGroup(g) {
      ui.browse.g = g;
      ui.panelFresh = true;
      render();
      document.querySelector(`#panel [data-key="bn:${CSS.escape(g)}"]`)?.focus();
    },
    // 이름표 링크(「비슷한 스킬이 이미 들어 있어요 · ○○」)로 그 스킬에 간다: 전체 보기 창에서 그 묶음을 열고(찾기는 비움)
    // 그 줄을 가운데로 민 뒤 잠깐 밝히고, 초점은 그 줄의 스위치에 — 바로 둘 중 하나를 켜고 끌 수 있게.
    browseTo(kind, id) {
      const pre = kind === 'skills' ? 's' : 'h';
      const k = kind === 'skills' ? skillBy(state(), id) : null;
      ui.browse = { kind, g: k ? stageOf(k) : 'all', q: '' };
      ui.raw = null;
      ui.hit = `${pre}:${id}`;
      if (ui.panel?.kind === 'browse') (ui.panelFresh = true), render();
      else a.openPanel({ kind: 'browse' });
      const dlg = $('panel');
      dlg.querySelector(`[data-item="${CSS.escape(ui.hit)}"]`)?.scrollIntoView({ block: 'center' });
      dlg.querySelector(`[data-key="${CSS.escape(`tg:${ui.hit}`)}"]`)?.focus({ preventScroll: true });
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => ((ui.hit = null), dlg.querySelector('.item.hit')?.classList.remove('hit')), HIT_MS);
    },
    browseSearch(q) {
      ui.browse.q = q;
      ui.panelFresh = true;
      render();
    },
    closePanel() {
      if (!ui.panel) return;
      ui.panel = null;
      render();
    },
    async loadRaw(id) {
      ui.raw = { id, text: null };
      render();
      try {
        ui.raw = { id, text: (await api(`/api/skill?id=${encodeURIComponent(id)}`)).text };
      } catch (e) {
        ui.raw = { id, text: t('error', { error: errText(t, e) }) };
      }
      render();
    },
  };
  return a;
};

// 창 쪽 이벤트(창마다 한 번만 단다): ✕(<id>Close) · Esc(cancel) · 바깥 누르기. 창 안에서 누르기 시작해 바깥에서 뗀 경우는 닫지 않는다.
// 큰 창(panel) 위에 작은 창(info)이 겹쳐 뜨면 Esc 는 맨 위 창에만 간다.
export function wireDialog(id, onClose) {
  const dlg = $(id);
  $(`${id}Close`).addEventListener('click', onClose);
  dlg.addEventListener('cancel', (e) => (e.preventDefault(), onClose()));
  let down = false;
  dlg.addEventListener('pointerdown', (e) => (down = e.target === dlg));
  dlg.addEventListener('click', (e) => (e.target === dlg && down ? onClose() : null, (down = false)));
}
