// 사용자 규칙과 반대인 것(selection.conflicts) — 서버(scripts/lib/conflicts.mjs)와 고르기 화면이 같이 쓴다. DOM 을 쓰지 않는다.
// 기록: { kind: 'rule'|'hook', id, line·lang·hash(rule 만 — line 은 서버가 지문으로 다시 찾은 지금 번호), choice: 'mine'|'harness', userText, file }
// mine: 사용자 규칙을 따른다(그 줄은 넣지 않고 그 훅은 끈다) · harness: harness-fit 쪽을 쓴다(사용자가 자기 규칙을 고친다)

export const conflictKey = (c) => `${c.kind}:${c.id}${c.kind === 'rule' ? `:${c.line}` : ''}`;

const listOf = (x) => (Array.isArray(x) ? x : Array.isArray(x?.conflicts) ? x.conflicts : []);

// 「내 규칙」을 고른 훅 id(목록이나 선택을 받는다)
export const mineHooks = (x) => new Set(listOf(x).filter((c) => c.kind === 'hook' && c.choice === 'mine').map((c) => c.id));

// 그 훅·규칙의 기록들(규칙은 줄마다 하나씩일 수 있다)
export const conflictsOf = (x, kind, id) => listOf(x).filter((c) => c.kind === kind && c.id === id);

// 고른 쪽을 바꾼 새 목록(화면은 sel.conflicts 를 통째로 바꾼다 — 사본이 같은 배열을 나눠 쓰지 않게)
export const withChoice = (list, key, choice) => listOf(list).map((c) => (conflictKey(c) === key ? { ...c, choice } : c));

// 훅을 켜고 끄면 그 훅의 기록도 따라간다: 켜면 harness-fit 쪽, 끄면 내 규칙 쪽
export const followHook = (list, id, on) => listOf(list).map((c) => (c.kind === 'hook' && c.id === id ? { ...c, choice: on ? 'harness' : 'mine' } : c));

// 「내 규칙」을 고른 훅을 뺀 조합(조합·추천·지난번 선택에서 시작할 때 — selection.js fromCombo). 지금 고른 쪽으로 거르므로
// 작은 창에서 harness-fit 쪽으로 바꾼 뒤 조합을 다시 고르면 그 훅이 다시 켜진다(검토 2026-11-17: 서버가 처음 목록으로 한 번만 걸러 다시 켜지지 않았다)
export const withoutMine = (k, list) => {
  const mine = mineHooks(list);
  return mine.size && k ? { ...k, hooks: [...(k.hooks || [])].filter((id) => !mine.has(id)) } : k;
};

// ~/ 파일(사람마다 다른 전역 글) 기록인가 — 팀원 공유면 쓰지 않는다(서버 scripts/lib/conflict-files.mjs 와 같은 표준 이름)
export const isGlobal = (c) => String(c?.file || '').startsWith('~/');

// 팀원 공유를 바꿀 때: 켜면 ~/ 기록을 빼 두고(aside) 그 「내 규칙」 훅은 다시 켤 후보(back), 끄면 빼 둔 기록을 되살리고 그 훅은 끈다(off)
export const shareSplit = (list, aside, share) => {
  const cur = listOf(list);
  if (!share) return { list: [...cur, ...listOf(aside)], aside: [], back: [], off: [...mineHooks(aside)] };
  const keep = cur.filter((c) => !isGlobal(c));
  const still = mineHooks(keep);
  return { list: keep, aside: [...listOf(aside), ...cur.filter(isGlobal)], back: [...mineHooks(cur.filter(isGlobal))].filter((id) => !still.has(id)), off: [] };
};
