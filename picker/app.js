// 고르기 화면: 상태와 동작. 그리기는 view.js·parts.js, 작은 창은 dialogs.js.
import { h, fmt } from './dom.js';
import * as V from './view.js';
import { dialog } from './dialogs.js';

const TOKEN = new URLSearchParams(location.search).get('t') || '';
const PREVIEW_DELAY_MS = 250;
const PROGRESS_POLL_MS = 400;
const ERR_DETAIL_MAX = 160; // 화면에 보이는 원래 오류 글은 짧게

let S; // 서버 상태
let sel; // { combo, flow, skills, hooks, rules, explore: Set, note, share }
const ui = {
  dialog: null, touched: new Set(), custom: false, fresh: null, preview: null, previewStale: false,
  busy: false, progress: null, done: undefined, raw: null, openRule: null, pathsOpen: false,
  openConds: new Set(), switched: null, lastAdd: null, applied: null, opener: null,
};

// 오류에 code 를 붙인다: network(연결 끊김) · forbidden(토큰·Host 거절) · tooLarge · server(그 밖)
const fail = (code, detail) => Object.assign(new Error(detail || code), { code, detail });
const SERVER_CODES = { forbidden: 'forbidden', 'too large': 'tooLarge' };
const api = async (p, body) => {
  let res;
  try {
    res = await fetch(p, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-Harness-Token': TOKEN, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw fail('network', String(e.message || e));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw fail(SERVER_CODES[data.error] || 'server', String(data.error || `HTTP ${res.status}`));
  return data;
};

const t = (key, vars) => fmt(S.strings[key] ?? key, vars);
const ERR_KEYS = { network: 'errNetwork', forbidden: 'errForbidden', tooLarge: 'errTooLarge', server: 'errServer' };
const errText = (e) => t(ERR_KEYS[e.code] || 'errServer');
// 길면 뒤쪽을 남긴다(Windows 긴 경로에서 어느 파일인지는 끝에 있다).
const errDetail = (e) => {
  const d = e.code === 'server' && e.detail ? String(e.detail) : '';
  return d.length > ERR_DETAIL_MAX ? `…${d.slice(-ERR_DETAIL_MAX)}` : d;
};
const errInfo = (e) => ({ text: errText(e), detail: errDetail(e) });

const fromCombo = (k) => ({
  combo: k.id, flow: k.flow, skills: new Set(k.skills), hooks: new Set(k.hooks), rules: new Set(k.rules),
  explore: sel?.explore || new Set(), note: sel?.note || '', share: !!k.share, // 팀원 공유 기본값은 combos.json(auto 와 같은 값)
});
const snapshot = (x) => ({ ...x, skills: new Set(x.skills), hooks: new Set(x.hooks), rules: new Set(x.rules), explore: new Set(x.explore) });
const payload = (x) => ({
  lang: S.lang, combo: x.combo, flow: x.flow, skills: [...x.skills], hooks: [...x.hooks], rules: [...x.rules],
  explore: [...x.explore], note: x.note, share: x.share,
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
      p = { error: t('previewFailed'), ...errInfo(e) };
    }
    if (my !== previewSeq) return;
    ui.preview = p;
    ui.previewStale = false;
    render();
  }, delay);
};
const changed = () => (refreshPreview(), render());

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
    if (!f || id === sel.flow) return;
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
    ui.lastAdd = ui.dialog?.kind === 'add' ? ui.dialog : null;
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
  // 닫으면 더하기 창의 찾기 글자도 잊는다(자세히 → 「목록으로」 때만 이어 감).
  closeDialog() {
    ui.dialog = null;
    ui.lastAdd = null;
    render();
  },
  async loadRaw(id) {
    ui.raw = { id, text: null };
    render();
    try {
      ui.raw = { id, text: (await api(`/api/skill?id=${encodeURIComponent(id)}`)).text };
    } catch (e) {
      ui.raw = { id, text: t('error', { error: errText(e) }) };
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
  // 입력할 때마다 화면 전체를 다시 그리면 커서가 사라지므로 글자 수만 바꾼다. 미리보기는 바로 「오래됨」으로 표시한다.
  setNote(text) {
    sel.note = text;
    const c = document.getElementById('noteCount');
    if (c) c.textContent = t('noteCount', { n: text.length, max: S.noteMax });
    document.querySelector('.what')?.classList.add('stale');
    refreshPreview(PREVIEW_DELAY_MS * 2);
  },
  addNote(text) {
    if (sel.note.includes(text)) return;
    sel.note = sel.note.trim() ? `${sel.note.trim()}\n${text}` : text;
    changed();
  },
  retryPreview() {
    refreshPreview(0);
    render();
  },
  // 「이대로 적용」은 먼저 최종 확인 창을 띄운다. 확인을 눌러야 실제로 바뀐다.
  apply() {
    ui.dialog = { kind: 'confirm' };
    render();
  },
  // 확인한 순간의 선택·미리보기를 따로 떠 둔다. 끝 화면은 이것으로 그린다(적용 중에 바뀐 화면 상태와 섞이지 않게).
  async confirmApply() {
    if (!ui.preview || ui.preview.error || ui.previewStale) return;
    ui.applied = { sel: snapshot(sel), preview: ui.preview };
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
      ui.done = await api('/api/apply', payload(ui.applied.sel));
    } catch (e) {
      // 연결이 끊겼으면 서버가 이미 적용하고 꺼졌을 수 있고, 서버 오류면 일부만 썼을 수 있다.
      ui.dialog = { kind: 'failed', maybeChanged: true, ...errInfo(e), ...(e.code === 'network' ? { text: t('applyNetwork') } : {}) };
    } finally {
      clearInterval(poll);
      ui.busy = false;
    }
    render();
  },
  cancel() {
    ui.dialog = { kind: 'cancel' };
    render();
  },
  async confirmCancel() {
    ui.dialog = null;
    ui.busy = true;
    render();
    try {
      await api('/api/cancel', {});
      ui.done = null;
    } catch (e) {
      ui.dialog = { kind: 'failed', maybeChanged: false, ...errInfo(e) };
    } finally {
      ui.busy = false;
    }
    render();
  },
  async switchLang() {
    await load(S.lang === 'ko' ? 'en' : 'ko', true);
  },
};

