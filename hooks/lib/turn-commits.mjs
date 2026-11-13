// 이번 사람 턴에 만든 커밋: HEAD 의 reflog 에서 턴이 시작된 뒤 커밋을 만든 기록(commit·cherry-pick·revert·merge 커밋)을 골라,
// 아직 브랜치에 남아 있는 것만(amend·reset 으로 버린 옛 커밋은 뺀다). 커밋 해시 알리기·문서 검사가 함께 쓴다.
// git 의 committer 날짜가 아니라 reflog(이 저장소에서 HEAD 가 움직인 때)를 본다 — pull 로 받은 남의 커밋은 들어가지 않는다.
import { git } from './core.mjs';
import { findRepo } from './repo-files.mjs';

const REFLOG_MAX = 200;
// reflog 제목 중 새 커밋을 만든 것
const MAKES_COMMIT = /^(?:commit(?: \([^)]*\))?|cherry-pick|revert): |^(?:merge|pull)\b[^:]*: Merge made/;
// 브랜치에 남았는지 볼 때 committer 날짜 여유(시계 차이)
const SLACK_S = 3600;

const lines = (out) => (out || '').split('\n').filter(Boolean);

// 커밋 제목(%s)과 reflog 제목(%gs)은 탭이 들 수 있어 그 사이는 \x1f 로 나눈다. 커밋 제목을 reflog 에서 같이 받아 git log 를 따로 부르지 않는다.
const SEP = '\x1f';

// → [{ hash, short, subject, at(초) }] 최신 순, 겹침 없이
// shared: 한 훅 실행 안에서 나눠 쓰는 표(커밋 해시 알리기·문서 검사가 같은 저장소·같은 턴을 두 번 묻지 않게)
export const turnCommits = (root, sinceMs, shared = null) => {
  if (!root || !Number.isFinite(sinceMs)) return [];
  const memo = shared ? (shared.turnCommits ??= new Map()) : null;
  // 같은 저장소의 다른 폴더도 한 번만(맨 위를 파일로 못 찾으면 폴더 그대로 — 열쇠 때문에 git 을 띄우지 않게)
  const key = `${findRepo(root)?.root || root}\n${sinceMs}`;
  if (memo?.has(key)) return memo.get(key);
  const out = readTurnCommits(root, sinceMs);
  memo?.set(key, out);
  return out;
};

const readTurnCommits = (root, sinceMs) => {
  const since = Math.floor(sinceMs / 1000);
  const made = [];
  const seen = new Set();
  for (const l of lines(git(root, ['reflog', 'show', '--date=unix', '--format=%H%x09%h%x09%gd%x09%s%x1f%gs', '-n', String(REFLOG_MAX), 'HEAD', '--']))) {
    const [hash, short, sel] = l.split('\t', 3);
    const rest = l.split('\t').slice(3).join('\t');
    const cut = rest.indexOf(SEP);
    const subject = cut < 0 ? '' : rest.slice(0, cut);
    const gs = cut < 0 ? rest : rest.slice(cut + 1);
    const at = Number((sel || '').match(/@\{(\d+)\}$/)?.[1]);
    if (!Number.isFinite(at)) continue;
    if (at < since) break; // reflog 는 최신 순이다
    if (!MAKES_COMMIT.test(gs || '') || seen.has(hash)) continue;
    seen.add(hash);
    made.push({ hash, short, at, subject });
  }
  if (!made.length) return [];
  // 브랜치(또는 지금 HEAD)에 남은 것만
  const alive = new Set(lines(git(root, ['rev-list', '--branches', 'HEAD', `--since=${new Date((since - SLACK_S) * 1000).toISOString()}`])));
  return made.filter((c) => alive.has(c.hash));
};
