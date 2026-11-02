// 이 명령의 커밋에 들어갈 것: 이미 stage 한 것 + 같은 명령의 git add(파일·폴더·-u·-A) + commit -a + commit <경로>.
// 반환: { files: 저장소 기준 경로들, added: Map(경로 → 더한 줄들) }. 커밋이 없으면 null.
import fs from 'node:fs';
import path from 'node:path';
import { git } from './core.mjs';
import { BASH, gitSegments, shortFlags } from './cmdline.mjs';

// stage 에 올리는 하위 명령. `git stage` 는 `git add` 의 다른 이름이다.
export const ADD_SUB = 'add|stage';

// 경로를 따옴표·8진수로 바꾸지 않고 그대로 받는다(한글 경로가 "\354\204\244…" 로 와서 검사를 빠져나가지 않게).
const RAW_PATHS = ['-c', 'core.quotepath=false'];
// 지우는 변경(D)은 뺀다 — 저장소에서 .env·키 파일을 빼는 커밋은 막을 일이 아니다.
const NOT_DELETED = '--diff-filter=ACMR';
const NAMES = [...RAW_PATHS, 'diff', '--name-only', NOT_DELETED];
const DIFF = [...RAW_PATHS, 'diff', '-U0', '--no-color', NOT_DELETED];
const UNTRACKED = [...RAW_PATHS, 'ls-files', '--others'];
const TRACKED = [...RAW_PATHS, 'ls-files'];
const EXCLUDE_IGNORED = '--exclude-standard';
const MAX_UNTRACKED_BYTES = 1 << 20;

// commit 의 짧은 옵션 중 값을 받는 것(-m 메시지, -F 파일, -C/-c 커밋, -t 템플릿, -S 키, -u 모드).
export const COMMIT_VALUE_FLAGS = 'mFCctSu';
// 그중 다음 낱말을 값으로 가져가는 것(-S·-u 는 붙여 쓸 때만 값을 받는다).
export const COMMIT_NEXT_VALUE = 'mFCct';
export const COMMIT_LONG_VALUE = new Set([
  '--message', '--file', '--author', '--date', '--template', '--reuse-message', '--reedit-message',
  '--fixup', '--squash', '--cleanup', '--trailer', '--pathspec-from-file',
]);
const REDIRECT = /^\d*[<>]/;
const REDIRECT_ONLY = /^\d*(?:<<-?|<|>>?|>&)$/;

// commit 이 -a/--all 로 추적 중인 변경을 모두 넣는지. 인자는 따옴표를 비운 것.
export const commitStagesAll = (bare) => shortFlags(bare, COMMIT_VALUE_FLAGS).has('a') || /(?:^|\s)--all(?=\s|$)/.test(bare);

// `git commit <경로> -m …` 의 경로들(옵션 값·리다이렉션은 뺀다).
export const commitPaths = (words) => {
  const out = [];
  let opts = true;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (REDIRECT.test(w)) {
      if (REDIRECT_ONLY.test(w)) i++;
    } else if (opts && w === '--') opts = false;
    else if (opts && w.startsWith('--')) {
      if (COMMIT_LONG_VALUE.has(w)) i++;
    } else if (opts && /^-[A-Za-z]/.test(w)) {
      // 묶음(-am)에서 값을 받는 글자가 맨 끝이면 다음 낱말이 그 값이다.
      const at = [...w.slice(1)].findIndex((ch) => COMMIT_NEXT_VALUE.includes(ch));
      if (at === w.length - 2) i++;
    } else out.push(w);
  }
  return out;
};

// git add 인자 → { specs: 경로들, force, tracked: 경로 없이 -u/-A, untracked: 경로 없이 -A }.
const ADD_UPDATE = /^--update$/;
const ADD_ALL = /^--(?:all|no-ignore-removal)$/;
const parseAdd = (words) => {
  const opts = words.filter((w) => w.startsWith('-'));
  const specs = words.filter((w) => !w.startsWith('-'));
  const short = shortFlags(opts.filter((w) => !w.startsWith('--')).join(' '));
  const all = short.has('A') || opts.some((w) => ADD_ALL.test(w));
  const update = short.has('u') || opts.some((w) => ADD_UPDATE.test(w));
  return { specs, force: short.has('f') || opts.includes('--force'), update, all };
};

