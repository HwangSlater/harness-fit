// 고르기 화면: 상태와 동작. 그리기는 view.js·parts.js, 작은 창은 dialogs.js.
import { h, fmt } from './dom.js';
import * as V from './view.js';
import { dialog } from './dialogs.js';

const TOKEN = new URLSearchParams(location.search).get('t') || '';
const PREVIEW_DELAY_MS = 250;
const PROGRESS_POLL_MS = 400;
const TEAM_COMBOS = ['team', 'strict']; // 팀 조합이면 「팀원도 같은 검사 쓰기」를 기본으로 켠다

let S; // 서버 상태
let sel; // { combo, flow, skills, hooks, rules, explore: Set, note, share }
const ui = {
  dialog: null, touched: new Set(), custom: false, fresh: null, preview: null, previewStale: false,
  busy: false, progress: null, done: undefined, raw: null, openRule: null, pathsOpen: false,
  openConds: new Set(), switched: null,
};

const api = async (p, body) => {
  const res = await fetch(p, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Harness-Token': TOKEN, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || res.status);
  return data;
};

const t = (key, vars) => fmt(S.strings[key] ?? key, vars);
const fromCombo = (k) => ({
  combo: k.id, flow: k.flow, skills: new Set(k.skills), hooks: new Set(k.hooks), rules: new Set(k.rules),
  explore: sel?.explore || new Set(), note: sel?.note || '', share: TEAM_COMBOS.includes(k.id),
});
const snapshot = (x) => ({ ...x, skills: new Set(x.skills), hooks: new Set(x.hooks), rules: new Set(x.rules), explore: new Set(x.explore) });
const payload = () => ({
  lang: S.lang, combo: sel.combo, flow: sel.flow, skills: [...sel.skills], hooks: [...sel.hooks], rules: [...sel.rules],
  explore: [...sel.explore], note: sel.note, share: sel.share,
});

let previewTimer;
const refreshPreview = () => {
  clearTimeout(previewTimer);
  ui.previewStale = true; // 새 계산이 올 때까지 흐리게(이전 숫자를 맞는 값처럼 보이지 않게)
  previewTimer = setTimeout(async () => {
    try {
      ui.preview = await api('/api/preview', payload());
    } catch (e) {
      ui.preview = { error: String(e.message || e) };
    }
    ui.previewStale = false;
    render();
  }, PREVIEW_DELAY_MS);
};
const changed = () => (render(), refreshPreview());

const act = {
  // 직접 고친 뒤 다른 조합을 누르면 고친 내용이 사라지므로, 「이전으로」를 잠깐 보여 준다.
  pickCombo(k) {
    if (k.id === sel.combo && !ui.custom) return;
    ui.switched = ui.custom ? { sel: snapshot(sel), touched: new Set(ui.touched) } : null;
    sel = fromCombo(k);
    ui.touched.clear();
    ui.custom = false;
    changed();
  },
  undoSwitch() {
    if (!ui.switched) return;
    sel = ui.switched.sel;
    ui.touched = ui.switched.touched;
    ui.custom = true;
    ui.switched = null;
    changed();
  },
  // 브랜치 방식에 딸린 훅을 켜고 끈다. 무엇이 바뀌었는지는 view 가 조합 기본값과 비교해 브랜치 구역 바로 아래에 보여 준다.
  pickFlow(id) {
    const f = S.flows.find((x) => x.id === id);
    sel.flow = id;
    f.hooksOn.forEach((x) => sel.hooks.add(x));
    f.hooksOff.forEach((x) => sel.hooks.delete(x));
    ui.custom = true;
    ui.switched = null;
    changed();
  },
  // 카드에서 뺀 스킬은 자리에 「빠짐」으로 남겨 다시 넣을 수 있게 한다.
  toggle(kind, id) {
    const set = sel[kind];
    set.has(id) ? set.delete(id) : set.add(id);
    if (kind === 'skills') ui.touched.add(id);
    if (kind !== 'explore') ui.custom = true;
    ui.switched = null;
    changed();
  },
  toggleShare() {
    sel.share = !sel.share;
    changed();
  },
  // 작은 창(dialogs.js): 더하기 목록, 스킬 자세히(목록에서 열었으면 from 으로 돌아갈 수 있게), 최종 확인
  // 더하기 창은 단계 탭을 바꾸거나 자세히에서 돌아와도 찾기 글자와 「이번에 넣은 수」를 이어 간다.
  openAdd(stage) {
    const prev = ui.dialog?.kind === 'add' ? ui.dialog : ui.lastAdd;
    ui.dialog = { kind: 'add', stage, q: prev?.q || '', added: prev?.added || 0 };
    ui.lastAdd = null;
    render();
  },
  openDetail(id, from = null) {
    if (ui.dialog?.kind === 'add') ui.lastAdd = ui.dialog;
    ui.dialog = { kind: 'detail', id, from };
    ui.raw = null;
    render();
  },
  pickInDialog(id) {
    const adding = !sel.skills.has(id);
    act.toggle('skills', id);
    if (ui.dialog?.kind === 'add') ui.dialog.added = Math.max(0, (ui.dialog.added || 0) + (adding ? 1 : -1));
    render();
  },
  searchAdd(q) {
    ui.dialog.q = q;
    render();
  },
  closeDialog() {
    ui.dialog = null;
    render();
  },
  async loadRaw(id) {
    ui.raw = { id, text: null };
    render();
    try {
      ui.raw = { id, text: (await api(`/api/skill?id=${encodeURIComponent(id)}`)).text };
    } catch (e) {
      ui.raw = { id, text: t('error', { error: String(e.message || e) }) };
    }
    render();
  },
  openRule(id) {
    ui.openRule = id;
    render();
  },
  showFiles() {
    ui.pathsOpen = true;
    render();
    document.getElementById('s7')?.scrollIntoView({ behavior: 'smooth' });
  },
  // 입력할 때마다 화면 전체를 다시 그리면 커서가 사라지므로 글자 수만 바꾼다.
  setNote(text) {
    sel.note = text;
    const c = document.getElementById('noteCount');
    if (c) c.textContent = t('noteCount', { n: text.length, max: S.noteMax });
    clearTimeout(act.noteTimer);
    act.noteTimer = setTimeout(refreshPreview, PREVIEW_DELAY_MS * 2);
  },
  addNote(text) {
    if (sel.note.includes(text)) return;
    sel.note = sel.note.trim() ? `${sel.note.trim()}\n${text}` : text;
    changed();
  },
  // 「이대로 적용」은 먼저 최종 확인 창을 띄운다. 확인을 눌러야 실제로 바뀐다.
  apply() {
    ui.dialog = { kind: 'confirm' };
    render();
  },
  async confirmApply() {
    ui.dialog = null;
    ui.busy = true;
    ui.progress = null;
    render();
    const poll = setInterval(async () => {
      try {
        ui.progress = await api('/api/progress');
        render();
      } catch {}
    }, PROGRESS_POLL_MS);
    try {
      ui.done = await api('/api/apply', payload());
    } catch (e) {
      ui.busy = false;
      alert(t('error', { error: String(e.message || e) }));
    }
    clearInterval(poll);
    render();
  },
  async cancel() {
    try {
      await api('/api/cancel', {});
    } catch {}
    ui.done = null;
    render();
  },
  async switchLang() {
    await load(S.lang === 'ko' ? 'en' : 'ko', true);
  },
};

function render() {
  const main = document.getElementById('main');
  const c = { S, sel, ui, t, act };
  if (ui.done !== undefined) {
    main.replaceChildren(V.finished(c, ui.done, !!sel.note.trim()));
    document.getElementById('bar').classList.add('hidden');
    return;
  }
  const y = window.scrollY;
  // 글을 쓰는 중(요청 칸·스킬 찾기)이면 다시 그린 뒤에도 커서 자리를 지킨다. 창 안 스크롤도 지킨다.
  const active = document.activeElement;
  const typing = ['note', 'apSearch'].includes(active?.id) ? [active.id, active.selectionStart, active.selectionEnd] : null;
  const bodyScroll = document.querySelector('.m-body')?.scrollTop || 0;
  const win = dialog(c);
  main.replaceChildren(V.header(c), V.tiles(c), V.combos(c), V.journey(c), V.guards(c), V.flows(c), V.rules(c), V.note(c), V.outcome(c), ...(win ? [win] : []));
  document.body.classList.toggle('noscroll', !!win);
  document.getElementById('bar').replaceChildren(...V.bar(c));
  window.scrollTo(0, y);
  const mb = document.querySelector('.m-body');
  if (mb) mb.scrollTop = bodyScroll;
  const el = typing && document.getElementById(typing[0]);
  if (el) {
    el.focus({ preventScroll: true });
    el.setSelectionRange(typing[1], typing[2]);
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.dialog) act.closeDialog();
});

async function load(lang, keep) {
  try {
    const prev = sel;
    S = await api(`/api/state${lang ? `?lang=${lang}` : ''}`);
    document.documentElement.lang = S.lang;
    sel = keep && prev ? prev : fromCombo({ ...S.recommended, id: S.recommended.combo });
    render();
    refreshPreview();
    if (ui.fresh === null)
      api('/api/fresh').then((f) => ((ui.fresh = f), render()), (e) => ((ui.fresh = { error: String(e.message || e), repos: [] }), render()));
  } catch (e) {
    document.getElementById('main').replaceChildren(h('div.card.err', {}, String(e.message || e)));
  }
}
load();