// 적용·그만두기를 기다리는 동안과 끝난 뒤에는 선택을 바꾸는 동작을 모두 막는다(화면도 inert).
const ALWAYS = new Set(['showFiles', 'loadRaw']);
for (const [name, fn] of Object.entries(act)) {
  if (!ALWAYS.has(name)) act[name] = (...a) => (ui.busy || ui.done !== undefined ? undefined : fn(...a));
}

const byKey = (key) => (key ? document.querySelector(`[data-key="${CSS.escape(key)}"]`) : null);
const focusIn = (win) => (win.querySelector('[data-autofocus]') || win.querySelector('.modal'))?.focus({ preventScroll: true });

function render() {
  const main = document.getElementById('main');
  const bar = document.getElementById('bar');
  main.toggleAttribute('inert', ui.busy);
  main.classList.toggle('busy', ui.busy);
  main.setAttribute('aria-busy', String(ui.busy));
  if (ui.done !== undefined) {
    const a = ui.applied;
    const c = { S, sel: a?.sel || sel, ui: { ...ui, preview: a?.preview || null }, t, act };
    main.replaceChildren(V.finished(c, ui.done));
    bar.classList.add('hidden');
    main.querySelector('h2')?.focus({ preventScroll: true });
    return;
  }
  const c = { S, sel, ui, t, act };
  const y = window.scrollY;
  // 다시 그려도 같은 조작 요소(data-key)에 초점을 둔다. 글을 쓰는 중이면 커서 자리도, 창 안 스크롤도 지킨다.
  const active = document.activeElement;
  const key = active?.dataset?.key;
  const caret = key && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
  const wasOpen = !!document.querySelector('.modal');
  const bodyScroll = document.querySelector('.m-body')?.scrollTop || 0;
  const win = dialog(c);
  const parts = [V.header(c), V.tiles(c), V.combos(c), V.journey(c), V.guards(c), V.flows(c), V.rules(c), V.note(c), V.outcome(c)];
  if (win) parts.forEach((el) => el.setAttribute('inert', '')); // 창이 떠 있는 동안 뒤쪽은 누를 수도, 초점이 갈 수도 없다
  main.replaceChildren(...parts, ...(win ? [win] : []));
  document.body.classList.toggle('noscroll', !!win);
  bar.replaceChildren(...V.bar(c));
  bar.toggleAttribute('inert', !!win);
  window.scrollTo(0, y);
  const mb = document.querySelector('.m-body');
  if (mb) mb.scrollTop = bodyScroll;
  if (win && !wasOpen) {
    ui.opener = key || ui.opener; // 닫으면 연 버튼으로 초점을 돌려준다
    return focusIn(win);
  }
  if (!win && wasOpen) {
    // 연 버튼이 없어졌으면(예: 그 단계의 스킬을 다 넣어 「+ 더하기」가 사라짐) 「전체 스킬 둘러보기」로.
    const opener = byKey(ui.opener) || byKey('browseAll');
    opener?.focus({ preventScroll: true });
    // 적용 중이라 버튼이 잠겼으면 기억해 두었다가, 실패 알림을 닫을 때 그 버튼으로 돌려준다.
    if (!opener?.disabled) ui.opener = null;
    return;
  }
  const el = byKey(key);
  if (el) {
    el.focus({ preventScroll: true });
    if (caret && 'setSelectionRange' in el) el.setSelectionRange(...caret);
  } else if (win && !win.contains(document.activeElement)) focusIn(win);
}

