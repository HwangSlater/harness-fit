// 고르기 화면: 상태와 동작, 단계 넘기기(주소 # 마다 한 단계 — 뒤로·앞으로 가기가 된다), 다시 그리기.
// 그리기는 frame·steps·skills·hooks·rules·review.js, 창은 panel.js(+ browse.js). 셈은 stats.js 한 곳.
import { h, fmt } from './dom.js';
import { api, errText, errInfo } from './api.js';
import * as F from './frame.js';
import { comboStep, requestStep } from './steps.js';
import { skillsStep } from './skills.js';
import { hooksStep } from './hooks.js';
import { rulesStep } from './rules.js';
import { reviewStep, finished } from './review.js';
import { renderPanel, wirePanel } from './panel.js';
import { githubOn, choiceOf } from './github.js';
import { dupsFor, defaultsFor, matesFor, flowBy, blockingHooks } from './stats.js';
import { hookKey, fromCombo, fromRecommended, snapshot, startSelection, sameSel } from './selection.js';
import { applyActions } from './apply-flow.js';
import { budgetActions } from './budget-view.js';

const PREVIEW_DELAY_MS = 250;
const TOAST_MS = 3200;
const STEP_VIEWS = { combo: comboStep, skills: skillsStep, hooks: hooksStep, rules: rulesStep, request: requestStep, review: reviewStep };

let S; // 서버 상태
let sel; // { combo, flow, skills, hooks, rules, explore: Set, note, share, github, githubChoice, hookOpts }
const ui = {
  step: 'combo', visited: new Set(), focusStep: false,
  panel: null, opener: null, browse: { kind: 'skills', g: 'all', q: '' }, open: new Set(), raw: null,
  touched: new Set(), custom: false, switched: null, fresh: null, preview: null, previewStale: false,
  busy: false, progress: null, done: undefined, applied: null, pathsOpen: false, ruleView: 'full',
  github: null, // GET /api/github 의 답(null = 확인 중)
  optBad: {}, // 훅 옵션 목록 칸에서 꼴이 틀려 뺀 값(칸마다)
};

const t = (key, vars) => fmt(S.strings[key] ?? key, vars, S.lang);
const ctx = (x = sel, extra = {}) => ({ S, sel: x, ui: { ...ui, ...extra }, t, act, dup: dupsFor(S, x), defaults: defaultsFor(S, x), mates: matesFor(S, x) });
const payload = (x) => ({
  lang: S.lang, combo: x.combo, flow: x.flow, skills: [...x.skills], hooks: [...x.hooks], rules: [...x.rules],
  explore: [...x.explore], note: x.note, share: x.share, github: githubOn(ui, x), githubChoice: choiceOf(ui, x), hookOpts: x.hookOpts,
  covered: [...dupsFor(S, x).hooks.keys()], skipLines: S.detected.skipLines || {},
});

// 미리보기: 요청마다 번호를 붙이고, 마지막에 보낸 것의 답만 받는다(늦게 온 옛 답이 새 선택을 덮지 않게).
let previewTimer;
let previewSeq = 0;
const refreshPreview = (delay = PREVIEW_DELAY_MS) => {
  clearTimeout(previewTimer);
  const my = ++previewSeq;
  ui.previewStale = true; // 새 계산이 올 때까지 흐리게(이전 숫자를 맞는 값처럼 보이지 않게)
  previewTimer = setTimeout(async () => {
    let p;
    try {
      p = await api('/api/preview', payload(sel));
    } catch (e) {
      p = { error: t('previewFailed'), ...errInfo(t, e) };
    }
    if (my !== previewSeq) return;
    ui.preview = p;
    ui.previewStale = false;
    render();
  }, delay);
};
const changed = () => (refreshPreview(), render());
const edited = () => ((ui.custom = true), (ui.switched = null), changed());

let toastTimer;
const toast = (msg) => {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), TOAST_MS);
};

