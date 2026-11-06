// 이번 사람 턴에 만든 커밋: HEAD 의 reflog 에서 턴이 시작된 뒤 커밋을 만든 기록(commit·cherry-pick·revert·merge 커밋)을 골라,
// 아직 브랜치에 남아 있는 것만(amend·reset 으로 버린 옛 커밋은 뺀다). 커밋 해시 알리기·문서 검사가 함께 쓴다.
// git 의 committer 날짜가 아니라 reflog(이 저장소에서 HEAD 가 움직인 때)를 본다 — pull 로 받은 남의 커밋은 들어가지 않는다.
import { git } from './core.mjs';

const REFLOG_MAX = 200;
// reflog 제목 중 새 커밋을 만든 것
const MAKES_COMMIT = /^(?:commit(?: \([^)]*\))?|cherry-pick|revert): |^(?:merge|pull)\b[^:]*: Merge made/;
// 브랜치에 남았는지 볼 때 committer 날짜 여유(시계 차이)
const SLACK_S = 3600;

const lines = (out) => (out || '').split('\n').filter(Boolean);

// → [{ hash, short, subject, at(초) }] 최신 순, 겹침 없이
export const turnCommits = (root, sinceMs) => {
  if (!root || !Number.isFinite(sinceMs)) return [];
  const since = Math.floor(sinceMs / 1000);
  const made = [];
  const seen = new Set();
  for (const l of lines(git(root, ['reflog', 'show', '--date=unix', '--format=%H%x09%h%x09%gd%x09%gs', '-n', String(REFLOG_MAX), 'HEAD', '--']))) {
    const [hash, short, sel, gs] = l.split('\t');
    const at = Number((sel || '').match(/@\{(\d+)\}$/)?.[1]);
    if (!Number.isFinite(at)) continue;
    if (at < since) break; // reflog 는 최신 순이다
    if (!MAKES_COMMIT.test(gs || '') || seen.has(hash)) continue;
    seen.add(hash);
    made.push({ hash, short, at });
  }
  if (!made.length) return [];
  // 브랜치(또는 지금 HEAD)에 남은 것만, 제목과 함께
  const alive = new Set(lines(git(root, ['rev-list', '--branches', 'HEAD', `--since=${new Date((since - SLACK_S) * 1000).toISOString()}`])));
  const subjects = new Map(lines(git(root, ['log', '--no-walk=unsorted', '--format=%H%x09%s', ...made.map((c) => c.hash), '--'])).map((l) => [l.slice(0, l.indexOf('\t')), l.slice(l.indexOf('\t') + 1)]));
  return made.filter((c) => alive.has(c.hash)).map((c) => ({ ...c, subject: subjects.get(c.hash) || '' }));
};
