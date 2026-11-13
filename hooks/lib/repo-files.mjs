// 저장소 찾기·HEAD·브랜치 읽기를 파일로 한다(git 프로세스 없이). 훅은 셸 명령마다 돌고 git 한 번이 이 PC 에서 45~70ms 라,
// 읽기만 하는 git status·git log 에도 git 을 네 번 띄우던 것을 0번으로 줄이려고(전체 검토 2026-11-13).
// 원칙: git 과 같은 답을 확실히 낼 수 있을 때만 파일로 답하고, 조금이라도 애매하면 undefined 를 돌려 부른 쪽이 git 에게 묻는다.
//   애매한 것: GIT_DIR 같은 환경 변수, .git 폴더 안, 맨 폴더가 bare 저장소처럼 보임, 깨진 .git 파일, 파일 시스템 경계(POSIX),
//   reftable, 브랜치가 아닌 곳을 가리키는 HEAD, 이상한 ref 이름·내용.
import fs from 'node:fs';
import path from 'node:path';

// 저장소 찾기를 바꾸는 git 환경 변수(git 훅 안에서는 GIT_DIR 이 붙는다)
const GIT_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_CEILING_DIRECTORIES', 'GIT_DISCOVERY_ACROSS_FILESYSTEM', 'GIT_INDEX_FILE'];
const HEX = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

const statOf = (p) => { try { return fs.statSync(p, { throwIfNoEntry: false }) || null; } catch { return null; } };
const readOf = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const looksGitDir = (d) => statOf(path.join(d, 'HEAD'))?.isFile() && (statOf(path.join(d, 'objects'))?.isDirectory() || statOf(path.join(d, 'commondir'))?.isFile());

// dir 의 저장소 → { root, gitDir, commonDir } · false(저장소가 아님이 확실) · undefined(애매 — git 에게 물을 것)
// root 는 git rev-parse --show-toplevel 처럼 실제 경로(정션·심볼릭 링크·대소문자를 푼 것)다.
export const findRepo = (dir) => {
  if (GIT_ENV.some((k) => process.env[k])) return undefined;
  let d;
  try {
    d = fs.realpathSync.native(path.resolve(dir));
  } catch {
    return false; // 없는 폴더 — git -C 도 실패한다
  }
  if (!statOf(d)?.isDirectory()) return false;
  if (d.split(/[\\/]/).some((p) => p.toLowerCase() === '.git')) return undefined;
  const dev = process.platform === 'win32' ? null : statOf(d)?.dev;
  for (;;) {
    if (looksGitDir(d)) return undefined; // bare 저장소이거나 그 안
    const dot = path.join(d, '.git');
    const st = statOf(dot);
    if (st?.isDirectory()) return looksGitDir(dot) ? withCommon(d, dot) : undefined;
    if (st?.isFile()) {
      const m = /^gitdir: (.+?)\s*$/.exec(readOf(dot) || '');
      const gitDir = m && path.resolve(d, m[1]);
      return gitDir && looksGitDir(gitDir) ? withCommon(d, gitDir) : undefined;
    }
    if (st) return undefined;
    const up = path.dirname(d);
    if (up === d) return false;
    if (dev !== null && statOf(up)?.dev !== dev) return undefined; // 파일 시스템 경계는 git 이 따로 판단한다
    d = up;
  }
};
// core.bare = true 인 저장소(.git 이 있어도 작업 트리가 없다)는 git rev-parse --show-toplevel 이 실패한다 — 파일로 정하지 않고 git 에게 묻는다(검토 2026-11-13)
const BARE = /^\s*bare\s*=\s*true\s*$/im;
const withCommon = (root, gitDir) => {
  const c = readOf(path.join(gitDir, 'commondir'));
  const commonDir = c === null ? gitDir : path.resolve(gitDir, c.trim());
  if (BARE.test(readOf(path.join(commonDir, 'config')) || '')) return undefined;
  return { root, gitDir, commonDir };
};

