// git 협업 규칙: add 전체 금지, 보호 브랜치, 브랜치 이름. 커밋 메시지는 message.mjs, 검사 건너뛰기는 no-verify.mjs.
// 옵션은 따옴표를 비운 인자(bare)에서, 브랜치·경로 같은 값은 따옴표를 벗긴 낱말(words)에서 읽는다
// — 커밋 메시지 속 `-n`·`-a` 를 옵션으로 읽지 않고, `"main"` 처럼 따옴표 친 값도 놓치지 않게.
// 명령은 셸(bash·PowerShell)마다 따옴표를 다르게 읽으므로 check 가 받은 shell 을 그대로 넘긴다.
import fs from 'node:fs';
import path from 'node:path';
import { git, shortFlags, gitSegments } from '../lib/core.mjs';
import { ADD_SUB, commitStagesAll } from '../lib/staged.mjs';
import { branchCreated, worktreeCreated, parseSwitch, branchTimeline, anyBranchExists } from '../lib/branches.mjs';
import { commitMsg, commitMessage } from './message.mjs';
import { noVerify } from './no-verify.mjs';

// 보호 브랜치 기본값(화면의 옵션 기본값과 같아야 한다 — scripts/test/hook-options.test.mjs)
export const DEFAULT_PROTECTED = ['main', 'master'];

export { commitMessage };

// 전체를 add 하는 경로. `*.md` 같은 패턴은 고른 것이라 두고, 맨 `*`·`.`·저장소 맨 위(`:/`)만 전체로 본다.
const ADD_ALL_PATHS = new Set(['.', './', '.\\', '*', './*', '.\\*', ':/', ':']);
const ADD_ALL_LONG = new Set(['--all', '--no-ignore-removal']);

export const addAll = {
  id: 'git-add-all',
  on: 'shell',
  check({ cmd, shell, t }) {
    for (const { words } of gitSegments(cmd, ADD_SUB, shell)) {
      const short = shortFlags(words.filter((w) => /^-[A-Za-z]/.test(w)).join(' '));
      if (short.has('A') || words.some((w) => ADD_ALL_LONG.has(w) || ADD_ALL_PATHS.has(w))) return t('git.addAll');
      // 경로 없는 -u(--update)는 추적 중인 변경을 모두 올린다(commit -a 와 같다)
      const paths = words.filter((w) => !w.startsWith('-'));
      if ((short.has('u') || words.includes('--update')) && !paths.length) return t('git.addAll');
    }
    if (gitSegments(cmd, 'commit', shell).some((c) => commitStagesAll(c.bare))) return t('git.commitAll');
    return null;
  },
};

const currentBranch = (root) => (git(root, ['symbolic-ref', '--short', 'HEAD']) || '').trim();
const hasCommits = (root) => git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']) !== null;

// 명령 안에서 switch·checkout 으로 브랜치가 바뀌면 그 뒤 commit·push 는 바뀐 브랜치에서 돈다.
export const timelineOf = (cmd, shell, root) => {
  const switches = ['switch', 'checkout'].flatMap((sub) => gitSegments(cmd, sub, shell).map((s) => ({ ...s, sub }))).sort((a, b) => a.start - b.start);
  return branchTimeline(root, currentBranch(root), switches);
};

// push 에서 값을 받는 옵션. 그 다음 낱말은 원격·refspec 이 아니다.
const PUSH_VALUE_OPTS = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
// --force-with-lease 도 보호 브랜치에서는 강제 push 로 본다(올린 기록을 다시 쓰는 것은 같다).
const PUSH_FORCE_LONG = /^--force(?:-with-lease(?:=.*)?)?$/;
const PUSH_ALL = /^--(?:all|mirror|branches)$/;
// 원격 브랜치 지우기: --delete·-d, 또는 보낼 쪽이 빈 refspec(`:main`).
const PUSH_DELETE_LONG = '--delete';
const EMPTY_SOURCE = /^:[^:]/;

