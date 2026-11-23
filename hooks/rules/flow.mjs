// 브랜치 전략 규칙: Git Flow 합치기 방향(merge-flow, 막음), 오래 산 브랜치 알림(branch-age, 알림만 — 트렁크·Git Flow),
// Git Flow 의 develop 되돌려 합치기 알림(back-merge, 알림만).
// 이름은 보호 브랜치(protect-branch) 옵션의 브랜치 목록을 따른다 — 사용자가 main 대신 production 을 적었으면 그것이 배포 브랜치다.
// 원칙: 확실할 때만 막는다. 지금 브랜치·합칠 브랜치 가운데 하나라도 모르는 이름이면(태그·커밋 해시·HEAD~1·다른 이름) 통과.
import { git, gitSegments, repoState } from '../lib/core.mjs';
import { timelineOf } from '../lib/branches.mjs';
import { findRepo, refExists, refValue, safeRefName } from '../lib/repo-files.mjs';
import { stampFile, readStamp, writeStamp } from '../lib/stamp.mjs';
import { localDate } from '../lib/dates.mjs';

// 배포 브랜치로 볼 이름. 보호 목록에서 이 꼴이 아닌 것은 통합 브랜치(develop·integration 등) — 환경 이름(staging·qa…)만 빼고.
const PROD = /^(?:main|master|production|prod|trunk|stable)$/i;
// 환경 브랜치(배포 앞 단계 서버) — 그런 브랜치에 feature 를 합치거나 그것을 main 에 합치는 팀이 있어 모르는 이름으로 둔다
const ENV = /^(?:stag(?:e|ing)|qa|uat|test(?:ing)?|pre-?prod(?:uction)?|sandbox|demo|preview)$/i;
export const DEFAULT_PROD = ['main', 'master'];
export const DEFAULT_DEV = ['develop'];

// 윈도(NTFS)는 ref 파일 이름의 대소문자를 가리지 않아 `git merge FEATURE/a` 도 feature/a 를 합친다 — 그때는 대소문자 없이 견준다
export const FOLD_CASE = process.platform === 'win32';

// 켠 규칙의 protect-branch 옵션 → { prod, dev }. 목록이 없으면 기본 이름. 목록이 있으면 그 안의 이름만(develop 이 없으면 통합 브랜치도 없음).
export const flowNames = (rules) => {
  const pb = rules?.['protect-branch'];
  if (!(pb && typeof pb === 'object' && Array.isArray(pb.branches))) return { prod: DEFAULT_PROD, dev: DEFAULT_DEV };
  const list = pb.branches.filter((b) => typeof b === 'string' && b && !b.includes('/') && safeRefName(b));
  const prod = list.filter((b) => PROD.test(b));
  return { prod: prod.length ? prod : DEFAULT_PROD, dev: list.filter((b) => !PROD.test(b) && !ENV.test(b)) };
};

// 브랜치 이름 → 'main' · 'develop' · 'feature' · 'bugfix' · 'release' · 'hotfix' · null(모름)
const FLOW_PREFIX = /^(feature|bugfix|release|hotfix)\/[^/]/;
const FLOW_PREFIX_I = new RegExp(FLOW_PREFIX.source, 'i');
export const flowKind = (name, names, fold = FOLD_CASE) => {
  if (typeof name !== 'string' || !name) return null;
  const key = fold ? name.toLowerCase() : name;
  const has = (list) => list.some((b) => (fold ? b.toLowerCase() : b) === key);
  if (has(names.prod)) return 'main';
  if (has(names.dev)) return 'develop';
  return (fold ? FLOW_PREFIX_I : FLOW_PREFIX).exec(name)?.[1].toLowerCase() || null;
};

// 지금 브랜치(target) 종류 → 합치면 안 되는 쪽(source) 종류 → 문구 키
const BLOCKED = {
  main: { feature: 'mergeFlow.intoMain', bugfix: 'mergeFlow.intoMain', develop: 'mergeFlow.intoMainDevelop' },
  release: { feature: 'mergeFlow.intoRelease' },
  hotfix: { develop: 'mergeFlow.intoHotfix', feature: 'mergeFlow.intoHotfix' },
};

