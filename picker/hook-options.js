// 훅 옵션 값 고르기·검사. 서버(cleanSelection·buildConfig)와 화면이 같은 함수를 쓴다(dup.js 처럼).
// 옵션 꼴은 catalog/packs.json hooks[].options: { key, type: 'select' | 'toggle' | 'list', choices?: [{ value, label }], item?, default, label, help }
// 훅 코드가 실제로 읽는 opts.<key> 만 둔다(scripts/test/hook-options.test.mjs 가 확인한다).

// 목록 칸 한 줄의 꼴. 브랜치 이름, 프로젝트 안 경로(앞의 / 와 .. 은 안 됨).
const ITEM = { branch: /^[\w.-]+(\/[\w.-]+)*$/, path: /^[\w.@-][\w.@/-]*$/ };
const LIST_MAX = 20;
const ITEM_MAX = 200;

const validItem = (o, x) => typeof x === 'string' && x.length <= ITEM_MAX && !x.includes('..') && !!ITEM[o.item]?.test(x);
export const validValue = (o, v) => {
  if (o.type === 'toggle') return typeof v === 'boolean';
  if (o.type === 'select') return (o.choices || []).some((c) => c.value === v);
  if (o.type === 'list') return Array.isArray(v) && v.length <= LIST_MAX && v.every((x) => validItem(o, x));
  return false;
};

// 받은 옵션 값({ 훅 id: { key: 값 } })에서 꼴에 맞는 것만 남긴다
export const cleanHookOpts = (hooks, raw) => {
  const out = {};
  for (const [id, vals] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    const opts = hooks.find((x) => x.id === id)?.options || [];
    for (const [key, v] of Object.entries(vals && typeof vals === 'object' ? vals : {})) {
      const o = opts.find((x) => x.key === key);
      if (o && validValue(o, v)) (out[id] ||= {})[key] = v;
    }
  }
  return out;
};

// 브랜치 방식이 정하는 칸(flows[].hooks 에 한 번이라도 나오는 키)
export const ownedKeys = (flows, id) => new Set(flows.flatMap((f) => Object.keys(f.hooks?.[id] || {})));

// 화면에 보일 값: 사용자가 이 화면에서 고친 값 > 브랜치 방식 칸은 그 방식의 값 > 아니면 지난번 harness.json 값 > 기본값.
// (방식이 정하는 칸은 다시 적용할 때 방식의 값으로 바뀐다 — apply.mjs buildConfig 와 같은 규칙)
export const optionValue = ({ id, opt, flow, owned, prev, user }) => {
  const mine = user?.[id];
  if (mine && opt.key in mine) return mine[opt.key];
  if (owned.has(opt.key)) return flow?.hooks?.[id]?.[opt.key] ?? opt.default;
  const before = prev?.[id]?.[opt.key];
  return before !== undefined && validValue(opt, before) ? before : opt.default;
};

// 목록 칸 글 → { values, bad }(쉼표·빈칸으로 나눔, 꼴이 틀린 것은 bad 로)
export const parseList = (opt, text) => {
  const parts = [...new Set(String(text || '').split(/[,\s]+/).map((s) => s.trim()).filter(Boolean))];
  return { values: parts.filter((x) => validItem(opt, x)).slice(0, LIST_MAX), bad: parts.filter((x) => !validItem(opt, x)) };
};
