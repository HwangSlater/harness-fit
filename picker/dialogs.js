// 화면 가운데 뜨는 작은 창들: 스킬 자세히, 스킬 더하기, 적용 전 최종 확인.
// 한 번에 하나만 뜬다(ui.dialog = { kind, ... }). 바깥을 누르거나 Esc 로 닫는다(확인 창 제외 없음 — 모두 닫힘 = 취소).
import { h } from './dom.js';
import { stars, skillBadges } from './parts.js';
import { stageOf, STAGES } from './view.js';

const skillBy = (S, id) => S.skills.find((k) => k.id === id);
const listable = (S, k) => !(k.overlapsHook && S.hooks.some((x) => x.id === k.overlapsHook));

function modal({ act, t }, { title, sub, body, foot, size = '' }) {
  return h('div.modal-wrap', { on: { click: (e) => e.target.classList.contains('modal-wrap') && act.closeDialog() } },
    h(`div.modal${size ? `.${size}` : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div.m-head', {}, h('div', {}, h('h2', {}, title), sub ? h('div.tiny', {}, sub) : null), h('button.x', { 'aria-label': t('close'), on: { click: act.closeDialog } }, '×')),
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
        : h('button.btn.outline', { on: { click: () => act.loadRaw(k.id) } }, t('viewRaw')),
    ],
    foot: [
      ui.dialog.from ? h('button.btn.outline', { on: { click: () => act.openAdd(ui.dialog.from) } }, t('backToList')) : null,
      h('span.grow'),
      h(`button.btn.${on ? 'outline' : 'primary'}`, { on: { click: () => act.toggle('skills', k.id) } }, on ? t('dRemove') : t('dAdd')),
    ],
  });
}

// 스킬 더하기: 그 단계에 넣을 수 있는 스킬 목록
function addDialog(c, stage) {
  // 한 번에 여러 개를 보고 고를 수 있게: 단계 탭 + 찾기 + 3열 카드. 카드를 누르면 넣고, 다시 누르면 뺀다.
  const { S, sel, ui, t, act } = c;
  const q = (ui.dialog.q || '').trim().toLowerCase();
  const inStage = (k) => stage === 'all' || stageOf(k) === stage;
  const matches = (k) => !q || `${k.title} ${k.when} ${k.id} ${k.repo}`.toLowerCase().includes(q);
  const pool = S.skills.filter((k) => listable(S, k));
  const list = pool.filter((k) => inStage(k) && matches(k)).sort((a, b) => (b.stars || 0) - (a.stars || 0));
  const hidden = S.skills.filter((k) => inStage(k) && !listable(S, k)).length;
  const added = ui.dialog.added || 0;
  const tabs = [['all', t('addAll')], ...STAGES.map(([id]) => [id, t(`stage.${id}`)])].map(([id, label]) => {
    const n = pool.filter((k) => (id === 'all' || stageOf(k) === id) && !sel.skills.has(k.id)).length;
    return h(`button.ap-tab${id === stage ? '.on' : ''}`, { role: 'tab', 'aria-selected': String(id === stage), on: { click: () => act.openAdd(id) } }, label, h('span.n', {}, String(n)));
  });
  const card = (k) => {
    const on = sel.skills.has(k.id);
    return h(`div.ap-card${on ? '.on' : ''}`, {},
      h('button.ap-pick', { 'aria-pressed': String(on), on: { click: () => act.pickInDialog(k.id) } },
        h('span.ap-check', { 'aria-hidden': 'true' }, on ? '✓' : '+'),
        h('span.ap-text', {}, h('b', {}, k.title), h('span.d.clamp', {}, k.when), h('span.m', {}, `${k.repo} · ${t('stars', { n: stars(S, k.stars) })}`))),
      h('div.ap-foot', {}, skillBadges(S, k, t), h('button.sk-more', { on: { click: () => act.openDetail(k.id, stage) } }, t('details'))));
  };
  return modal(c, {
    title: stage === 'all' ? t('addTitleAll') : t('addTitle', { stage: t(`stage.${stage}`) }),
    sub: t('addSub2'),
    size: 'xwide',
    body: [
      h('div.ap-tools', {},
        h('div.ap-tabs', { role: 'tablist' }, tabs),
        h('input.ap-search', { id: 'apSearch', type: 'search', placeholder: t('searchPh'), value: ui.dialog.q || '', 'aria-label': t('searchPh'), on: { input: (e) => act.searchAdd(e.target.value) } })),
      list.length ? h('div.ap-grid', {}, list.map(card)) : h('div.tiny', {}, t('addEmpty')),
      hidden ? h('div.tiny.ap-note', {}, t('hiddenOverlap', { n: hidden })) : null,
    ],
    foot: [
      h('span.tiny', {}, added ? t('addedNow', { n: added }) : t('addHint')),
      h('span.grow'),
      h('button.btn.primary', { on: { click: act.closeDialog } }, t('done2')),
    ],
  });
}

// 적용 전 최종 확인: 무엇이 어디에, 무엇으로 들어가는지 + 진행 순서
function confirmDialog(c) {
  const { S, sel, ui, t, act } = c;
  const p = ui.preview;
  if (!p || ui.previewStale) return modal(c, { title: t('confirmTitle'), body: h('div.tiny', {}, t('previewLoading')) });
  const n = (kind) => p.changes.filter((x) => x.kind === kind).length;
  const copied = p.changes.filter((x) => x.kind === 'skill').map((x) => skillBy(S, x.skill)?.title || x.skill);
  const hookNames = S.hooks.filter((x) => sel.hooks.has(x.id)).map((x) => x.name);
  const ruleNames = [...S.rules.filter((r) => sel.rules.has(r.id)).map((r) => r.name), ...(sel.flow !== 'none' ? [t('flowRule', { name: S.flows.find((f) => f.id === sel.flow).name })] : [])];
  const group = (kind, title, where, what, names) =>
    h(`div.cg.${kind}`, {},
      h('div.cg-head', {}, h('b', {}, title), h('code', {}, where)),
      h('div.cg-what', {}, what),
      names?.length ? h('div.cg-names', {}, names.join(' · ')) : null);
  const groups = [
    copied.length ? group('skill', t('cSkills', { n: copied.length }), '.claude/skills/', t('cSkillsWhat'), copied) : null,
    p.manual.length ? group('manual', t('cManual', { n: p.manual.length }), t('cManualWhere'), t('cManualWhat'), p.manual.map((m) => skillBy(S, m.skill)?.title || m.skill)) : null,
    group('hook', t('cHooks', { n: sel.hooks.size }), '.claude/fys.json', t('cHooksWhat'), hookNames),
    n('claude-md') ? group('rule', t('cRules', { n: ruleNames.length }), 'CLAUDE.md', t('cRulesWhat'), ruleNames) : null,
    n('share') ? group('share', t('cShare'), '.claude/settings.json', t('cShareWhat', { repo: S.pluginRepo, ref: S.pluginRef }), null) : null,
    n('request') ? group('memo', t('cNote'), '.claude/fys-request.md', t('cNoteWhat'), [sel.note.trim().split('\n')[0] + (sel.note.trim().includes('\n') ? ' …' : '')]) : null,
    sel.explore.size ? group('plain', t('cExplore', { n: sel.explore.size }), t('cExploreWhere'), t('cExploreWhat'), [...sel.explore]) : null,
    group('plain', t('cBackup'), '.claude/fys-backup/', t('cBackupWhat'), null),
  ];
  const steps = [t('step1'), t('step2'), t('step3', { n: copied.length }), t('step4')];
  return modal(c, {
    title: t('confirmTitle'),
    sub: t('confirmLead'),
    size: 'wide',
    body: [
      h('div.cgs', {}, groups),
      h('div.steps', {}, h('b', {}, t('stepsTitle')), h('ol', {}, steps.map((s) => h('li', {}, s)))),
      h('div.undo', {}, t('undoLine', { cmd: S.undoCommand })),
    ],
    foot: [
      h('button.btn.outline', { on: { click: act.closeDialog } }, t('back')),
      h('span.grow'),
      h('button.btn.primary', { on: { click: act.confirmApply } }, t('confirmGo')),
    ],
  });
}

export function dialog(c) {
  const d = c.ui.dialog;
  if (!d) return null;
  if (d.kind === 'detail') return skillDetail(c, skillBy(c.S, d.id));
  if (d.kind === 'add') return addDialog(c, d.stage);
  if (d.kind === 'confirm') return confirmDialog(c);
  return null;
}