const lines = (out) => (out || '').split('\n').filter(Boolean);

// diff 출력 → { 파일 경로: 더한 줄들 }. 경로는 저장소 맨 위 기준.
const addedByFile = (diff, into) => {
  let file = null;
  for (const line of (diff || '').split('\n')) {
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim();
      file = p === '/dev/null' ? null : p.replace(/^b\//, '');
      if (file && !into.has(file)) into.set(file, []);
    } else if (file && line.startsWith('+')) into.get(file).push(line.slice(1));
  }
  return into;
};

export const commitPlan = (cmd, cwd, root, shell = BASH) => {
  const commits = gitSegments(cmd, 'commit', shell);
  if (!commits.length) return null;
  const abs = (f) => path.resolve(cwd, f);
  const rel = (f) => path.relative(root, abs(f)).split(path.sep).join('/');

  let allTracked = commits.some((c) => commitStagesAll(c.bare));
  let allUntracked = false;
  let force = false;
  const addSpecs = []; // 추적 중인 변경 + 새 파일
  const trackedSpecs = commits.flatMap((c) => commitPaths(c.words)); // 추적 중인 변경만(commit <경로>, add -u <경로>)
  for (const { words } of gitSegments(cmd, ADD_SUB, shell)) {
    const a = parseAdd(words);
    force ||= a.force;
    if (!a.specs.length) {
      allTracked ||= a.update || a.all;
      allUntracked ||= a.all;
    } else (a.update ? trackedSpecs : addSpecs).push(...a.specs);
  }
  const specs = [...addSpecs, ...trackedSpecs].map(abs);

  const files = new Set(lines(git(root, [...NAMES, '--cached'])));
  if (allTracked) lines(git(root, NAMES)).forEach((f) => files.add(f));
  if (specs.length) lines(git(root, [...NAMES, '--', ...specs])).forEach((f) => files.add(f));

  // 새 파일: 폴더·패턴 안의 추적 안 된 파일 + 이름으로 준 파일(-f 로 무시 목록을 넘는 것도). 지운 파일은 없으니 빠진다.
  const untrackedArgs = [...UNTRACKED, ...(force ? [] : [EXCLUDE_IGNORED])];
  const fresh = new Set();
  if (allUntracked) lines(git(root, untrackedArgs)).forEach((f) => fresh.add(f));
  if (addSpecs.length) lines(git(root, [...untrackedArgs, '--', ...addSpecs.map(abs)])).forEach((f) => fresh.add(f));
  const named = addSpecs.filter((f) => fs.statSync(abs(f), { throwIfNoEntry: false })?.isFile()).map(rel);
  if (named.length) {
    const tracked = new Set(lines(git(root, [...TRACKED, '--', ...named])));
    named.filter((f) => !tracked.has(f)).forEach((f) => fresh.add(f));
  }
  fresh.forEach((f) => files.add(f));

  const added = addedByFile(git(root, [...DIFF, '--cached']), new Map());
  if (allTracked) addedByFile(git(root, DIFF), added);
  if (specs.length) addedByFile(git(root, [...DIFF, '--', ...specs]), added);
  // 아직 추적하지 않는 새 파일은 diff 에 안 나오므로 내용을 직접 읽는다(1MB 미만만).
  for (const f of fresh) {
    try {
      const file = path.join(root, f);
      const st = fs.statSync(file);
      if (st.isFile() && st.size < MAX_UNTRACKED_BYTES) added.set(f, fs.readFileSync(file, 'utf8').split('\n'));
    } catch {}
  }
  return { files: [...files], added };
};
