// 이 명령의 커밋에 들어갈 것: 이미 stage 한 것 + 같은 명령의 git add(파일·폴더·-u·-A) + commit -a + commit <경로>.
// 반환: { files, added, rows(f), unseen, before(f), after(f), isNew(f) }. 커밋이 없으면 null.
//   files: 저장소 기준 경로들, added: Map(경로 → 더한 줄들), rows(f): 더한 줄의 줄 번호·바로 위 줄(허용 주석용),
//   unseen: 같은 명령 앞부분이 커밋할 내용을 바꿀 수 있으면 그 부분(글) — 이때는 내용을 미리 볼 수 없다.
//   before/after: 커밋 전(HEAD)·커밋될 파일 내용(없으면 null).
import fs from 'node:fs';
import path from 'node:path';
import { git, repoState } from './core.mjs';
import { BASH, gitSegments, commandSegments } from './cmdline.mjs';
import { ADD_SUB, commitStagesAll, commitPaths, parseAdd, GIT_WORD, gitWords, commandWords } from './commit-args.mjs';
import { countLines } from './lines.mjs';

// 명령 낱말 읽기는 commit-args.mjs, 줄 세기는 lines.mjs 로 옮겼다(예전 가져오기를 위해 여기서도 내보낸다).
export { countLines };

// 경로를 따옴표·8진수로 바꾸지 않고 그대로 받는다(한글 경로가 "\354\204\244…" 로 와서 검사를 빠져나가지 않게).
const RAW_PATHS = ['-c', 'core.quotepath=false'];
// 지우는 변경(D)은 뺀다 — 저장소에서 .env·키 파일을 빼는 커밋은 막을 일이 아니다.
const NOT_DELETED = '--diff-filter=ACMR';
const NAMES = [...RAW_PATHS, 'diff', '--name-only', '--no-renames', NOT_DELETED];
// 더한 줄은 이름 바꾸기를 따라간다(-M) — git mv 로 옮긴 파일의 옛 줄을 새로 더한 줄로 보지 않게. 파일 목록(NAMES)은 새 이름을 더한 파일로 본다.
const DIFF = [...RAW_PATHS, 'diff', '-U0', '--no-color', '-M', '--no-ext-diff', '--no-textconv', NOT_DELETED];
const UNTRACKED = [...RAW_PATHS, 'ls-files', '--others'];
const TRACKED = [...RAW_PATHS, 'ls-files'];
const EXCLUDE_IGNORED = '--exclude-standard';
// 한 번에 읽는 글의 한도(파일 하나, diff 하나). 넘으면 그 파일은 보지 않는다(packs.json detail 에 적음).
export const MAX_TEXT_BYTES = 32 * 1024 * 1024;
const MAX_FILE_BYTES = MAX_TEXT_BYTES;
const BIG = { maxBuffer: MAX_TEXT_BYTES };

const lines = (out) => (out || '').split('\n').filter(Boolean);

// diff 의 더한 줄을 into 에 모은다(only 에 든 파일만). 한꺼번에 받은 diff 가 한도를 넘으면 파일마다 다시 받는다
// — 큰 파일 하나 때문에 나머지를 놓치지 않게. byPath: 경로를 diff 에 넘길지(디스크와 비교할 때).
const diffAdded = (root, args, into, only, byPath = false, nos = null) => {
  const paths = [...only].map((f) => path.join(root, f));
  const whole = git(root, byPath ? [...args, '--', ...paths] : args, BIG);
  if (whole !== null) return addedByFile(whole, into, only, nos);
  for (const f of paths) addedByFile(git(root, [...args, '--', f], BIG), into, only, nos);
  return into;
};