// 값을 받는 옵션(다음 낱말이나 붙은 글자는 브랜치가 아니다)
const MERGE_VALUE_LONG = new Set(['-m', '--message', '-F', '--file', '-s', '--strategy', '-X', '--strategy-option', '--into-name', '--cleanup']);
const MERGE_VALUE_SHORT = 'mFsX';
const MERGE_CONTROL = /^--(?:abort|continue|quit|skip)$/;
const PULL_VALUE_LONG = new Set(['--depth', '--deepen', '--shallow-since', '--shallow-exclude', '-j', '--jobs', '--upload-pack', '-s', '--strategy', '-X', '--strategy-option', '-o', '--server-option', '--negotiation-tip']);
const PULL_VALUE_SHORT = 'sXjo';

// 옵션을 뺀 낱말들. `--` 뒤는 모두 낱말, 맨 `-` 는 낱말(git merge - = 직전 브랜치 — 모르는 이름으로 통과).
export const positionalOf = (words, valueLong, valueShort) => {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === '--') {
      out.push(...words.slice(i + 1));
      break;
    }
    if (w.startsWith('--') || (w.startsWith('-') && w.length > 1 && valueLong.has(w))) {
      if (valueLong.has(w)) i++;
      continue;
    }
    if (w.startsWith('-') && w.length > 1) {
      // 짧은 옵션 묶음: 값을 받는 글자가 끝에 있으면 다음 낱말이 값, 가운데 있으면 나머지 글자가 값
      for (let k = 1; k < w.length; k++) {
        if (valueShort.includes(w[k])) {
          if (k === w.length - 1) i++;
          break;
        }
      }
      continue;
    }
    out.push(w);
  }
  return out;
};

