// git 하위 명령이 작업 트리(또는 stage)에서 바꾸거나 지우는 경로. 보호 경로(rules/shell.mjs protectedShell)와
// 마이그레이션(rules/migration.mjs migrationShell)이 같이 쓴다 — 읽는 곳을 하나로(2026-11-11, 역할극 8·11 회차: git rm·mv·checkout -- 로
// 보호 경로를 바꿔도 지나갔다).
// → [{ file, op: 'delete'|'write'|'stage', git: 하위 명령, recursive?, gitGlob?(git 이 푸는 글롭 — * 가 / 를 넘음), cached?, source?, from?, fromHead?, noOverlay? }]
//   rm: 지우기(--cached 면 cached — stage 에서만 뺀다), mv: 보내는 쪽 지우기 + 받는 쪽 쓰기,
//   checkout [<커밋>] -- 경로 · checkout <커밋> 경로 · checkout 경로(그 이름의 파일·폴더가 있을 때만): 쓰기(source = 커밋),
//   restore 경로: 쓰기(--staged 만이고 --source 가 없거나 HEAD 면 stage — 올린 것을 내릴 뿐), clean -f 경로: 지우기.
// 보기만 하는 꼴(rm -n·mv -n·clean -n·--dry-run)은 뺀다. 변수·명령 치환으로 정한 경로($F, $(…))는 알 수 없어 뺀다.
// git -C 폴더 는 따로 맞추지 않는다(경로를 지금 폴더 기준으로 읽는다).
import fs from 'node:fs';
import path from 'node:path';
import { BASH, gitSegments } from './cmdline.mjs';
import { git } from './core.mjs';

