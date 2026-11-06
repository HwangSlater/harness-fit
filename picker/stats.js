// 셈과 묶기: 개수·토큰·단계·묶음·겹침은 모두 여기서만 낸다(화면 어디서 보여 주든 같은 값). DOM 을 쓰지 않는다.
import { dupHooks, dupSkills } from './dup.js';

// 개발 단계 ↔ 카탈로그 단계. 순서대로 처음 맞는 칸에 놓는다. 앞 6칸이 「기획부터 배포까지」 막대.
export const STAGES = [
  ['plan', ['plan']],
  ['design', ['design', 'ui']],
  ['build', ['impl', 'refactor', 'perf']],
  ['test', ['test', 'debug']],
  ['review', ['review', 'security']],
  ['ship', ['git', 'ci', 'deploy']],
  ['other', ['docs', 'meta', 'files']],
].map(([id, cats]) => ({ id, cats }));
export const MAIN = STAGES.slice(0, 6);

const sum = (arr) => arr.reduce((a, b) => a + b, 0);
export const skillBy = (S, id) => S.skills.find((k) => k.id === id);
export const hookBy = (S, id) => S.hooks.find((x) => x.id === id);
export const flowBy = (S, id) => S.flows.find((f) => f.id === id) || null;
export const comboBy = (S, id) => S.combos.find((k) => k.id === id) || null;
export const stageOf = (k) => STAGES.find((st) => st.cats.some((x) => k.stages.includes(x)))?.id || 'other';
// 훅과 같은 일을 하는 스킬은 고를 목록에서 뺀다(헷갈림 방지 — scripts/lib/picker-state.mjs newSinceOf 와 같은 기준).
export const listable = (S, k) => !(k.overlapsHook && S.hooks.some((x) => x.id === k.overlapsHook));

export const skillTokens = (S, skills) => sum([...skills].map((id) => skillBy(S, id)?.always || 0));
export const ruleTokens = (S, rules, flow) => sum([...rules, flow].map((id) => S.ruleTokens[id] || 0));
export const costOf = (S, skills, rules, flow) => skillTokens(S, skills) + ruleTokens(S, rules, flow);
export const pct = (S, n) => ((n / S.contextTokens) * 100).toFixed(1);
const WORD_LIGHT = 300;
const WORD_MID = 900;
export const weightWord = (n) => (n < WORD_LIGHT ? 'word1' : n < WORD_MID ? 'word2' : 'word3');

// 들어갈 규칙: 미리보기가 있으면 실제로 글이 남는 것만(이미 CLAUDE.md 에 있어 다 빠진 것은 빼고)
export const ruleIds = (sel, ui) => (ui?.preview?.ruleTexts ? Object.keys(ui.preview.ruleTexts) : [...(sel.flow !== 'none' ? [sel.flow] : []), ...sel.rules]);
export const ruleCount = (sel, ui) => ruleIds(sel, ui).length;
export const lineCount = (text) => (text ? text.split('\n').filter((l) => l.startsWith('- ')).length : 0);
export const ruleLines = (ui) => sum(Object.values(ui?.preview?.ruleTexts || {}).map(lineCount));

// 이 조합이 돕는 개발 단계(막대 6칸)
export const coverage = (S, skills) => MAIN.map((st) => [...skills].some((id) => { const k = skillBy(S, id); return k && stageOf(k) === st.id; }));

// 저장소 스택에 맞춘 추천(조합마다 combos.json stackAddons 를 펼친 것을 모은다). [{ id, stacks }]
export const recSkills = (S) => {
  const out = new Map();
  for (const k of S.combos) for (const a of k.addons || []) for (const id of a.skills) if (!out.has(id) && skillBy(S, id)) out.set(id, a.stacks);
  return [...out].map(([id, stacks]) => ({ id, stacks }));
};

