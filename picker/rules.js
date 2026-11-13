// 4 CLAUDE.md 지침 단계: 지침 목록(목록 상자 + 스위치) + 「줄을 대신 맡는 훅」 칩 + 실제로 써질 구역 미리 보기.
// 미리 보기 글은 서버가 켠 훅·스킬에 맞춰 만든 것 그대로(/api/preview 의 ruleTexts·ruleDropped — scripts/lib/claude-md.mjs).
import { h } from './dom.js';
import { lrow, toggleSwitch, label, isNew, num, withCode, link, segmented } from './parts.js';
import { ruleLines, ruleCount, lineCount, ruleTokens, flowBy, hookBy } from './stats.js';
import { stepHead } from './frame.js';
import { hookChip } from './hooks.js';
import { ruleDesc, dropWhy } from './rule-dialog.js';

const START = '<!-- harness-fit:start -->';
const END = '<!-- harness-fit:end -->';

// 지침 한 줄: 설명은 한 줄로 줄여 보이고, 줄을 누르면(Enter·Space 도) 작은 창에 전체 설명·넣을 줄·뺀 줄을 보여 준다(rule-dialog.js)
function ruleRow(c, r) {
  const { S, sel, ui, t, act } = c;
  const on = sel.rules.has(r.id);
  const text = ui.preview?.ruleTexts?.[r.id];
  // 켜 두었는데 들어갈 줄이 하나도 없으면(이미 CLAUDE.md 에 같은 말이 있어 다 뺌) 그 이유를 보여 준다
  const skipped = on && ui.preview?.ruleTexts && !text;
  return lrow({
    cls: on ? '' : '.off', id: `lb-ru-${r.id}`, title: [r.name, isNew(S, 'rules', r.id) ? [' ', label(t('badgeNew'), '.accent')] : null], desc: ruleDesc(S, r), descOne: true,
    extra: skipped ? h('span.d.warn', {}, t('ruleAllSkipped')) : null,
    open: { key: `ruleOpen:${r.id}`, onOpen: () => act.openPanel({ kind: 'rule', id: r.id }) },
    tail: [h('span.meta', {}, on && text ? t('ruleSize', { lines: lineCount(text), tok: S.ruleTokens[r.id] || 0 }) : ''),
      toggleSwitch(t, { key: `rule:${r.id}`, on, labelId: `lb-ru-${r.id}`, onToggle: () => act.toggle('rules', r.id) })],
  });
}

function flowRow({ S, sel, ui, t }) {
  const f = flowBy(S, sel.flow);
  const set = sel.flow !== 'none';
  const text = ui.preview?.ruleTexts?.[sel.flow];
  return lrow({
    title: set ? t('flowRule', { name: f.name }) : t('flowRuleNone'), desc: set ? t('flowRuleD', { name: f.name }) : t('flowRuleNoneD', { name: f?.name || '' }),
    tail: [set && text ? h('span.meta', {}, t('ruleSize', { lines: lineCount(text), tok: S.ruleTokens[sel.flow] || 0 })) : null,
      h('a.link', { href: '#combo', 'data-key': 'flowChange', 'aria-label': t('flowChangeLabel') }, t('change'))],
  });
}

// 줄을 대신 맡는 훅: 켠 지침(+ 브랜치 전략 지침)의 {{!hook:id}} 훅. 켜면 그 줄이 빠진다(같은 칩으로 바로 켜고 끈다).
function coverChips(c) {
  const { S, sel, ui, t } = c;
  const ids = [...new Set([...sel.rules, sel.flow].flatMap((id) => S.ruleHooks?.[id] || []))].map((id) => hookBy(S, id)).filter(Boolean);
  // 플러그인이 없으면 훅이 돌지 않아 지침 글을 「훅 꺼짐」으로 넣는다(apply.mjs plan) — 칩을 켜도 줄이 빠지지 않는다고 알린다
  const noPlugin = ui.preview?.warnings?.includes('plugin-missing');
  return h('div.overlap', {},
    h('p.hint', {}, h('b', {}, t('coverHead')), ` · ${t(noPlugin ? 'coverNoPlugin' : 'coverHint')}`),
    h('div.chips', {}, ids.length ? ids.map((x) => hookChip(c, x)) : h('span.muted', {}, t('coverNone'))));
}

