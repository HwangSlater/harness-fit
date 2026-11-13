// 화면 틀: 머리 막대, 단계 막대(UnderlineNav), 단계 머리, 오른쪽 요약 카드, 휴대폰 요약 막대, 아래 「이전 · 다음」.
// 단계는 주소 #(combo·skills·hooks·rules·request·review)마다 하나. 그리기만 하고 상태는 app.js 가 갖는다.
import { h, icon } from './dom.js';
import { num, btn, btnLink } from './parts.js';
import { shareOpen } from './team.js';
import { budgetLine } from './budget-view.js';
import { costOf, pct, ruleCount, ruleLines, skillTokens, ruleTokens, weightWord, comboBy, flowBy, skillBy } from './stats.js';

// tab: 막대 이름 · where: 들어가는 곳 · count: 이름 옆 작은 값
export const STEPS = [
  { id: 'combo', count: ({ S, sel }) => comboBy(S, sel.combo)?.name || '' },
  { id: 'skills', where: '.claude/skills/', count: ({ sel }) => sel.skills.size },
  { id: 'hooks', where: '.claude/harness.json', count: ({ sel }) => sel.hooks.size },
  { id: 'rules', where: 'CLAUDE.md', count: ({ sel, ui }) => ruleCount(sel, ui) },
  { id: 'request', count: ({ sel, t }) => (sel.note.trim() ? t('sumHas') : '') },
  { id: 'review', count: () => '' },
];
export const stepIndex = (id) => STEPS.findIndex((s) => s.id === id);

export function header({ S, ui, t, act }) {
  const d = S.detected;
  return [
    h('a.brand', { href: '#combo', 'aria-label': t('brandLabel') }, icon('i-mark'), h('span', {}, 'harness-fit')),
    h('nav.crumbs', { 'aria-label': t('crumbsLabel') },
      h('span.crumb', {}, icon('i-repo'), h('span', { title: d.root || d.name }, d.name)),
      d.defaultBranch ? [h('span.slash', { 'aria-hidden': 'true' }, '/'), h('span.crumb', {}, icon('i-branch'), h('span', {}, d.defaultBranch))] : null),
    h('span.sp'),
    // 끝난 뒤에는 서버가 꺼져 언어 바꾸기·그만두기를 할 수 없다
    ui.done === undefined ? h('button.hbtn', { type: 'button', 'data-key': 'lang', lang: S.lang === 'ko' ? 'en' : 'ko', 'aria-label': t('langLabel'), disabled: ui.busy, on: { click: act.switchLang } }, icon('i-globe'), h('span', {}, t('langToggle'))) : null,
    ui.done === undefined ? h('button.hbtn', { type: 'button', 'data-key': 'cancel', 'aria-haspopup': 'dialog', disabled: ui.busy, on: { click: act.cancel } }, h('span.always', {}, t('cancel'))) : null,
  ].filter(Boolean);
}

export function tabs(c) {
  const { ui, t } = c;
  return STEPS.map((st, i) => {
    const cur = st.id === ui.step;
    const done = ui.visited.has(st.id) && !cur;
    const n = st.count(c);
    return h('li', {}, h('a.tab', { href: `#${st.id}`, 'aria-current': cur ? 'step' : null, 'data-key': `tab:${st.id}` },
      h('span.in', {},
        done ? h('span.ti.done', { title: t('tabSeen') }, icon('i-check')) : h('span.ti', { 'aria-hidden': 'true' }, String(i + 1)),
        h('span.tn', {}, t(`step_${st.id}`)),
        n === '' || n == null ? null : h(typeof n === 'number' ? 'span.counter' : 'span.ctext', {}, String(n)))));
  });
}

export const stepHead = ({ t }, id) => {
  const i = stepIndex(id);
  const st = STEPS[i];
  return [
    h('p.stepno', {}, h('span', {}, `${i + 1} / ${STEPS.length}`), st.where ? h('span.where', {}, st.where) : null),
    h('h1.qt', { id: `t-${id}`, tabindex: '-1' }, t(`q_${id}`)),
  ];
};

// 고른 것 한 줄씩(오른쪽 요약·확인 단계가 같은 묶음)
export const sumRows = ({ S, sel, ui, t }) => [
  ['combo', t('step_combo'), `${comboBy(S, sel.combo)?.name || '–'} · ${flowBy(S, sel.flow)?.name || '–'}`],
  ['skills', t('step_skills'), t('nItems', { n: sel.skills.size })],
  ['hooks', t('step_hooks'), t('nItems', { n: sel.hooks.size })],
  ['rules', t('step_rules'), ui.preview?.ruleTexts ? t('rulesAndLines', { n: ruleCount(sel, ui), lines: ruleLines(ui) }) : t('nItems', { n: ruleCount(sel, ui) })],
  ['request', t('step_request'), sel.note.trim() ? t('sumHas') : t('sumNone')],
];

