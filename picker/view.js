// 고르기 화면의 구역들(시안 2차 a). 상태는 app.js 가 갖고, 여기는 그리기만 한다.
// c = { S, sel, ui, t, act } — S: 서버 상태, sel: 고른 것, ui: 화면 상태, t: 문구, act: 동작
import { h, s, icon } from './dom.js';
import { stars, skillBadges, hookItem, ruleCard, switchEl, changeGroups } from './parts.js';

// 개발 단계 ↔ 카탈로그 단계. 순서대로 처음 맞는 칸에 놓는다.
export const STAGES = [
  ['plan', ['plan'], 'M4 6h16M4 12h10M4 18h7'],
  ['design', ['design', 'ui'], 'M4 4h16v16H4zM4 10h16'],
  ['build', ['impl', 'refactor', 'perf'], 'M8 7l-5 5 5 5M16 7l5 5-5 5'],
  ['test', ['test', 'debug'], 'M5 13l4 4L19 7'],
  ['review', ['review', 'security'], 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6'],
  ['ship', ['git', 'ci', 'deploy'], 'M12 3v12M7 8l5-5 5 5M5 21h14'],
  ['other', ['docs', 'meta', 'files'], 'M4 4h10l6 6v10H4zM14 4v6h6'],
];
const MAIN = STAGES.slice(0, 6);
const WORD_LIGHT = 300;
const WORD_MID = 900;

export const stageOf = (skill) => STAGES.find(([, cats]) => cats.some((x) => skill.stages.includes(x)))?.[0] || 'other';
const skillBy = (S, id) => S.skills.find((k) => k.id === id);
const sum = (arr) => arr.reduce((a, b) => a + b, 0);
// 훅과 같은 일을 하는 스킬은 고를 목록에서 뺀다(헷갈림 방지).
const listable = (S, k) => !(k.overlapsHook && S.hooks.some((x) => x.id === k.overlapsHook));

export const costOf = (S, skills, rules, flow) =>
  sum([...skills].map((id) => skillBy(S, id)?.always || 0)) + sum([...rules, flow].map((id) => S.ruleTokens[id] || 0));
export const pct = (S, n) => ((n / S.contextTokens) * 100).toFixed(1);
const word = (t, n) => t(n < WORD_LIGHT ? 'word1' : n < WORD_MID ? 'word2' : 'word3');
const ruleCount = (sel) => sel.rules.size + (sel.flow !== 'none' ? 1 : 0);

// kinds: 이 구역에서 고른 것이 무엇으로(스킬·훅·규칙) 어디에 들어가는지 제목 옆에 붙이는 표시
const section = (n, title, sub, ...body) => sectionK(n, [], title, sub, ...body);
const sectionK = (n, kinds, title, sub, ...body) =>
  h('section.sec', { id: `s${n}` }, h('div.sec-head', {}, h('span.num', {}, String(n)), h('h2', {}, title), kinds, sub ? h('p', {}, sub) : null), ...body);
const kind = (t, k) => h(`span.kind.${k}`, {}, t(`kind${k[0].toUpperCase()}${k.slice(1)}`));

export function header({ S, t, act }) {
  const chips = [h('span.chip', {}, S.recommended.why[0])];
  const byStack = new Map(); // 같은 스택에서 나온 스킬은 칩 하나로
  for (const a of S.recommended.addons || []) {
    const key = a.stacks.join(' · ');
    byStack.set(key, [...(byStack.get(key) || []), ...a.skills]);
  }
  for (const [stack, ids] of byStack) chips.push(h('span.chip', {}, stack, ' → ', h('b', {}, ids.map((id) => skillBy(S, id)?.title || id).join(', '))));
  if (S.detected.hasDevelop) chips.push(h('span.chip', {}, t('flowChip')));
  // 빈 저장소: 맞춤 추천을 못 했다는 것을 숨기지 않는다. 사용자가 말로 알려 준 것은 그렇다고 표시한다.
  const hint = S.detected.hinted;
  // 인원은 맨 앞 칩(추천 이유)이 이미 말하므로 여기엔 스택만.
  if (hint?.stack.length) chips.push(h('span.chip.hint', {}, t('hintChip', { list: hint.stack.join(' · ') })));
  else if (S.detected.thin && !hint) chips.push(h('span.chip.thin', {}, t('thinChip')));
  return h('header.top', {},
    h('div.grow', {}, h('h1', {}, t('title', { name: S.detected.name })), h('p.lead', {}, t('lead')), h('div.detect', {}, chips)),
    h('button.lang', { 'data-key': 'lang', on: { click: act.switchLang } }, t('langToggle')));
}

export function tiles({ S, sel, t }) {
  const skillTok = sum([...sel.skills].map((id) => skillBy(S, id)?.always || 0));
  const ruleTok = sum([...sel.rules, sel.flow].map((id) => S.ruleTokens[id] || 0));
  const total = skillTok + ruleTok;
  const max = Math.max(total, ...S.combos.map((k) => costOf(S, k.skills, k.rules, k.flow)));
  const tile = (kind, k, big, unit, d, foot, extra) =>
    h(`div.card.tile.${kind}`, {}, h('div.tk', {}, k), h('div.big', {}, big, h('small', {}, unit)), extra, h('div.td', {}, d), h('div.foot', {}, foot));
  return h('div.tiles', {},
    tile('skill', t('tileSkillK'), sel.skills.size, t('tileSkillU'), t('tileSkillD'), t('tileSkillC', { n: skillTok })),
    tile('hook', t('tileHookK'), sel.hooks.size, t('tileHookU'), t('tileHookD'), t('tileHookC')),
    tile('rule', t('tileRuleK'), ruleCount(sel), t('tileRuleU'), t('tileRuleD'), t('tileRuleC', { n: ruleTok })),
    tile('cost', t('tileCostK'), total.toLocaleString(), t('tileCostU'), t('tileCostD'), t('costLine', { word: word(t, total), pct: pct(S, total) }),
      [h('div.meter', {}, h('i', { style: `width:${max ? (total / max) * 100 : 0}%` })), h('div.scale', {}, h('span', {}, t('scaleLow')), h('span', {}, t('scaleHigh')))]));
}

const coverage = (S, skills) => MAIN.map(([id]) => skills.some((sid) => { const k = skillBy(S, sid); return k && stageOf(k) === id; }));

export function combos({ S, sel, ui, t, act }) {
  return section(1, t('s1'), t('s1p'),
    h('div.combos', {}, S.combos.map((k) => {
      const n = costOf(S, k.skills, k.rules, k.flow);
      const picked = k.id === sel.combo;
      return h(`button.combo${picked ? '.on' : ''}`, { 'data-key': `combo:${k.id}`, 'aria-pressed': String(picked), on: { click: () => act.pickCombo(k) } },
        h('div.row1', {}, h('span.name', {}, k.name),
          picked && ui.custom ? h('span.tag', {}, t('custom')) : k.id === S.recommended.combo ? h('span.rec', {}, t('recommended')) : null),
        h('div.for', {}, k.for),
        h('div.cov', { title: t('covTitle') }, coverage(S, k.skills).map((on) => h(`i${on ? '.on' : ''}`))),
        // 직접 고친 조합은 지금 실제로 고른 개수를 보여 준다(아래 막대와 같은 숫자).
        h('div.foot', {}, h('span', {}, picked && ui.custom ? t('comboFootNow', { s: sel.skills.size, h: sel.hooks.size }) : t('comboFoot', { s: k.skills.length, h: k.hooks.length })), h('span', {}, `${word(t, n)} ${pct(S, n)}%`)),
        picked ? null : h('div.diff', {}, diffText({ sel, t }, k)));
    })),
    ui.switched ? h('div.toast', { role: 'status' }, t('switched', { name: S.combos.find((k) => k.id === sel.combo)?.name }),
      h('button.linkish.small', { 'data-key': 'undoSwitch', on: { click: act.undoSwitch } }, t('undoSwitch'))) : null);
}

// 다른 조합을 고르면 지금 선택에서 무엇이 달라지는지(「지금보다 스킬 +4 · 훅 +1」)
function diffText({ sel, t }, k) {
  const d = (now, next) => {
    const plus = next.filter((x) => !now.has(x)).length;
    const minus = [...now].filter((x) => !next.includes(x)).length;
    return [plus ? `+${plus}` : '', minus ? `−${minus}` : ''].filter(Boolean).join(' ');
  };
  const parts = [[t('diffSkill'), d(sel.skills, k.skills)], [t('diffHook'), d(sel.hooks, k.hooks)], [t('diffRule'), d(sel.rules, k.rules)]].filter(([, v]) => v);
  return parts.length ? `${t('diffLabel')} ${parts.map(([n, v]) => `${n} ${v}`).join(' · ')}` : t('diffSame');
}

function skillCard(c, k) {
  const { S, sel, t, act } = c;
  const on = sel.skills.has(k.id);
  return h(`div.sk${on ? '' : '.off'}`, {},
    h('button.sk-main', { 'data-key': `skill:${k.id}`, 'aria-pressed': String(on), on: { click: () => act.toggle('skills', k.id) } },
      h('b', {}, k.title), h('span', {}, on ? k.when : t('removed'))),
    h('div.sk-foot', {}, skillBadges(S, k, t), h('button.sk-more', { 'data-key': `more:${k.id}`, 'aria-haspopup': 'dialog', on: { click: () => act.openDetail(k.id) } }, t('details'))));
}

function stageColumn(c, [id, , path]) {
  const { S, sel, ui, t, act } = c;
  const mine = S.skills.filter((k) => stageOf(k) === id && listable(S, k));
  const shown = mine.filter((k) => sel.skills.has(k.id) || ui.touched.has(k.id));
  const others = mine.filter((k) => !sel.skills.has(k.id) && !ui.touched.has(k.id));
  // 「+ 더하기」는 작은 창(dialogs.js)으로 연다.
  return h(`div.stage${id === 'other' ? '.wide' : ''}`, {},
    h('div.sh', {}, h('span.ico', {}, icon(path)), h('div', {}, h('h3', {}, t(`stage.${id}`)), h('div.tiny', {}, t(`stage.${id}.sub`)))),
    shown.length ? shown.map((k) => skillCard(c, k)) : h('div.empty', {}, id === 'other' ? t('emptyOther') : t('emptyStage')),
    others.length ? h('button.add', { 'data-key': `add:${id}`, 'aria-haspopup': 'dialog', on: { click: () => act.openAdd(id) } }, t('addSkill', { n: others.length })) : null);
}

export function journey(c) {
  const { S, sel, t, act } = c;
  const more = S.skills.filter((k) => listable(S, k) && !sel.skills.has(k.id)).length;
  return sectionK(2, [kind(t, 'skill')], t('s2'), t('s2p'),
    h('div.card.journey', {}, MAIN.map((st) => stageColumn(c, st))),
    h('div.card.journey.other', {}, stageColumn(c, STAGES[6])),
    h('button.browse-all', { 'data-key': 'browseAll', 'aria-haspopup': 'dialog', on: { click: () => act.openAdd('all') } }, t('browseAll', { n: more })));
}

export function guards(c) {
  const { S, t } = c;
  return sectionK(3, [kind(t, 'hook')], t('s3'), t('s3p'),
    h('div.guards', {}, S.hooks.map((x) => hookItem(c, x))));
}

// 브랜치 그림(작은 SVG). 색은 CSS 의 .ln-main / .ln-br / .ln-dev
function branchSvg(id) {
  const ln = (cls, d) => s('path', { class: cls, d });
  const dot = (x, y) => s('circle', { class: 'dot', cx: x, cy: y, r: 4 });
  const label = (x, y, text) => s('text', { x, y, class: 'lbl' }, text);
  const parts = {
    'github-flow': [ln('ln-main', 'M10 40H190'), ln('ln-br', 'M40 40C55 40 55 18 70 18H120C135 18 135 40 150 40'), dot(40, 40), dot(150, 40), label(10, 54, 'main'), label(72, 12, 'feature/…'), label(130, 12, 'PR')],
    'git-flow': [ln('ln-main', 'M10 50H190'), ln('ln-dev', 'M10 30H190'), ln('ln-br', 'M50 30C60 30 60 10 70 10H110C120 10 120 30 130 30'), ln('ln-dev', 'M160 30C168 30 168 50 176 50'), dot(176, 50), label(10, 47, 'main'), label(10, 27, 'develop'), label(72, 8, 'feature/…')],
    'trunk': [ln('ln-main', 'M10 36H190'), ...[40, 70, 100, 130, 160].map((x) => ln('ln-br', `M${x - 12} 36C${x - 8} 36 ${x - 8} 24 ${x - 4} 24C${x} 24 ${x} 36 ${x + 4} 36`)), label(10, 52, 'main')],
    'none': [ln('ln-main', 'M10 32H190'), dot(50, 32), dot(100, 32), dot(150, 32), label(10, 52, 'main')],
  };
  return s('svg', { viewBox: '0 0 200 58', 'aria-hidden': 'true' }, parts[id] || []);
}

// 고른 조합의 기본값과 비교해 브랜치 방식 때문에 달라진 검사(누적). 브랜치 구역 바로 아래에 보여 준다.
function flowNote({ S, sel, t }) {
  const base = S.combos.find((k) => k.id === sel.combo);
  if (!base || base.flow === sel.flow) return null;
  const related = new Set(S.flows.flatMap((f) => [...f.hooksOn, ...f.hooksOff]));
  const name = (id) => S.hooks.find((x) => x.id === id)?.name || id;
  const parts = [...related].filter((id) => base.hooks.includes(id) !== sel.hooks.has(id))
    .map((id) => (sel.hooks.has(id) ? t('flowOn', { name: name(id) }) : t('flowOff', { name: name(id) })));
  return parts.length ? h('div.flow-note', { role: 'status' }, t('flowNote', { list: parts.join(', ') })) : null;
}

// 라디오 묶음 키보드: 화살표·Home·End 로 옮기면서 고른다. Tab 으로는 고른 하나에만 들어온다.
const FLOW_KEYS = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
function flowKey({ S, act }, e, id) {
  const i = S.flows.findIndex((f) => f.id === id);
  const n = S.flows.length;
  const to = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : e.key in FLOW_KEYS ? (i + FLOW_KEYS[e.key] + n) % n : -1;
  if (to < 0) return;
  e.preventDefault();
  const next = S.flows[to].id;
  act.pickFlow(next);
  document.querySelector(`[data-key="flow:${CSS.escape(next)}"]`)?.focus();
}

export function flows(c) {
  const { S, sel, t, act } = c;
  return sectionK(4, [kind(t, 'hook'), kind(t, 'rule')], t('s4'), t('s4p'),
    h('div.flows', { role: 'radiogroup', 'aria-label': t('s4') }, S.flows.map((f) =>
      h(`button.flow${f.id === sel.flow ? '.on' : ''}`, {
        'data-key': `flow:${f.id}`, role: 'radio', 'aria-checked': String(f.id === sel.flow), tabindex: f.id === sel.flow ? '0' : '-1',
        on: { click: () => act.pickFlow(f.id), keydown: (e) => flowKey(c, e, f.id) },
      },
        h('span.name', {}, f.name), branchSvg(f.id), h('span.for', {}, f.for), h('span.d', {}, f.desc)))),
    flowNote(c));
}

export function rules(c) {
  const { S, sel, t } = c;
  const flow = S.flows.find((f) => f.id === sel.flow);
  return sectionK(5, [kind(t, 'rule')], t('s5'), t('s5p'),
    h('div.rules', {},
      S.rules.map((r) => ruleCard(c, r, false)),
      sel.flow !== 'none' ? ruleCard(c, { id: sel.flow, name: t('flowRule', { name: flow.name }), desc: flow.desc }, true) : null));
}

export function note({ S, sel, t, act }) {
  const examples = ['noteEx1', 'noteEx2', 'noteEx3', 'noteEx4'].map((k) => t(k));
  return section(6, t('s6'), t('s6p'),
    h('div.card.req', {},
      h('textarea', { id: 'note', 'data-key': 'note', rows: 4, maxlength: S.noteMax, placeholder: t('notePh'), 'aria-label': t('s6'), value: sel.note, on: { input: (e) => act.setNote(e.target.value) } }),
      h('div.req-foot', {},
        h('span.tiny', {}, t('noteEx')),
        examples.map((ex, i) => {
          const has = sel.note.includes(ex);
          return h(`button.exchip${has ? '.used' : ''}`, { 'data-key': `ex:${i}`, disabled: has, title: has ? t('noteDup') : null, on: { click: () => act.addNote(ex) } }, has ? `✓ ${ex}` : `+ ${ex}`);
        }),
        h('span.count.tiny', { id: 'noteCount' }, t('noteCount', { n: sel.note.length, max: S.noteMax })))));
}


export function outcome({ S, sel, ui, t, act }) {
  const p = ui.preview;
  const items = [];
  if (p && !p.error) {
    const n = (kind) => p.changes.filter((x) => x.kind === kind).length;
    if (n('skill')) items.push(['skill', t('wSkills', { n: n('skill') }), t('wSkillsD')]);
    items.push(['hook', t('wConfig', { n: sel.hooks.size }), t('wConfigD')]);
    if (n('claude-md')) items.push(['rule', t('wMd', { n: ruleCount(sel) }), t('wMdD')]);
    if (n('share')) items.push(['share', t('wShare'), t('wShareD')]);
    if (n('request')) items.push(['memo', t('wRequest'), t('wRequestD')]);
    if (n('gitignore')) items.push(['plain', t('wGitignore'), t('wGitignoreD')]);
    if (p.manual.length) items.push(['manual', t('wManual', { n: p.manual.length }), t('wManualD', { list: p.manual.map((m) => skillBy(S, m.skill)?.title || m.skill).join(', ') })]);
  }
  const pathLine = (x) => `${x.action === 'create' ? '+' : '~'} ${x.path}${x.skill ? `  — ${skillBy(S, x.skill)?.title || ''}` : ''}`;
  const f = ui.fresh;
  const fresh = f === null ? h('div.fresh-line.tiny', {}, t('freshLoading'))
    : f.error ? h('div.fresh-line.tiny', {}, t('freshError', { error: f.error, date: S.checkedAt }))
      : !f.repos.length ? h('div.fresh-line.tiny', {}, t('freshNoneShort', { date: S.checkedAt }))
        : h('div.card.fresh', {}, h('b', {}, t('freshTitle')), h('div.tiny', {}, t('freshHint')), f.repos.slice(0, 12).map((r) =>
          h('label.fr', {}, h('input', { 'data-key': `explore:${r.repo}`, type: 'checkbox', checked: sel.explore.has(r.repo), on: { change: () => act.toggle('explore', r.repo) } }),
            h('span', {}, h('b', {}, r.repo), h('span.d', {}, r.description), h('span.m', {}, `${t('stars', { n: stars(S, r.stars) })} · ${r.isNew ? t('freshNew') : t('freshUpdated')} ${r.isNew ? r.createdAt : r.pushedAt}`)))));
  return section(7, t('s7'), t('s7p'),
    h('div.card.share', {},
      h('button.share-btn', { 'data-key': 'share', 'aria-pressed': String(sel.share), on: { click: act.toggleShare } },
        h('span', {}, h('b', {}, t('shareTitle')), h('span.d', {}, t('shareD')), h('span.m', {}, t('sharePin', { repo: S.pluginRepo, ref: S.pluginRef }))), switchEl(sel.share, t))),
    h(`div.card.what${ui.previewStale ? '.stale' : ''}`, {},
      !p ? h('div.tiny', {}, t('previewLoading'))
        : p.error ? h('div.err', { role: 'alert' }, p.error, ' ', p.text, ' ', h('button.linkish.small', { 'data-key': 'retryPreview', on: { click: act.retryPreview } }, t('retry'))) : null,
      h('ul.what-list', {}, items.map(([kind, title, d]) => h('li', {}, h(`span.wdot.${kind}`), h('div', {}, h('b', {}, title), h('div.tiny', {}, d))))),
      p && !p.error ? h('details.paths', { id: 'paths', open: ui.pathsOpen, on: { toggle: (e) => (ui.pathsOpen = e.target.open) } }, h('summary', { 'data-key': 'paths' }, t('paths')), h('pre', {}, p.changes.map(pathLine).join('\n'))) : null,
      h('div.undo', {}, t('undoLine', { cmd: S.undoCommand }))),
    fresh);
}

export function bar({ S, sel, ui, t, act }) {
  const n = costOf(S, sel.skills, sel.rules, sel.flow);
  const pr = ui.progress;
  return [
    h('div', {}, h('div.k', {}, t('barCost')), h('b', {}, t('barCostV', { n: n.toLocaleString(), pct: pct(S, n) }))),
    h('div', {}, h('div.k', {}, t('barCount')), h('b', {}, t('barCountV', { s: sel.skills.size, h: sel.hooks.size, r: ruleCount(sel) }))),
    ui.busy ? h('div.progress', { role: 'status' },
      h('div.k', {}, pr?.total ? t('progress', { done: pr.done, total: pr.total }) : t('applying'), pr?.current ? ` · ${t('progressCur', { name: skillBy(S, pr.current)?.title || pr.current })}` : ''),
      h('div.pbar', {}, h('i', { style: `width:${pr?.total ? (pr.done / pr.total) * 100 : 5}%` }))) : h('div.grow'),
    h('button.btn.link', { 'data-key': 'seeFiles', disabled: ui.busy, on: { click: act.showFiles } }, t('seeFiles')),
    h('button.btn.ghost', { 'data-key': 'cancel', 'aria-haspopup': 'dialog', disabled: ui.busy, on: { click: act.cancel } }, t('cancel')),
    h('button.btn.primary', { 'data-key': 'apply', 'aria-haspopup': 'dialog', disabled: ui.busy, on: { click: act.apply } }, ui.busy ? t('applying') : t('apply')),
  ];
}

// 끝 화면. c.sel·c.ui.preview 는 「확인하고 적용」을 누른 순간의 사본이다(app.js).
export function finished(c, result) {
  const { S, sel, ui, t } = c;
  if (!result) return h('div.done.card', {}, h('h2', { tabindex: '-1' }, t('cancelled')));
  // 무엇이 스킬·훅·규칙으로 들어갔는지 확인 창과 같은 묶음으로. 정확한 경로는 접어 둔다.
  const p = ui.preview && !ui.preview.error && ui.preview.changes ? ui.preview : null;
  return h('div.done.card', {},
    h('div.check', {}, icon('M5 13l4 4L19 7', 28)),
    h('h2', { tabindex: '-1' }, t('doneTitle')),
    h('p', {}, t('done')),
    sel.note.trim() ? h('p', {}, t('doneNote')) : null,
    result.failed?.length ? h('p.err', {}, t('doneFailed', { list: result.failed.map((x) => skillBy(S, x.skill)?.title || x.skill).join(', ') })) : null,
    result.manual?.length ? h('p', {}, t('doneManual', { list: result.manual.map((m) => skillBy(S, m.skill)?.title || m.skill).join(', ') })) : null,
    h('p.undo', {}, t('doneUndo', { cmd: result.undo || S.undoCommand })),
    p ? h('div.cgs', {}, changeGroups(c, p, result.failed)) : null,
    h('details.paths', {}, h('summary', {}, t('paths')), h('pre', {}, (result.changed || []).map((line) => {
      const id = line.match(/\.claude\/skills\/([^/\s]+)/)?.[1];
      return id ? `${line}  — ${skillBy(S, id)?.title || ''}` : line;
    }).join('\n'))));
}