// 뺀 줄 한 줄: 줄 그은 글 + 누가 맡는지
function droppedLine(c, d) {
  return h('div.ln.drop', {}, h('s', {}, d.text), h('span.why', {}, `  ← ${dropWhy(c, d)}`));
}

// 미리 보기: 줄여 보기는 지침마다 제목 + 줄 수 + 첫 줄, 전체 보기는 써질 글 그대로(「뺀 줄 보기」면 뺀 줄도 제자리에)
function preview(c) {
  const { S, sel, ui, t, act } = c;
  const p = ui.preview;
  const full = ui.ruleView !== 'short';
  const seg = segmented({ label: t('ruleViewLabel'), value: full ? 'full' : 'short', onPick: act.setRuleView,
    items: [['short', t('viewShort'), 'rv:short'], ['full', t('viewFull'), 'rv:full']] });
  const texts = p && !p.error ? Object.entries(p.ruleTexts || {}) : [];
  const dropped = p && !p.error ? p.ruleDropped || {} : {};
  const nDropped = texts.reduce((n, [id]) => n + (dropped[id]?.length || 0), 0);
  const showDrop = full && ui.showDropped;
  let body;
  if (!p) body = h('div.ln.cnt', { role: 'status' }, t('previewLoading'));
  else if (p.error) body = h('div.ln', { role: 'alert' }, `${p.error} ${p.text || ''} `, link('retryPreview', t('retry'), act.retryPreview));
  else {
    const lines = [h('div.ln.mk', {}, START)];
    texts.forEach(([id, text], i) => {
      if (i) lines.push(h('div.ln', {}, ' '));
      const rows = text.split('\n');
      if (full) {
        const drops = showDrop ? dropped[id] || [] : [];
        rows.forEach((l, at) => {
          for (const d of drops) if (d.at === at) lines.push(droppedLine(c, d));
          lines.push(h(`div.ln${l.startsWith('#') ? '.hd' : ''}`, {}, l || ' '));
        });
        for (const d of drops) if (d.at >= rows.length) lines.push(droppedLine(c, d));
        return;
      }
      const bullets = rows.filter((l) => l.startsWith('- '));
      lines.push(h('div.ln.short', {}, h('b.hd', {}, rows[0]), h('span.cnt', {}, `  ${t('nLines', { n: bullets.length })} · `), bullets[0] || '', bullets.length > 1 ? '…' : ''));
    });
    if (!texts.length) lines.push(h('div.ln.cnt', {}, t('ruleNone')));
    lines.push(h('div.ln.mk', {}, END));
    body = lines;
  }
  const dropBtn = nDropped
    ? link('pvDrop', showDrop ? t('droppedHide') : t('droppedShow', { n: nDropped }), act.toggleDropped, { 'aria-pressed': String(showDrop) })
    : p && !p.error ? h('span', {}, t('droppedNone')) : null;
  return h(`div.box.preview${ui.previewStale ? '.stale' : ''}`, {},
    h('div.box-h', {}, h('span', {}, t('ruleIn')), seg),
    h('div.pv', { role: 'region', 'aria-label': t('ruleIn'), tabindex: '0' }, body),
    h('div.pvfoot', {}, h('span', {}, t('ruleFoot', { lines: ruleLines(ui), tok: num(S, ruleTokens(S, sel.rules, sel.flow)) })), dropBtn));
}

export function rulesStep(c) {
  const { S, sel, ui, t } = c;
  return [
    ...stepHead(c, 'rules'),
    h('p.qs', {}, t('s5p')),
    h('div.qb', {}, h('div.rulesgrid', {},
      h('div', {},
        h('div.box', {},
          h('div.box-h', {}, h('span', {}, t('rulesN', { n: ruleCount(sel, ui) })), h('span.muted', {}, t('ruleFootShort', { lines: ruleLines(ui), tok: num(S, ruleTokens(S, sel.rules, sel.flow)) }))),
          S.rules.map((r) => ruleRow(c, r)),
          flowRow(c)),
        coverChips(c)),
      // 저장소를 읽어선 알 수 없는 것(헷갈리는 곳·저장소에 없는 결정·두 번 바로잡은 것)은 사람이 표시 밖에 적는다 — 공식 권장
      h('div.pvcol', {}, preview(c), h('p.hint', {}, withCode(t('ownNotes')))))),
  ];
}
