// 1 조합·브랜치 단계, 5 요청 단계. (2 스킬은 skills.js, 3 자동 검사는 hooks.js, 4 규칙은 rules.js, 6 확인은 review.js)
import { h, icon } from './dom.js';
import { previousLine, shead, flash, label, link } from './parts.js';
import { coverage, ruleCount, comboBy, flowBy, hookBy } from './stats.js';
import { stepHead } from './frame.js';
import { flowArt } from './flow-art.js';

const COMBO_ICON = { light: 'i-feather', solo: 'i-bolt', team: 'i-people', strict: 'i-shield' };

// 저장소에서 찾은 것: 스택 · 추천 이유 · develop 브랜치 · (빈 저장소면) 알려 준 내용이나 기본 조합으로 시작했다는 것
function found({ S, t }) {
  const d = S.detected;
  // 스택 이름은 고정폭 표시, 추천 이유·develop 같은 문장은 본문 글꼴(고정폭 한글은 글자 사이가 벌어진다)
  const words = [S.recommended.why[0], d.hasDevelop ? t('flowChip') : null].filter(Boolean);
  const hint = d.hinted;
  return h('div.found', {},
    h('span.k', {}, t('foundK')), (d.stack || []).map((x) => h('span.tok', {}, x)), words.map((x) => h('span.tok.text', {}, x)),
    // 빈 저장소: 맞춤 추천을 못 했다는 것을 숨기지 않는다. 사용자가 말로 알려 준 것은 그렇다고 표시한다.
    hint?.stack.length ? h('span.tok.hint', {}, t('hintChip', { list: hint.stack.join(' · ') })) : null,
    d.thin && !hint && !S.previous ? h('p.hint.thin', {}, t('thinChip')) : null);
}

function comboCard(c, k) {
  const { S, sel, ui, t, act } = c;
  const picked = k.id === sel.combo;
  const cov = coverage(S, k.skills);
  // 직접 고친 조합은 지금 실제로 고른 개수를 보여 준다(요약 카드와 같은 숫자).
  const n = picked && ui.custom ? { s: sel.skills.size, h: sel.hooks.size, r: ruleCount(sel, ui) } : { s: k.skills.length, h: k.hooks.length, r: k.rules.length + (k.flow !== 'none' ? 1 : 0) };
  return h(`div.card.combo${picked ? '.sel' : ''}`, {},
    h('button.cmain', { type: 'button', 'aria-pressed': String(picked), 'data-key': `combo:${k.id}`, on: { click: () => act.pickCombo(k) } },
      h('span.tt', {}, h('span.ico', {}, icon(COMBO_ICON[k.id] || 'i-file')), h('h3', {}, k.name),
        picked && ui.custom ? label(t('custom')) : k.id === S.recommended.combo ? label(t('recommended'), '.accent') : null),
      h('p', {}, k.desc),
      h('p.for', {}, k.for),
      h('span.cnt', {}, t(picked && ui.custom ? 'comboCntNow' : 'comboCnt', n))),
    h('div.cfoot', {},
      h('span.cov', { role: 'img', 'aria-label': t('covLabel', { n: cov.filter(Boolean).length }) }, cov.map((v) => h(`i${v ? '.on' : ''}`))),
      link(`see:${k.id}`, t('seeCombo'), () => act.openPanel({ kind: 'combo', id: k.id }), { 'aria-haspopup': 'dialog' })));
}

// 고른 조합의 기본값과 비교해 브랜치 방식 때문에 달라진 검사(누적)
function flowNote({ S, sel, t }) {
  const base = comboBy(S, sel.combo);
  if (!base || base.flow === sel.flow) return null;
  const related = new Set(S.flows.flatMap((f) => [...f.hooksOn, ...f.hooksOff]));
  const name = (id) => hookBy(S, id)?.name || id;
  const parts = [...related].filter((id) => base.hooks.includes(id) !== sel.hooks.has(id))
    .map((id) => (sel.hooks.has(id) ? t('flowOn', { name: name(id) }) : t('flowOff', { name: name(id) })));
  return parts.length ? flash({ cls: '.info', role: 'status', title: t('flowNote', { list: parts.join(', ') }) }) : null;
}

function flows(c) {
  const { S, sel, t, act } = c;
  const f = flowBy(S, sel.flow);
  const on = (f?.hooksOn || []).map((id) => hookBy(S, id)?.name || id);
  return [
    shead(t('s4'), t('s4p')),
    h('div.flows', { role: 'radiogroup', 'aria-label': t('s4') }, S.flows.map((x) => {
      const picked = x.id === sel.flow;
      return h(`label.card.flow${picked ? '.sel' : ''}`, {},
        h('input', { type: 'radio', name: 'flow', value: x.id, checked: picked, 'data-key': `flow:${x.id}`, on: { change: () => act.pickFlow(x.id) } }),
        flowArt(x.id, t),
        h('span.tt', {}, h('span.radio'), h('h3', {}, x.name)),
        h('p', {}, x.desc), x.for && x.for !== x.desc ? h('p', {}, x.for) : null);
    })),
    h('p.hint', {}, f && f.id !== 'none' ? t(on.length ? 'flowTurnsOn' : 'flowRuleOnly', { n: on.length, list: on.join(' · '), name: f.name }) : t('flowNone')),
    flowNote(c),
  ];
}

export function comboStep(c) {
  const { S, ui, t, act } = c;
  const rec = comboBy(S, S.recommended.combo);
  return [
    ...stepHead(c, 'combo'),
    h('p.qs', {}, S.previous ? t('sub_combo_prev') : t('sub_combo', { name: rec?.name || '' })),
    h('div.qb', {},
      found(c),
      previousLine(c),
      h('div.combos', {}, S.combos.map((k) => comboCard(c, k))),
      ui.switched && !ui.switched.reset ? flash({ cls: '.info', role: 'status', title: t('switched', { name: comboBy(S, c.sel.combo)?.name }),
        act: h('button.btn', { type: 'button', 'data-key': 'undoSwitch', on: { click: act.undoSwitch } }, t('undoSwitch')) }) : null,
      h('p.hint', {}, t('covTitle')),
      flows(c)),
  ];
}

export function requestStep(c) {
  const { S, sel, t, act } = c;
  const examples = ['noteEx1', 'noteEx2', 'noteEx3', 'noteEx4'].map((k) => t(k));
  return [
    ...stepHead(c, 'request'),
    h('p.qs', {}, t('s6p')),
    h('div.qb', {}, h('div.req', {},
      h('label', { for: 'note' }, t('noteLabel')),
      h('textarea', { id: 'note', 'data-key': 'note', rows: 5, maxlength: S.noteMax, placeholder: t('notePh'), 'aria-describedby': 'noteCount', value: sel.note, on: { input: (e) => act.setNote(e.target.value) } }),
      h('div.under', {}, h('span.muted', {}, t('noteWhere')), h('span.count', { id: 'noteCount' }, t('noteCount', { n: sel.note.length, max: S.noteMax }))),
      h('div.exs', {}, h('span.muted', {}, t('noteEx')), examples.map((ex, i) => {
        const has = sel.note.includes(ex);
        return h('button.btn', { type: 'button', 'data-key': `ex:${i}`, disabled: has, title: has ? t('noteDup') : null, on: { click: () => act.addNote(ex) } }, icon(has ? 'i-check' : 'i-plus'), ex);
      })))),
  ];
}
