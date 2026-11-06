// 고르기 화면의 선택(sel) 만들기: 조합에서, 또는 지난번 적용한 선택에서. 상태는 app.js 가 갖는다.

export const hookKey = (id) => `hook:${id}`; // ui.touched 에 훅도 적는다(스킬 id 와 섞이지 않게 앞에 붙임)

// k = 조합(또는 그 꼴의 선택), cur = 지금 선택(사용자가 따로 고른 것은 조합을 바꿔도 그대로 둔다)
export const fromCombo = (k, cur) => ({
  combo: k.id, flow: k.flow, skills: new Set(k.skills), hooks: new Set(k.hooks), rules: new Set(k.rules),
  explore: cur?.explore || new Set(), note: cur?.note || '', share: !!k.share, // 팀원 공유 기본값은 combos.json(auto 와 같은 값)
  // GitHub 저장소 설정(기본 꺼짐)·항목 선택·훅 옵션은 사용자가 고른 것이라 조합을 바꿔도 그대로 둔다
  github: !!cur?.github, githubChoice: cur?.githubChoice || {}, hookOpts: cur?.hookOpts || {},
});
export const snapshot = (x) => ({ ...x, skills: new Set(x.skills), hooks: new Set(x.hooks), rules: new Set(x.rules), explore: new Set(x.explore) });

// 고른 것(조합·브랜치 방식·팀원 공유·스킬·훅·규칙)이 같은가
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
export const sameSel = (a, b) => a.combo === b.combo && a.flow === b.flow && a.share === b.share && ['skills', 'hooks', 'rules'].every((k) => sameSet(a[k], b[k]));

export const fromRecommended =(S, cur) => fromCombo({ ...S.recommended, id: S.recommended.combo }, cur);

// 처음 열 때의 선택. 전에 적용한 프로젝트면(S.previous) 지난번 선택에서 시작한다 — 그 뒤 새로 생긴 것은 지난번 선택에 없으니 꺼진 채.
// 조합 기본값과 다르면 「직접 고침」(custom), 조합과 다르게 둔 스킬·훅은 손댄 것(touched)으로 친다
// (스킬은 카드 자리에 「빠짐」으로 남고, 팀원 공유를 바꿔도 다시 넣거나 빼지 않는다).
export function startSelection(S, cur) {
  const p = S.previous;
  if (!p) return { sel: fromRecommended(S, cur), custom: false, touched: new Set() };
  const k = S.combos.find((x) => x.id === p.combo) || S.combos.find((x) => x.id === S.recommended.combo);
  const sel = fromCombo({ ...k, ...p, id: k.id }, cur);
  const same = (a, b) => a.size === b.length && b.every((x) => a.has(x));
  const custom = p.combo !== k.id || p.flow !== k.flow || !same(sel.skills, k.skills) || !same(sel.hooks, k.hooks) || !same(sel.rules, k.rules) || sel.share !== !!k.share;
  const differs = (list, set) => [...new Set([...list, ...set])].filter((id) => list.includes(id) !== set.has(id));
  const touched = new Set([...k.skills.filter((id) => !sel.skills.has(id)), ...differs(k.hooks, sel.hooks).map(hookKey)]);
  return { sel, custom, touched };
}
