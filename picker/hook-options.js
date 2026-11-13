// 훅 옵션 값 고르기·검사. 서버(cleanSelection·buildConfig)와 화면이 같은 함수를 쓴다(dup.js 처럼).
// 옵션 꼴은 catalog/packs.json hooks[].options: { key, type: 'select' | 'toggle' | 'list', choices?: [{ value, label }], item?, default, label, help }
// 훅 코드가 실제로 읽는 opts.<key> 만 둔다(scripts/test/hook-options.test.mjs 가 확인한다).

// 목록 칸 한 줄의 꼴. 브랜치 이름, 프로젝트 안 경로(.. 은 안 됨, 앞의 / 는 맨 위 기준), 명령 앞부분(낱말과 띄어쓰기만 — ; | & $ 같은 셸 기호는 안 됨).
// 경로·명령은 한글 같은 다른 글자도 받는다(config/관절한계.yaml — 검토 2026-11-11)
// 경로는 글롭 * · ** 도 받는다(*.tfstate.*·infra/**/*.tfvars — hooks/lib/path-glob.mjs, 2026-11-12). * 와 / 만으로 된 꼴(* · **)은 모든 파일이라 받지 않는다.
// 앞의 / 하나는 .gitignore 처럼 「프로젝트 맨 위」(/kubeconfig*) — 받는다(//… 는 아님, 2026-11-12)
const ITEM = { word: /^[a-z][a-z0-9-]{0,15}$/, branch: /^[\w.-]+(\/[\w.-]+)*$/, path: /^\/?[\p{L}\p{N}_.@*-][\p{L}\p{N}_.@*/ -]*$/u, command: /^[\p{L}\p{N}_.@/:=+-][\p{L}\p{N}_ .@/:=+-]*$/u };
// 30: iOS 처럼 스택 기본값(14개)과 저장소에서 찾은 명령이 함께 들어가면 20 을 넘어 말없이 잘렸다(2026-11-13)
export const LIST_MAX = 30;
const ITEM_MAX = 200;
// 글롭은 * · / · 빈칸 아닌 글자가 둘 이상이어야 — *-*·*_*·**/*e* 는 거의 모든 파일에 맞는다(검토 2026-11-12)
const GLOB_LETTERS_MIN = 2;
const pathOk = (x) => /[^*/. ]/.test(x) && (!x.includes('*') || x.replace(/[*/ ]/g, '').length >= GLOB_LETTERS_MIN);

const validItem = (o, x) => !badWhy(o, x);
// 받지 않는 까닭(화면 문구 optBadWhy_<값>) — 다 「셸 기호」로 안내해 너무 넓은 패턴·긴 경로를 받지 않는 까닭을 알 수 없던 일(화면 역할 평가, 2026-11-12). 받으면 null
export const badWhy = (o, x) => {
  if (typeof x !== 'string') return o.item;
  if (x.length > ITEM_MAX) return 'long';
  if (x.includes('..') || !ITEM[o.item]?.test(x)) return o.item;
  return o.item === 'path' && !pathOk(x) ? 'broad' : null;
};
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
      if (!o) continue;
      // 목록은 항목마다 거른다 — 한 줄이 꼴에 안 맞는다고 목록 전체를 버리던 일(검토 2026-11-11). 경로의 \ 는 / 로 맞춘다.
      if (o.type === 'list' && Array.isArray(v)) {
        const items = v.map((x) => (typeof x === 'string' ? x.trim() : x)).map((x) => ((o.item === 'path' || o.item === 'command') && typeof x === 'string' ? x.replace(/\\/g, '/') : x));
        const kept = [...new Set(items.filter((x) => validItem(o, x)))].slice(0, LIST_MAX);
        if (kept.length || !v.length) (out[id] ||= {})[key] = kept;
      } else if (validValue(o, v)) (out[id] ||= {})[key] = v;
    }
  }
  return out;
};

// 브랜치 방식이 정하는 칸(flows[].hooks 에 한 번이라도 나오는 키)
export const ownedKeys = (flows, id) => new Set(flows.flatMap((f) => Object.keys(f.hooks?.[id] || {})));