// 합칠 쪽 이름: refs/heads/·refs/remotes/<원격>/ 을 떼고, origin/feature/x 처럼 원격 추적 브랜치면(ref 파일이 있을 때만) 원격 이름을 뗀다.
// 짧은 이름은 git 이 태그(refs/tags/<이름>)를 브랜치보다 먼저 고른다 — 그 태그가 있으면 브랜치가 아니라 모르는 이름이다.
const sourceKind = (raw, names, files) => {
  const explicitHead = raw.startsWith('refs/heads/');
  let name = raw.replace(/^refs\/heads\//, '');
  const remoteRef = /^refs\/remotes\/[^/]+\/(.+)$/.exec(name);
  if (remoteRef) name = remoteRef[1];
  const direct = flowKind(name, names);
  if (direct && !explicitHead && !remoteRef && files && safeRefName(name) && refExists(files, `refs/tags/${name}`) === true) return null;
  if (direct || remoteRef || !name.includes('/') || !safeRefName(name)) return direct;
  // feature/x 같은 꼴이 아니고 「원격/브랜치」 꼴일 수 있을 때 — 파일로 확실히 원격 추적 브랜치일 때만
  return files && refExists(files, `refs/remotes/${name}`) === true ? flowKind(name.slice(name.indexOf('/') + 1), names) : null;
};

// 이 명령이 합치는 것들: [{ start, sources: [이름…] }]. git merge <브랜치…>, git pull <원격> <브랜치…>(브랜치를 적었을 때만).
export const mergesOf = (cmd, shell) => {
  const out = [];
  for (const s of gitSegments(cmd, 'merge', shell)) {
    if (s.words.some((w) => MERGE_CONTROL.test(w))) continue;
    out.push({ start: s.start, sources: positionalOf(s.words, MERGE_VALUE_LONG, MERGE_VALUE_SHORT) });
  }
  for (const s of gitSegments(cmd, 'pull', shell)) {
    const pos = positionalOf(s.words, PULL_VALUE_LONG, PULL_VALUE_SHORT);
    // 원격만 주면(git pull origin) upstream 을 받는다 — 무엇을 합치는지 파일만으로는 모른다
    const specs = pos.slice(1).map((spec) => spec.replace(/^\+/, '').split(':')[0]).filter(Boolean);
    if (specs.length) out.push({ start: s.start, sources: specs, pull: true });
  }
  return out;
};

// 막는 글의 「갈 곳」: 보호 목록에 적은 통합 브랜치 이름들(없으면 이름 없이 「통합 브랜치」)
const devText = (names, t) => (names.dev.length ? t('mergeFlow.dev', { names: names.dev.map((n) => `\`${n}\``).join('·') }) : t('mergeFlow.devNone'));

export const mergeFlow = {
  id: 'merge-flow',
  on: 'shell',
  check({ cmd, shell, root, repo, rules, t }) {
    if (!root) return null;
    const merges = mergesOf(cmd, shell);
    if (!merges.length) return null;
    const names = flowNames(rules);
    const state = repo || repoState(root);
    const branchAt = timelineOf(cmd, shell, root, state);
    let files;
    for (const m of merges) {
      const target = branchAt(m.start);
      const blocked = BLOCKED[flowKind(target, names)];
      if (!blocked) continue;
      files ??= findRepo(root) || null;
      for (const source of m.sources) {
        const key = blocked[sourceKind(source, names, files)];
        if (key) return t(key, { source, target, develop: devText(names, t), main: names.prod[0] });
      }
    }
    return null;
  },
};

// 오래 산 브랜치 알림 기본값(화면의 옵션 기본값과 같아야 한다 — packs.json branch-age options)
export const DEFAULT_MAX_HOURS = 24;
export const DEFAULT_MAX_BEHIND = 20;
// 알림만 하는 훅이라 git 이 늦으면 기다리지 않고 조용히 넘어간다(두 번 부르는 것을 합쳐 이 한도 안에서).
// HARNESS_FIT_NOTICE_GIT_MS: 시험만 쓴다 — 전체 시험이 CPU 를 다 쓰면 git 두 번이 1.5초를 넘어 알림 시험이 흔들렸다(2026-11-23)
const noticeGitMs = () => (Number(process.env.HARNESS_FIT_NOTICE_GIT_MS) > 0 ? Number(process.env.HARNESS_FIT_NOTICE_GIT_MS) : 1500);
const AGE_MAX_BUFFER = 4 * 1024 * 1024;
const HOUR_S = 3600;

const positive = (v, fallback) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback);
const ageText = (hours, t) => {
  const days = Math.floor(hours / 24);
  if (days === 1) return t('branchAge.day');
  return days > 1 ? t('branchAge.days', { n: days }) : t('branchAge.hours', { n: Math.max(1, Math.floor(hours)) });
};

// `git log --format=%at` 출력(브랜치에만 있는 커밋의 작성 시각, 줄마다) → 가장 이른 시각(초), 없으면 null.
// 작성 시각은 rebase 해도 남고, 차례는 날짜 순이 아닐 수 있어(rebase·cherry-pick) 가장 작은 것을 고른다.
export const oldestOf = (out) => {
  let oldest = null;
  for (const line of out.split('\n')) {
    const at = Number(line.trim());
    if (line.trim() && Number.isFinite(at) && at > 0 && (oldest === null || at < oldest)) oldest = at;
  }
  return oldest;
};

// 견줄 트렁크 ref 들: 로컬 refs/heads/<트렁크> 와 원격 refs/remotes/origin/<트렁크> 가운데 있는 것.
// 로컬 main 은 오래 안 받아 왔을 수 있고, 원격 main 은 아직 안 올린 로컬 커밋이나 fork 의 옛 origin 일 수 있어 둘 다 쓴다.
const trunkRefs = (trunks, state, files) => {
  for (const n of trunks) {
    if (!safeRefName(n)) continue;
    const refs = [];
    if (state.isBranch(n)) refs.push(`refs/heads/${n}`);
    if (files && refExists(files, `refs/remotes/origin/${n}`) === true) refs.push(`refs/remotes/origin/${n}`);
    if (refs.length) return { trunk: n, refs };
  }
  return null;
};