// push 낱말(따옴표 벗긴 것) → { force, all, targets: [{ ref, plus, del }] }. refspec 이 없으면 targets 는 빈 배열(지금 브랜치).
export const parsePush = (words, branch) => {
  const positional = [];
  const flags = [];
  for (let i = 0; i < words.length; i++) {
    if (PUSH_VALUE_OPTS.has(words[i])) i++;
    else if (words[i].startsWith('-')) flags.push(words[i]);
    else positional.push(words[i]);
  }
  const short = shortFlags(flags.filter((f) => !f.startsWith('--')).join(' '), 'o');
  const deleting = short.has('d') || flags.includes(PUSH_DELETE_LONG);
  const targets = positional.slice(1).map((spec) => {
    const plus = spec.startsWith('+');
    const raw = spec.replace(/^\+/, '');
    let ref = (raw.includes(':') ? raw.split(':').pop() : raw).replace(/^refs\/heads\//, '');
    // HEAD·@, 그리고 명령으로 구한 이름($(git branch --show-current), PowerShell (git …))은 지금 브랜치다
    if (ref === 'HEAD' || ref === '@' || /\$\(|`/.test(raw) || raw.startsWith('(')) ref = branch;
    return { ref, plus, del: deleting || EMPTY_SOURCE.test(raw) };
  });
  const force = short.has('f') || flags.some((f) => PUSH_FORCE_LONG.test(f));
  // --tags 만 주면 태그만 올린다(브랜치는 안 올림)
  const tagsOnly = !targets.length && flags.includes('--tags');
  return { force, targets, all: flags.some((f) => PUSH_ALL.test(f)), tagsOnly };
};

// cherry-pick·revert·am 도 지금 브랜치에 커밋을 만든다(merge·pull·rebase 는 합치기·따라가기라 보지 않는다 — Git Flow 는 main·develop 에서 합친다).
// 커밋을 만들지 않는 꼴: cherry-pick·revert 의 -n·--no-commit(줄임 포함), --abort·--quit, am 의 --abort·--quit·--show-current-patch.
// --continue·--skip(am 은 --resolved·-r 도)은 남은 커밋을 만든다 — 진행 중인 것이 없거나, 시작할 때 -n 이었으면(.git/sequencer/opts) 만들지 않는다.
const PICK_SUBS = ['cherry-pick', 'revert', 'am'];
const longIs = (w, name, min) => w.length >= min && w.startsWith('--') && `--${name}`.startsWith(w);
const PICK_STOP = (w) => longIs(w, 'abort', 4) || longIs(w, 'quit', 4) || longIs(w, 'show-current-patch', 4) || w.startsWith('--show-current-patch=');
const PICK_RESUME = (sub, w) => longIs(w, 'continue', 5) || longIs(w, 'skip', 4) || (sub === 'am' && (longIs(w, 'resolved', 4) || w === '-r'));
// 다음 낱말·붙은 글자를 값으로 받는 짧은 옵션(-m 부모 번호, -X 전략 옵션, -S 키). 그 뒤 글자는 옵션이 아니다.
const PICK_VALUE_SHORT = { 'cherry-pick': 'mXS', revert: 'mXS', am: 'pCS' };
const pickNoCommit = (sub, words) => {
  if (sub === 'am') return false;
  for (const w of words) {
    if (w === '--') break;
    if (longIs(w, 'no-commit', 5)) return true;
    if (/^-[A-Za-z]/.test(w) && !w.startsWith('--') && shortFlags(w, PICK_VALUE_SHORT[sub]).has('n')) return true;
  }
  return false;
};
const gitFile = (root, name) => {
  const out = git(root, ['rev-parse', '--git-path', name]);
  return out === null ? null : path.resolve(root, out.trim());
};
const readOr = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
// 이어 하기(--continue·--skip)가 커밋을 만들까: 진행 중인 것이 있고, -n 으로 시작하지 않았을 때
const resumeCommits = (root, sub) => {
  if (sub === 'am') { const d = gitFile(root, 'rebase-apply'); return !!d && fs.existsSync(path.join(d, 'applying')); }
  const opts = readOr(gitFile(root, path.join('sequencer', 'opts')) || '');
  if (opts !== null) return !/^\s*no-commit\s*=\s*true\s*$/m.test(opts);
  const head = gitFile(root, sub === 'revert' ? 'REVERT_HEAD' : 'CHERRY_PICK_HEAD');
  return !!head && fs.existsSync(head);
};
// 이 조각이 커밋을 만드는지
export const pickCommits = (root, sub, words) => {
  if (words.some(PICK_STOP)) return false;
  if (words.some((w) => PICK_RESUME(sub, w))) return resumeCommits(root, sub);
  if (pickNoCommit(sub, words)) return false;
  return true;
};

export const protectBranch = {
  id: 'protect-branch',
  on: 'shell',
  check({ cmd, shell, root, opts, t }) {
    if (!root) return null;
    const branches = Array.isArray(opts.branches) ? opts.branches : DEFAULT_PROTECTED;
    const isProtected = (b) => branches.includes(b);
    const branchAt = timelineOf(cmd, shell, root);

    if (!opts.allowCommit && hasCommits(root)) {
      for (const c of gitSegments(cmd, 'commit', shell)) {
        const branch = branchAt(c.start);
        if (isProtected(branch)) return t('git.protectedCommit', { branch });
      }
      for (const sub of PICK_SUBS) for (const c of gitSegments(cmd, sub, shell)) {
        const branch = branchAt(c.start);
        if (isProtected(branch) && pickCommits(root, sub, c.words)) return t('git.protectedPick', { branch, sub });
      }
    }
    for (const { words, start } of gitSegments(cmd, 'push', shell)) {
      const branch = branchAt(start);
      const { force, targets, all, tagsOnly } = parsePush(words, branch);
      if (tagsOnly) continue;
      const hit = targets.filter((x) => isProtected(x.ref));
      // 보호 브랜치를 원격에서 지우는 것은 noDirectPush 설정과 상관없이 막는다.
      const deleted = hit.find((x) => x.del);
      if (deleted) return t('git.protectedDelete', { branch: deleted.ref });
      const hitsProtected = all || (targets.length ? hit.length > 0 : isProtected(branch));
      if ((hitsProtected && force) || hit.some((x) => x.plus)) return t('git.protectedForce');
      if (hitsProtected && opts.noDirectPush) return t('git.protectedPush');
    }
    return null;
  },
};

// 대문자·숫자·하위 경로 허용(feature/JIRA-123, fix/api/empty). 시작 부분만 강제한다.
// catalog/packs.json 의 GitHub Flow 패턴·branch-name 설명과 같은 목록이다.
export const DEFAULT_BRANCH_PATTERN = '^(feature|feat|fix|hotfix|chore|docs|refactor|test)/[A-Za-z0-9][A-Za-z0-9._/-]*$';
// 기본 브랜치(main·master·develop)는 이름 규칙과 상관없이 만들 수 있다(새 저장소, Git Flow 의 develop).
export const DEFAULT_BASE_BRANCHES = ['main', 'master', 'develop'];
// 안내 문구 예시 후보. 지금 쓰는 패턴에 맞는 것만 보여 준다(Git Flow 에서는 fix/ 가 안 맞으므로).
const BRANCH_EXAMPLES = ['feature/login', 'fix/empty-cart', 'bugfix/empty-cart', 'hotfix/crash-on-start', 'release/1.2.0'];
const MAX_EXAMPLES = 2;

export const branchExamples = (pattern) => {
  const re = new RegExp(pattern);
  return BRANCH_EXAMPLES.filter((b) => re.test(b)).slice(0, MAX_EXAMPLES);
};

// 이 명령이 새로 만드는 브랜치 이름들: checkout -b/-B/--orphan, switch -c/-C/--create/--orphan,
// branch <이름>·branch -m/-M/-c/-C [옛] <새>, worktree add -b/-B <이름> 또는 브랜치를 안 준 worktree add <경로>, stash branch <이름>.
export const createdBranches = (cmd, shell, root) => {
  const names = [];
  for (const sub of ['checkout', 'switch']) for (const s of gitSegments(cmd, sub, shell)) {
    const p = parseSwitch(sub, s.words);
    if (p.create !== undefined) names.push(p.create);
  }
  for (const s of gitSegments(cmd, 'branch', shell)) {
    const n = branchCreated(s.words);
    if (n) names.push(n);
  }
  for (const s of gitSegments(cmd, 'worktree', shell)) {
    const w = worktreeCreated(s.words);
    if (w && !(w.fromPath && (!root || anyBranchExists(root, w.name)))) names.push(w.name);
  }
  for (const s of gitSegments(cmd, 'stash', shell)) if (s.words[0] === 'branch' && s.words[1]) names.push(s.words[1]);
  return names.filter((n) => typeof n === 'string');
};

export const branchName = {
  id: 'branch-name',
  on: 'shell',
  check({ cmd, shell, root, opts, t }) {
    const pattern = opts.pattern || DEFAULT_BRANCH_PATTERN;
    const re = new RegExp(pattern);
    const base = opts.allow || DEFAULT_BASE_BRANCHES;
    // 변수가 든 이름($name, fix/$issue)은 값을 알 수 없어 보지 않는다(packs.json detail 에 적어 둔다).
    const bad = createdBranches(cmd, shell, root).find((n) => n && !n.includes('$') && !n.startsWith('-') && !base.includes(n) && !re.test(n));
    if (bad === undefined) return null;
    const examples = branchExamples(pattern).map((b) => `\`${b}\``).join(', ');
    return examples ? t('git.branchName', { name: bad, pattern, examples }) : t('git.branchNameNoExample', { name: bad, pattern });
  },
};

export default [addAll, protectBranch, commitMsg, branchName, noVerify];