const act = {
  go: (id) => (location.hash = id),
  // 직접 고친 뒤 다른 조합을 누르면 고친 내용이 사라지므로, 「이전 선택으로 돌리기」를 띄운다.
  pickCombo(k, fromPanel = false) {
    if (k.id === sel.combo && !ui.custom) return;
    ui.switched = ui.custom ? { sel: snapshot(sel), touched: new Set(ui.touched) } : null;
    const answer = sel.share;
    sel = fromCombo(k, sel);
    keepShare(answer);
    ui.touched.clear();
    ui.custom = false;
    if (fromPanel) (ui.panel = null), toast(t('comboPickedToast', { name: k.name }));
    changed();
  },
  undoSwitch() {
    if (!ui.switched) return;
    sel = ui.switched.sel;
    ui.touched = ui.switched.touched;
    ui.custom = ui.switched.custom ?? true;
    ui.switched = null;
    changed();
  },
  // 지난번 선택에서 시작했을 때 「추천으로 되돌리기」. 지난번 선택은 같은 「이전 선택으로 돌리기」로 되살린다.
  resetToRecommended() {
    ui.switched = { sel: snapshot(sel), touched: new Set(ui.touched), custom: ui.custom, reset: true };
    const answer = sel.share;
    sel = fromRecommended(S, sel);
    keepShare(answer);
    ui.touched.clear();
    ui.custom = false;
    changed();
  },
  // 브랜치 방식에 딸린 훅을 켜고 끈다(packs.json flows hooksOn/hooksOff — 서버 applyFlow 와 같은 데이터).
  pickFlow(id) {
    const f = flowBy(S, id);
    if (!f || id === sel.flow) return;
    sel.flow = id;
    const dup = dupsFor(S, sel).hooks;
    f.hooksOn.filter((x) => !dup.has(x)).forEach((x) => sel.hooks.add(x)); // 이미 있는 훅이 같은 일을 하면 다시 켜지 않는다
    f.hooksOff.forEach((x) => sel.hooks.delete(x));
    edited();
  },
  toggle(kind, id) {
    const set = sel[kind];
    set.has(id) ? set.delete(id) : set.add(id);
    if (kind === 'skills') ui.touched.add(id);
    if (kind === 'hooks') ui.touched.add(hookKey(id));
    if (kind === 'explore') return changed();
    edited();
  },
  // 묶음 모두 켜기·끄기(전체 보기 창)
  setHooks(ids, on) {
    for (const id of ids) (on ? sel.hooks.add(id) : sel.hooks.delete(id)), ui.touched.add(hookKey(id));
    edited();
  },
  // 「추천대로」: 지금 조합·브랜치 방식이 켜는 훅으로(이미 있는 훅과 같은 일을 하는 것은 빼고)
  hooksDefault() {
    const dup = dupsFor(S, sel).hooks;
    const d = defaultsFor(S, sel).hooks;
    for (const id of flowBy(S, sel.flow)?.hooksOff || []) d.delete(id);
    sel.hooks = new Set([...d].filter((id) => !dup.has(id)));
    [...ui.touched].filter((k) => k.startsWith('hook:')).forEach((k) => ui.touched.delete(k));
    toast(t('hooksDefaultDone', { n: sel.hooks.size }));
    edited();
  },
  // 「차단하는 것만」: 막는 훅만 켜고 알려 주기만 하는 훅은 끈다(stats.js blockingHooks)
  hooksBlockOnly() {
    sel.hooks = blockingHooks(S, sel);
    S.hooks.forEach((x) => ui.touched.add(hookKey(x.id)));
    toast(t('hooksBlockOnlyDone', { n: sel.hooks.size }));
    edited();
  },
  // 「팀원도 같은 훅을 쓰게 할까요?」 답(브랜치 전략을 정했으면 답해야 적용할 수 있다 — team.js)
  answerShare(v) {
    ui.shareAnswered = true;
    if (sel.share !== v) setShare(v);
    edited();
  },
};

// 팀원 공유를 바꾸면 「이 PC 에만 있어서 뺀 것」을 다시 넣거나 뺀다(팀원에게는 그 훅·스킬이 없다).
// 조합·브랜치 전략이 기본으로 넣는 것만 움직이고, 사용자가 직접 켜고 끈 훅·스킬은 그대로 둔다.
function setShare(v) {
  const before = dupsFor(S, sel);
  sel.share = v;
  syncDups(before);
}
// 겹침이 바뀐 뒤(팀원 공유를 바꿈·기존 훅 시험 결과가 옴): 새로 겹치는 기본 항목은 빼고, 더는 겹치지 않는 것은 다시 넣는다.
function syncDups(before) {
  const after = dupsFor(S, sel);
  const d = defaultsFor(S, sel);
  for (const id of d.hooks) {
    if (ui.touched.has(hookKey(id))) continue;
    if (after.hooks.has(id)) sel.hooks.delete(id);
    else if (before.hooks.has(id)) sel.hooks.add(id);
  }
  for (const id of d.skills) {
    if (ui.touched.has(id)) continue;
    if (after.skills.has(id)) sel.skills.delete(id);
    else if (before.skills.has(id)) sel.skills.add(id);
  }
}
// 조합을 바꿔도 이미 답한 팀원 공유는 그 답대로
const keepShare = (answer) => ui.shareAnswered && sel.share !== answer && setShare(answer);

