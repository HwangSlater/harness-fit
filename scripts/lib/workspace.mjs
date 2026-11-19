// 작업 폴더: git 저장소가 아닌 폴더 하나에 git 저장소 여럿(바로 아래 폴더)과 같이 쓰는 docs/ 가 든 꼴.
// 화면·API 저장소를 한 세션에서 같이 고치려고 맨 위 폴더에서 Claude Code 를 연다(사용자 요청, 2026-11-19).
// ⚠️ 맨 위는 git 저장소가 아니라 감지가 「혼자 빠르게」·브랜치 전략 없음·git 훅 없음으로 나왔다 — 같은 명령을 messenger/ 에서 돌리면
//    「팀 협업」·Git Flow 였다(0.2.0 에서 잼, v0.5.0 에서 다시 확인). host 도 none 이라 GitLab 팀에 「GitHub 은 gh 명령으로 읽기」가 들어갔다.
// 그래서 저장소마다 감지한 결과를 합쳐 하나의 감지 결과로 낸다. 합치는 기준은 아래 mergeWorkspace 의 칸마다 적었다.
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../../hooks/lib/core.mjs';

// 저장소가 이만큼은 있어야 작업 폴더로 본다(하나뿐이면 그 저장소에서 열면 된다 — 맨 위를 모르는 폴더로 두던 지금 동작 그대로)
export const WORKSPACE_MIN = 2;
// 이 이름의 폴더는 저장소로 보지 않는다(받아 온 패키지 안의 .git)
const SKIP = new Set(['node_modules']);
const real = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
};
// Windows·macOS 는 경로의 대소문자를 가리지 않는다
const FOLD = process.platform === 'win32' || process.platform === 'darwin';
const same = (a, b) => (FOLD ? a.toLowerCase() === b.toLowerCase() : a === b);

// dir 이 작업 폴더면 바로 아래 git 저장소 폴더 이름들(정렬), 아니면 null.
// 아님: dir 이 git 저장소 안(그 저장소 하나로 본다), 저장소가 WORKSPACE_MIN 보다 적음. 점으로 시작하는 폴더·연결(심볼릭 링크·정션)은 보지 않는다.
// 저장소 판정은 훅과 같은 repoRoot(.git 을 파일로 찾고 애매하면 git) — 그 폴더가 저장소 맨 위일 때만(위 저장소의 하위 폴더는 아님).
export const workspaceRepos = (dir) => {
  const top = path.resolve(dir);
  if (repoRoot(top)) return null;
  let entries;
  try {
    entries = fs.readdirSync(top, { withFileTypes: true });
  } catch {
    return null;
  }
  const repos = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name) && fs.existsSync(path.join(top, e.name, '.git')))
    .map((e) => e.name)
    .filter((n) => {
      const r = repoRoot(path.join(top, n));
      return !!r && same(real(r), real(path.join(top, n)));
    })
    .sort();
  return repos.length >= WORKSPACE_MIN ? repos : null;
};