// diff 출력 → { 파일 경로: 더한 줄들 }. 경로는 저장소 맨 위 기준.
// 머리(+++ b/…)와 내용 줄(+…)은 @@ 뒤인지로 가른다 — 「++ 」로 시작하는 내용 줄을 머리로 읽지 않게.
// 더한 줄마다 커밋될 파일의 줄 번호를 nos 에 모은다(@@ -a,b +c,d @@ 의 c 부터. 허용 주석의 「바로 위 줄」과 알림에 쓴다).
const HUNK_START = /^@@ -\d+(?:,\d+)? \+(\d+)/;
const addedByFile = (diff, into, only = null, nos = null) => {
  let file = null;
  let inHunk = false;
  let no = 0;
  for (const line of (diff || '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      inHunk = false;
      file = null;
    } else if (!inHunk && line.startsWith('+++ ')) {
      const p = line.slice(4).replace(/\t$/, '');
      file = p === '/dev/null' ? null : p.replace(/^b\//, '');
      if (file && only && !only.has(file)) file = null;
      if (file && !into.has(file)) into.set(file, []);
      if (file && nos && !nos.has(file)) nos.set(file, []);
    } else if (line.startsWith('@@')) {
      inHunk = true;
      no = Number(line.match(HUNK_START)?.[1] || 0);
    } else if (inHunk && file && line.startsWith('+')) {
      into.get(file).push(line.slice(1));
      nos?.get(file).push(no || null);
      if (no) no++;
    }
  }
  return into;
};

// ── 명령 앞부분이 커밋할 내용을 바꿀 수 있는지 ─────────────────────
// 훅은 명령이 돌기 「전에」 본다. `sed -i … && git add x && git commit` 처럼 같은 명령 앞부분이 파일을 쓰면
// 지금 디스크에 있는 내용은 커밋될 내용과 다르다. 그런 명령은 볼 수 없으므로 나눠 실행하게 한다.
// 내용을 바꾸지 않는 것만 앞에 둘 수 있다: 폴더 옮기기, 출력만 하는 명령, 아래 git 하위 명령.
// 파일을 쓰지 않는 명령(> 로 내보내면 writesFile 이 따로 잡는다)과 셸 흐름 낱말(if … then, { }, $?)
const SAFE_CMD = new Set([
  'cd', 'chdir', 'pushd', 'popd', 'set-location', 'sl', 'echo', 'printf', 'write-host', 'write-output', 'true', ':',
  'pwd', 'ls', 'dir', 'cat', 'head', 'tail', 'wc', 'grep', 'which', 'type', 'test', '[', '[[', 'sleep', 'set', 'export',
  'get-content', 'gc', 'get-childitem', 'gci', 'get-location', 'test-path', 'start-sleep', 'select-string',
  'if', 'then', 'else', 'elif', 'fi', '{', '}', 'do', 'done', '!', '$?', '$lastexitcode',
]);
const SAFE_GIT = new Set(['add', 'stage', 'status', 'diff', 'log', 'show', 'rm', 'mv', 'commit', 'fetch', 'config', 'tag', 'remote', 'rev-parse', 'ls-files', 'shortlog', 'blame', 'grep', 'describe', 'reflog', 'branch']);
// 내용을 바꾸지 않는 브랜치 옮기기·stage 비우기: 시작점 없는 switch -c·checkout -b, restore --staged, 경로·옵션 없는 reset(stage 만 비움)
const keepsContent = (sub, args) => {
  const pos = args.filter((a) => !a.startsWith('-'));
  if (sub === 'switch') return /^-[cC]$|^--(?:force-)?create$/.test(args[0] || '') && pos.length === 1;
  if (sub === 'checkout') return /^-[bB]$/.test(args[0] || '') && pos.length === 1;
  if (sub === 'restore') return args.some((a) => a === '--staged' || a === '-S') && !args.some((a) => a === '--worktree' || a === '-W' || a.startsWith('--source') || a === '-s');
  if (sub === 'reset') return !args.some((a) => /^--(?:soft|hard|keep|merge)$/.test(a)) && (pos.length === 0 || args.includes('--') || pos[0] === 'HEAD');
  return false;
};
// 바깥으로 보내는 출력(> 파일)은 파일을 쓴다. 버리는 출력(>/dev/null, 2>&1, >$null)만 둔다.
const REDIRECT_ANY = />/g;
const REDIRECT_DISCARD = /^\d?>>?\s*(?:&\d|\/dev\/null\b|\$null\b|NUL\b)/i;
// add 의 대화식 옵션·명령 치환·변수로 준 경로는 무엇이 올라갈지 미리 알 수 없다.
const ADD_UNKNOWN = /^(?:-p|--patch|-i|--interactive|-e|--edit|--pathspec-from-file(?:=.*)?)$|^[$`]|^@\(/;

const writesFile = (bare) => {
  for (const m of bare.matchAll(REDIRECT_ANY)) {
    const i = m.index;
    if (bare[i - 1] === '>') continue; // >> 의 두 번째 글자는 앞에서 봤다
    const from = i > 0 && /\d/.test(bare[i - 1]) ? i - 1 : i;
    if (!REDIRECT_DISCARD.test(bare.slice(from))) return true;
  }
  return false;
};

// 시험·린트·타입 검사 실행과 mkdir 은 커밋할 파일을 쓰지 않는 것으로 친다(시험 뒤 커밋하는 흔한 꼴을 막지 않게).
// 고치는 옵션(--fix·--write·-u 스냅숏 갱신)을 주면 쓴다고 본다. package.json 스크립트 안에서 고치는 것은 보지 못한다(packs.json detail 에 적음).
const PKG = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const CHECK_SCRIPT = /^(?:test|t|lint|typecheck|type-check|check|tsc)(?::[\w-]+)?$/;
const NPX = new Set(['npx', 'pnpx', 'bunx']);
const NPX_CHECK = /^(?:tsc|vitest|jest|eslint|playwright|mocha|ava)$/;
const FIXES = /^(?:--fix|--write|-w|-u|--updateSnapshot|--update-snapshots|--emit)$/;
const checkRunner = (w) => {
  if (w.some((x) => FIXES.test(x))) return false;
  const [a, b, c] = w.map((x) => x.toLowerCase());
  if (a === 'mkdir' || a === 'pytest' || (a === 'new-item' && w.some((x) => /^directory$/i.test(x)))) return true;
  if (PKG.has(a)) return CHECK_SCRIPT.test(b === 'run' ? c || '' : b || '');
  if (NPX.has(a)) return NPX_CHECK.test(b || '') && (b !== 'tsc' || w.includes('--noEmit'));
  if (a === 'node') return b === '--test';
  if (/^python3?$/.test(a)) return b === '-m' && /^(?:pytest|unittest|mypy)$/.test(c || '');
  if (a === 'go') return b === 'test' || b === 'vet';
  if (a === 'cargo') return b === 'test' || b === 'check' || b === 'clippy';
  if (a === 'dotnet' || a === 'swift') return b === 'test';
  return false;
};

// 조각 하나가 커밋할 내용을 바꿀 수 있는지. 바꿀 수 있으면 true.
const mayChangeContent = (seg, worktreeSources) => {
  const rest = commandWords(seg.words);
  const first = rest[0] || '';
  if (!first) return false;
  if (GIT_WORD.test(first)) {
    const { sub, args } = gitWords(rest);
    if (!SAFE_GIT.has(sub) && !keepsContent(sub, args)) return true;
    if ((sub === 'add' || sub === 'stage') && args.some((w) => ADD_UNKNOWN.test(w))) return true;
    return writesFile(seg.bare);
  }
  // stage 를 거치지 않는 커밋(이미 stage 한 것만)은 git 아닌 명령이 바꾸지 못한다.
  if (!worktreeSources) return false;
  return !(SAFE_CMD.has(first.toLowerCase()) || checkRunner(rest)) || writesFile(seg.bare);
};

// 마지막 커밋 앞 조각 가운데 커밋할 내용을 바꿀 수 있는 첫 조각(글). 없으면 null.
const unseenPart = (cmd, shell, lastCommitAt, worktreeSources) => {
  for (const seg of commandSegments(cmd, shell)) {
    if (seg.start + seg.raw.length > lastCommitAt) break;
    if (mayChangeContent(seg, worktreeSources)) return seg.raw.trim();
  }
  return null;
};

const readSmall = (file) => {
  try {
    const st = fs.statSync(file);
    return st.isFile() && st.size < MAX_FILE_BYTES ? fs.readFileSync(file, 'utf8') : null;
  } catch {
    return null;
  }
};

// repo: 이 도구 호출에서 나눠 쓰는 저장소 상태(ctx.repo — HEAD 가 있는지를 규칙끼리 한 번만 구한다). 없으면 여기서 만든다.
export const commitPlan = (cmd, cwd, root, shell = BASH, repo = null) => {
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
  const worktreeSources = allTracked || allUntracked || specs.length > 0;
  const lastCommitAt = Math.max(...commits.map((c) => c.start));
  const unseen = unseenPart(cmd, shell, lastCommitAt, worktreeSources)
    || (trackedSpecs.some((w) => /^[$`]|^@\(/.test(w)) ? commits[commits.length - 1].raw.trim() : null);

  // 디스크에서 가져갈 파일(추적 중인 변경) + 새 파일. 나머지는 stage 한 내용 그대로.
  const fromDisk = new Set();
  if (allTracked) lines(git(root, NAMES, BIG)).forEach((f) => fromDisk.add(f));
  if (specs.length) lines(git(root, [...NAMES, '--', ...specs], BIG)).forEach((f) => fromDisk.add(f));
  const untrackedArgs = [...UNTRACKED, ...(force ? [] : [EXCLUDE_IGNORED])];
  const fresh = new Set();
  if (allUntracked) lines(git(root, untrackedArgs, BIG)).forEach((f) => fresh.add(f));
  if (addSpecs.length) lines(git(root, [...untrackedArgs, '--', ...addSpecs.map(abs)], BIG)).forEach((f) => fresh.add(f));
  // 이름으로 준 파일은 -f 없이도 무시 목록을 넘을 수 있다(git 이 거절하지만 막는 쪽으로 본다).
  const named = addSpecs.filter((f) => fs.statSync(abs(f), { throwIfNoEntry: false })?.isFile()).map(rel);
  if (named.length) {
    const tracked = new Set(lines(git(root, [...TRACKED, '--', ...named], BIG)));
    named.filter((f) => !tracked.has(f)).forEach((f) => fresh.add(f));
  }
  fresh.forEach((f) => fromDisk.add(f));

  const staged = new Set(lines(git(root, [...NAMES, '--cached'], BIG)));
  const files = new Set([...staged, ...fromDisk]);
  const hasHead = (repo || repoState(root)).hasHead();

  // 더한 줄: stage 한 파일은 HEAD↔stage, 디스크에서 가져가는 추적 파일은 HEAD↔디스크, 새 파일은 전부.
  const added = new Map();
  const addedNos = new Map(); // 파일 → 더한 줄마다 줄 번호(diff 로 받은 파일만. 통째로 읽은 파일은 i + 1)
  const onlyStaged = new Set([...staged].filter((f) => !fromDisk.has(f)));
  if (onlyStaged.size) diffAdded(root, [...DIFF, '--cached'], added, onlyStaged, false, addedNos);
  const diskTracked = [...fromDisk].filter((f) => !fresh.has(f));
  if (diskTracked.length) {
    const base = hasHead ? ['HEAD'] : ['--cached'];
    if (hasHead) diffAdded(root, [...DIFF, ...base], added, new Set(diskTracked), true, addedNos);
    else diskTracked.forEach((f) => { const s = readSmall(path.join(root, f)); if (s != null) added.set(f, s.split('\n')); });
  }
  for (const f of fresh) {
    const s = readSmall(path.join(root, f));
    if (s != null) added.set(f, s.split('\n'));
  }

  const headText = (f) => (hasHead ? git(root, [...RAW_PATHS, 'show', `HEAD:${f}`], BIG) : null);
  const after = (f) => (fromDisk.has(f) ? readSmall(path.join(root, f)) : git(root, [...RAW_PATHS, 'show', `:${f}`], BIG));
  // 더한 줄 i 의 자리(allow.mjs 의 줄 자리 정보 꼴). 바로 위 줄이 더한 줄이 아니면 커밋될 파일을 한 번 읽어 찾는다(허용 주석을 볼 때만).
  const rows = (f) => {
    const ls = added.get(f) || [];
    const nos = addedNos.get(f);
    if (!nos) return { prev: (i) => (i > 0 ? ls[i - 1] : null), no: (i) => i + 1 };
    let whole;
    return {
      no: (i) => nos[i] ?? null,
      prev: (i) => {
        const n = nos[i];
        if (!n || n === 1) return null;
        if (i > 0 && nos[i - 1] === n - 1) return ls[i - 1];
        whole ??= (after(f) ?? '').split('\n');
        return whole[n - 2] ?? null;
      },
    };
  };
  // 새 파일: 아직 추적하지 않는 파일, 또는 stage 에 「더한 파일(A)」로 오른 것. git mv 로 옮긴 파일(R)은 이름만 바뀐 것이라 새 파일이 아니다.
  // 파일마다 git show 로 HEAD 를 보지 않고 한 번에 묻는다 — 새 파일 2000개 커밋이 git 2000번(몇 분)이 되던 것(2026-11-06 시험).
  let addedNames = null;
  const isNew = (f) => {
    if (fresh.has(f)) return true;
    addedNames ??= new Set(lines(git(root, [...RAW_PATHS, 'diff', '--cached', '--name-only', '-M', '--diff-filter=A'], BIG)));
    return addedNames.has(f);
  };
  // 커밋될 파일의 줄 수(큰 새 파일 검사). stage 한 파일은 git 이 센 더한 줄 수(--numstat, 새 파일이면 전체 줄 수)를 한 번에 받는다.
  let numstat = null;
  const lineCountOf = (f) => {
    if (fromDisk.has(f)) {
      const s = readSmall(path.join(root, f));
      return s == null ? null : countLines(s);
    }
    if (!numstat) {
      numstat = new Map();
      for (const rec of (git(root, [...RAW_PATHS, 'diff', '--cached', '--numstat', '-z', '--no-renames', '--diff-filter=A'], BIG) || '').split('\0')) {
        const m = rec.match(/^(\d+)\t\d+\t(.+)$/s);
        if (m) numstat.set(m[2], Number(m[1]));
      }
    }
    return numstat.has(f) ? numstat.get(f) : null;
  };
  return { files: [...files], added, rows, unseen, before: headText, after, isNew, lineCount: lineCountOf };
};