Object.assign(act, {
  openPanel(d) {
    if (!ui.panel) ui.opener = document.activeElement?.dataset?.key || lastClicked; // 닫으면 이 단추로 초점을 돌려준다
    ui.panel = d;
    ui.panelFresh = true;
    render();
  },
  openBrowse(kind, g) {
    ui.browse = { kind, g, q: '' };
    ui.raw = null;
    act.openPanel({ kind: 'browse' });
  },
  browseGroup(g) {
    ui.browse.g = g;
    ui.panelFresh = true;
    render();
    document.querySelector(`#panel [data-key="bn:${CSS.escape(g)}"]`)?.focus();
  },
  browseSearch(q) {
    ui.browse.q = q;
    ui.panelFresh = true;
    render();
  },
  toggleOpen: (key) => (ui.open.has(key) ? ui.open.delete(key) : ui.open.add(key), render()),
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
  setRuleView: (v) => ((ui.ruleView = v), render()),
  // 「뺀 줄 보기」: 훅·스킬이 맡거나 이미 CLAUDE.md 에 있어 뺀 줄을 미리 보기에 줄 그어 보여 준다(전체 보기에서)
  toggleDropped: () => ((ui.showDropped = !ui.showDropped), ui.showDropped && (ui.ruleView = 'full'), render()),
  togglePaths: () => ((ui.pathsOpen = !ui.pathsOpen), render()),
  // 입력할 때마다 본문을 다시 그리면 커서가 사라지므로 글자 수와 요약만 바꾼다. 미리보기는 바로 「오래됨」으로 표시한다.
  setNote(text) {
    sel.note = text;
    const n = document.getElementById('noteCount');
    if (n) n.textContent = t('noteCount', { n: text.length, max: S.noteMax });
    refreshPreview(PREVIEW_DELAY_MS * 2);
    renderFrame(ctx());
  },
  addNote(text) {
    if (sel.note.includes(text)) return;
    sel.note = sel.note.trim() ? `${sel.note.trim()}\n${text}` : text;
    changed();
  },
  toggleGithub: () => ((sel.github = !sel.github), changed()),
  setGithubItem: (id, v) => ((sel.githubChoice = { ...sel.githubChoice, [id]: v }), changed()),
  // 훅 옵션. 고친 값은 브랜치 방식을 바꿔도 남는다(hook-options.js optionValue). bad: 목록 칸에서 꼴이 틀려 뺀 값
  setHookOpt: (id, key, v, bad = []) => ((sel.hookOpts = { ...sel.hookOpts, [id]: { ...sel.hookOpts[id], [key]: v } }), (ui.optBad = { ...ui.optBad, [`opt:${id}:${key}`]: bad }), changed()),
  retryGithub: () => ((ui.github = null), render(), loadGithub(true)), // 「다시 확인」(오프라인·로그인 전이었을 때)
  retryPreview: () => (refreshPreview(0), render()),
  switchLang: () => load(S.lang === 'ko' ? 'en' : 'ko', true),
});
// 적용·그만두기(apply-flow.js)
Object.assign(act, applyActions({ ui, t, current: () => sel, ctx: () => ctx(), payload, render: () => render(), openPanel: (d) => act.openPanel(d) }));

// 스킬 목록 예산 「권장대로 줄이기」·되돌리기(budget-view.js)
Object.assign(act, budgetActions({ ui, current: () => sel, edited }));

// 적용·그만두기를 기다리는 동안과 끝난 뒤에는 선택을 바꾸는 동작을 모두 막는다(화면도 inert).
const ALWAYS = new Set(['go', 'loadRaw', 'toggleOpen', 'togglePaths', 'setRuleView', 'toggleDropped', 'closePanel', 'browseGroup', 'browseSearch']);
for (const [name, fn] of Object.entries(act)) {
  if (!ALWAYS.has(name)) act[name] = (...a) => (ui.busy || ui.done !== undefined ? undefined : fn(...a));
}

