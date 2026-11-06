// GitHub 저장소 설정 항목 고르기. 서버(scripts/lib/github-settings.mjs)와 화면이 같은 함수를 쓴다(dup.js 처럼).
// 항목(서버 itemsFor 가 GitHub 에서 읽은 값으로 만든다):
//   { id, key, type: 'toggle' | 'select', branch?, default, from, already?, choices?, prNow?, blocked? }
//   id 는 명령줄에도 그대로 쓴다: squash · autodelete · pr:<브랜치> · approvals:<브랜치>=<수> · noforce:<브랜치> · nodelete:<브랜치> · admins:<브랜치>
// 토글은 「켜는 것」만 한다. 끄면 그 설정은 지금 그대로 둔다(이미 켜져 있으면 already 로 보여 주고 고를 것이 없다).

export const SHORT = { pullRequest: 'pr', approvals: 'approvals', noForcePush: 'noforce', noDelete: 'nodelete', enforceAdmins: 'admins' };
export const PROTECT_KEYS = Object.keys(SHORT);
// 「squash 로만 합치기」가 바꾸는 저장소 칸
export const SQUASH_ONLY = { allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false };

const choosable = (i) => !i.blocked && !i.already;

// 추천 값(packs.json flows 의 github 칸 기본값). 이미 켜져 있는 것·막힌 것은 빠진다.
export const defaultChoice = (items) => Object.fromEntries(items.filter(choosable).map((i) => [i.id, i.default]));

// 받은 선택을 항목에 맞춰 거른다. 토글은 true 만 켜짐(빠지면 꺼짐), 수는 고를 수 있는 값만(아니면 추천 값).
export const cleanChoice = (items, raw) => {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const i of items.filter(choosable)) out[i.id] = i.type === 'toggle' ? src[i.id] === true : i.choices.includes(src[i.id]) ? src[i.id] : i.default;
  return out;
};

// 명령줄 목록 → 선택: "squash,pr:main,approvals:main=1" → { squash: true, 'pr:main': true, 'approvals:main': 1 }
export const parseItemList = (text) => {
  const out = {};
  for (const part of String(text || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const [id, v] = part.split('=');
    out[id] = v === undefined ? true : Number.isInteger(Number(v)) ? Number(v) : v;
  }
  return out;
};

// 선택 → 실제로 바뀔 칸: { scope: 'repo', key, from, to, item } · { scope: 'branch', branch, key, from, to, item }
export const changesFor = (items, choice) => {
  const out = [];
  const on = (id) => choice?.[id] === true;
  for (const i of items) {
    if (!choosable(i)) continue;
    if (i.key === 'squash') {
      if (!on(i.id)) continue;
      for (const [key, to] of Object.entries(SQUASH_ONLY)) if (i.from?.[key] !== to) out.push({ scope: 'repo', key, from: i.from?.[key] ?? null, to, item: i.id });
    } else if (i.key === 'autodelete') {
      if (on(i.id)) out.push({ scope: 'repo', key: 'delete_branch_on_merge', from: i.from ?? null, to: true, item: i.id });
    } else if (i.key === 'approvals') {
      // 승인 수는 PR 을 요구할 때만 뜻이 있다(이미 요구하거나, 이번에 켜거나)
      const to = Number.isInteger(choice?.[i.id]) ? choice[i.id] : i.default;
      const from = i.from ?? 0;
      if ((i.prNow || on(`pr:${i.branch}`)) && to !== from) out.push({ scope: 'branch', branch: i.branch, key: 'approvals', from, to, item: i.id });
    } else if (on(i.id)) out.push({ scope: 'branch', branch: i.branch, key: i.key, from: false, to: true, item: i.id });
  }
  return out;
};