// 브랜치가 트렁크보다 얼마나 뒤처졌고 언제 갈라졌나 → { behind, oldest } · null(실패·시간 초과 — 조용히)
//   뒤처진 수: 두 트렁크 가운데 어느 쪽에든 있고 브랜치에는 없는 커밋 수(한쪽이 다른 쪽을 품으면 새것과의 차이와 같다)
//   나이: 두 트렁크 어디에서도 닿지 않는 브랜치 커밋 가운데 가장 이른 작성 시각
// `git log --left-right A...B` 하나로 하면 뒤처진 커밋마다 줄을 만들어 5만 커밋 뒤면 1초 가까이 걸렸다(검토 2026-11-17).
const measure = (root, branch, refs) => {
  const deadline = Date.now() + noticeGitMs();
  const head = `refs/heads/${branch}`;
  const count = git(root, ['rev-list', '--count', ...refs, `^${head}`, '--'], { timeout: noticeGitMs() });
  const behind = Number((count || '').trim());
  if (count === null || !Number.isInteger(behind)) return null;
  const left = deadline - Date.now();
  if (left <= 0) return null;
  const log = git(root, ['log', '--format=%at', head, ...refs.map((r) => `^${r}`), '--'], { timeout: left, maxBuffer: AGE_MAX_BUFFER });
  if (log === null) return null;
  return { behind, oldest: oldestOf(log) };
};

export const branchAge = {
  id: 'branch-age',
  notice: true,
  on: 'shell',
  check({ input, cmd, shell, root, repo, rules, opts, t }) {
    if (!root) return null;
    const segs = [...gitSegments(cmd, 'commit', shell), ...gitSegments(cmd, 'push', shell)];
    if (!segs.length) return null;
    const state = repo || repoState(root);
    const first = Math.min(...segs.map((s) => s.start));
    const branch = timelineOf(cmd, shell, root, state)(first);
    const names = flowNames(rules);
    const fold = (s) => (FOLD_CASE ? s.toLowerCase() : s);
    if (!branch || [...names.prod, ...names.dev].some((n) => fold(n) === fold(branch)) || !safeRefName(branch)) return null;
    // Git Flow 의 feature·bugfix·release 는 develop 에서 따므로 develop 과 견준다(main 과 견주면 아직 배포 안 한 develop 커밋까지 이 브랜치 나이로 셌다).
    // develop 이 없으면(트렁크·GitHub Flow) main. hotfix·모르는 이름은 main
    const kind = flowKind(branch, names);
    // Git Flow 일 때만(합치기 방향·되돌려 합치기 훅이 켜짐) — 보호 브랜치 목록이 없으면 flowNames 가 develop 을 기본으로 주어,
    // 트렁크 저장소에 남은 옛 develop 과 견줘 나이를 크게 잘못 셌다(독립 검토 2026-11-23)
    const gitFlow = !!(rules?.['merge-flow'] || rules?.['back-merge']);
    const trunks = gitFlow && ['feature', 'bugfix', 'release'].includes(kind) ? [...names.dev, ...names.prod] : names.prod;
    // 세션마다 브랜치마다 한 번만 본다(같은 줄을 커밋·푸시마다 되풀이하지 않게, 큰 저장소에서 git 을 매번 걸지 않게).
    // 세션 id 가 없으면 날짜로. 이미 봤으면 git 을 부르기 전에 끝낸다.
    const stamp = stampFile('branch-age', root, branch);
    const seen = typeof input?.session_id === 'string' && input.session_id ? input.session_id : localDate();
    if (readStamp(stamp) === seen) return null;
    const files = findRepo(root);
    const base = trunkRefs(trunks, state, files);
    if (!base) return null;
    const got = measure(root, branch, base.refs);
    // 시간 초과·실패도 「봤음」으로 적는다(아주 큰 저장소에서 커밋마다 1.5초를 기다리지 않게). 새 브랜치(아직 ref 없음)는 다음에 다시
    if (got || state.isBranch(branch)) writeStamp(stamp, seen);
    if (!got) return null;
    const { behind, oldest } = got;
    const { trunk } = base;
    const hours = oldest === null ? 0 : (Date.now() / 1000 - oldest) / HOUR_S;
    const old = hours > positive(opts.hours, DEFAULT_MAX_HOURS);
    const stale = behind > positive(opts.commits, DEFAULT_MAX_BEHIND);
    if (!old && !stale) return null;
    const vars = { branch, trunk, behind, age: old ? ageText(hours, t) : '' };
    if (old) return t(behind > 0 ? 'branchAge.old' : 'branchAge.oldOnly', vars);
    return t('branchAge.behind', vars);
  },
};

