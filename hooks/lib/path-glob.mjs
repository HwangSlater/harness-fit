// 사용자가 적은 보호 경로의 글롭(* · **) 맞추기 — protected-files 의 paths 옵션(역할극 15 회차 인프라: *.tfstate*·kubeconfig*·*.tfplan, 2026-11-12).
// 꼴은 .gitignore 를 따른다: / 가 없는 꼴(*.tfstate*)은 어느 깊이의 이름에도, / 가 든 꼴(infra/*.tfvars)은 프로젝트 맨 위부터.
// * 는 / 를 넘지 않고, 마디 하나 전체인 ** 는 마디 0개 이상. 이름이 맞으면 그 폴더 안 파일도 지킨다(폴더 이름에 맞은 꼴).
// 정규식을 만들지 않는다 — 마디마다 두 손가락 맞추기 + 마디 단위 동적 계획(꼴 길이 × 경로 길이, 꼴은 GLOB_MAX 자까지).
import fs from 'node:fs';
import path from 'node:path';

// 이보다 긴 꼴은 글롭으로 보지 않고 글자 그대로 맞춘다(protectedBy 의 원래 길)
export const GLOB_MAX = 256;
export const isGlob = (g) => g.includes('*') && g.length <= GLOB_MAX;

// 마디 하나: * 는 글자 0개 이상(/ 는 마디에 없다). 마지막 * 자리로만 되돌아가는 두 손가락 맞추기
const segMatch = (p, s) => {
  let i = 0;
  let j = 0;
  let star = -1;
  let mark = 0;
  while (j < s.length) {
    if (i < p.length && p[i] !== '*' && p[i] === s[j]) { i++; j++; }
    else if (i < p.length && p[i] === '*') { star = i++; mark = j; }
    else if (star !== -1) { i = star + 1; j = ++mark; }
    else return false;
  }
  while (i < p.length && p[i] === '*') i++;
  return i === p.length;
};

// 꼴 글 → 마디 목록. 이어진 ** 는 하나로, 마디 안의 ** 는 * 와 같다. anchored: 맨 위부터 맞추는지
// 앞이 / 인 꼴(/kubeconfig*)은 .gitignore 처럼 맨 위 기준(2026-11-12 — 어느 깊이든 맞춰 internal/kubeconfig.go 까지 막던 일)
export const parseGlob = (g) => {
  const dir = g.endsWith('/') || g.startsWith('/');
  const body = g.replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
  const segs = [];
  for (const s of body.split('/')) {
    if (!s) continue;
    const seg = s === '**' ? '**' : s.replace(/\*{2,}/g, '*');
    if (seg === '**' && segs.at(-1) === '**') continue;
    segs.push(seg);
  }
  // 끝이나 앞이 / 인 꼴은 맨 위 기준(data/·/kubeconfig*), / 가 든 꼴도 맨 위 기준, 아니면 어느 깊이든
  return { segs, anchored: dir || body.includes('/') };
};

// 꼴 마디를 경로 마디 앞에서부터 먹여 본 상태: reach[j] = 경로 마디 j 개를 먹고 꼴을 다 쓴 경우가 있는지
const run = (segs, parts) => {
  let cur = new Uint8Array(parts.length + 1);
  cur[0] = 1;
  for (const p of segs) {
    const next = new Uint8Array(parts.length + 1);
    if (p === '**') {
      let on = 0;
      for (let j = 0; j <= parts.length; j++) next[j] = on ||= cur[j];
    } else {
      for (let j = 0; j < parts.length; j++) if (cur[j] && segMatch(p, parts[j])) next[j + 1] = 1;
    }
    cur = next;
  }
  return cur;
};

// rel(프로젝트 기준, / 로 맞춘 경로)이 꼴에 맞거나 맞은 폴더 안에 있는지. loose: 절대 경로처럼 맨 위를 모를 때 어디서든
export const globMatch = (g, rel, loose = false) => {
  const { segs, anchored } = parseGlob(g);
  if (!segs.length) return false;
  const parts = rel.split('/').filter(Boolean);
  const reach = run(anchored && !loose ? segs : ['**', ...segs], parts);
  for (let j = 1; j <= parts.length; j++) if (reach[j]) return true;
  return false;
};

// 폴더 relDir 를 지울 때 그 안의 무엇이 꼴에 맞을 수 있는지(폴더 자체가 맞는 것은 globMatch 가 본다).
// 맨 위 기준 꼴은 폴더 마디를 먹고 남은 꼴이 있을 때, 아니면(어느 깊이든) 늘 — 실제 파일을 보아 정한다(insideHits)
export const globMayHold = (g, relDir) => {
  const { segs, anchored } = parseGlob(g);
  if (!segs.length) return false;
  if (!anchored) return true;
  const parts = relDir.split('/').filter(Boolean);
  // 경로를 다 먹은 뒤 꼴이 남는지: 꼴 앞 i 마디로 경로 전체를 먹을 수 있는 i < 끝
  for (let i = 0; i < segs.length; i++) if (run(segs.slice(0, i), parts)[parts.length]) return true;
  return false;
};