// ── 이름만: 이 명령 「자신이」 stage 하는 파일 ─────────────────────
// 보호 경로·마이그레이션 커밋 검사는 파일 이름만 쓴다. commitPlan 은 stage 한 내용까지 읽어 26MB stage 에서 0.5초 걸렸다(2026-11-11).
// 이미 stage 돼 있던 것은 보지 않는다 — 사용자가 손으로 stage 한 것 때문에 Claude 의 엉뚱한 커밋을 막지 않게. Claude 가 앞 명령에서
// stage 한 것은 그 git add 를 볼 때 막는다(같은 함수로). docs/decisions.md 「커밋 검사는 이 명령이 올리는 것만」.

// 한 명령을 보는 동안 규칙마다 같은 계산을 다시 하지 않는다(shared 는 evaluate 가 명령마다 새로 준다).
export const once = (shared, key, make) => {
  if (!shared) return make();
  if (!(key in shared)) shared[key] = make();
  return shared[key];
};

// 명령 낱말만 읽는다(git 을 부르지 않음). git add·commit 이 없으면 null.
//   all: commit -a·add -u·add -A(추적 중인 변경 모두), allUntracked: add -A(새 파일 모두), specs: add·commit 경로(cwd 기준), addSpecs: 새 파일도 올리는 경로
//   root: 저장소 맨 위(값 또는 함수 — :/경로 꼴이 있을 때만 부른다). 모르면 :/경로 는 저장소 전체로 본다.
// 저장소 맨 위 기준 pathspec(:/ · :(top) · :(top,glob)…). 나머지가 비면 저장소 전체(add -A 와 같다 — 검토 2026-11-11).
const TOP = /^:(?:\/|\([\w,]*\btop\b[\w,]*\))/;
// 빼는 pathspec(:!x · :^x · :(exclude)x) — 올리는 것을 넓히지 않는다. 빼는 것만 주면 git 은 저장소 전체에서 뺀다.
const EXCLUDE = /^:(?:[!^]|\([\w,]*\bexclude\b[\w,]*\))/;
// 무엇이 올라갈지 낱말로는 알 수 없는 꼴: 명령 치환·변수($(…)·`…`·$F·@(…)), --pathspec-from-file, xargs git add, update-index --stdin·--index-info.
// 이때는 「작업 트리의 바뀐 것 전부」를 올리는 것으로 본다 — 보호 경로·마이그레이션이 실제로 바뀌었을 때만 걸린다(넓게 보되 헛막음은 작게).
const UNKNOWABLE = /^[$`]|^@\(|^--pathspec-from-file(?:=|$)/;
const UPDATE_INDEX_UNKNOWABLE = /^--(?:stdin|index-info|cacheinfo)(?:=|$)/;
// 내용을 올리지 않고 표시만 바꾸는 update-index(--assume-unchanged·--skip-worktree·--refresh 등)
const INDEX_FLAGS_ONLY = /^--(?:(?:no-)?assume-unchanged|(?:no-)?skip-worktree|(?:really-)?refresh|(?:no-)?fsmonitor-valid|(?:no-)?split-index|(?:no-)?untracked-cache|test-untracked-cache|show-index-version|index-version)$/;
const xargsRun = (cmd, shell, at) => commandSegments(cmd, shell).some((seg) =>
  seg.start <= at && at <= seg.start + seg.raw.length && /^(?:.*[\\/])?xargs(?:\.exe)?$/i.test(seg.words[0] || ''));
export const stageSources = (cmd, shell = BASH, root = null) => {
  const commits = gitSegments(cmd, 'commit', shell);
  const adds = gitSegments(cmd, ADD_SUB, shell);
  const updates = gitSegments(cmd, 'update-index', shell);
  if (!commits.length && !adds.length && !updates.length) return null;
  const src = { all: commits.some((c) => commitStagesAll(c.bare)), allUntracked: false, force: false, specs: commits.flatMap((c) => commitPaths(c.words)), addSpecs: [] };
  const whole = () => {
    src.all = true;
    src.allUntracked = true;
  };
  let top;
  const topOf = (s) => {
    const rest = s.replace(TOP, '');
    if (!rest) return null;
    top ??= typeof root === 'function' ? root() : root;
    return top ? path.join(top, rest) : null;
  };
  for (const { words, start } of adds) {
    const a = parseAdd(words);
    src.force ||= a.force;
    if (words.some((w) => UNKNOWABLE.test(w)) || xargsRun(cmd, shell, start)) whole();
    const specs = [];
    let wide = false;
    for (const s of a.specs) {
      if (EXCLUDE.test(s)) continue;
      if (!TOP.test(s)) specs.push(s);
      else {
        const abs = topOf(s);
        if (abs) specs.push(abs);
        else wide = true;
      }
    }
    if (wide || (a.specs.length && !specs.length)) whole();
    if (!specs.length) {
      src.all ||= a.update || a.all;
      src.allUntracked ||= a.all;
    } else {
      src.specs.push(...specs);
      if (!a.update) src.addSpecs.push(...specs);
    }
  }
  // git update-index --add 경로(새 파일도), 그냥 update-index 경로(추적 중인 것만)
  for (const { words } of updates) {
    if (words.some((w) => INDEX_FLAGS_ONLY.test(w))) continue;
    if (words.some((w) => UPDATE_INDEX_UNKNOWABLE.test(w) || UNKNOWABLE.test(w))) {
      whole();
      continue;
    }
    const paths = words.filter((w) => !w.startsWith('-') && !/^[<>|&]|^\d>/.test(w));
    src.specs.push(...paths);
    if (words.includes('--add')) src.addSpecs.push(...paths);
  }
  return src;
};

// git pathspec 글롭(* 는 / 도 넘는다)
const pathspecRe = (g) => new RegExp(`^${g.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\[!/g, '[^').replace(/\*+/g, '.*').replace(/\?/g, '.')}(?:/|$)`);
const nul = (out) => (out || '').split('\0');
const STATUS = [...RAW_PATHS, 'diff', '--name-status', '-z', '--no-renames'];

// → { changed: Set(더하거나 고친 것), deleted: Set, untracked(): 새 파일 목록(처음 부를 때 git 한 번) } — 경로는 저장소 맨 위 기준.
// git 은 작업 트리 이름 목록 한 번(git diff --name-status). 내용은 읽지 않는다.
export const commandStages = (cmd, cwd, root, shell = BASH) => {
  const src = stageSources(cmd, shell, root);
  const out ={ changed: new Set(), deleted: new Set(), untracked: () => [] };
  if (!src || (!src.all && !src.specs.length && !src.addSpecs.length)) return out;
  const rels = src.specs.map((s) => path.relative(root, path.resolve(cwd, s)).split(path.sep).join('/'));
  const res = rels.map((s) => (/[*?[]/.test(s) ? pathspecRe(s) : null));
  const covers = (f) => src.all || rels.some((s, i) => s === '' || (res[i] ? res[i].test(f) : f === s || f.startsWith(`${s}/`)));
  const z = nul(git(root, STATUS, BIG));
  for (let i = 0; i + 1 < z.length; i += 2) {
    const [st, f] = [z[i], z[i + 1]];
    if (st && f && covers(f)) (st[0] === 'D' ? out.deleted : out.changed).add(f);
  }
  let fresh;
  out.untracked = () => {
    if (fresh) return fresh;
    if (!src.allUntracked && !src.addSpecs.length) return (fresh = []);
    const args = [...RAW_PATHS, 'ls-files', '--others', '-z', ...(src.force ? [] : [EXCLUDE_IGNORED])];
    const only = src.allUntracked ? [] : ['--', ...src.addSpecs.map((s) => path.resolve(cwd, s))];
    return (fresh = nul(git(root, [...args, ...only], BIG)).filter(Boolean));
  };
  return out;
};

// 진짜 커밋 때(git pre-commit 훅) 들어갈 것: 지금 stage 에 있는 것만. commit -a·commit <경로> 일 때 git 이 임시 색인을
// GIT_INDEX_FILE 로 넘기고, 여기서 띄우는 git 도 그 색인을 읽는다 — 명령을 짐작하지 않고 실제로 들어갈 내용을 본다.
export const stagedPlan = (root) => commitPlan('git commit', root, root);