// ── 되돌려 합치기 알림(back-merge, Git Flow, 알림만) ──
// release·hotfix 를 main 에 합친 뒤 develop 에 되돌려 합치지 않으면 다음 배포에서 그 수정이 사라진다(hotfix 가 한쪽에만 남음).
// push 할 때 main(로컬·origin) 에 있고 develop(로컬·origin) 어디에도 없는 커밋(병합 커밋 빼고)을 세어 알린다.
// 한 세션에서 main·develop 끝 커밋이 그대로면 한 번만(움직이면 다시). develop 이 없으면(트렁크·GitOps 처럼 main 하나) 보지 않는다.
// 못 보는 것: release 를 main 에 squash 로 합친 저장소 — 그 squash 커밋은 develop 에 영영 없어 늘 알린다(설정에서 끄면 된다).
const refsOf = (names, state, files) =>
  names.filter(safeRefName).flatMap((n) => [
    ...(state.isBranch(n) ? [`refs/heads/${n}`] : []),
    ...(files && refExists(files, `refs/remotes/origin/${n}`) === true ? [`refs/remotes/origin/${n}`] : []),
  ]);

export const backMerge = {
  id: 'back-merge',
  notice: true,
  on: 'shell',
  check({ input, cmd, shell, root, repo, rules, t }) {
    if (!root || !gitSegments(cmd, 'push', shell).length) return null;
    const names = flowNames(rules);
    if (!names.dev.length) return null;
    const state = repo || repoState(root);
    const files = findRepo(root);
    const prod = refsOf(names.prod, state, files);
    const dev = refsOf(names.dev, state, files);
    if (!prod.length || !dev.length) return null;
    // 한 세션에서 main·develop 끝 커밋이 그대로면 다시 보지 않는다 — git 을 부르기 전에 ref 파일로 견준다(push 마다 git 한 번 늘지 않게)
    const tips = [...prod, ...dev].map((r) => refValue(files, r) ?? '?').join(',');
    const stamp = stampFile('back-merge', root);
    const seen = `${typeof input?.session_id === 'string' && input.session_id ? input.session_id : localDate()}:${tips}`;
    if (readStamp(stamp) === seen) return null;
    const out = git(root, ['rev-list', '--count', '--no-merges', ...prod, ...dev.map((r) => `^${r}`), '--'], { timeout: noticeGitMs() });
    const n = Number((out || '').trim());
    // 시간 초과·실패도 「봤음」으로 적는다(branch-age 와 같이 — 큰 저장소에서 push 마다 1.5초를 기다리지 않게)
    writeStamp(stamp, seen);
    if (!Number.isInteger(n) || n <= 0 || out === null) return null;
    // 확인 명령은 센 것과 같은 ref 들로(로컬 main 을 안 받아 와 origin/main 에만 있는 커밋도 보이게 — 독립 검토 2026-11-23)
    const short = (r) => r.replace(/^refs\/(?:heads|remotes)\//, '');
    const range = [...prod.map(short), ...dev.map((r) => `^${short(r)}`)].join(' ');
    return t('backMerge.missing', { n, main: prod.map(short).join('·'), develop: dev.map(short).join('·'), range });
  },
};

export default [mergeFlow, branchAge, backMerge];