// 창 안에서만 Tab 이 돈다. Esc 로 닫는다.
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]';
document.addEventListener('keydown', (e) => {
  if (!ui.dialog) return;
  if (e.key === 'Escape') return e.isComposing ? undefined : act.closeDialog(); // 한글 조합을 취소하는 Esc 는 창을 닫지 않는다
  if (e.key !== 'Tab') return;
  const m = document.querySelector('.modal');
  const list = [...m.querySelectorAll(FOCUSABLE)];
  if (!list.length) return (e.preventDefault(), m.focus());
  const [first, last] = [list[0], list.at(-1)];
  const at = document.activeElement;
  if (e.shiftKey && (at === first || at === m || !m.contains(at))) (e.preventDefault(), last.focus());
  else if (!e.shiftKey && (at === last || !m.contains(at))) (e.preventDefault(), first.focus());
});

async function load(lang, keep) {
  try {
    const prev = sel;
    S = await api(`/api/state${lang ? `?lang=${lang}` : ''}`);
    document.documentElement.lang = S.lang;
    sel = keep && prev ? prev : fromCombo({ ...S.recommended, id: S.recommended.combo });
    refreshPreview();
    render();
    // 끝 화면이 뜬 뒤 늦게 온 답은 다시 그리지 않는다(펼쳐 둔 경로·초점이 흐트러지지 않게).
    const later = () => ui.done === undefined && render();
    if (ui.fresh === null)
      api('/api/fresh').then((f) => ((ui.fresh = f), later()), (e) => ((ui.fresh = { error: errText(e), repos: [] }), later()));
  } catch (e) {
    // 이미 화면이 떠 있으면(언어 바꾸기 실패) 고른 것을 지우지 않고 알림 창으로만 알린다.
    if (S && sel) {
      ui.dialog = { kind: 'failed', maybeChanged: false, ...errInfo(e) };
      return render();
    }
    document.getElementById('main').replaceChildren(h('div.card.err', { role: 'alert' }, String(e.message || e)));
  }
}
load();