const uniq = (xs) => [...new Set(xs)];
const posix = (p) => String(p).replace(/\\/g, '/');
// 맨 위에서 돌릴 수 있게 저장소 폴더로 들어가는 명령. 이름에 빈칸이 있으면 따옴표
const inRepo = (name, cmd) => `cd ${/\s/.test(name) ? `"${name}"` : name} && ${cmd}`;
// 보호 경로·결과 폴더는 프로젝트(작업 폴더) 맨 위 기준이라 저장소 이름을 앞에 붙인다.
// 「/」 가 없는 이름(application-secret.yml)·점 꼴(.hdf5)은 어디서든 맞는 꼴이라 그대로 둔다(hooks/lib/secrets.mjs protectedBy)
const underRepo = (name, p) => (posix(p).includes('/') ? `${name}/${posix(p).replace(/^\.\//, '')}` : p);
const sameJson = (xs) => xs.every((x) => JSON.stringify(x) === JSON.stringify(xs[0]));
// 모두 같으면 그 값, 아니면 null(값이 없는 저장소 — 기록이 적은 저장소 — 는 견주지 않는다)
const agreed = (xs) => {
  const known = xs.filter((x) => x != null);
  return known.length && sameJson(known) ? known[0] : null;
};
// 가장 많은 값(같으면 저장소 이름 차례로 앞의 것)
const mostOf = (xs, fallback) => {
  const n = new Map();
  for (const x of xs) if (x) n.set(x, (n.get(x) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || fallback;
};

// 저장소 위치: none(원격 없음)은 빼고 하나로 모이면 그것, 다르면 mixed.
// mixed 는 GitLab 이 아니므로 GitHub 전용 훅을 빼지 않는다(catalog.mjs fitOff 는 gitlab 일 때만 뺀다 — GitHub 저장소가 섞여 있으면 쓸모가 있다)
const hostOf = (hosts) => {
  const known = uniq(hosts.filter((h) => h && h !== 'none'));
  return known.length === 0 ? 'none' : known.length === 1 ? known[0] : 'mixed';
};

const mergeCommands = (parts) => {
  const out = {};
  for (const { name, det } of parts) {
    for (const [kind, list] of Object.entries(det.commands || {})) if (Array.isArray(list)) (out[kind] ||= []).push(...list.map((c) => inRepo(name, c)));
  }
  return out;
};

const mergeSuggest = (parts) => {
  const ask = [];
  const protect = [];
  const offer = [];
  const why = {};
  for (const { name, det } of parts) {
    const s = det.suggest || {};
    const at = (w) => (w && w.at ? { ...w, at: `${name}/${posix(w.at)}` } : w);
    // 묻는 명령은 명령 꼴이라 그대로(ask-cmd 는 어느 폴더에서 돌든 명령 낱말로 맞춘다) — 찾은 파일 자리만 저장소 이름을 붙인다
    for (const v of s.ask || []) if (!ask.includes(v)) (ask.push(v), (why[v] ??= at(s.why?.[v])));
    for (const v of s.protect || []) {
      const p = underRepo(name, v);
      if (!protect.includes(p)) (protect.push(p), (why[p] ??= at(s.why?.[v])));
    }
    for (const v of s.offer || []) {
      const p = underRepo(name, v);
      if (!offer.includes(p)) (offer.push(p), (why[p] ??= at(s.why?.[v])));
    }
  }
  return { ask, protect, ...(offer.length ? { offer } : {}), why };
};

const mergeHistory = (parts, branchesMax) => {
  const hs = parts.map((p) => p.det.history || {});
  const sum = (k) => hs.reduce((n, h) => n + (h[k] || 0), 0);
  return {
    subjects: sum('subjects'), conventional: sum('conventional'),
    extraTypes: uniq(hs.flatMap((h) => h.extraTypes || [])).slice(0, 5),
    messages: sum('messages'), korean: sum('korean'), english: sum('english'),
    branches: uniq(hs.flatMap((h) => h.branches || [])).slice(0, branchesMax),
  };
};

// 커밋·PR 형식: 저장소마다 분명한 꼴이 같을 때만(다르면 지침에 한 꼴로 적을 수 없다 — 적지 않는다). 양식 파일은 저장소 이름을 붙여 모은다
const mergeVcs = (parts) => {
  const vs = parts.map((p) => p.det.vcs || {});
  const templates = parts.flatMap(({ name, det }) => (det.vcs?.pr?.templates || []).map((t) => `${name}/${posix(t)}`));
  const title = agreed(vs.map((v) => v.pr?.title ?? null));
  return { commit: agreed(vs.map((v) => v.commit ?? null)), pr: { templates, title, own: templates.length > 0 || vs.some((v) => v.pr?.own) } };
};

// parts: [{ name, det(그 저장소의 detect 결과), authorIds(최근 6개월 커밋한 사람 — 저장소를 넘어 한 번씩 센다) }]
// helpers: detect.mjs 의 것을 받는다(같은 판정을 두 군데 두지 않게) — kindsOf, existing(맨 위에서 읽은 기존 설정), branchesMax
export const mergeWorkspace = (dir, parts, { kindsOf, existing, branchesMax }) => {
  const dets = parts.map((p) => p.det);
  const any = (k) => dets.some((d) => d[k]);
  const stack = uniq(dets.flatMap((d) => d.stack || []));
  // 저장소 단서 종류: 하나라도 있으면(화면 파일·로그인 단서가 그 저장소에 있다). 「정확한 버전으로」(pinned)는 JS 저장소가 모두 그럴 때만
  const signals = uniq(dets.flatMap((d) => [...(d.kinds || []), ...(d.js ? ['js'] : [])]));
  const pinned = dets.filter((d) => d.js).every((d) => (d.kinds || []).includes('pinned'));
  const code = any('code');
  const authors = uniq(parts.flatMap((p) => p.authorIds || [])).length;
  const developN = dets.filter((d) => d.hasDevelop).length;
  return {
    root: dir,
    name: path.basename(dir),
    stack,
    kinds: kindsOf(stack, pinned ? signals : signals.filter((k) => k !== 'pinned'), code),
    depRanges: { total: dets.reduce((n, d) => n + (d.depRanges?.total || 0), 0), ranged: dets.reduce((n, d) => n + (d.depRanges?.ranged || 0), 0) },
    js: any('js'),
    code,
    thin: dets.every((d) => d.thin),
    // 맨 위는 git 저장소가 아니다 — 저장소마다의 것은 workspace 칸에
    isGit: false,
    commits: dets.reduce((n, d) => n + (d.commits || 0), 0),
    authors,
    team: authors > 1,
    host: hostOf(dets.map((d) => d.host)),
    defaultBranch: mostOf(dets.map((d) => d.defaultBranch), 'main'),
    // 저장소의 절반 이상에 develop 이 있으면 Git Flow(설정은 작업 폴더에 하나라 저장소마다 다른 전략을 줄 수 없다 —
    // develop 없는 저장소는 이유 줄에 이름을 밝힌다, catalog.mjs recommend)
    hasDevelop: developN > 0 && developN * 2 >= dets.length,
    hasTests: any('hasTests'),
    commands: mergeCommands(parts),
    suggest: mergeSuggest(parts),
    commandsListed: uniq(dets.flatMap((d) => d.commandsListed || [])),
    history: mergeHistory(parts, branchesMax),
    vcs: mergeVcs(parts),
    library: dets.every((d) => d.library),
    existing,
    workspace: parts.map(({ name, det }) => ({ name, host: det.host, defaultBranch: det.defaultBranch, hasDevelop: det.hasDevelop, authors: det.authors })),
  };
};