const $ = (id) => document.getElementById(id);
const byKey = (root, key) => (key ? root.querySelector(`[data-key="${CSS.escape(key)}"]`) : null);

// 단계 막대·요약 카드·휴대폰 막대(요청 칸에 글을 쓸 때는 본문을 두고 이것만 다시 그린다)
function renderFrame(c) {
  $('tabs').replaceChildren(...F.tabs(c));
  $('sum').replaceChildren(F.sum(c));
  $('mbar').replaceChildren(...F.mbar(c));
  $('mbar').hidden = ui.step === 'review';
}

function render() {
  const active = document.activeElement;
  const key = active?.dataset?.key;
  const caret = key && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
  const wasOpen = $('panel').open;
  const y = window.scrollY;
  const doneView = ui.done !== undefined;
  const c = doneView && ui.applied ? ctx(ui.applied.sel, { preview: ui.applied.preview }) : ctx();
  $('skip').textContent = t('skip');
  $('unav').setAttribute('aria-label', t('stepsLabel'));
  $('sum').setAttribute('aria-label', t('sumTitle'));
  $('mbar').setAttribute('aria-label', t('sumTitle'));
  $('top').replaceChildren(...F.header(c));
  for (const id of ['unav', 'sum', 'mbar']) $(id).hidden = doneView;
  document.body.classList.toggle('finished', doneView);
  const main = $('main');
  for (const el of [main, $('sum'), $('mbar'), $('unav')]) el.toggleAttribute('inert', ui.busy);
  main.setAttribute('aria-busy', String(ui.busy));
  if (doneView) {
    if ($('panel').open && !ui.panel) $('panel').close();
    main.replaceChildren(finished(c, ui.done));
    return main.querySelector('h1')?.focus({ preventScroll: true });
  }
  renderFrame(c);
  main.replaceChildren(h(`section.step${ui.focusStep ? '.enter' : ''}`, { 'aria-labelledby': `t-${ui.step}` }, STEP_VIEWS[ui.step](c)), F.cta(c), F.footer(c));
  const shown = renderPanel(c, { fresh: !!ui.panelFresh });
  ui.panelFresh = false;
  const dlg = $('panel');
  if (ui.focusStep) {
    ui.focusStep = false;
    window.scrollTo(0, 0);
    // 좁은 폭: 지금 단계가 단계 막대 가운데 오게 가로로 민다
    const nav = $('unav');
    const tab = nav.querySelector('[aria-current]')?.parentElement;
    if (tab && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = tab.offsetLeft - (nav.clientWidth - tab.offsetWidth) / 2;
    return $(`t-${ui.step}`)?.focus({ preventScroll: true });
  }
  window.scrollTo(0, y);
  // 창을 처음 열면 찾기 칸(있으면)이나 제목으로, 닫으면 연 단추로 초점을 돌려준다.
  if (shown?.opening) return ((dlg.querySelector('[data-autofocus]') || $('panelTitle')).focus({ preventScroll: true }));
  if (!ui.panel && wasOpen) return byKey(document, ui.opener)?.focus({ preventScroll: true });
  // 다시 그려도 같은 조작 요소(data-key)에 초점을 둔다. 글을 쓰는 중이면 커서 자리도 지킨다.
  const el = byKey(ui.panel ? dlg : document, key);
  if (el) {
    el.focus({ preventScroll: true });
    if (caret && 'setSelectionRange' in el) el.setSelectionRange(...caret);
  }
}

// 단계 바꾸기: 주소 # 가 바뀔 때만(단계 막대·요약·「바꾸기」·이전/다음 모두 주소를 바꾼다)
function show(id) {
  if (!STEP_VIEWS[id]) return history.replaceState(null, '', '#combo'), show('combo');
  if (ui.step !== id) ui.visited.add(ui.step);
  ui.step = id;
  ui.panel = null; // 뒤로 가기로 단계를 바꾸면 떠 있던 창은 닫는다(돌아갈 단추가 없다)
  ui.focusStep = true;
  render();
}
window.addEventListener('hashchange', () => S && show(location.hash.slice(1)));
$('skip').addEventListener('click', (e) => (e.preventDefault(), $(`t-${ui.step}`)?.focus()));
// 단계 막대: 화살표·Home·End 로 탭 사이 이동, Enter 로 그 단계 열기(링크 기본 동작)
$('tabs').addEventListener('keydown', (e) => {
  const tabs = [...document.querySelectorAll('.tab')];
  const i = tabs.indexOf(document.activeElement);
  const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
  if (i < 0 || to === undefined) return;
  e.preventDefault();
  tabs[(to + tabs.length) % tabs.length].focus();
});
wirePanel(() => act.closePanel());
// 마지막으로 누른 조작 요소(초점을 받지 않는 환경에서도 창을 닫은 뒤 돌아갈 곳을 알게)
let lastClicked = null;
document.addEventListener('click', (e) => (lastClicked = e.target.closest?.('[data-key]')?.dataset.key || lastClicked), true);

// GitHub 저장소 설정을 켤 수 있는지(gh 를 몇 번 부르느라 1~3초). 화면은 먼저 띄우고 답이 오면 다시 그린다.
const loadGithub = (refresh = false) => api(`/api/github${refresh ? '?refresh=1' : ''}`).then((g) => (ui.github = g), () => (ui.github = { offered: false, reason: 'error' })).then(() => ui.done === undefined && render());

// 기존 훅 시험 결과(서버가 화면을 띄운 뒤 마저 한다 — 몇 초~십몇 초). 오면 상태를 바꾸고 겹치는 기본 훅을 뺀 뒤 다시 그린다.
// 그동안 확인 단계는 적용을 막는다(frame.js applyBlock). 못 받으면 「확인하지 못했다」로 바꾼다.
let existingWait = null;
const waitExisting = () => api(`/api/existing?lang=${S.lang}`).then(async (next) => {
  if (!S.detected.existing?.hooksPending) return; // 언어를 바꾸며 이미 받았다
  if (next.lang !== S.lang) next = await api(`/api/state?lang=${S.lang}`);
  const before = dupsFor(S, sel);
  const untouched = sameSel(sel, startSelection(S, sel).sel);
  S = next;
  // 아직 아무것도 안 바꿨으면 처음부터 결과를 안 것처럼 다시 시작하고, 바꿨으면 그 선택에서 겹치는 기본 훅만 뺀다
  if (untouched) ({ sel, custom: ui.custom, touched: ui.touched } = startSelection(S, sel));
  else syncDups(before);
  refreshPreview();
}).catch(() => Object.assign(S.detected.existing, { hooksPending: false, hookProbeFailed: true }))
  .then(() => ui.done === undefined && render());

async function load(lang, keep) {
  try {
    const prev = sel;
    const before = S && prev ? dupsFor(S, prev) : null;
    S = await api(`/api/state${lang ? `?lang=${lang}` : ''}`);
    document.documentElement.lang = S.lang;
    document.title = t('pageTitle', { name: S.detected.name });
    if (keep && prev) (sel = prev), before && syncDups(before); // 그사이 기존 훅 시험이 끝났으면 그 결과도 반영
    else ({ sel, custom: ui.custom, touched: ui.touched } = startSelection(S, prev));
    if (!keep) ui.shareAnswered = !!S.previous; // 지난번에 적용했으면 그때 답한 것으로 본다
    ui.step = STEP_VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'combo';
    if (!keep && location.hash.slice(1) !== ui.step) history.replaceState(null, '', `#${ui.step}`);
    refreshPreview();
    render();
    // 끝 화면이 뜬 뒤 늦게 온 답은 다시 그리지 않는다(펼쳐 둔 경로·초점이 흐트러지지 않게).
    const later = () => ui.done === undefined && render();
    if (ui.github === null && !keep) loadGithub();
    if (S.detected.existing?.hooksPending && !existingWait) existingWait = waitExisting();
    if (ui.fresh === null) api('/api/fresh').then((f) => ((ui.fresh = f), later()), (e) => ((ui.fresh = { error: errText(t, e), repos: [] }), later()));
  } catch (e) {
    // 이미 화면이 떠 있으면(언어 바꾸기 실패) 고른 것을 지우지 않고 알림 창으로만 알린다.
    if (S && sel) {
      ui.panel = { kind: 'failed', maybeChanged: false, ...errInfo(t, e) };
      return render();
    }
    $('main').replaceChildren(h('div.flash', { role: 'alert' }, h('p', {}, String(e.message || e))));
  }
}
load();
