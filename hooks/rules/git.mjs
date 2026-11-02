// git 협업 규칙: add 전체 금지, 보호 브랜치, 커밋 메시지 형식, 브랜치 이름.
// 옵션은 따옴표를 비운 인자(bare)에서, 브랜치·경로 같은 값은 따옴표를 벗긴 낱말(words)에서 읽는다
// — 커밋 메시지 속 `-n`·`-a` 를 옵션으로 읽지 않고, `"main"` 처럼 따옴표 친 값도 놓치지 않게.
// 명령은 셸(bash·PowerShell)마다 따옴표를 다르게 읽으므로 check 가 받은 shell 을 그대로 넘긴다.
import { git, GIT, SUB_END, BASH, stripQuoted, shortFlags, gitSegments } from '../lib/core.mjs';
import { heredocs } from '../lib/cmdline.mjs';
import { ADD_SUB, COMMIT_VALUE_FLAGS, COMMIT_NEXT_VALUE, COMMIT_LONG_VALUE, commitStagesAll } from '../lib/staged.mjs';

const has = (cmd, sub, shell) => new RegExp(GIT + sub + SUB_END).test(stripQuoted(cmd, shell));

// 전체를 add 하는 경로. `*.md` 같은 패턴은 고른 것이라 두고, 맨 `*`·`.`·저장소 맨 위(`:/`)만 전체로 본다.
const ADD_ALL_PATHS = new Set(['.', './', '.\\', '*', ':/']);
const ADD_ALL_LONG = new Set(['--all', '--no-ignore-removal']);

export const addAll = {
  id: 'git-add-all',
  on: 'shell',
  check({ cmd, shell, t }) {
    for (const { words } of gitSegments(cmd, ADD_SUB, shell)) {
      const short = shortFlags(words.filter((w) => /^-[A-Za-z]/.test(w)).join(' '));
      if (short.has('A') || words.some((w) => ADD_ALL_LONG.has(w) || ADD_ALL_PATHS.has(w))) return t('git.addAll');
    }
    if (gitSegments(cmd, 'commit', shell).some((c) => commitStagesAll(c.bare))) return t('git.commitAll');
    return null;
  },
};

const currentBranch = (root) => (git(root, ['symbolic-ref', '--short', 'HEAD']) || '').trim();
const hasCommits = (root) => git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']) !== null;

// push 에서 값을 받는 옵션. 그 다음 낱말은 원격·refspec 이 아니다.
const PUSH_VALUE_OPTS = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
// --force-with-lease 도 보호 브랜치에서는 강제 push 로 본다(올린 기록을 다시 쓰는 것은 같다).
const PUSH_FORCE_LONG = /^--force(?:-with-lease(?:=.*)?)?$/;
const PUSH_ALL = /^--(?:all|mirror)$/;
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
    if (ref === 'HEAD' || ref === '@') ref = branch;
    return { ref, plus, del: deleting || EMPTY_SOURCE.test(raw) };
  });
  const force = short.has('f') || flags.some((f) => PUSH_FORCE_LONG.test(f));
  return { force, targets, all: flags.some((f) => PUSH_ALL.test(f)) };
};