const REDIRECT = /^[<>|&]|^\d>/;
const unknown = (p) => !p || /[$`]/.test(p) || /^@\(/.test(p);
const DRY = /^(?:-[a-zA-Z]*n[a-zA-Z]*|--dry-run)$/;
const shortHas = (words, ch) => words.some((w) => new RegExp(`^-[a-zA-Z]*${ch}[a-zA-Z]*$`).test(w));
// 옵션을 뺀 낱말(-- 뒤는 - 로 시작해도 경로). values: 다음 낱말을 값으로 가져가는 옵션
const split = (words, values = null) => {
  const before = [];
  let after = null;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (REDIRECT.test(w)) continue;
    if (after) after.push(w);
    else if (w === '--') after = [];
    else if (w.startsWith('-') && w !== '-') {
      if (values?.test(w)) i++;
    } else before.push(w);
  }
  return { before, after };
};
const exists = (cwd, f) => fs.existsSync(path.resolve(cwd, f));
// 브랜치·태그·원격 브랜치(git checkout x 가 origin/x 로 새 브랜치를 만드는 꼴)로 있는 이름인지. 파일이 같은 이름으로 있을 때만 부른다(git 한 번).
// for-each-ref 는 앞부분으로도 맞추므로(refs/heads/main 이 main/x 에도) 이름을 통째로 다시 맞춘다.
const isRef = (cwd, name) => {
  if (!/^[\w./-]+$/.test(name) || name.startsWith('-')) return false;
  // 로컬 브랜치·태그만 — 원격 브랜치에만 있는 이름은, 같은 이름의 파일이 있으면 git 이 파일을 되돌린다(검토 2026-11-11, git 2.55 에서 확인)
  const out = git(cwd, ['for-each-ref', '--format=%(refname)', `refs/heads/${name}`, `refs/tags/${name}`]);
  return (out || '').split('\n').some((r) => r === `refs/heads/${name}` || r === `refs/tags/${name}`);
};
const GLOB = /[*?[]/;
const HEADISH = /^(?:HEAD|@)$/;

const rm = (s) => {
  if (s.words.some((w) => DRY.test(w))) return [];
  const { before, after } = split(s.words);
  const recursive = shortHas(s.words, 'r');
  const cached = s.words.includes('--cached');
  return [...before, ...(after || [])].map((file) => ({ file, op: 'delete', git: 'rm', recursive, gitGlob: true, cached }));
};
const mv = (s) => {
  if (s.words.some((w) => DRY.test(w))) return [];
  const { before, after } = split(s.words);
  const files = [...before, ...(after || [])];
  const from = files.slice(0, -1);
  return [...from.map((file) => ({ file, op: 'delete', git: 'mv', recursive: true })), ...files.slice(-1).map((file) => ({ file, op: 'write', git: 'mv', from }))];
};
// checkout: -b·-B·--orphan 은 브랜치 만들기(경로 없음 — -- 가 없을 때). - 는 앞 브랜치.
const checkout = (s, cwd) => {
  const { before, after } = split(s.words, /^-[bB]$|^--orphan$/);
  // noOverlay: --no-overlay 면 restore 처럼 가져오는 커밋에 없는 파일을 지운다(보통 checkout 은 둔다)
  const noOverlay = s.words.includes('--no-overlay');
  const write = (source) => (file) => ({ file, op: 'write', git: 'checkout', recursive: true, gitGlob: true, source, noOverlay });
  if (after) return after.map(write(before[0] ?? null));
  if (s.words.some((w) => /^-[bB]$|^--orphan$/.test(w)) || !before.length || before[0] === '-') return [];
  // -- 없이: 낱말 하나면 그 이름의 파일·폴더가 있을 때만 경로(없으면 브랜치), 둘 이상이면 첫째는 커밋·나머지는 경로.
  // 그 이름의 파일이 있어도 같은 이름의 브랜치·태그·원격 브랜치가 있으면 git 은 브랜치를 바꾼다(파일 main + git checkout main — 검토 2026-11-11)
  if (before.length === 1) {
    const one = before[0];
    if (GLOB.test(one)) return [write(null)(one)];
    return exists(cwd, one) && !isRef(cwd, one) ? [write(null)(one)] : [];
  }
  return before.slice(1).map(write(before[0]));
};
const restore = (s) => {
  const w = s.words;
  let source = null;
  for (let i = 0; i < w.length; i++) {
    if (w[i] === '-s' || w[i] === '--source') source = w[i + 1] ?? null;
    else if (w[i].startsWith('--source=')) source = w[i].slice(9);
    else if (/^-s./.test(w[i])) source = w[i].slice(2);
  }
  const staged = w.includes('--staged') || shortHas(w, 'S');
  const worktree = w.includes('--worktree') || shortHas(w, 'W');
  const onlyUnstage = staged && !worktree && (!source || HEADISH.test(source));
  const { before, after } = split(w, /^(?:-s|--source)$/);
  // fromHead: --staged --worktree 에 --source 가 없으면 HEAD 에서 둘 다 되돌린다(보통 restore 는 stage 에서)
  return [...before, ...(after || [])].map((file) => ({ file, op: onlyUnstage ? 'stage' : 'write', git: 'restore', recursive: true, gitGlob: true, source, fromHead: staged && !source }));
};
// clean: -f(·--force) 가 있어야 지운다. -e·--exclude 는 값을 받는다. 경로가 없으면 저장소 전체 — danger-cmd discardChanges 가 본다.
const clean = (s) => {
  const w = s.words;
  if (w.some((x) => DRY.test(x)) || !(shortHas(w, 'f') || w.includes('--force'))) return [];
  const { before, after } = split(w, /^(?:-e|--exclude)$/);
  const recursive = shortHas(w, 'd');
  return [...before, ...(after || [])].map((file) => ({ file, op: 'delete', git: 'clean', recursive, gitGlob: true }));
};

const READ = { rm, mv, checkout, restore, clean };

// 넓은 pathspec: 「.」「..」(끝 / 포함), 글롭(git 의 * 는 / 를 넘는다), 「:/」 같은 마법 — 이름으로는 무엇이 바뀔지 알 수 없다
// (검토 2026-11-11: git rm -r .·git rm "m*"·git rm "config/*.yml" 이 보호 파일을 지워도 지나갔다).
export const wideSpec = (file) => GLOB.test(file) || file.startsWith(':') || /(?:^|[\\/])\.\.?[\\/]*$/.test(file);
// git 에 물어볼 대상: 넓은 pathspec, 그리고 checkout·restore 의 폴더(그 안의 보호 파일이 실제로 바뀌는지 — 이름으로 막으면 헛막음)
export const askGit = (w, cwd) => wideSpec(w.file) || ((w.git === 'checkout' || w.git === 'restore') && w.op === 'write' && isDirAt(cwd, w.file));
const isDirAt = (cwd, f) => {
  try {
    return fs.statSync(path.resolve(cwd, f), { throwIfNoEntry: false })?.isDirectory() ?? false;
  } catch {
    return false;
  }
};
// 넓은 pathspec 이 실제로 바꿀 파일(저장소 맨 위 기준, / 로). git 이 직접 푼다 — rm 은 추적 중인 파일(ls-files),
// checkout·restore 는 되돌릴 쪽(커밋·HEAD·stage)과 지금 작업 트리가 다른 파일만(diff — 같으면 바뀌지 않는다).
// clean·mv 와 git 을 못 부를 때는 null(부르는 쪽이 원래대로 본다).
export const wideTouched = (w, cwd) => {
  const spec = ['--', w.file];
  let out = null;
  if (w.git === 'rm') {
    if (!w.recursive && !GLOB.test(w.file) && !w.file.startsWith(':')) return []; // -r 없는 git rm . 은 아무것도 지우지 않는다
    out = git(cwd, ['ls-files', '-z', '--full-name', ...spec], { maxBuffer: 16 * 1024 * 1024 });
  } else if ((w.git === 'checkout' || w.git === 'restore') && w.op === 'write') {
    const from = w.source || (w.fromHead ? 'HEAD' : null);
    if (from?.startsWith('-')) return null; // --source=--output=… 같은 값이 git diff 옵션으로 읽히지 않게
    out = git(cwd, ['diff', '--name-only', '--no-renames', '-z', ...(from ? [from] : []), ...spec], { maxBuffer: 16 * 1024 * 1024 });
  } else return null;
  return out === null ? null : out.split('\0').filter(Boolean);
};
// 커밋된 내용(HEAD)이나 stage 의 내용으로 되돌리기만 하는가: checkout -- 경로 · checkout HEAD -- 경로 · restore 경로 · restore --source=HEAD 경로.
// 보호 파일을 커밋된 판으로 되돌리는 것은 안전하다(역할극 16 회차 다시, 2026-11-13 — 막혀서 되돌리지 못했다). 다른 커밋·브랜치에서 가져오기와
// --no-overlay(가져오는 쪽에 없는 파일을 지움)는 아니다
export const restoresCommitted = (w) => (w.git === 'checkout' || w.git === 'restore') && w.op === 'write' && !w.noOverlay && (!w.source || HEADISH.test(w.source));
export const gitWrites = (cmd, shell = BASH, cwd = process.cwd()) =>
  Object.entries(READ)
    .flatMap(([sub, read]) => gitSegments(cmd, sub, shell).flatMap((s) => read(s, cwd)))
    .filter((x) => !unknown(x.file));