// ref 이름으로 파일을 찾아도 되는 꼴(.. · 역슬래시 · 콜론 같은 것이 있으면 git 에게 묻는다 — 경로 밖을 읽지 않게)
const SAFE_REF = /^(?!.*\.\.)(?!.*\/\/)(?!.*\.lock(?:\/|$))(?!\/)(?!.*\/$)[A-Za-z0-9._\-/]+$/;
export const safeRefName = (name) => typeof name === 'string' && SAFE_REF.test(name) && !name.startsWith('-') && !name.startsWith('.');

// 풀린 refs(packed-refs) 한 번 읽기 — 한 저장소 안에서 여러 번 묻는다
const packedOf = (repo) => {
  if (!('packed' in repo)) {
    const text = readOf(path.join(repo.commonDir, 'packed-refs'));
    repo.packed = text === null ? new Set() : new Set(text.split('\n').filter((l) => HEX.test(l.slice(0, l.indexOf(' ')))).map((l) => l.slice(l.indexOf(' ') + 1).trim()));
  }
  return repo.packed;
};
const reftable = (repo) => statOf(path.join(repo.commonDir, 'reftable')) !== null;

// ref 가 있나: true · false · undefined(애매). refs/heads 등은 공통 폴더에, 작업 폴더(worktree)마다의 것은 gitDir 에 있다.
export const refExists = (repo, ref) => {
  if (!repo || reftable(repo) || !ref.startsWith('refs/') || !safeRefName(ref.slice(5))) return undefined;
  const st = statOf(path.join(repo.commonDir, ref));
  if (st?.isFile()) return HEX.test((readOf(path.join(repo.commonDir, ref)) || '').trim()) ? true : undefined;
  if (st) return st.isDirectory() ? packedOf(repo).has(ref) || undefined : undefined;
  return packedOf(repo).has(ref);
};

// HEAD → { branch: 짧은 이름('' = 분리된 HEAD), hasHead: 커밋이 있나 } · undefined(애매)
// branch 는 git symbolic-ref --short HEAD 와 같아야 한다: 같은 짧은 이름의 다른 ref(태그·원격 등)가 있으면 git 은 heads/ 를 붙이므로 그때는 묻는다.
export const headOf = (repo) => {
  if (!repo || reftable(repo)) return undefined;
  const text = (readOf(path.join(repo.gitDir, 'HEAD')) || '').trim();
  if (HEX.test(text)) return { branch: '', hasHead: true };
  const m = /^ref: refs\/heads\/(.+)$/.exec(text);
  if (!m || !safeRefName(m[1])) return undefined;
  const name = m[1];
  for (const other of [`refs/${name}`, `refs/tags/${name}`, `refs/remotes/${name}`, `refs/remotes/${name}/HEAD`]) {
    const has = refExists(repo, other);
    if (has !== false) return undefined;
  }
  const hasHead = refExists(repo, `refs/heads/${name}`);
  return hasHead === undefined ? undefined : { branch: name, hasHead };
};

// 원격 추적 브랜치가 하나라도 있나: true · false · undefined
export const hasRemoteRefsOf = (repo) => {
  if (!repo || reftable(repo)) return undefined;
  if ([...packedOf(repo)].some((r) => r.startsWith('refs/remotes/'))) return true;
  const walk = (d, depth) => {
    let list;
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return false; }
    for (const e of list) {
      // 이상한 파일(숨김·잠금·ref 이름이 아닌 것)이 있으면 git 에게 묻는다 — for-each-ref 는 그런 것을 ref 로 치지 않는다
      if (!safeRefName(e.name) || e.name.endsWith('.lock')) return undefined;
      // 심볼릭 ref(origin/HEAD 의 「ref: …」)는 가리키는 곳이 없으면 git 이 ref 로 치지 않는다 — 파일만 보고 true 라 하면
      // 원격 추적이 없는 첫 push 를 막았다(검토 2026-11-13). 이런 파일은 git 에게 묻는다
      if (e.isFile()) return /^ref:/.test(readOf(path.join(d, e.name)) || '') ? undefined : true;
      if (!e.isDirectory() || depth >= 8) return undefined;
      const sub = walk(path.join(d, e.name), depth + 1);
      if (sub !== false) return sub;
    }
    return false;
  };
  return walk(path.join(repo.commonDir, 'refs', 'remotes'), 0);
};
