// 이력 규칙: 이미 올린 커밋 다시 쓰지 않기(amend·rebase), PR 합치기 방식(squash + 브랜치 지우기).
// 강제 push 는 여기서 보지 않는다 — 보호 브랜치(protect-branch)가 본다. 기능 브랜치에 rebase 뒤 강제 push 하는 것은
// 그 앞의 rebase 를 여기서 막는다.
// git 이 실패하면(저장소가 아님·원격 없음·upstream 없음) 막지 않는다.
import { git, gitSegments } from '../lib/core.mjs';
import { commandSegments } from '../lib/cmdline.mjs';
import { commandWords } from '../lib/commit-args.mjs';
import { timelineOf } from '../lib/branches.mjs';

// 이 커밋을 가진 원격 브랜치 하나(origin/HEAD -> … 줄은 뺀다). 없거나 git 이 실패하면 null.
const remoteWith = (root, rev) => {
  const out = git(root, ['branch', '-r', '--contains', rev]);
  if (!out) return null;
  return out.split('\n').map((s) => s.trim()).find((s) => s && !s.includes(' -> ')) || null;
};
const firstLine = (s) => (s || '').split('\n').map((x) => x.trim()).find(Boolean) || null;

// git 은 헷갈리지 않는 긴 옵션 줄임을 받는다(--am·--ame·--amen = --amend)
const AMEND = /(?:^|\s)--am(?:e(?:nd?)?)?(?=\s|$)/;
// 진행 중인 rebase 를 이어 가거나 멈추는 것은 새로 다시 쓰는 것이 아니다
const REBASE_CONTROL = new Set(['--continue', '--abort', '--skip', '--quit', '--edit-todo', '--show-current-patch']);
// 값을 받는 옵션(다음 낱말은 upstream·branch 가 아니다)
const REBASE_VALUE = new Set(['--onto', '-s', '--strategy', '-X', '--strategy-option', '-x', '--exec', '-C']);

// 이미 최신이어도 커밋을 새로 만드는 옵션(편집 목록·명령 실행·강제)
const REBASE_REWRITES = /^(?:-i|--interactive|-x|--exec|-f|--force-rebase|--no-ff|--onto)$/;

// rebase 낱말 → { control, root, rewrites, upstream, branch }
export const parseRebase = (words) => {
  const positional = [];
  let root = false;
  let control = false;
  let rewrites = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (REBASE_REWRITES.test(w) || /^-[a-z]*i/.test(w)) rewrites = true;
    if (REBASE_CONTROL.has(w)) control = true;
    else if (REBASE_VALUE.has(w)) i++;
    else if (w === '--root') root = true;
    else if (!w.startsWith('-')) positional.push(w);
  }
  return { control, root, rewrites, upstream: positional[0] || null, branch: positional[1] || null };
};

// rebase 가 다시 쓰는 커밋 가운데 가장 오래된 것. 아무것도 다시 쓰지 않으면 null.
const oldestRewritten = (root, r) => {
  const tip = r.branch || 'HEAD';
  if (r.root) return firstLine(git(root, ['rev-list', '--max-parents=0', tip, '--']));
  const upstream = firstLine(git(root, ['rev-parse', '--verify', '--quiet', `${r.upstream || '@{upstream}'}^{commit}`]));
  const base = upstream && firstLine(git(root, ['merge-base', upstream, tip]));
  if (!base) return null;
  // upstream 이 이미 조상이면 git 은 「최신」이라며 아무것도 다시 쓰지 않는다(편집·강제 옵션이 없을 때)
  if (base === upstream && !r.rewrites) return null;
  return firstLine(git(root, ['rev-list', '--reverse', `${base}..${tip}`, '--']));
};

export const noRewritePushed = {
  id: 'no-rewrite-pushed',
  on: 'shell',
  check({ cmd, shell, root, repo, t }) {
    if (!root) return null;
    // 브랜치 흐름은 amend 가 있을 때만 구한다(지금 브랜치를 묻는 일이 없게 — git status·보통 커밋)
    let branchAt;
    for (const s of gitSegments(cmd, 'commit', shell)) {
      if (!AMEND.test(s.bare)) continue;
      branchAt ??= timelineOf(cmd, shell, root, repo || undefined);
      // 같은 명령에서 다른 브랜치로 옮긴 뒤 amend 하면 그 브랜치 끝 커밋을 본다
      const remote = remoteWith(root, branchAt(s.start) || 'HEAD');
      if (remote) return t('history.amend', { remote });
    }
    for (const { words } of gitSegments(cmd, 'rebase', shell)) {
      const r = parseRebase(words);
      if (r.control || [r.upstream, r.branch].some((x) => x && x.startsWith('-'))) continue;
      const oldest = oldestRewritten(root, r);
      const remote = oldest && remoteWith(root, oldest);
      if (remote) return t('history.rebase', { remote });
    }
    return null;
  },
};

// gh pr merge: 명령 자리(줄 처음, ; & | ( 뒤, PowerShell & 호출)에 있을 때만
const FLOW_WORDS = new Set(['if', 'while', 'until', 'elif']);
const GH_VALUE = new Set(['-b', '--body', '-F', '--body-file', '-t', '--subject', '-A', '--author-email', '--match-head-commit', '-R', '--repo']);
const GH_VALUE_SHORT = 'bFtAR';

// gh pr merge 낱말 → { squash, del }
export const parsePrMerge = (words) => {
  let squash = false;
  let del = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (GH_VALUE.has(w)) i++;
    else if (w === '--squash' || w === '--squash=true') squash = true;
    else if (w === '--delete-branch' || w === '--delete-branch=true') del = true;
    else if (/^-[A-Za-z]/.test(w)) {
      for (const ch of w.slice(1)) {
        if (ch === 's') squash = true;
        if (ch === 'd') del = true;
        if (GH_VALUE_SHORT.includes(ch)) break;
      }
    }
  }
  return { squash, del };
};

export const prMerge = {
  id: 'pr-merge',
  on: 'shell',
  check({ cmd, shell, t }) {
    // 명령 조각마다: 앞붙은 환경 변수·흐름 낱말(if·then·{)을 떼고, gh 의 -R/--repo 를 건너뛴 뒤 pr merge 인지 본다.
    for (const seg of commandSegments(cmd, shell)) {
      let w = commandWords(seg.words);
      while (FLOW_WORDS.has(w[0])) w = commandWords(w.slice(1));
      if (!/^(?:.*[\\/])?gh(?:\.exe)?$/i.test(w[0] || '')) continue;
      let i = 1;
      while (/^(?:-R|--repo)$/.test(w[i] || '') || /^--repo=/.test(w[i] || '')) i += w[i].includes('=') ? 1 : 2;
      if (w[i] !== 'pr' || w[i + 1] !== 'merge') continue;
      const { squash, del } = parsePrMerge(w.slice(i + 2));
      const missing = [squash ? null : '`--squash`', del ? null : '`--delete-branch`'].filter(Boolean);
      if (missing.length) return t('prMerge.missing', { missing: missing.join(' · ') });
    }
    return null;
  },
};

export default [noRewritePushed, prMerge];