export const protectBranch = {
  id: 'protect-branch',
  on: 'shell',
  check({ cmd, shell, root, opts, t }) {
    if (!root) return null;
    const bare = stripQuoted(cmd, shell);
    const branches = opts.branches || ['main', 'master'];
    const isProtected = (b) => branches.includes(b);
    const branch = currentBranch(root);
    const switching = new RegExp(GIT + String.raw`(?:checkout\s+-[bB]|switch\s+-[cC])\s`).test(bare);

    if (has(cmd, 'commit', shell) && !switching && isProtected(branch) && hasCommits(root) && !opts.allowCommit) {
      return t('git.protectedCommit', { branch });
    }
    for (const { words } of gitSegments(cmd, 'push', shell)) {
      const { force, targets, all } = parsePush(words, branch);
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

// 커밋 메시지를 명령에서 꺼낸다. -m/--message 여러 개, -am 같은 묶음, bash heredoc(`-F - <<EOF`,
// `-m "$(cat <<'EOF' … EOF)"`), PowerShell here-string(`-m @'…'@`). 꺼낼 수 없으면(편집기·-F 파일) null.
const MESSAGE_LONG = '--message';
const MESSAGE_SHORT = 'm';
// 낱말 목록에서 -m 값들. 다른 옵션의 값(-F 파일, --author 이름)은 건너뛴다.
const messageParts = (words) => {
  const parts = [];
  for (let i = 0; i < words.length && words[i] !== '--'; i++) {
    const w = words[i];
    if (w === MESSAGE_LONG) parts.push(words[++i] ?? '');
    else if (w.startsWith(MESSAGE_LONG + '=')) parts.push(w.slice(MESSAGE_LONG.length + 1));
    else if (COMMIT_LONG_VALUE.has(w)) i++;
    else if (/^-[A-Za-z]/.test(w)) {
      for (let k = 1; k < w.length; k++) {
        if (w[k] === MESSAGE_SHORT) {
          parts.push(k + 1 < w.length ? w.slice(k + 1) : (words[++i] ?? ''));
          break;
        }
        if (COMMIT_VALUE_FLAGS.includes(w[k])) {
          if (k + 1 === w.length && COMMIT_NEXT_VALUE.includes(w[k])) i++;
          break;
        }
      }
    }
  }
  return parts;
};

export const commitMessage = (cmd, shell = BASH) => {
  const [seg] = gitSegments(cmd, 'commit', shell);
  if (!seg) return null;
  const end = seg.start + seg.raw.length;
  const doc = shell === BASH && heredocs(cmd).find((h) => h.op >= seg.start && h.op < end);
  if (doc) return doc.body.trim();
  const parts = messageParts(seg.words);
  return parts.length ? parts.join('\n\n').trim() : null;
};

const CONVENTIONAL = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([\w\-./ ]+\))?!?: \S/;
const HANGUL = /[가-힣]/;
const DEFAULT_MAX_SUBJECT = 72;

export const commitMsg = {
  id: 'commit-msg',
  on: 'shell',
  check({ cmd, shell, opts, t }) {
    if (!has(cmd, 'commit', shell) || /--no-edit\b|--fixup\b|--squash\b/.test(stripQuoted(cmd, shell))) return null;
    const msg = commitMessage(cmd, shell);
    if (msg === null) return null;
    const subject = msg.split('\n')[0];
    const style = opts.style || 'conventional';
    if (style === 'conventional' && !CONVENTIONAL.test(subject)) return t('git.msgConventional', { subject });
    if (opts.lang === 'ko' && !HANGUL.test(msg)) return t('git.msgKorean');
    if (opts.lang === 'en' && HANGUL.test(msg)) return t('git.msgEnglish');
    const max = opts.maxSubject || DEFAULT_MAX_SUBJECT;
    if (subject.length > max) return t('git.msgLong', { len: subject.length, max });
    return null;
  },
};

// 대문자·숫자·하위 경로 허용(feature/JIRA-123, fix/api/empty). 시작 부분만 강제한다.
// catalog/packs.json 의 GitHub Flow 패턴·branch-name 설명과 같은 목록이다.
export const DEFAULT_BRANCH_PATTERN = '^(feature|feat|fix|hotfix|chore|docs|refactor|test)/[A-Za-z0-9][A-Za-z0-9._/-]*$';
// 안내 문구 예시 후보. 지금 쓰는 패턴에 맞는 것만 보여 준다(Git Flow 에서는 fix/ 가 안 맞으므로).
const BRANCH_EXAMPLES = ['feature/login', 'fix/empty-cart', 'bugfix/empty-cart', 'hotfix/crash-on-start', 'release/1.2.0'];
const MAX_EXAMPLES = 2;

export const branchExamples = (pattern) => {
  const re = new RegExp(pattern);
  return BRANCH_EXAMPLES.filter((b) => re.test(b)).slice(0, MAX_EXAMPLES);
};

export const branchName = {
  id: 'branch-name',
  on: 'shell',
  check({ cmd, shell, opts, t }) {
    const m = stripQuoted(cmd, shell).match(new RegExp(GIT + String.raw`(?:checkout\s+-[bB]|switch\s+-[cC]|branch)\s+([^\s"';&|]+)`))
      || cmd.match(new RegExp(GIT + String.raw`(?:checkout\s+-[bB]|switch\s+-[cC]|branch)\s+["']([^\s"';&|]+)["']`));
    if (!m || m[1].startsWith('-')) return null;
    const pattern = opts.pattern || DEFAULT_BRANCH_PATTERN;
    if (new RegExp(pattern).test(m[1])) return null;
    const examples = branchExamples(pattern).map((b) => `\`${b}\``).join(', ');
    return examples ? t('git.branchName', { name: m[1], pattern, examples }) : t('git.branchNameNoExample', { name: m[1], pattern });
  },
};

// 커밋 전 검사(pre-commit 훅)를 건너뛰지 않는다. commit 의 -n 도 --no-verify 다(push 의 -n 은 dry-run 이라 보지 않음).
const NO_VERIFY = /(?:^|\s)--no-verify(?=\s|$)/;
export const noVerify = {
  id: 'no-verify',
  on: 'shell',
  check({ cmd, shell, t }) {
    const skip =
      gitSegments(cmd, 'commit|push|merge|rebase', shell).some((s) => NO_VERIFY.test(s.bare)) ||
      gitSegments(cmd, 'commit', shell).some((s) => shortFlags(s.bare, COMMIT_VALUE_FLAGS).has('n'));
    return skip ? t('git.noVerify') : null;
  },
};

export default [addAll, protectBranch, commitMsg, branchName, noVerify];
