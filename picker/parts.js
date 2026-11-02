// 작은 부품: 켜고 끄는 스위치, 스킬 표시, 훅 한 줄, 규칙 카드. (작은 창들은 dialogs.js)
import { h } from './dom.js';

export const fmtStars = (n) => (n >= 10000 ? `${(n / 10000).toFixed(1)}만` : n >= 1000 ? `${(n / 1000).toFixed(1)}천` : String(n ?? '–'));
const fmtStarsEn = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n ?? '–'));
export const stars = (S, n) => (S.lang === 'ko' ? fmtStars(n) : fmtStarsEn(n));

// 켜짐/꺼짐이 한눈에 보이는 스위치(누르는 곳은 바깥 버튼)
export const switchEl = (on, t) =>
  h(`span.switch${on ? '.on' : ''}`, { 'aria-hidden': 'true' }, h('span.knob'), h('span.sw-label', {}, on ? t('on') : t('off')));

// 스킬 카드에 붙는 작은 표시
export const skillBadges = (S, k, t) => [
  k.scripts.length ? h('span.badge.info', {}, t('badgeScripts', { n: k.scripts.length })) : null,
  k.install === 'plugin' ? h('span.badge.plain', {}, t('badgePlugin')) : null,
];

// 막는 실수 한 줄: 스위치 + 예시 + 막는 조건(브랜치 방식에 따라 바뀜)
export function hookItem({ S, sel, ui, t, act }, x) {
  const on = sel.hooks.has(x.id);
  const o = S.flows.find((f) => f.id === sel.flow)?.override?.[x.id] || {};
  const bad = o.bad || x.bad;
  const fix = o.fix || x.fix;
  return h(`div.guard${on ? '' : '.off'}`, {},
    h('button.guard-main', { 'aria-pressed': String(on), on: { click: () => act.toggle('hooks', x.id) } },
      h('span', {}, h('b', {}, x.name), h('span.ex', {}, h('span.bad', {}, bad), ' → ', h('span.fix', {}, fix))),
      switchEl(on, t)),
    // 다시 그려도 펼쳐 둔 조건은 펼친 채로 둔다.
    h('details.cond', { open: ui.openConds.has(x.id), on: { toggle: (e) => (e.target.open ? ui.openConds.add(x.id) : ui.openConds.delete(x.id)) } },
      h('summary', {}, t('condition')), h('div', {}, o.detail || x.detail)));
}

// CLAUDE.md 규칙 카드: 실제로 들어갈 문장을 펼쳐 볼 수 있다
export function ruleCard({ S, sel, ui, t, act }, r, fixed) {
  const on = fixed || sel.rules.has(r.id);
  const text = ui.preview?.ruleTexts?.[r.id];
  const open = ui.openRule === r.id;
  return h(`div.rulec${on ? '' : '.off'}${fixed ? '.fixed' : ''}`, {},
    h(fixed ? 'div.rule-main' : 'button.rule-main', fixed ? {} : { 'aria-pressed': String(on), on: { click: () => act.toggle('rules', r.id) } },
      h('span', {}, h('b', {}, r.name), h('span.d', {}, r.desc), h('span.m', {}, t('tileRuleC', { n: S.ruleTokens[r.id] || 0 }))),
      fixed ? null : switchEl(on, t)),
    on && text ? h('button.linkish.small', { on: { click: () => act.openRule(open ? null : r.id) } }, open ? t('hideText') : t('showText')) : null,
    open && text ? h('pre.rule-text', {}, text) : null);
}

// 무엇이 어디에 무엇으로(스킬·훅·규칙…) 들어가는지 묶음. 적용 전 확인 창과 끝 화면이 같이 쓴다.
// p = 미리보기(changes·manual), failed = 받지 못한 스킬(끝 화면에서만)
export function changeGroups({ S, sel, t }, p, failed = []) {
  const n = (kind) => p.changes.filter((x) => x.kind === kind).length;
  const title = (id) => S.skills.find((k) => k.id === id)?.title || id;
  const missed = new Set(failed.map((x) => x.skill));
  const copied = p.changes.filter((x) => x.kind === 'skill' && !missed.has(x.skill)).map((x) => title(x.skill));
  const hookNames = S.hooks.filter((x) => sel.hooks.has(x.id)).map((x) => x.name);
  const ruleNames = [...S.rules.filter((r) => sel.rules.has(r.id)).map((r) => r.name), ...(sel.flow !== 'none' ? [t('flowRule', { name: S.flows.find((f) => f.id === sel.flow).name })] : [])];
  const group = (kind, head, where, what, names) =>
    h(`div.cg.${kind}`, {},
      h('div.cg-head', {}, h('b', {}, head), h('code', {}, where)),
      h('div.cg-what', {}, what),
      names?.length ? h('div.cg-names', {}, names.join(' · ')) : null);
  return [
    copied.length ? group('skill', t('cSkills', { n: copied.length }), '.claude/skills/', t('cSkillsWhat'), copied) : null,
    p.manual.length ? group('manual', t('cManual', { n: p.manual.length }), t('cManualWhere'), t('cManualWhat'), p.manual.map((m) => title(m.skill))) : null,
    group('hook', t('cHooks', { n: sel.hooks.size }), '.claude/harness.json', t('cHooksWhat'), hookNames),
    n('claude-md') ? group('rule', t('cRules', { n: ruleNames.length }), 'CLAUDE.md', t('cRulesWhat'), ruleNames) : null,
    n('share') ? group('share', t('cShare'), '.claude/settings.json', t('cShareWhat', { repo: S.pluginRepo, ref: S.pluginRef }), null) : null,
    n('request') ? group('memo', t('cNote'), '.claude/harness-request.md', t('cNoteWhat'), [sel.note.trim().split('\n')[0] + (sel.note.trim().includes('\n') ? ' …' : '')]) : null,
    sel.explore.size ? group('plain', t('cExplore', { n: sel.explore.size }), t('cExploreWhere'), t('cExploreWhat'), [...sel.explore]) : null,
    group('plain', t('cBackup'), '.claude/harness-backup/', t('cBackupWhat'), null),
  ];
}
