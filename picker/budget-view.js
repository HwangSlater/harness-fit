// 스킬 목록 예산 알림(확인 단계·요약 카드)과 끝 화면의 「새 스킬 부르기」. 숫자는 서버 미리보기(/api/preview 의 skillBudget)를 그대로 쓴다 —
// 적용 결과 JSON 과 같은 셈(apply.mjs plan → picker/budget.js). 「권장대로 줄이기」가 뺄 스킬도 서버가 정한 trim 그대로.
import { h, icon } from './dom.js';
import { num, withCode, btn } from './parts.js';
import { skillBy } from './stats.js';
import { catalogChars, NEAR } from './budget.js';
import { noteFlash } from './review-notes.js';

const pctOf = (b) => Math.round(b.ratio * 100);
const names = (S, ids) => ids.map((id) => skillBy(S, id)?.title || id).join(', ');
const charsOf = (S, id) => { const k = skillBy(S, id); return k ? catalogChars(k) : 0; };

// 경고할 예산(미리보기가 없거나 낡았거나 넉넉하면 null)
export const budgetWarn = (ui) => {
  const b = ui.preview && !ui.preview.error ? ui.preview.skillBudget : null;
  return b && b.level !== 'ok' ? b : null;
};

// 확인 단계의 알림 띠: 무슨 일이 생기는지 · 숫자 · 고를 수 있는 두 가지(줄이기 단추 / 예산 늘리는 법은 글로만 — 설정은 바꾸지 않는다)
export function budgetBox(c) {
  const { S, ui, t, act } = c;
  const trimmed = ui.trimmed?.length ? h('div.flash.info', { role: 'status' }, icon('i-info'),
    h('div.sp', {}, h('b', {}, t('budgetTrimmed', { n: ui.trimmed.length, list: names(S, ui.trimmed) }))),
    btn('undoTrim', t('budgetUndo'), act.undoTrim)) : null;
  const b = budgetWarn(ui);
  if (!b) return trimmed;
  const trim = b.trim || [];
  const freed = trim.reduce((a, id) => a + charsOf(S, id), 0);
  const heavy = b.current >= b.budget * NEAR;
  // 한 줄: 제목 · 예산의 몇 % · 「권장대로 줄이기」. 까닭·숫자·뺄 스킬·예산 늘리는 법은 「자세히」 안에
  const trimBtn = trim.length ? btn('trimSkills', t('budgetTrim'), () => act.trimSkills(trim)) : null;
  return [trimmed, noteFlash(c, {
    key: 'budget', cls: `.budget${ui.previewStale ? '.stale' : ''}`, attrs: { 'data-key': 'budgetBox' }, btn: trimBtn,
    title: t(b.level === 'over' ? (b.ratio > 1 ? 'budgetPastT' : 'budgetOverT') : 'budgetNearT'), aside: t('budgetPct', { pct: pctOf(b) }),
    body: [
      h('p', {}, withCode(t('budgetWhy'))),
      h('p.bnums', {}, t('budgetNums', { current: num(S, b.current), added: num(S, b.added), total: num(S, b.total), label: t(`budgetLabel_${b.budgetSource}`), budget: num(S, b.budget), pct: pctOf(b) })),
      heavy ? h('p', {}, t('budgetHeavy', { pct: Math.round((b.current / b.budget) * 100) })) : null,
      trim.length ? h('p', {}, t('budgetTrimD', { list: names(S, trim), n: num(S, freed) })) : null,
      h('p', {}, withCode(t('budgetRaise'))),
    ] }) ];
}

// 요약 카드 한 줄(어느 단계에서나 보이게). 누르면 확인 단계의 알림으로 간다.
export function budgetLine({ ui, t }) {
  const b = budgetWarn(ui);
  if (!b || ui.step === 'review') return null;
  return h(`a.sbudget${ui.previewStale ? '.stale' : ''}`, { href: '#review', 'data-key': 'sumBudget' }, icon('i-warn'), h('span', {}, t(b.ratio > 1 ? 'sumBudgetPast' : 'sumBudget', { pct: pctOf(b) })));
}

// 끝 화면: 받은 스킬을 부르는 명령(/이름)과 실제 크기를 보는 곳
export function skillCommands({ t }, result) {
  const cmds = result.skillCommands || [];
  if (!cmds.length) return null;
  return h('div.box', {}, h('div.box-h', {}, h('span', {}, t('doneCmdsT'))),
    h('div.lrow', {}, h('div.main', {},
      h('div.cmds', {}, cmds.map((x) => h('code', {}, x))),
      h('span.d', {}, withCode(t(result.skillBudget ? 'doneCmdsBudget' : 'doneCmdsD'))))));
}

// 「권장대로 줄이기」와 되돌리기. 뺀 것은 사용자가 직접 끈 것으로 친다(겹침 맞추기가 다시 넣지 않게).
export const budgetActions = ({ ui, current, edited }) => ({
  trimSkills(ids) {
    const sel = current();
    ui.trimmed = ids.filter((id) => sel.skills.has(id));
    for (const id of ui.trimmed) sel.skills.delete(id), ui.touched.add(id);
    edited();
  },
  undoTrim() {
    const sel = current();
    for (const id of ui.trimmed || []) sel.skills.add(id);
    ui.trimmed = null;
    edited();
  },
});