function progress({ S, ui, t }) {
  const pr = ui.progress;
  const cur = pr?.current ? ` · ${t('progressCur', { name: skillBy(S, pr.current)?.title || pr.current })}` : '';
  return h('div.prog', { role: 'status' },
    h('span', {}, pr?.total ? t('progress', { done: pr.done, total: pr.total }) : t('applying'), cur),
    h('div.pbar', {}, h('i', { style: `width:${pr?.total ? (pr.done / pr.total) * 100 : 5}%` })));
}

export function sum(c) {
  const { S, sel, ui, t, act } = c;
  const total = costOf(S, sel.skills, sel.rules, sel.flow);
  return h('div.box', {},
    h('div.box-h', {}, h('h2', {}, t('sumTitle')), h('span.muted.mono', {}, S.detected.name)),
    h('ul.srows', {}, sumRows(c).map(([id, k, v]) => h('li', {}, h(`a.srow${id === ui.step ? '.cur' : ''}`, { href: `#${id}`, 'data-key': `sum:${id}`, 'aria-current': id === ui.step ? 'step' : null }, h('span.k', {}, k), h('b', {}, v))))),
    h(`div.cost${ui.previewStale ? '.stale' : ''}`, {},
      h('span.k', {}, t('costK')),
      h('b', {}, t('aboutN', { n: num(S, total) }), h('small', {}, ` ${t('tokens')}`)),
      h('span.d', {}, t('costSplit', { s: num(S, skillTokens(S, sel.skills)), r: num(S, ruleTokens(S, sel.rules, sel.flow)), pct: pct(S, total), word: t(weightWord(total)) }))),
    budgetLine(c),
    h('div.sact', {},
      ui.busy ? progress(c) : null,
      // 적용은 확인 단계의 단추만 한다. 요약 카드는 확인 단계로 데려간다.
      ui.busy || ui.step === 'review' ? null : btnLink('toReview', t('toReview'), '#review', '.lg.primary.block')));
}

export function mbar(c) {
  const { S, sel, ui, t, act } = c;
  const total = costOf(S, sel.skills, sel.rules, sel.flow);
  const head = `${comboBy(S, sel.combo)?.name || ''} · ${flowBy(S, sel.flow)?.name || ''}`;
  const line = t('mbarLine', { s: sel.skills.size, h: sel.hooks.size, r: ruleCount(sel, ui), n: num(S, total) });
  return [
    h('a.mt', { href: '#review', 'aria-label': `${t('sumTitle')}: ${head}, ${line}` }, h('b', {}, head), h('span', {}, line)),
    ui.busy ? progress(c) : h('a.link', { href: '#review', 'data-key': 'toReviewBar' }, t('toReview')),
  ];
}

// 확인 단계에서 아직 적용할 수 없는 까닭(없으면 null): 이미 있는 훅을 확인 중(겹치는 훅이 켜진 채 적용되지 않게)·바뀔 것을 계산 중·계산 실패·팀원 질문에 답하지 않음
export const applyBlock = ({ S, sel, ui }) => (S.detected.existing?.hooksPending ? 'applyNeedExisting'
  : !ui.preview || ui.previewStale ? 'applyNeedPreview' : ui.preview.error ? 'applyPreviewFailed' : shareOpen(sel, ui) ? 'applyNeedShare' : null);

export function cta(c) {
  const { sel, ui, t, act } = c;
  const i = stepIndex(ui.step);
  const last = i === STEPS.length - 1;
  const block = last ? applyBlock(c) : null;
  return h('div.cta', {},
    btn('prev', [icon('i-left'), t('prev')], () => act.go(STEPS[i - 1].id), '.lg', { disabled: i === 0 || ui.busy }),
    h('span.sp'),
    h(`span.next-k${block ? '.warn' : ''}`, { id: 'nextK', role: block ? 'status' : null }, block ? t(block) : last ? t('barCountV', { s: sel.skills.size, h: sel.hooks.size, r: ruleCount(sel, ui) }) : t('nextK', { name: t(`step_${STEPS[i + 1].id}`) })),
    btn(last ? 'applyCta' : 'next', last ? (ui.busy ? t('applyingShort') : t('applyNow')) : t('next'), () => (last ? act.confirmApply() : act.go(STEPS[i + 1].id)), '.lg.primary',
      { 'aria-describedby': last ? 'nextK' : null, disabled: ui.busy || !!block }));
}

export const footer = ({ S, t }) => h('footer', {}, h('span', {}, t('footLocal')), h('span', {}, t('footCatalog', { date: S.checkedAt })));
