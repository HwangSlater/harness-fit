// 답을 끝낼 때(Stop) 보는 규칙: 커밋 해시 알리기(commit-hash), 답 언어 맞추기(answer-lang).
// 막으면 Claude 가 이유를 받고 답을 이어 쓴다. 이미 한 번 막아서 다시 도는 중(stop_hook_active)이면 디스패처가 통과시킨다.
import { repoRoot, commandCwd } from '../lib/core.mjs';
import { readTurnTail, humanTurn, finalTexts } from '../lib/transcript.mjs';
import { turnCommits } from '../lib/turn-commits.mjs';
import { judgeLang, ANSWER_LANGS, DEFAULT_ANSWER_LANG } from '../lib/answer-lang.mjs';

export const MAX_COMMITS = 6;
const MAX_REPOS = 5;
const HASH_TOKEN = /\b[0-9a-f]{7,40}\b/gi;
const SAMPLE = 120;
// 막는 글 맨 앞 표시. 같은 사람 턴에서 이 표시가 든 되먹임이 이미 있으면 다시 묻지 않는다.
export const markOf = (id) => `[harness-fit · ${id}]`;

// 대화 기록은 훅 한 번에 한 번만 읽는다(여러 규칙이 shared 로 나눠 쓴다)
const tailOf = (input, shared) => {
  if (!('tail' in shared)) shared.tail = typeof input.transcript_path === 'string' ? readTurnTail(input.transcript_path) : null;
  return shared.tail;
};
// 사람 턴(여러 규칙이 같이 쓴다)
export const turnOf = (input, shared) => {
  if (!('turn' in shared)) shared.turn = humanTurn(tailOf(input, shared));
  return shared.turn;
};

// 이번 턴에 볼 저장소: 작업 폴더의 저장소 + 명령의 `cd … &&`·`git -C` 로 간 저장소
const reposOf = (cwd, commands) => {
  const dirs = new Set([cwd]);
  for (const c of commands) if (/\bgit\b/.test(c)) dirs.add(commandCwd(c, cwd));
  const roots = new Set();
  for (const d of dirs) {
    if (roots.size >= MAX_REPOS) break;
    const r = repoRoot(d);
    if (r) roots.add(r);
  }
  return [...roots];
};

export const commitHash = {
  id: 'commit-hash',
  on: 'stop',
  check({ input, cwd, t, shared }) {
    const turn = turnOf(input, shared);
    // 셸 명령을 하나도 안 쓴 턴은 보지 않는다(그 사이 사용자가 터미널에서 한 커밋 때문에 묻지 않게)
    if (!turn || !turn.commands.length || !Number.isFinite(turn.since)) return null;
    if (turn.asked(markOf('commit-hash'))) return null;
    const commits = reposOf(cwd, turn.commands).flatMap((root) => turnCommits(root, turn.since, shared)).slice(0, MAX_COMMITS);
    if (!commits.length) return null;
    const last = typeof input.last_assistant_message === 'string' ? [{ text: input.last_assistant_message, at: null }] : [];
    // 답마다 해시 모양 글을 한 번만 뽑는다
    const said = [...turn.texts, ...last].map((x) => ({ at: x.at, tokens: (x.text.match(HASH_TOKEN) || []).map((s) => s.toLowerCase()) })).filter((x) => x.tokens.length);
    // 커밋 뒤에 쓴 답 어디에든 있으면 된다(앞 답에 이미 알렸는데 마지막 답에 없다고 거듭 묻지 않게)
    const missing = commits.filter((c) => !said.some((x) => (x.at === null || x.at >= c.at * 1000 - 1000) && x.tokens.some((tok) => c.hash.startsWith(tok))));
    if (!missing.length) return null;
    const list = missing.map((c) => `- ${c.short} ${c.subject}`).join('\n');
    return `${markOf('commit-hash')} ${t('commitHash.missing', { n: missing.length, list, example: missing[0].short })}`;
  },
};

export const answerLang = {
  id: 'answer-lang',
  on: 'stop',
  check({ input, opts, t, shared }) {
    const want = ANSWER_LANGS.includes(opts.lang) ? opts.lang : DEFAULT_ANSWER_LANG;
    let texts = finalTexts(tailOf(input, shared));
    if (!texts.length && typeof input.last_assistant_message === 'string') texts = [input.last_assistant_message];
    if (!texts.length) return null;
    const { block, bad } = judgeLang(texts, want);
    if (!block) return null;
    const sample = (bad[0] || texts[texts.length - 1]).replace(/\s+/g, ' ').trim().slice(0, SAMPLE);
    return `${markOf('answer-lang')} ${t('answerLang.wrong', { lang: t(`lang.name.${want}`), sample })}`;
  },
};

export default [commitHash, answerLang];
