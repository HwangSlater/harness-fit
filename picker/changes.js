// 무엇이 어디에 무엇으로(스킬·훅·규칙…) 들어가는지. 확인 단계 「생기는 것」, 적용 전 확인 창, 끝 화면이 같이 쓴다.
// p = 미리보기(/api/preview: changes·manual·warnings·skipped). 끝 화면에서는 sel·p 가 「확인하고 적용」을 누른 순간의 사본이다.
import { h } from './dom.js';
import { lrow } from './parts.js';
import { skillBy, flowBy, ruleCount } from './stats.js';

const title = (S, id) => skillBy(S, id)?.title || id;

// 확인 단계의 줄: [아이콘, 제목, 설명, 종류(warn 이면 알림 띠)]
export function outcomeItems({ S, sel, ui, t }) {
  const p = ui.preview;
  if (!p || p.error) return [];
  const n = (kind) => p.changes.filter((x) => x.kind === kind).length;
  const items = [];
  if (n('skill')) items.push(['i-folder', t('wSkills', { n: n('skill') }), t('wSkillsD')]);
  items.push(['i-file', t('wConfig', { n: sel.hooks.size }), t('wConfigD')]);
  if (n('claude-md')) items.push(['i-file', t('wMd', { n: ruleCount(sel, ui) }), t('wMdD')]);
  if (n('share')) items.push(['i-file', t('wShare'), t('wShareD')]);
  if (n('request')) items.push(['i-file', t('wRequest'), t('wRequestD')]);
  if (n('git-hook')) items.push(['i-file', t('wGitHook'), t('wGitHookD')]);
  if (n('gitignore')) items.push(['i-file', t('wGitignore'), t('wGitignoreD')]);
  if (p.manual.length) items.push(['i-down', t('wManual', { n: p.manual.length }), t('wManualD', { list: p.manual.map((m) => title(S, m.skill)).join(', ') })]);
  // 이미 있는 같은 이름 폴더는 건드리지 않는다
  if (p.skipped?.length) items.push(['i-info', t('wSkipped', { n: p.skipped.length }), t('wSkippedD', { list: p.skipped.map((id) => title(S, id)).join(', ') })]);
  return items;
}
// 적용은 되지만 약속대로 동작하지 않을 것(apply.mjs plan 의 warnings): [id, 제목 한 줄, 자세한 설명]
// skill-budget 은 숫자·단추가 있어 따로 그린다(budget-view.js budgetBox)
export const warningsOf = ({ ui, t }) => (ui.preview && !ui.preview.error ? ui.preview.warnings || [] : []).filter((w) => w !== 'skill-budget').map((w) => [w, t(`warn_${w}`), t(`warn_${w}_d`, { cmd: ui.preview.gitHookCmd || '' })]);

export const pathLines = (S, p) => p.changes.map((x) => `${x.action === 'create' ? '+' : '~'} ${x.path}${x.skill ? `  — ${title(S, x.skill)}` : ''}`).join('\n');

// failed = 받지 못한 스킬(끝 화면에서만)
export function changeGroups({ S, sel, t }, p, failed = []) {
  const n = (kind) => p.changes.filter((x) => x.kind === kind).length;
  const missed = new Set(failed.map((x) => x.skill));
  const copied = p.changes.filter((x) => x.kind === 'skill' && !missed.has(x.skill)).map((x) => title(S, x.skill));
  const hookNames = S.hooks.filter((x) => sel.hooks.has(x.id)).map((x) => x.name);
  // 실제로 글이 들어가는 지침만(미리 계산이 있으면 그 목록 — 이미 CLAUDE.md 에 있어 다 빠진 것은 빼고)
  const ruleName = (id) => S.rules.find((r) => r.id === id)?.name || t('flowRule', { name: flowBy(S, id)?.name || id });
  const ruleNames = (p.ruleTexts ? Object.keys(p.ruleTexts) : [...(sel.flow !== 'none' ? [sel.flow] : []), ...sel.rules]).map(ruleName);
  const note = sel.note.trim();
  // 확인 단계 「생기는 것」과 같은 목록 줄(lrow: 아이콘 · 제목 · 설명) + 들어가는 곳 · 이름들.
  // full 이 있으면 이름은 두 줄까지만 보이고, 전체 글은 title 로 둔다(아주 긴 요청 메모가 창을 덮지 않게).
  const group = (ic, head, where, what, names, full) => lrow({ ic, title: head, desc: what, extra: [
    h('span.d', {}, /[/.]/.test(where) ? h('code', {}, where) : where), // 경로만 고정폭
    names?.length ? h(`span.d.cg-names${full ? '.clamp' : ''}`, { title: full || null }, names.join(' · ')) : null] });
  return [
    copied.length ? group('i-folder', t('cSkills', { n: copied.length }), '.claude/skills/', t('cSkillsWhat'), copied) : null,
    p.manual.length ? group('i-down', t('cManual', { n: p.manual.length }), t('cManualWhere'), t('cManualWhat'), p.manual.map((m) => title(S, m.skill))) : null,
    // 플러그인이 안 깔렸으면 「이미 깔린 플러그인이 막아요」 대신 깔아야 돈다고(확인 단계 경고와 같은 말 — 화면 역할 평가)
    group('i-file', t('cHooks', { n: sel.hooks.size }), '.claude/harness.json', t(p.warnings?.includes('plugin-missing') ? 'cHooksWhatNoPlugin' : 'cHooksWhat'), hookNames),
    n('git-hook') ? group('i-file', t('cGitHook'), '.git/hooks/pre-commit', t('cGitHookWhat'), null) : null,
    n('claude-md') ? group('i-file', t('cRules', { n: ruleNames.length }), 'CLAUDE.md', t('cRulesWhat'), ruleNames) : null,
    n('share') ? group('i-file', t('cShare'), '.claude/settings.json', t('cShareWhat', { repo: S.pluginRepo, ref: S.pluginRef }), null) : null,
    n('request') ? group('i-file', t('cNote'), '.claude/harness-request.md', t('cNoteWhat'), note ? [note] : null, note) : null,
    sel.explore.size ? group('i-info', t('cExplore', { n: sel.explore.size }), t('cExploreWhere'), t('cExploreWhat'), [...sel.explore]) : null,
    group('i-folder', t('cBackup'), '.claude/harness-backup/', t('cBackupWhat'), null),
  ];
}
