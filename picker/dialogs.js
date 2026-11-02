// 화면 가운데 뜨는 작은 창들: 스킬 자세히, 스킬 더하기, 적용 전 최종 확인, 그만두기 확인, 실패 알림.
// 한 번에 하나만 뜬다(ui.dialog = { kind, ... }). 바깥을 누르거나 Esc 로 닫는다(닫힘 = 취소).
// 초점: 열면 창 안으로(data-autofocus 가 있으면 그곳), 닫으면 연 버튼으로. Tab 가두기·뒤쪽 inert 는 app.js.
import { h } from './dom.js';
import { stars, skillBadges, changeGroups } from './parts.js';
import { stageOf, STAGES } from './view.js';

const skillBy = (S, id) => S.skills.find((k) => k.id === id);
const listable = (S, k) => !(k.overlapsHook && S.hooks.some((x) => x.id === k.overlapsHook));

function modal({ act, t }, { title, sub, body, foot, size = '' }) {
  // 바깥을 눌러 닫기: 누르기 시작한 곳도 바깥이어야 한다(창 안에서 글을 끌어 고르다 바깥에서 놓으면 닫지 않게).
  let downOutside = false;
  return h('div.modal-wrap', { on: {
    pointerdown: (e) => (downOutside = e.target.classList.contains('modal-wrap')),
    click: (e) => downOutside && e.target.classList.contains('modal-wrap') && act.closeDialog(),
  } },
    h(`div.modal${size ? `.${size}` : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
      h('div.m-head', {}, h('div', {}, h('h2', {}, title), sub ? h('div.tiny', {}, sub) : null), h('button.x', { 'data-key': 'close', 'aria-label': t('close'), on: { click: act.closeDialog } }, '×')),
      h('div.m-body', {}, body),
      foot ? h('div.m-foot', {}, foot) : null));
}

// 스킬 자세히
function skillDetail(c, k) {
  const { S, sel, ui, t, act } = c;
  const on = sel.skills.has(k.id);
  const row = (label, ...v) => h('div.d-row', {}, h('div.d-k', {}, label), h('div.d-v', {}, ...v));
  return modal(c, {
    title: k.title,
    sub: `${k.id} · ${k.repo}`,
    body: [
      row(t('dWhen'), k.when),
      row(t('dSource'), `${k.repo} · ${t('stars', { n: stars(S, k.stars) })}`),
      row(t('dLicense'), k.license || t('dLicenseNone')),
      k.install === 'plugin' ? h('div.d-note', {}, t('dPlugin'), ' ', t('dManualPin')) : row(t('dPinned'), t('dPinnedV', { sha: k.sha })),
      row(t('dFiles'), t('dFilesV', { n: k.files ?? '–' })),
      k.scripts.length
        ? h('div.d-warn', {}, h('b', {}, t('dScripts', { n: k.scripts.length })), h('p', {}, t('dScriptsNote')), h('ul', {}, k.scripts.map((f) => h('li', {}, f))))
        : h('div.d-ok', {}, t('dNoScripts')),
      row(t('dCostK'), t('dCost', { always: k.always, onUse: k.onUse })),
      ui.raw?.id === k.id
        ? [h('div.tiny', {}, t('rawNote')), h('pre.raw', {}, ui.raw.text ?? t('loadingRaw'))]
        : h('button.btn.outline', { 'data-key': 'raw', on: { click: () => act.loadRaw(k.id) } }, t('viewRaw')),
    ],
    foot: [
      ui.dialog.from ? h('button.btn.outline', { 'data-key': 'backList', on: { click: () => act.openAdd(ui.dialog.from) } }, t('backToList')) : null,
      h('span.grow'),
      h(`button.btn.${on ? 'outline' : 'primary'}`, { 'data-key': 'dToggle', on: { click: () => act.toggle('skills', k.id) } }, on ? t('dRemove') : t('dAdd')),
    ],
  });
}

// 스킬 더하기: 그 단계에 넣을 수 있는 스킬 목록
function addDialog(c, stage) {
  // 한 번에 여러 개를 보고 고를 수 있게: 단계 버튼 + 찾기 + 3열 카드. 카드를 누르면 넣고, 다시 누르면 뺀다.
  const { S, sel, ui, t, act } = c;
  const q = (ui.dialog.q || '').trim().toLowerCase();
  const inStage = (k) => stage === 'all' || stageOf(k) === stage;
  const matches = (k) => !q || `${k.title} ${k.when} ${k.id} ${k.repo}`.toLowerCase().includes(q);
  const pool = S.skills.filter((k) => listable(S, k));
  const list = pool.filter((k) => inStage(k) && matches(k)).sort((a, b) => (b.stars || 0) - (a.stars || 0));
  const hidden = S.skills.filter((k) => inStage(k) && !listable(S, k));
  // 뺀 스킬이 겹치는 검사 이름은 훅 데이터에서 만든다.
  const hiddenHooks = [...new Set(hidden.map((k) => k.overlapsHook))].map((id) => t('quote', { name: S.hooks.find((x) => x.id === id)?.name || id })).join(', ');
  const added = ui.dialog.added || 0;
  // 단계 고르기는 목록을 걸러 주는 버튼 묶음(aria-pressed)이다. 탭 패널이 따로 없다.
  const tabs = [['all', t('addAll')], ...STAGES.map(([id]) => [id, t(`stage.${id}`)])].map(([id, label]) => {
    const n = pool.filter((k) => (id === 'all' || stageOf(k) === id) && !sel.skills.has(k.id)).length;
    return h(`button.ap-tab${id === stage ? '.on' : ''}`, { 'data-key': `tab:${id}`, 'aria-pressed': String(id === stage), on: { click: () => act.openAdd(id) } }, label, h('span.n', {}, String(n)));
  });
  const card = (k) => {
    const on = sel.skills.has(k.id);
    return h(`div.ap-card${on ? '.on' : ''}`, {},
      h('button.ap-pick', { 'data-key': `pick:${k.id}`, 'aria-pressed': String(on), on: { click: () => act.pickInDialog(k.id) } },
        h('span.ap-check', { 'aria-hidden': 'true' }, on ? '✓' : '+'),
        h('span.ap-text', {}, h('b', {}, k.title), h('span.d.clamp', {}, k.when), h('span.m', {}, `${k.repo} · ${t('stars', { n: stars(S, k.stars) })}`))),
      h('div.ap-foot', {}, skillBadges(S, k, t), h('button.sk-more', { 'data-key': `apMore:${k.id}`, on: { click: () => act.openDetail(k.id, stage) } }, t('details'))));
  };
  return modal(c, {
    title: stage === 'all' ? t('addTitleAll') : t('addTitle', { stage: t(`stage.${stage}`) }),
    sub: t('addSub2'),
    size: 'xwide',
    body: [
      h('div.ap-tools', {},
        h('div.ap-tabs', { role: 'group', 'aria-label': t('stageFilter') }, tabs),
        h('input.ap-search', { id: 'apSearch', 'data-key': 'apSearch', 'data-autofocus': true, type: 'search', placeholder: t('searchPh'), value: ui.dialog.q || '', 'aria-label': t('searchPh'), on: {
          // 한글은 글자를 조합하는 동안 다시 그리면 조합이 깨진다. 조합이 끝났을 때 찾는다.
          input: (e) => !e.isComposing && act.searchAdd(e.target.value),
          compositionend: (e) => act.searchAdd(e.target.value),
        } })),
      list.length ? h('div.ap-grid', {}, list.map(card)) : h('div.tiny', {}, t('addEmpty')),
      hidden.length ? h('div.tiny.ap-note', {}, t('hiddenOverlap', { n: hidden.length, hooks: hiddenHooks })) : null,
    ],
    foot: [
      h('span.tiny', { role: 'status' }, added ? t('addedNow', { n: added }) : t('addHint')),
      h('span.grow'),
      h('button.btn.primary', { 'data-key': 'addDone', on: { click: act.closeDialog } }, t('done2')),
    ],
  });
}

// 적용 전 최종 확인: 무엇이 어디에, 무엇으로 들어가는지 + 진행 순서.
// 미리보기가 오래됐으면 새 계산을 기다리고(오면 다시 그려진다), 실패했으면 다시 시도할 수 있게 한다. 둘 다 적용 버튼은 잠근다.
function confirmDialog(c) {
  const { S, ui, t, act } = c;
  const p = ui.preview;
  const back = h('button.btn.outline', { 'data-key': 'back', on: { click: act.closeDialog } }, t('back'));
  const go = (ready) => h('button.btn.primary', { 'data-key': 'confirmGo', disabled: !ready, 'aria-disabled': String(!ready), on: { click: act.confirmApply } }, t('confirmGo'));
  if (!p || ui.previewStale) return modal(c, { title: t('confirmTitle'), body: h('div.tiny', { role: 'status' }, t('previewLoading')), foot: [back, h('span.grow'), go(false)] });
  if (p.error) {
    return modal(c, {
      title: t('confirmTitle'),
      body: [h('p.err', { role: 'alert' }, p.error, ' ', p.text), p.detail ? h('div.tiny.err-detail', {}, t('errDetail', { detail: p.detail })) : null],
      foot: [back, h('span.grow'), h('button.btn.outline', { 'data-key': 'retry', 'data-autofocus': true, on: { click: act.retryPreview } }, t('retry')), go(false)],
    });
  }
  const copied = p.changes.filter((x) => x.kind === 'skill').length;
  const steps = [t('step1'), t('step2'), t('step3', { n: copied }), t('step4')];
  return modal(c, {
    title: t('confirmTitle'),
    sub: t('confirmLead'),
    size: 'wide',
    body: [
      h('div.cgs', {}, changeGroups(c, p)),
      h('div.steps', {}, h('b', {}, t('stepsTitle')), h('ol', {}, steps.map((s) => h('li', {}, s)))),
      h('div.undo', {}, t('undoLine', { cmd: S.undoCommand })),
    ],
    foot: [back, h('span.grow'), go(true)],
  });
}

// 「그만두기」 확인: 실수로 눌러 고른 것을 잃지 않게. 기본 초점은 「계속 고르기」.
function cancelDialog(c) {
  const { t, act } = c;
  return modal(c, {
    title: t('cancelTitle'),
    body: h('p', {}, t('cancelBody')),
    foot: [
      h('button.btn.outline', { 'data-key': 'keep', 'data-autofocus': true, on: { click: act.closeDialog } }, t('cancelKeep')),
      h('span.grow'),
      h('button.btn.danger', { 'data-key': 'cancelGo', on: { click: act.confirmCancel } }, t('cancelGo')),
    ],
  });
}

// 적용·그만두기가 실패했을 때. 적용이었다면 파일이 이미 바뀌었을 수 있으니 되돌리는 방법을 같이 알린다.
function failedDialog(c, d) {
  const { S, t, act } = c;
  return modal(c, {
    title: d.maybeChanged ? t('applyFailTitle') : t('errorTitle'),
    body: [
      h('p.err', { role: 'alert' }, d.text),
      d.maybeChanged ? h('div.undo', {}, t('applyFailMaybe', { cmd: S.undoCommand })) : null,
      d.detail ? h('div.tiny.err-detail', {}, t('errDetail', { detail: d.detail })) : null,
    ],
    foot: [h('span.grow'), h('button.btn.primary', { 'data-key': 'failedOk', 'data-autofocus': true, on: { click: act.closeDialog } }, t('close'))],
  });
}

export function dialog(c) {
  const d = c.ui.dialog;
  if (!d) return null;
  if (d.kind === 'detail') return skillDetail(c, skillBy(c.S, d.id));
  if (d.kind === 'add') return addDialog(c, d.stage);
  if (d.kind === 'confirm') return confirmDialog(c);
  if (d.kind === 'cancel') return cancelDialog(c);
  if (d.kind === 'failed') return failedDialog(c, d);
  return null;
}
