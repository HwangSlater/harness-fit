// 브랜치 읽기: 명령이 새로 만드는 브랜치 이름, 명령 안에서 브랜치가 바뀌는 흐름(switch·checkout 뒤의 commit·push).
// git 하위 명령의 인자 낱말(따옴표 벗긴 것)을 받는다.
import { git, repoState } from './core.mjs';
import { gitSegments } from './cmdline.mjs';

// 짧은 옵션 묶음(-qb name, -bname)에서 값을 받는 글자 ch 의 값. 없으면 undefined.
const bundled = (words, i, letters) => {
  const w = words[i];
  if (!/^-[A-Za-z]+/.test(w) || w.startsWith('--')) return undefined;
  for (let k = 1; k < w.length; k++) {
    if (letters.includes(w[k])) return { value: w.slice(k + 1) || words[i + 1], used: w.slice(k + 1) ? 0 : 1 };
    if (!/[A-Za-z]/.test(w[k])) return undefined;
  }
  return undefined;
};

// 긴 옵션 이름(=값 또는 다음 낱말).
const longValue = (words, i, names) => {
  const w = words[i];
  for (const n of names) {
    if (w === n) return { value: words[i + 1], used: 1 };
    if (w.startsWith(n + '=')) return { value: w.slice(n.length + 1), used: 0 };
  }
  return undefined;
};

// checkout·switch 낱말 → { create: 새 브랜치 이름, to: 옮겨 가는 브랜치('' = 분리된 HEAD), paths: -- 뒤 경로가 있는지, positional }
export const parseSwitch = (sub, words) => {
  const createShort = sub === 'switch' ? 'cC' : 'bB';
  const createLong = sub === 'switch' ? ['--create', '--force-create', '--orphan'] : ['--orphan'];
  let create;
  let detach = false;
  let paths = false;
  const positional = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === '--') {
      paths = true;
      break;
    }
    const v = longValue(words, i, createLong) || bundled(words, i, createShort);
    if (v) {
      create = v.value;
      i += v.used;
    } else if (w === '--detach' || (sub === 'switch' && w === '-d')) detach = true;
    else if (!w.startsWith('-') || w === '-') positional.push(w);
  }
  // `git checkout main README.md` 는 파일 되돌리기다(브랜치는 그대로)
  if (sub === 'checkout' && create === undefined && positional.length > 1) paths = true;
  return { create, detach, paths, positional };
};

// branch 낱말 → 새로 생기는 이름(만들기·이름 바꾸기·복사). 목록 보기·지우기·설정이면 null.
const BRANCH_VALUE = new Set(['--sort', '--format', '--contains', '--no-contains', '--merged', '--no-merged', '--points-at', '-u', '--set-upstream-to']);
const BRANCH_NO_CREATE = /^(?:-[dDlarv]+|--delete|--list|--all|--remotes|--show-current|--verbose|-vv|--edit-description|--unset-upstream|--set-upstream-to(?:=.*)?|-u|--contains|--no-contains|--merged|--no-merged|--points-at|--sort(?:=.*)?|--format(?:=.*)?|--column(?:=.*)?|--no-column)$/;
export const branchCreated = (words) => {
  let rename = false;
  const positional = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === '--') {
      positional.push(...words.slice(i + 1));
      break;
    }
    if (/^(?:-[mMcC]|--move|--copy)$/.test(w) || /^-[fq]*[mMcC][fq]*$/.test(w)) rename = true;
    else if (BRANCH_NO_CREATE.test(w)) return null;
    else if (BRANCH_VALUE.has(w)) i++;
    else if (!w.startsWith('-')) positional.push(w);
  }
  if (!positional.length) return null;
  return rename ? positional[positional.length - 1] : positional[0];
};

// worktree 낱말(add 부터) → 새로 만드는 브랜치 이름 또는 { fromPath } (경로 이름으로 만들 수 있음)
const WORKTREE_VALUE = new Set(['--reason']);
export const worktreeCreated = (words) => {
  if (words[0] !== 'add') return null;
  let detach = false;
  const positional = [];
  for (let i = 1; i < words.length; i++) {
    const v = bundled(words, i, 'bB');
    if (v) return { name: v.value };
    const w = words[i];
    if (w === '--detach' || w === '-d') detach = true;
    else if (WORKTREE_VALUE.has(w)) i++;
    else if (!w.startsWith('-')) positional.push(w);
  }
  if (detach || positional.length !== 1) return null;
  // `git worktree add <경로>`: 브랜치를 안 주면 경로 마지막 이름으로 새 브랜치를 만든다(그 이름 브랜치가 없을 때).
  const base = positional[0].replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return base ? { name: base, fromPath: true } : null;
};

// 브랜치·원격 브랜치가 있는지
export const localBranchExists = (root, name) => git(root, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`]) !== null;
export const anyBranchExists = (root, name) =>
  localBranchExists(root, name) || Boolean((git(root, ['for-each-ref', '--format=%(refname)', `refs/remotes/*/${name}`]) || '').trim());

const previousBranch = (root) => (git(root, ['rev-parse', '--abbrev-ref', '@{-1}']) || '').trim() || null;

// 명령 안에서 HEAD 가 가리키는 브랜치를 따라간다. segments: gitSegments(cmd, 'switch|checkout|…') 의 결과에 sub 를 붙인 것.
// 반환: 자리 → 그때의 브랜치(분리된 HEAD 는 '', 알 수 없으면 null).
export const branchTimeline = (root, start, switches) => {
  const steps = [];
  let cur = start;
  let prev; // 이 명령 안에서 직전에 있던 브랜치(`git checkout -` 이 돌아갈 곳). 아직 안 옮겼으면 git 에게 묻는다.
  for (const s of switches) {
    const p = parseSwitch(s.sub, s.words);
    let next = cur;
    if (p.create) next = p.create;
    else if (p.detach) next = '';
    else if (!p.paths && p.positional.length) {
      const target = p.positional[0];
      if (target === '-') next = prev !== undefined ? prev : previousBranch(root);
      else if (s.sub === 'switch' || anyBranchExists(root, target)) next = target;
    }
    if (next !== cur) prev = cur;
    cur = next;
    steps.push({ at: s.start, branch: cur });
  }
  return (pos) => {
    let b = start;
    for (const st of steps) if (st.at < pos) b = st.branch;
    return b;
  };
};

// 지금 브랜치(분리된 HEAD 는 ''). HEAD 파일을 먼저 읽고 애매할 때만 git 에게 묻는다(core.mjs repoState).
export const currentBranch = (root) => repoState(root).branch();

// 명령 안에서 switch·checkout 으로 브랜치가 바뀌면 그 뒤 commit·push 는 바뀐 브랜치에서 돈다. 반환은 branchTimeline 과 같다.
// repo: 이 도구 호출에서 나눠 쓰는 저장소 상태(ctx.repo) — 없으면 여기서 만든다.
export const timelineOf = (cmd, shell, root, repo = repoState(root)) => {
  const switches = ['switch', 'checkout'].flatMap((sub) => gitSegments(cmd, sub, shell).map((s) => ({ ...s, sub }))).sort((a, b) => a.start - b.start);
  return branchTimeline(root, repo.branch(), switches);
};
