// 스킬 목록 예산: Claude 가 늘 보는 「스킬 이름 + 설명」 목록의 글자 수 셈. 서버(apply.mjs plan)와 화면이 같은 함수를 쓴다. DOM·fs 를 쓰지 않는다.
// 근거(code.claude.com/docs/en/skills): 목록 예산은 문맥 창의 1%, 알 수 없으면 8,000자(SLASH_COMMAND_TOOL_CHAR_BUDGET 로 바꿈).
// 넘치면 이름은 남고 설명이 덜 쓴 스킬부터 빠진다 — 새로 넣은 스킬(쓴 적 0번)이 먼저 빠진다. 스킬마다 description+when_to_use 는 1,536자에서 잘린다.
// 정확한 셈(토큰인지 글자인지, 번들 스킬이 들어가는지)은 문서에 없다 — 그래서 화면은 「넘을 수 있어요」로만 말한다.

export const DESC_CAP = 1536;
export const DEFAULT_BUDGET = 8000;
export const NEAR = 0.8; // 예산의 80% 이상이면 알린다

const sum = (a) => a.reduce((x, y) => x + y, 0);

// 목록 한 줄의 글자 수(가정: 이름 + 잘린 설명. 줄 사이 기호·띄어쓰기는 몇 자뿐이라 뺐다)
export const entryChars = (name, description = '', whenToUse = '', cap = DESC_CAP) =>
  String(name).length + Math.min((whenToUse ? `${description} ${whenToUse}` : description).length, cap);

// 카탈로그 스킬의 목록 글자 수. 설치하면 이름은 카탈로그 id 가 된다(install-skill.mjs setSkillName).
// descChars 는 scripts/dev/check-descriptions.mjs 가 고정 커밋의 SKILL.md 에서 잰 값(모든 카탈로그 스킬에 있다 — skill-budget 시험).
export const catalogChars = (k, cap = DESC_CAP) =>
  k.id.length + Math.min(k.descChars, cap);

// 새로 들어가는 카탈로그 스킬: 복사 설치하는 것 중 프로젝트에 같은 폴더가 아직 없는 것.
// 폴더가 있으면 그 자리에서 고치거나(전에 harness-fit 이 넣음 — 지금 크기에 이미 들어 있음) 건드리지 않는다(사용자 폴더).
export const newSkills = (skills, chosen, present = []) => {
  const has = new Set(present);
  return [...chosen].map((id) => skills.find((k) => k.id === id)).filter((k) => k && k.install === 'copy' && !has.has(k.id));
};

// listing = { current, budget, budgetSource, maxDesc } (scripts/lib/skill-budget.mjs currentListing)
export const budgetOf = (listing, added = []) => {
  const add = sum(added.map((k) => catalogChars(k, listing.maxDesc)));
  const total = listing.current + add;
  const ratio = listing.budget > 0 ? total / listing.budget : 0;
  return {
    current: listing.current, added: add, total, budget: listing.budget, budgetSource: listing.budgetSource,
    newCount: added.length, ratio: Math.round(ratio * 1000) / 1000,
    level: ratio > 1 ? 'over' : ratio >= NEAR ? 'near' : 'ok',
  };
};

// 「권장대로 줄이기」에서 먼저 뺄 차례(작을수록 먼저):
//   0 같은 일을 하는 스킬이 함께 골라짐(catalog/overlaps.json — 묶음에서 가장 짧은 것 하나는 남긴다)
//   1 조합·스택 추천 밖에서 직접 더한 것
//   2 조합이 켜는 것
//   3 저장소 스택에 맞춘 것(combos.json stackAddons) — 이 저장소에 가장 맞으므로 마지막까지 남긴다
// 같은 차례면 설명이 긴 것부터(적게 빼고 많이 줄이려고).
export const trimTier = ({ comboSkills, stackSkills, overlaps = [] }, chosenIds, charsOf) => {
  const chosen = new Set(chosenIds);
  const redundant = new Set();
  for (const g of overlaps) {
    const inSel = g.filter((id) => chosen.has(id)).sort((a, b) => charsOf(a) - charsOf(b));
    inSel.slice(1).forEach((id) => redundant.add(id));
  }
  return (id) => (redundant.has(id) ? 0 : stackSkills.has(id) ? 3 : comboSkills.has(id) ? 2 : 1);
};

// 뺄 스킬 id 들. 예산의 80% 아래로 내려갈 때까지 뺀다.
// 지금 있는 스킬만으로 이미 80% 이상이면 새 스킬을 다 빼도 알림이 사라지지 않으므로, 차례 0·1(겹침·직접 더한 것)만 뺀다.
export const trimPlan = (listing, added, tierOf) => {
  const cap = listing.maxDesc;
  const target = listing.budget * NEAR;
  const order = [...added].sort((a, b) => tierOf(a.id) - tierOf(b.id) || catalogChars(b, cap) - catalogChars(a, cap));
  const onlyLight = listing.current >= target;
  let total = budgetOf(listing, added).total;
  const drop = [];
  for (const k of order) {
    if (total < target) break;
    if (onlyLight && tierOf(k.id) > 1) break;
    drop.push(k.id);
    total -= catalogChars(k, cap);
  }
  return drop;
};
