// 이미 있는 것과 겹치는지 — 서버 추천(scripts/lib/catalog.mjs)과 고르기 화면(app.js)이 같이 쓴다. DOM 을 쓰지 않는다.
// existing = detect 결과의 existing: { hooks: { <훅 id>: { scope, by[] } }, skillList: [{ id, name, scope, plugin }], similar: [{ id, to }] }
// 팀원 공유를 켜면 이 PC 의 나에게만 있는 것(user · project-local)은 팀원에게 없으므로 겹침으로 보지 않는다.
const counts = (scope, share) => scope === 'project' || !share;

// 기존 훅 시험(catalog/probes.json)은 GitHub Flow 의 옵션으로 만든 입력이다. 다른 브랜치 방식은 그 훅에 다른 옵션을 넣으므로
// (Git Flow 는 develop 도 보호, 이름 모양도 다름) 그 방식이 옵션을 넣는 훅은 겹친다고 보지 않는다 — 덜 막는 쪽으로 틀리지 않게.
export const PROBE_FLOW = 'github-flow';
const tunedBy = (flow) => (flow && flow.id !== PROBE_FLOW ? new Set(Object.keys(flow.hooks || {})) : new Set());

export const dupHooks = (existing, share, flow = null) => {
  const tuned = tunedBy(flow);
  return Object.entries(existing?.hooks || {}).filter(([id, v]) => counts(v.scope, share) && !tuned.has(id)).map(([id, v]) => ({ id, scope: v.scope, by: v.by }));
};

// 같은 스킬: 폴더 이름이나 머리말 name 이 카탈로그 id 와 같은 것. 비슷한 스킬: setup 때 Claude 가 이름·설명을 보고 짚은 것(similar).
export const dupSkills = (existing, catalogIds, share) => {
  const list = existing?.skillList || [];
  const out = new Map();
  for (const s of list) {
    if (!counts(s.scope, share)) continue;
    for (const id of [s.id, s.name]) if (catalogIds.has(id) && !out.has(id)) out.set(id, { id, scope: s.scope, by: [s.plugin ? `${s.plugin} · ${s.name}` : s.name], same: true });
  }
  for (const { id, to } of existing?.similar || []) {
    const s = list.find((x) => x.name === to || x.id === to);
    if (!catalogIds.has(id) || out.has(id) || (s && !counts(s.scope, share))) continue;
    out.set(id, { id, scope: s?.scope || 'user', by: [to], same: false });
  }
  return [...out.values()];
};

// 조합 기본값에서 겹치는 것을 뺀다. base = { skills, hooks } (배열)
export const withoutDups = (base, existing, catalogIds, share, flow = null) => {
  const h = new Set(dupHooks(existing, share, flow).map((x) => x.id));
  const s = new Set(dupSkills(existing, catalogIds, share).map((x) => x.id));
  return { skills: base.skills.filter((id) => !s.has(id)), hooks: base.hooks.filter((id) => !h.has(id)) };
};
