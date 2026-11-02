// git 협업 규칙: add 전체 금지, 보호 브랜치, 커밋 메시지 형식, 브랜치 이름.
import { git } from '../lib/core.mjs';

const GIT = String.raw`\bgit\s+(?:-C\s+\S+\s+)?`;
const has = (cmd, sub) => new RegExp(GIT + sub + String.raw`\b`).test(cmd);

export const addAll = {
  id: 'git-add-all',
  on: 'shell',
  check({ cmd, t }) {
    if (new RegExp(GIT + String.raw`add\s+(?:[^|;&\n]*\s)?(?:-A\b|--all\b|\.(?=\s|$|[;&|])|\*)`).test(cmd)) return t('git.addAll');
    const seg = cmd.match(new RegExp(GIT + String.raw`commit\b([^;&|\n]*)`));
    if (seg && /(?:^|\s)-[a-zA-Z]*a[a-zA-Z]*\b|\s--all\b/.test(seg[1])) return t('git.commitAll');
    return null;
  },
};

const currentBranch = (root) => (git(root, ['symbolic-ref', '--short', 'HEAD']) || '').trim();
const hasCommits = (root) => git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']) !== null;

export const protectBranch = {
  id: 'protect-branch',
  on: 'shell',
  check({ cmd, root, opts, t }) {
    if (!root) return null;
    const branches = opts.branches || ['main', 'master'];
    const isProtected = (b) => branches.includes(b);
    const branch = currentBranch(root);
    const switching = new RegExp(GIT + String.raw`(?:checkout\s+-[bB]|switch\s+-[cC])\s`).test(cmd);

    if (has(cmd, 'commit') && !switching && isProtected(branch) && hasCommits(root) && !opts.allowCommit) {
      return t('git.protectedCommit', { branch });
    }
    const push = cmd.match(new RegExp(GIT + String.raw`push\b([^;&|\n]*)`));
    if (push) {
      const args = push[1];
      const targets = args.split(/\s+/).filter((a) => a && !a.startsWith('-')).slice(1).map((a) => a.replace(/^\+/, '').split(':').pop());
      const hitsProtected = targets.length ? targets.some(isProtected) : isProtected(branch);
      const force = /(?:^|\s)(?:-f|--force(?!-with-lease))\b|\s\+\S/.test(args);
      if (hitsProtected && force) return t('git.protectedForce');
      if (hitsProtected && opts.noDirectPush) return t('git.protectedPush');
    }
    return null;
  },
};

// 커밋 메시지를 명령에서 꺼낸다. -m/--message 여러 개, heredoc. 꺼낼 수 없으면(편집기·-F 파일) null.
export const commitMessage = (cmd) => {
  const seg = cmd.match(new RegExp(GIT + String.raw`commit\b([\s\S]*)`));
  if (!seg) return null;
  const rest = seg[1];
  const doc = rest.match(/<<-?\s*['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\s*\1\b/);
  if (doc) return doc[2].trim();
  const parts = [...rest.matchAll(/(?:-m|--message)(?:=|\s+)(?:"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+))/g)].map((m) => m[1] ?? m[2] ?? m[3]);
  return parts.length ? parts.join('\n\n').trim() : null;
};

const CONVENTIONAL = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([\w\-./ ]+\))?!?: \S/;
const HANGUL = /[가-힣]/;

export const commitMsg = {
  id: 'commit-msg',
  on: 'shell',
  check({ cmd, opts, t }) {
    if (!has(cmd, 'commit') || /--no-edit\b|--fixup\b|--squash\b/.test(cmd)) return null;
    const msg = commitMessage(cmd);
    if (msg === null) return null;
    const subject = msg.split('\n')[0];
    const style = opts.style || 'conventional';
    if (style === 'conventional' && !CONVENTIONAL.test(subject)) return t('git.msgConventional', { subject });
    if (opts.lang === 'ko' && !HANGUL.test(msg)) return t('git.msgKorean');
    if (opts.lang === 'en' && HANGUL.test(msg)) return t('git.msgEnglish');
    const max = opts.maxSubject || 72;
    if (subject.length > max) return t('git.msgLong', { len: subject.length, max });
    return null;
  },
};

// 대문자·숫자·하위 경로 허용(feature/JIRA-123, fix/api/empty). 시작 부분만 강제한다.
export const DEFAULT_BRANCH_PATTERN = '^(feature|feat|fix|hotfix|release|chore|docs|refactor|test)/[A-Za-z0-9][A-Za-z0-9._/-]*$';

export const branchName = {
  id: 'branch-name',
  on: 'shell',
  check({ cmd, opts, t }) {
    const m =
      cmd.match(new RegExp(GIT + String.raw`(?:checkout\s+-[bB]|switch\s+-[cC]|branch)\s+["']?([^\s"';&|]+)`));
    if (!m || m[1].startsWith('-')) return null;
    const pattern = opts.pattern || DEFAULT_BRANCH_PATTERN;
    return new RegExp(pattern).test(m[1]) ? null : t('git.branchName', { name: m[1], pattern });
  },
};

// 커밋 전 검사(pre-commit 훅)를 건너뛰지 않는다. commit 의 -n 도 --no-verify 다(push 의 -n 은 dry-run 이라 보지 않음).
export const noVerify = {
  id: 'no-verify',
  on: 'shell',
  check({ cmd, t }) {
    const skip = new RegExp(GIT + String.raw`(?:(?:commit|push|merge|rebase)\b[^;&|\n]*\s--no-verify|commit\b[^;&|\n]*\s-n)(?=\s|$)`);
    return skip.test(cmd) ? t('git.noVerify') : null;
  },
};

export default [addAll, protectBranch, commitMsg, branchName, noVerify];
