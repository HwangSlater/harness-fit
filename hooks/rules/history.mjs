// 이력 규칙: 이미 올린 커밋 다시 쓰지 않기(amend·rebase). PR 병합 방식(pr-merge)은 지웠다 — 병합은 사람이 하고(self-merge) 방식은 GitHub 설정(스쿼시만·브랜치 자동 삭제)이 맡는다(마지막 점검 2026-11-26).
// 강제 push 는 여기서 보지 않는다 — 보호 브랜치(protect-branch)가 본다. 기능 브랜치에 rebase 뒤 강제 push 하는 것은
// 그 앞의 rebase 를 여기서 막는다.
// git 이 실패하면(저장소가 아님·원격 없음·upstream 없음) 막지 않는다.
import { git, gitSegments } from '../lib/core.mjs';
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

export default [noRewritePushed];
