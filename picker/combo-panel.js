// 「켜지는 것 보기」 창: 크기를 고정한 큰 창(tall)에 이 조합이 켜는 것을 전체 보기와 같은 항목 줄로 다 넣는다.
// 스킬·훅은 전체 보기와 같은 줄(skillItem·hookItem, 미리 보기라 스위치·옵션 없음), CLAUDE.md 지침은 들어갈 글을 처음부터 보여 주고,
// 브랜치 전략은 이름·설명·같이 켜는 훅. 구획마다 끝에 「다른 조합에는 있고 여기엔 없는 것」을 흐리게 적는다
// — 가볍게처럼 적게 켜는 조합에서 빈 곳이 「무엇이 빠졌는지」를 알려 주는 자리가 되게.
// 배치는 전체 보기와 같은 틀: 왼쪽 구획 목록(전체·스킬·훅·지침·브랜치 전략) + 오른쪽 줄(사용자 결정 — 창마다 같은 모양으로)
import { h } from './dom.js';
import { itemRow, num, btn, navItem } from './parts.js';
import { comboBy, flowBy, hookBy, skillBy, hookGroupsOf, diffOf, ruleIds } from './stats.js';
import { skillItem, repoGroups } from './skills.js';
import { hookItem } from './hooks.js';
import { ruleDesc, altLines, droppedBox } from './rule-dialog.js';

// 왼쪽 목록 「스킬」 아래 이 조합의 저장소 칸
const repoNav = (S, k) => [...new Set(k.skills.map((id) => skillBy(S, id)?.repo).filter(Boolean))];

const head = (title, sub) => h('div.gsec', {}, h('h3', {}, title), sub ? h('span', {}, sub) : null);
const notIn = (t, names) => (names.length ? h('p.hint.cnot', {}, t('comboNotIn', { list: names.join(' · ') })) : null);

// 구획 정의: { id, name, n, rows(), empty, others }
function sections(c, k) {
  const { S, sel, t } = c;
  const other = (pick, has, name) => [...new Set(S.combos.filter((x) => x.id !== k.id).flatMap(pick))].filter((id) => !has.has(id)).map(name).filter(Boolean);
  const skills = new Set(k.skills);
  const hooks = new Set(k.hooks);
  const rules = ruleIds({ flow: k.flow, rules: new Set(k.rules) }, null).filter((id) => S.rules.some((r) => r.id === id));
  // 이 조합으로 고르면 CLAUDE.md 에 들어갈 글(서버가 조합의 훅·스킬에 맞춰 만든 것 — 지침 단계 미리 보기와 같은 계산)
  const x = { ...sel, combo: k.id, flow: k.flow, skills, hooks, rules: new Set(k.rules), hookOpts: {}, baseOpts: k.hookOpts || {} };
  const ruleRow = (id) => {
    const r = S.rules.find((y) => y.id === id);
    const { lines, drops } = altLines(c, `combo:${k.id}`, x, id);
    return h('div.crule', {},
      itemRow(c, { key: `cr:${id}`, name: r.name, plain: ruleDesc(S, r), meta: [t('aboutTok', { n: num(S, S.ruleTokens[id] || 0) })] }),
      lines, drops.length ? h('div.cdrop', {}, h('p.hint', {}, t('ruleDlgDropped')), droppedBox(c, drops)) : null);
  };
  const f = flowBy(S, k.flow);
  const flowRow = () => (k.flow === 'none' || !f
    ? itemRow(c, { key: 'cf', name: t('flowRuleNone'), plain: t('flowRuleNoneD', { name: f?.name || '' }) })
    : itemRow(c, { key: 'cf', name: f.name, plain: f.desc, meta: [f.hooksOn.length ? t('comboFlowHooks', { list: f.hooksOn.map((id) => hookBy(S, id)?.name || id).join(' · ') }) : null] }));
  return [
    { id: 'skills', name: t('step_skills'), n: skills.size, rows: () => repoGroups(c, k.skills, (id) => skillItem(c, id, { preview: true })), empty: t('comboNoSkills'),
      others: other((x2) => x2.skills, skills, (id) => skillBy(S, id)?.title) },
    { id: 'hooks', name: t('step_hooks'), n: hooks.size, empty: t('comboNoHooks'),
      rows: () => hookGroupsOf(S, t('groupOther')).flatMap((g) => g.hooks.filter((y) => hooks.has(y.id)).map((y) => hookItem(c, y, { preview: true }))),
      others: other((x2) => x2.hooks, hooks, (id) => hookBy(S, id)?.name) },
    { id: 'rules', name: t('step_rules'), n: rules.length, rows: () => rules.map(ruleRow), empty: t('comboNoRules'),
      others: S.rules.filter((r) => !rules.includes(r.id)).map((r) => r.name) },
    { id: 'flow', name: t('comboFlow'), n: null, rows: () => [flowRow(), h('p.hint.cnot', {}, t('comboFlowNote'))], others: [] },
  ];
}

const sectionView = (c, s) => [
  head(s.name, s.n == null ? '' : c.t('nItems', { n: s.n })),
  ...(s.n === 0 ? [h('div.gempty', {}, s.empty)] : s.rows()),
  notIn(c.t, s.others),
];

export function comboPanel(c, d) {
  const { S, sel, t, act } = c;
  const k = comboBy(S, d.id);
  const secs = sections(c, k);
  const cur = sel.combo === k.id;
  const diff = diffOf(sel, k);
  const g = d.g || 'all';
  const shown = g === 'all' ? secs : secs.filter((s) => s.id === g);
  const repo = g.startsWith('repo:') ? g.slice(5) : null;
  const list = repo
    ? [head(repo, ''), ...repoGroups(c, k.skills.filter((id) => skillBy(S, id)?.repo === repo), (id) => skillItem(c, id, { preview: true }))]
    : shown.flatMap((s) => sectionView(c, s));
  // 저장소 칸은 「스킬」을 골랐을 때만 펼친다(전체 보기의 단계 → 저장소와 같게)
  const openSkills = g === 'skills' || !!repo;
  const nav = [
    navItem({ key: 'cg:all', current: g === 'all', name: t('addAll'), onClick: () => act.comboGroup('all') }),
    h('hr'),
    ...secs.map((s) => navItem({ key: `cg:${s.id}`, current: g === s.id, name: s.name, count: s.n == null ? (s.id === 'flow' ? flowBy(S, k.flow)?.name || '' : '') : s.n, onClick: () => act.comboGroup(s.id) }))
      .flatMap((b, i) => (secs[i].id === 'skills' && openSkills
        ? [b, ...repoNav(S, k).map((r) => navItem({ key: `cg:repo:${r}`, cls: '.sub', current: g === `repo:${r}`, name: r, count: k.skills.filter((id) => skillBy(S, id)?.repo === r).length, onClick: () => act.comboGroup(`repo:${r}`) }))]
        : [b])),
  ];
  return {
    title: t('comboPanelTitle', { name: k.name }), sub: `${k.for} · ${t('comboPanelSub')}`, tall: true, nav, list,
    foot: [h('span.muted', {}, cur ? t('comboCur') : diff.length ? `${t('diffLabel')} ${diff.map(([n, v]) => `${t(n)} ${v}`).join(' · ')}` : t('diffSame')),
      btn('panelDone', t('close'), act.closePanel, '.lg'),
      btn('pickHere', cur ? t('comboPicked') : t('comboPick'), () => act.pickCombo(k, true), '.lg.primary', { disabled: cur })],
  };
}