// 화면에 보일 값: 사용자가 이 화면에서 고친 값 > 브랜치 방식 칸은 그 방식의 값 > 아니면 지난번 harness.json 값 > 기본값.
// (방식이 정하는 칸은 다시 적용할 때 방식의 값으로 바뀐다 — apply.mjs buildConfig 와 같은 규칙)
// 조합이 저장소에 맞춰 정한 값(base — 커밋 기록 언어, ROS 2 의 ask-cmd 명령 등)은 지난번 값 다음.
export const optionValue = ({ id, opt, flow, owned, prev, user, base }) => {
  const mine = user?.[id];
  if (mine && opt.key in mine) return mine[opt.key];
  if (owned.has(opt.key)) return flow?.hooks?.[id]?.[opt.key] ?? opt.default;
  // 한도보다 긴 목록은 앞에서 LIST_MAX 개까지 — 통째로 버리고 기본값(빈 목록)을 보이면 서버가 실제로 저장하는 값(cleanHookOpts 가 앞 30개)과 달랐다(검토 2026-11-13)
  const fitList = (v) => (opt.type === 'list' && Array.isArray(v) ? v.slice(0, LIST_MAX) : v);
  const before = fitList(prev?.[id]?.[opt.key]);
  if (before !== undefined && validValue(opt, before)) return before;
  const fit = fitList(base?.[id]?.[opt.key]);
  return fit !== undefined && validValue(opt, fit) ? fit : opt.default;
};

// 서버로 보낼 옵션: 조합 값(base)은 지난번 harness.json 에 그 칸이 없을 때만 깔고, 사용자가 고친 값이 앞선다.
// 조합 값을 사용자 값처럼 보내 지난번에 적어 둔 ask-cmd 명령을 ROS 기본 목록으로 덮던 일(검토 2026-11-11)
export const sentOpts = (base = {}, prev = {}, user = {}) => {
  const out = {};
  for (const [id, o] of Object.entries(base || {})) {
    const had = prev?.[id] && typeof prev[id] === 'object' ? prev[id] : {};
    const keep = Object.fromEntries(Object.entries(o || {}).filter(([k]) => !(k in had)));
    if (Object.keys(keep).length) out[id] = keep;
  }
  for (const [id, o] of Object.entries(user || {})) out[id] = { ...(out[id] || {}), ...o };
  return out;
};

// 목록 칸 글 → { values, bad }(꼴이 틀린 것은 bad 로). 명령·경로는 띄어쓰기가 든 항목이라 쉼표·줄바꿈으로만 나누고
// (「ros2 launch, python scripts/train.py」 가 낱말마다 갈라져 모든 python 명령을 묻던 일 — 검토 2026-11-11), 나머지는 빈칸으로도 나눈다
// 브랜치도 쉼표·줄바꿈으로만 — 「release/2026 11」을 빈칸에서 말없이 둘로 나눠 둘 다 받던 일(화면 역할 평가 2026-11-12). 이제 빨간 값으로 남는다.
// 경로·명령의 \ 는 / 로(서버 cleanHookOpts 와 같게 — 화면만 config\prod.json 을 거절하던 일)
const tidyItem = (opt, s) => (opt?.item === 'command' || opt?.item === 'path' ? String(s).trim().replace(/\\/g, '/') : String(s).trim());
export const parseList = (opt, text) => {
  const sep = opt?.item === 'word' ? /[,\s]+/ : /[,\r\n]+/;
  const parts = [...new Set(String(text || '').split(sep).map((s) => tidyItem(opt, s)).filter(Boolean))];
  // 한도(LIST_MAX)는 여기서 자르지 않는다 — 넣는 쪽(opt-list.js add)이 남는 값을 빨간 칩으로 보인다(다시 검토 2026-11-12)
  return { values: parts.filter((x) => validItem(opt, x)), bad: parts.filter((x) => !validItem(opt, x)) };
};

// 끝 / 만 다른 경로는 같은 값(bench-results 와 bench-results/)
const sameItem = (a, b) => String(a).replace(/\/+$/, '') === String(b).replace(/\/+$/, '');
// 칸 아래 「+ 넣기」 제안: 이미 든 값(끝 / 만 다른 것 포함)·빨간 칩 값은 빼고, 칸이 가득 차면 하나도 내지 않는다 —
// 가득 찬 칸에서 눌러 빨간 「한도 넘음」 칩이 생기던 일(독립 검토 2026-11-13)
export const offerChoices = (offers, values = [], wrong = []) => (values.length >= LIST_MAX ? []
  : [...new Set(offers || [])].filter((x) => ![...values, ...wrong].some((y) => sameItem(x, y))));
// 제안 값 하나를 그대로 넣는다 — 쉼표로 나누지 않는다(쉼표가 든 폴더 이름이 둘로 갈리던 일). 꼴은 같은 badWhy 로 보고, 틀리면 빨간 칩으로
export const placeOne = (opt, x, values = [], wrong = []) => {
  const v = tidyItem(opt, x);
  if (!v || values.some((y) => sameItem(y, v))) return { values, bad: wrong };
  if (badWhy(opt, v) || values.length >= LIST_MAX) return { values, bad: [...new Set([...wrong, v])] };
  return { values: [...values, v], bad: wrong.filter((y) => y !== v) };
};