// 훅 묶음(packs.json hookGroups 순서). 훅이 없는 묶음은 뺀다. 묶음 목록에 없는 group 의 훅은 맨 끝 「그 밖」(otherName)으로.
export const hookGroupsOf = (S, otherName) => {
  const known = new Set((S.hookGroups || []).map((g) => g.id));
  const groups = (S.hookGroups || []).map((g) => ({ ...g, hooks: S.hooks.filter((x) => x.group === g.id) }));
  const rest = S.hooks.filter((x) => !known.has(x.group));
  if (rest.length) groups.push({ id: 'other', name: otherName, desc: '', hooks: rest });
  return groups.filter((g) => g.hooks.length);
};

// 이미 있는 것과 겹치는 것(팀원 공유를 켜면 이 PC 에만 있는 것은 겹침이 아니다, 브랜치 방식이 옵션을 넣는 훅은 방식에 따라 — dup.js)
export const dupsFor = (S, x, flowId = x.flow) => {
  const ids = new Set(S.skills.map((k) => k.id));
  const flow = flowBy(S, flowId);
  return { hooks: new Map(dupHooks(S.detected.existing, x.share, flow).map((d) => [d.id, d])), skills: new Map(dupSkills(S.detected.existing, ids, x.share).map((d) => [d.id, d])) };
};
// 기본으로 들어갈 훅·스킬: 지금 조합의 원래 목록 + 브랜치 방식이 켜는 훅(겹침 안내와 공유 바꾸기가 이 범위만 다룬다)
export const defaultsFor = (S, x) => {
  const base = comboBy(S, x.combo)?.base || { skills: [], hooks: [] };
  return { skills: new Set(base.skills), hooks: new Set([...base.hooks, ...(flowBy(S, x.flow)?.hooksOn || [])]) };
};
// 「차단하는 것만」: 명령·쓰기를 막는 훅(packs.json kind: block)만. 알려 주기만 하는 훅(notice)은 끈다.
// 그중에서도 이 저장소에 맞는 것만 — 이미 있는 훅과 같은 일·지금 브랜치 전략이 끄는 훅·다른 스택 전용 훅·어느 조합·브랜치 전략도 기본으로 켜지 않는 훅(사용자가 골라 켜는 것)은 뺀다.
export const blockingHooks = (S, x) => {
  const dup = dupsFor(S, x).hooks;
  const off = new Set(flowBy(S, x.flow)?.hooksOff || []);
  const usual = new Set([...S.combos.flatMap((k) => k.base?.hooks || k.hooks || []), ...S.flows.flatMap((f) => f.hooksOn)]);
  return new Set(S.hooks.filter((h) => h.kind === 'block' && !dup.has(h.id) && !off.has(h.id) && (h.stackOnly ? h.stackMatch : usual.has(h.id))).map((h) => h.id));
};
// 넣지 않은 스킬마다, 같은 묶음(catalog/overlaps.json)에서 이미 넣은 스킬의 이름
export const matesFor = (S, x) => {
  const out = new Map();
  for (const g of S.overlaps || []) {
    const inSel = g.filter((id) => x.skills.has(id));
    if (!inSel.length) continue;
    for (const id of g) if (!x.skills.has(id)) out.set(id, inSel.map((m) => skillBy(S, m)?.title || m));
  }
  return out;
};

// 다른 조합을 고르면 지금 선택에서 무엇이 달라지는지: [[종류 키, '+2 −1'], …]
export const diffOf = (sel, k) => {
  const d = (now, next) => {
    const plus = next.filter((x) => !now.has(x)).length;
    const minus = [...now].filter((x) => !next.includes(x)).length;
    return [plus ? `+${plus}` : '', minus ? `−${minus}` : ''].filter(Boolean).join(' ');
  };
  return [['diffSkill', d(sel.skills, k.skills)], ['diffHook', d(sel.hooks, k.hooks)], ['diffRule', d(sel.rules, k.rules)]].filter(([, v]) => v);
};
