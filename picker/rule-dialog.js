// CLAUDE.md 지침 한 줄을 누르면 뜨는 작은 창(panel.js 의 같은 <dialog>, 넓이 md):
// 이름 · 설명 전체 · CLAUDE.md 에 넣을 줄 · 훅·스킬이 맡아 뺀 줄 · 토큰 · 켜고 끄기.
// 넣을 줄과 뺀 줄은 지침 단계 미리 보기와 같은 서버 글(/api/preview 의 ruleTexts·ruleDropped)이라 적용과 어긋나지 않는다.
import { h } from './dom.js';
import { toggleSwitch, num } from './parts.js';
import { lineCount, hookBy, skillBy } from './stats.js';

// 이 저장소 명령(commands)은 설명 자리에 찾은 명령을 그대로 보여 준다(시험 하나만 꼴은 자리표시가 든 글이라 미리 보기에서만)
export const ruleDesc = (S, r) => (r.id === 'commands'
  ? Object.entries(S.detected.commands || {}).filter(([k]) => k !== 'testOne').flatMap(([, v]) => v).join(' · ') || r.desc : r.desc);

// 뺀 줄을 누가 맡는지(훅·스킬 이름, 또는 CLAUDE.md 에 이미 있음)
export const dropWhy = ({ S, t }, d) => {
  const name = (id) => (d.by === 'hook' ? hookBy(S, id)?.name : skillBy(S, id)?.title) || id;
  return d.by === 'existing' ? t('dropExisting') : t(d.by === 'hook' ? 'dropByHook' : 'dropBySkill', { name: d.who.map(name).join(', ') });
};

const sec = (title, ...kids) => h('section.rsec', {}, h('h3', {}, title), ...kids);

export function rulePanel(c, { id }) {
  const { S, sel, ui, t, act } = c;
  const r = S.rules.find((x) => x.id === id);
  const close = h('button.btn.lg.primary', { type: 'button', 'data-key': 'ruleDone', on: { click: act.closePanel } }, t('close'));
  if (!r) return { title: id, size: 'md', body: h('p', {}, t('ruleNone')), foot: [h('span.muted'), close] };
  const on = sel.rules.has(id);
  const p = ui.preview;
  const text = p && !p.error ? p.ruleTexts?.[id] : null;
  const drops = p && !p.error && on ? p.ruleDropped?.[id] || [] : [];
  const stale = ui.previewStale ? '.stale' : '';
  let lines;
  if (!on) lines = h('p.hint', {}, t('ruleDlgOff'));
  // 방금 켰으면 새 미리 보기가 올 때까지 「없음」이 아니라 계산 중
  else if (!p || (ui.previewStale && !text)) lines = h('p.hint', { role: 'status' }, t('previewLoading'));
  else if (p.error) lines = h('p.err', { role: 'alert' }, `${p.error} ${p.text || ''}`);
  else if (!text) lines = h('p.hint', {}, t('ruleAllSkipped'));
  else lines = h(`div.rlines${stale}`, { tabindex: '0', role: 'region', 'aria-label': t('ruleDlgLines') }, text.split('\n').map((l) => h(`div.ln${l.startsWith('#') ? '.hd' : ''}`, {}, l || ' ')));
  const cost = on && text ? t('ruleSize', { lines: lineCount(text), tok: num(S, S.ruleTokens[id] || 0) }) : t('ruleDlgCost', { tok: num(S, S.ruleTokens[id] || 0) });
  return {
    title: r.name, sub: t('ruleDlgSub'), size: 'md',
    body: [
      h('p.rdesc', {}, ruleDesc(S, r)),
      sec(t('ruleDlgLines'), lines),
      on ? sec(t('ruleDlgDropped'), drops.length
        ? h(`div.rlines${stale}`, {}, drops.map((d) => h('div.ln.drop', {}, h('s', {}, d.text), h('span.why', {}, `  ← ${dropWhy(c, d)}`))))
        : h('p.hint', {}, t('ruleDlgNoDrop'))) : null,
    ],
    foot: [h('span.muted', {}, cost),
      h('span.rtg', {}, toggleSwitch(t, { key: `rdlg:${id}`, on, label: r.name, onToggle: () => act.toggle('rules', id) })),
      close],
  };
}