// 도구가 만들어 내는 폴더(빌드 결과·캐시·내려받은 의존성). 그 안에서만 글롭에 맞는 것은 보호 대상이 아니다 —
// terraform init 이 .terraform/terraform.tfstate(백엔드 정보)를, 번들러가 dist/assets/kubeconfig-ABCD.js 를 만들어
// rm -rf .terraform·rm -rf dist 를 막던 일(검토 2026-11-12). 꼴이 이 이름을 마디로 적었으면(.terraform/*.tfstate) 빼지 않는다(skipNames).
// TOOL_DIRS: 이 이름이면 사람이 만든 폴더일 리가 거의 없어 늘 건너뛴다(들어가지도 세지도 않는다).
export const TOOL_DIRS = ['.terraform', 'node_modules', '__pycache__', '.next', '.nuxt', '.gradle', '.pytest_cache', '.mypy_cache', '.tox'];
// MAYBE_TOOL_DIRS: 흔한 이름이라 사람이 쓰는 폴더일 수도 있다(dist/secret.key · build/prod.tfstate · infra/target/terraform.tfstate 가 지워지던 일 — 두 번째 검토 2026-11-12).
// 안에 들어가 훑되, 그 폴더가 git 이 무시하는 폴더이고 맞은 파일을 git 이 추적하지 않을 때만 그 파일을 건너뛴다(keep).
export const MAYBE_TOOL_DIRS = ['dist', 'build', 'target', 'out', 'coverage', 'venv', '.venv', '.terragrunt-cache', '.svelte-kit', '.output', '.nyc_output', '.nox', '.ruff_cache', '.parcel-cache', '.turbo', '.serverless', '.aws-sam', 'cdk.out'];
// 꼴 목록이 마디로 적지 않은 도구 폴더 이름(소문자) — { always, maybe }
export const skipNames = (globs) => {
  const named = new Set(globs.flatMap((g) => parseGlob(g).segs.map((s) => s.toLowerCase())));
  const keep = (list) => new Set(list.filter((n) => !named.has(n)));
  return { always: keep(TOOL_DIRS), maybe: keep(MAYBE_TOOL_DIRS) };
};

// 지울 폴더 안을 훑어 꼴에 맞는 첫 파일(프로젝트 기준 경로)을 찾는다. 훑는 수는 WALK_MAX 개까지 — 넘으면 거기서 그만(놓침, decisions-hooks.md).
// 너비 우선으로 훑는다(readdir 순서에 따라 5,000개 안에 드는 것이 바뀌지 않게). .git 과 skip.always 의 폴더는 들어가지도 세지도 않는다.
// skip.maybe 의 폴더는 다른 것을 다 본 뒤에 훑고, 그 안에서 맞은 파일은 모아 두었다가 keep 으로 한꺼번에 가린다 —
// keep(그 폴더, 파일) 이 참인 첫 파일을 친다. keep.first(후보 [{ root, rel }]) 가 있으면 그것으로 한 번에(git 을 후보마다 부르지 않게 —
// packages/p0…p299/dist 에서 git 600번에 26초 걸렸다, 세 번째 검토 2026-11-12). test(rel) 는 protectedBy 로 맞춘다(대소문자 맞춤을 한곳에서)
const WALK_MAX = 5000;
// rel 경로에서 처음 나오는 maybe 폴더(프로젝트 기준), 없으면 null
const maybeRootOf = (rel, maybe) => {
  const parts = rel.split('/');
  const i = parts.findIndex((p) => maybe.has(p.toLowerCase()));
  return i === -1 ? null : parts.slice(0, i + 1).join('/');
};
export const insideHit = (absDir, relDir, test, skip = {}, max = WALK_MAX, keep = () => true) => {
  const always = skip instanceof Set ? skip : skip.always || new Set();
  const maybe = skip instanceof Set ? new Set() : skip.maybe || new Set();
  const first = typeof keep.first === 'function' ? keep.first : (list) => list.find((c) => keep(c.root, c.rel))?.rel ?? null;
  const cands = [];
  const settle = () => (cands.length ? first(cands) : null);
  let seen = 0;
  const queue = [[absDir, relDir, maybeRootOf(relDir, maybe)]];
  const later = [];
  for (let q = 0; q < queue.length || later.length; q++) {
    if (q === queue.length) queue.push(...later.splice(0));
    const [abs, rel, under] = queue[q];
    queue[q] = null;
    let ents;
    try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const dir = e.isDirectory();
      if (e.name === '.git' || (dir && always.has(e.name.toLowerCase()))) continue;
      if (++seen > max) return settle();
      const r = `${rel}/${e.name}`;
      const root = under || (dir && maybe.has(e.name.toLowerCase()) ? r : null);
      if (test(r)) {
        if (!root) return r;
        cands.push({ root, rel: r });
      }
      if (dir) (root && !under ? later : queue).push([path.join(abs, e.name), r, root]);
    }
  }
  return settle();
};
