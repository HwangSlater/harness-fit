// 6 확인 단계(고른 것 + 「바꾸기」, 적용하면 생기는 것, 팀원 공유, GitHub 설정)와 끝 화면.
import { h, icon } from './dom.js';
import { lrow, flash, shead, num, link, withCode } from './parts.js';
import { teamBox, teamHowTo } from './team.js';
import { comboBy, hookGroupsOf, costOf, pct, ruleIds, skillBy } from './stats.js';
import { stepHead, sumRows } from './frame.js';
import { outcomeItems, warningsOf, pathLines, changeGroups } from './changes.js';
import { githubBox, githubResult } from './github.js';
import { budgetBox, skillCommands } from './budget-view.js';
import { noteFlash } from './review-notes.js';

const short = (t, names, n = 3) => (names.length > n ? t('listMore', { list: names.slice(0, n).join(' · '), n: names.length - n }) : names.join(' · ') || t('sumNone'));

// 고른 것 한 줄마다 자세한 설명(오른쪽 요약과 같은 묶음 + 무엇이 들었는지)
function details(c) {
  const { S, sel, ui, t } = c;
  const groups = hookGroupsOf(S, t('groupOther')).map((g) => [g.name, g.hooks.filter((x) => sel.hooks.has(x.id)).length]).filter(([, n]) => n);
  const ruleName = (id) => S.rules.find((r) => r.id === id)?.name || t('flowRule', { name: S.flows.find((f) => f.id === id)?.name || id });
  const note = sel.note.trim();
  return {
    combo: comboBy(S, sel.combo)?.desc || '',
    skills: short(t, [...sel.skills].map((id) => skillBy(S, id)?.title || id)),
    hooks: groups.map(([n, k]) => `${n} ${k}`).join(' · ') || t('hooksNone'),
    rules: short(t, ruleIds(sel, ui).map(ruleName)),
    request: note ? (note.length > 80 ? `${note.slice(0, 80)}…` : note) : t('noteNone'),
  };
}

function filesBox(c) {
  const { S, ui, t, act } = c;
  const p = ui.preview;
  const head = h('div.box-h', {}, h('span', {}, t('filesHead')),
    p && !p.error ? link('paths', ui.pathsOpen ? t('pathsHide') : t('paths'), act.togglePaths, { 'aria-expanded': String(ui.pathsOpen) }) : null);
  if (!p) return h('div.box', {}, head, h('div.lrow.note', { role: 'status' }, t('previewLoading')));
  if (p.error) {
    return h('div.box', {}, head, h('div.lrow.note', { role: 'alert' }, h('div.main', {}, h('b', {}, p.error), h('span.d', {}, p.text), p.detail ? h('span.d', {}, t('errDetail', { detail: p.detail })) : null),
      h('button.btn', { type: 'button', 'data-key': 'retryPreview', on: { click: act.retryPreview } }, t('retry'))));
  }
  return h(`div.box${ui.previewStale ? '.stale' : ''}`, {}, head,
    outcomeItems(c).map(([ic, title, desc]) => lrow({ ic, title, desc })),
    ui.pathsOpen ? h('pre.paths', { tabindex: '0' }, pathLines(S, p)) : null);
}

export function reviewStep(c) {
  const { S, sel, ui, t, act } = c;
  const d = details(c);
  const total = costOf(S, sel.skills, sel.rules, sel.flow);
  return [
    ...stepHead(c, 'review'),
    h('p.qs', {}, t('s7p')),
    h('div.qb', {},
      h('div.box', {},
        h('div.box-h', {}, h('span', {}, t('sumTitle')), h('span.muted', {}, t('reviewCost', { n: num(S, total), pct: pct(S, total) }))),
        sumRows(c).map(([id, k, v]) => h('div.lrow.rv', {}, h('span.k', {}, k), h('div.main', {}, h('b', {}, v), h('span.d', {}, d[id])),
          h('a.link', { href: `#${id}`, 'data-key': `change:${id}`, 'aria-label': t('changeLabel', { name: k }) }, t('change'))))),
      shead(t('s7'), ''),
      h('div.cols', {},
        h('div.stack', {}, filesBox(c), budgetBox(c), warningsOf(c).map(([id, title, desc]) => noteFlash(c, { key: `warn:${id}`, title, body: h('p', {}, withCode(desc)), attrs: { 'data-key': `warn:${id}` } }))),
        h('div.stack', {},
          teamBox(c),
          githubBox(c))),
      h('div.steps-ol', {}, h('b', {}, t('stepsTitle')), h('ol', {}, [t('step1'), t('step2'), t('step3', { n: (ui.preview?.changes || []).filter((x) => x.kind === 'skill').length }), t('step4')].map((x) => h('li', {}, x)))),
      h('p.undo', {}, t('undoPre'), h('code', {}, S.undoCommand), t('undoPost'))),
  ];
}

// 끝 화면. c.sel·c.ui.preview 는 「확인하고 적용」을 누른 순간의 사본이다(app.js).
export function finished(c, result) {
  const { S, sel, ui, t } = c;
  if (!result) return h('section.step.done', {}, h('h1.qt', { tabindex: '-1' }, t('cancelled')), h('p.qs', {}, t('cancelledD')));
  const p = ui.preview && !ui.preview.error && ui.preview.changes ? ui.preview : null;
  const names = (list) => list.map((x) => skillBy(S, x.skill)?.title || x.skill).join(', ');
  return h('section.step.done', {},
    h('p.stepno', {}, icon('i-check'), h('span', {}, t('doneKicker'))),
    h('h1.qt', { tabindex: '-1' }, t('doneTitle')),
    h('p.qs', {}, t('done'), sel.note.trim() ? ` ${t('doneNote')}` : ''),
    h('div.qb.stack', {},
      result.failed?.length ? flash({ role: 'alert', title: t('doneFailed', { list: names(result.failed) }) }) : null,
      result.manual?.length ? flash({ cls: '.info', title: t('doneManual', { list: names(result.manual) }) }) : null,
      githubResult(c, result.github),
      p ? h('div.box', {}, h('div.box-h', {}, h('span', {}, t('doneWhat'))), changeGroups(c, p, result.failed)) : null,
      // CLAUDE.md 에 지침을 넣었을 때만: 사람만 아는 것은 직접 적게(지침 단계와 같은 한 줄)
      p && Object.keys(p.ruleTexts || {}).length ? h('p.hint', {}, withCode(t('ownNotes'))) : null,
      skillCommands(c, result),
      sel.share && p ? teamHowTo(c, p, true) : null,
      h('details.paths-d', {}, h('summary', {}, t('paths')), h('pre.paths', {}, (result.changed || []).map((line) => {
        const id = line.match(/\.claude\/skills\/([^/\s]+)/)?.[1];
        return id ? `${line}  — ${skillBy(S, id)?.title || ''}` : line;
      }).join('\n'))),
      h('p.undo', {}, t('undoPre'), h('code', {}, result.undo || S.undoCommand), t('undoPost'))));
}
