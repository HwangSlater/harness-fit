// 명령줄 읽기: 따옴표 속 비우기, 낱말 나누기, git 하위 명령 인자 꺼내기, 실행되지 않는 글 가리기.
// 따옴표 규칙은 셸마다 다르다(bash ↔ PowerShell). 어느 셸인지는 훅 입력의 tool_name 으로 정해 shell 인자로 받는다
// — 읽는 방법은 quotes.mjs. 같은 명령을 규칙마다 다시 읽지 않게 한 프로세스 안에서 결과를 기억해 둔다.
import { BASH, POWERSHELL, heredocs, scanQuotes } from './quotes.mjs';

export { BASH, POWERSHELL, shellOf, heredocs } from './quotes.mjs';

// `git` 과 하위 명령 사이의 전역 옵션: -C 경로, -c 키=값, --git-dir=…, --no-pager, -P 등 몇 개든.
export const QUOTED_OR_WORD = String.raw`(?:"[^"]*"|'[^']*'|\S+)`;
const GIT_GLOBAL = String.raw`(?:-[Cc]\s+${QUOTED_OR_WORD}|--[\w-]+(?:=${QUOTED_OR_WORD})?|-[pP])`;
// git 실행 파일: git · git.exe · git.cmd. 경로가 붙거나(`/usr/bin/git`, `"C:\Program Files\Git\bin\git.exe"`)
// PowerShell 호출 연산자(`& git`)가 앞에 와도 같다.
// 앞 git 의 옵션 값(`-c git`, `-C /x/git`, `--opt=git`)인 git 에서는 새로 시작하지 않는다 — 그러지 않으면
// `git -c git -c git …` 처럼 값마다 다시 시작해 옵션 끝까지 읽느라 길이의 제곱만큼 걸렸다(2만 자에 2초, 10만 자에 100초 넘게).
export const GIT_CMD = String.raw`(?<!=|-[Cc]\s+\S*)\bgit(?:\.exe|\.cmd)?["']?\s+`;
export const GIT = String.raw`${GIT_CMD}(?:${GIT_GLOBAL}\s+)*`;
// 하위 명령 이름의 끝. `\b` 는 `commit-graph` 의 `-` 앞에서도 끝나므로 `-` 까지 이어지면 다른 명령으로 본다.
export const SUB_END = String.raw`(?![\w-])`;
// 따옴표로 감싼 git 실행 파일 경로. 명령 자리에 있으면 비우지 않고 남겨 GIT 패턴이 찾게 한다.
const GIT_EXE_PATH = /^(?:.*[\\/])?git(?:\.exe|\.cmd)?$/i;
const COMMAND_START = /[;&|\n(]/;
const BLANK = /[ \t]/;

// 줄 이어 쓰기 표시(따옴표 밖). 따옴표 속은 이미 비워져 있어 여기 걸리지 않는다.
const CONTINUATION = { [BASH]: /\\\r?\n/g, [POWERSHELL]: /`\r?\n/g };
const CONTINUATION_AT = { [BASH]: '\\', [POWERSHELL]: '`' };

// 따옴표를 비울 때 채우는 글자. 공백·구분자·옵션 글자가 아니어야 한다(길이는 그대로 두어 위치를 맞춘다).
const FILL = '_';

// [시작, 끝) 구간들을 FILL 로 채운다. 길이는 그대로.
export const fillRanges = (cmd, ranges) => {
  if (!ranges.length) return cmd;
  const chars = cmd.split(''); // UTF-16 단위로 나눠야 위치가 정규식 index 와 맞는다.
  for (const [s, e] of ranges) for (let i = s; i < e; i++) chars[i] = FILL;
  return chars.join('');
};
const fillOf = (span) => [span.from, span.to];
const valueOf = (cmd, span) => cmd.slice(span.vs, span.ve);

// span 이 명령 자리(줄 처음, ; & | ( 뒤, PowerShell `&` 호출 연산자 뒤)에 있는지.
const atCommandStart = (cmd, open) => {
  let k = open - 1;
  while (k >= 0 && BLANK.test(cmd[k])) k--;
  if (cmd[k] === '&' && cmd[k - 1] !== '&') {
    k--;
    while (k >= 0 && BLANK.test(cmd[k])) k--;
  }
  return k < 0 || COMMAND_START.test(cmd[k]);
};
const isGitExe = (cmd, span) => GIT_EXE_PATH.test(valueOf(cmd, span)) && atCommandStart(cmd, span.open);

// 한 훅 프로세스 안에서 같은 (셸, 명령) 을 다시 읽지 않게 기억한다. 너무 쌓이면 비운다.
// 명령 글 자체를 열쇠로 쓰고(글자를 이어 붙인 새 열쇠를 만들면 10MB 명령을 부를 때마다 다시 해시했다) 그 안에서 (셸, 종류) 로 나눈다.
const CACHE_MAX = 256;
const memo = (cache, cmd, key, make) => {
  let inner = cache.get(cmd);
  if (!inner) {
    if (cache.size >= CACHE_MAX) cache.clear();
    inner = new Map();
    cache.set(cmd, inner);
  }
  if (inner.has(key)) return inner.get(key);
  const value = make();
  inner.set(key, value);
  return value;
};
const parsed = new Map();
const segmentsMemo = new Map();

// { docs: heredoc 목록, spans, comments, bare: 따옴표 속·heredoc 본문·주석을 비운 명령 }
const parse = (cmd, shell) =>
  memo(parsed, cmd, shell, () => {
    const docs = shell === BASH ? heredocs(cmd) : [];
    const { spans, comments } = scanQuotes(cmd, shell, new Map(docs.map((h) => [h.start, h.end])));
    const fills = spans.filter((s) => !isGitExe(cmd, s)).map(fillOf);
    // 줄 이어 쓰기(bash `\` + 줄바꿈, PowerShell 백틱 + 줄바꿈)는 한 명령이다 — 공백으로 바꿔 다음 줄 옵션을 놓치지 않게.
    const bare = fillRanges(cmd, [...fills, ...docs.map((h) => [h.start, h.end]), ...comments]).replace(CONTINUATION[shell] || CONTINUATION[BASH], (m) => ' '.repeat(m.length));
    return { docs, spans, comments, bare };
  });

// 따옴표 안 글자(커밋 메시지 등)·heredoc 본문·주석을 비운다. 옵션을 찾을 때 메시지 속 `-n`·`-a` 를 옵션으로 읽지 않게.
// 길이는 그대로라 여기서 찾은 위치로 원래 명령을 잘라 쓸 수 있다.
export const stripQuoted = (cmd, shell = BASH) => parse(cmd, shell).bare;

// 낱말 나누기. 따옴표는 벗기고 붙은 조각(`"+"main`)은 한 낱말로 잇는다. 주석은 뺀다.
// 따옴표 밖 글자는 한 글자씩 잇지 않고 이어진 구간을 한 번에 잘라 붙인다(아주 긴 낱말에서 글자마다 새 글을 만들어 느렸다).
const WS = /\s/;
export const splitWords = (s, shell = BASH) => {
  const { spans, comments } = parse(s, shell);
  const cont = CONTINUATION_AT[shell] || CONTINUATION_AT[BASH];
  const words = [];
  let cur = null;
  let runFrom = -1; // 따옴표 밖 글자가 이어지기 시작한 자리
  let k = 0;
  let c = 0;
  const endRun = (i) => {
    if (runFrom === -1) return;
    cur = (cur ?? '') + s.slice(runFrom, i);
    runFrom = -1;
  };
  const flush = (i) => {
    endRun(i);
    if (cur !== null) words.push(cur);
    cur = null;
  };
  for (let i = 0; i < s.length; i++) {
    if (spans[k] && i === spans[k].open) {
      endRun(i);
      cur = (cur ?? '') + valueOf(s, spans[k]);
      i = spans[k].close;
      k++;
    } else if (comments[c] && i === comments[c][0]) {
      flush(i);
      i = comments[c][1] - 1;
      c++;
    } else if (s[i] === cont && (s[i + 1] === '\n' || (s[i + 1] === '\r' && s[i + 2] === '\n'))) {
      flush(i);
      i += s[i + 1] === '\r' ? 2 : 1;
    } else if (WS.test(s[i])) flush(i);
    else if (runFrom === -1) runFrom = i;
  }
  flush(s.length);
  return words;
};

// 짧은 옵션 묶음(-fu, -am)에서 글자를 모은다. 값을 받는 글자(takesValue)를 만나면 그 묶음은 거기서 끝난다.
export const shortFlags = (args, takesValue = '') => {
  const out = new Set();
  for (const tok of args.split(/\s+/)) {
    if (!/^-[A-Za-z]/.test(tok)) continue;
    for (const ch of tok.slice(1)) {
      if (!/[A-Za-z]/.test(ch)) break;
      out.add(ch);
      if (takesValue.includes(ch)) break;
    }
  }
  return out;
};

// git 하위 명령(들)의 인자 부분(다음 && ; | 줄바꿈 전까지). 한 명령에 여러 번 나오면 모두.
// start: 원래 명령에서 인자 부분의 시작 자리, bare: 따옴표 속을 비운 것(옵션 찾기용), raw: 원래 글, words: 따옴표를 벗긴 낱말.
export const gitSegments = (cmd, sub, shell = BASH) =>
  memo(segmentsMemo, cmd, `${shell}\0${sub}`, () => {
    const re = new RegExp(GIT + `(?:${sub})` + SUB_END + String.raw`([^;&|\n]*)`, 'g');
    return [...stripQuoted(cmd, shell).matchAll(re)].map((m) => {
      const start = m.index + m[0].length - m[1].length;
      const raw = cmd.slice(start, start + m[1].length);
      return { start, bare: m[1], raw, words: splitWords(raw, shell) };
    });
  });

// 명령을 ; && || | & 줄바꿈 ( ) 로 나눈 조각들(따옴표 속·heredoc 본문은 나누지 않는다). 위치 순.
// heredoc 끝 줄(EOF)은 앞 명령의 일부라 조각으로 내지 않는다.
// { start, bare, raw, words } — start 는 원래 명령에서의 자리.
const SEGMENT_BREAK = /[;&|\n()]/;
export const commandSegments = (cmd, shell = BASH) =>
  memo(segmentsMemo, cmd, `${shell}\0\0seg`, () => {
    const { docs, bare } = parse(cmd, shell);
    const skip = docs.map((h) => {
      const next = cmd.indexOf('\n', h.end + 1);
      return [h.end, next === -1 ? cmd.length : next];
    });
    const inDocEnd = (i) => skip.some(([s, e]) => i >= s && i < e);
    const out = [];
    let from = 0;
    const flush = (to) => {
      const raw = cmd.slice(from, to);
      if (raw.trim() && !inDocEnd(from + raw.search(/\S/))) out.push({ start: from, bare: bare.slice(from, to), raw, words: splitWords(raw, shell) });
    };
    for (let i = 0; i <= bare.length; i++) {
      if (i === bare.length || SEGMENT_BREAK.test(bare[i])) {
        flush(i);
        from = i + 1;
      }
    }
    return out;
  });

// 따옴표 속 글을 다시 명령으로 실행하는 꼴: `bash -c "…"`, `sh -c '…'`, `eval "…"`, `pwsh -Command "…"`,
// `Invoke-Expression "…"`·`iex '…'`, `cmd /c "…"`. 그 따옴표 속 명령과 그 명령을 읽을 셸을 돌려준다.
// 규칙은 바깥 명령과 함께 이 안쪽 명령도 본다(따옴표 속이라 git 명령이 안 보이던 일을 막으려고).
// 앞 옵션은 값을 하나 받을 수 있다(-ExecutionPolicy Bypass, -o pipefail)
const INNER_BASH = /(?:\b(?:ba|z|da|k)?sh(?:\.exe)?\s+(?:-[A-Za-z]+\s+(?:[A-Za-z]\w*\s+)?)*-[A-Za-z]*c\s+|\beval\s+)$/;
const INNER_PS = /(?:\b(?:pwsh|powershell)(?:\.exe)?\s+(?:-[A-Za-z]+\s+(?:[A-Za-z]\w*\s+)?)*-(?:c|Command)\s+|\b(?:iex|Invoke-Expression)\s+(?:-Command\s+)?|\bcmd(?:\.exe)?\s+\/[cCkK]\s+)$/i;
const MAX_INNER_DEPTH = 3;
export const innerCommands = (cmd, shell = BASH, depth = 0) => {
  if (depth >= MAX_INNER_DEPTH) return [];
  const { spans, bare } = parse(cmd, shell);
  const out = [];
  for (const s of spans) {
    const before = bare.slice(Math.max(0, s.open - 80), s.open);
    const inner = INNER_BASH.test(before) ? BASH : INNER_PS.test(before) ? POWERSHELL : null;
    if (!inner) continue;
    const body = valueOf(cmd, s);
    out.push({ cmd: body, shell: inner }, ...innerCommands(body, inner, depth + 1));
  }
  return out;
};

// 위험 명령 찾기용: 실행되지 않는 글(echo·printf·Write-Host 인자, git commit/tag -m 메시지, gh pr/issue 본문,
// cat heredoc 본문, 주석)을 비운다. `bash -c "…"`·`eval "…"`·`cmd /c "…"` 처럼 실행되는 글과 명령 치환
// (bash `$(…)`·백틱, PowerShell `$(…)`)이 든 큰따옴표는 그대로 둔다.
// 결과를 셸로 넘기는 파이프(| sh, | iex)가 있으면 아무것도 비우지 않는다.
const PIPE_TO_SHELL = /\|\s*(?:sudo\s+)?(?:(?:ba|z|da|k)?sh|pwsh|powershell|iex|Invoke-Expression)\b/i;
// gh 로 PR·이슈·릴리스에 글을 남기는 명령(--title·--body·--notes 값은 글이다).
const GH_TEXT = String.raw`gh\s+(?:(?:pr|issue)\s+(?:create|comment|edit|review|close|merge)|release\s+(?:create|edit))${SUB_END}`;
const DATA_CMD = new RegExp(
  String.raw`^\s*(?:(?:echo|printf|Write-(?:Host|Output))\b|${GIT}(?:commit|tag|notes|stash)${SUB_END}|${GH_TEXT})`,
  'i',
);
// 큰따옴표 안 명령 치환. PowerShell 의 백틱은 이스케이프라 치환이 아니다.
const SUBSTITUTION = { [BASH]: /\$\(|`/, [POWERSHELL]: /\$\(/ };
// heredoc 을 받는 명령(그 줄의 마지막 명령 첫 낱말)이 셸·실행기인지
const HEREDOC_RUNNER = /^(?:sudo\s+)?(?:(?:ba|z|da|k)?sh|fish|pwsh|powershell|python[23]?|node|perl|ruby|php|eval|source|\.|xargs|ssh)\b/;
const lastCommand = (before) => before.split(/[;&|\n(]/).pop().trim();

export const dataMasked = (cmd, shell = BASH) => {
  if (PIPE_TO_SHELL.test(stripQuoted(cmd, shell))) return cmd;
  const substitution = SUBSTITUTION[shell] || SUBSTITUTION[BASH];
  // heredoc 본문은 셸·실행기로 가지 않으면 글이다(cat > 파일, git commit -F -, gh pr create --body-file -).
  // 따옴표 친 끝 표시(<<'EOF')면 치환도 없다. 따옴표 없는 끝 표시는 $(…) 가 없을 때만 글로 본다.
  const docs = parse(cmd, shell)
    .docs.filter((h) => !HEREDOC_RUNNER.test(lastCommand(cmd.slice(0, h.op))) && (h.quotedDelim || !substitution.test(h.body)))
    .map((h) => [h.start, h.end]);
  const view = fillRanges(cmd, docs);
  const { spans, comments, bare } = parse(view, shell);
  // 명령 시작 자리를 앞에서부터 한 번만 훑는다(따옴표가 많아도 길이에 비례). 한 명령에서 앞 따옴표가
  // 글로 판정되면 같은 명령의 뒤 따옴표도 글이다(DATA_CMD 는 명령 앞부분만 보므로).
  const data = [];
  let cut = -1;
  let p = 0;
  let known = null; // { cut, yes } — 이 명령에서 이미 글로 판정했는지
  for (const s of spans) {
    for (; p < s.open; p++) if (COMMAND_START.test(bare[p])) cut = p;
    if (s.q === '"' && substitution.test(view.slice(s.from, s.to))) continue;
    if (!(known && known.cut === cut)) known = { cut, yes: false };
    known.yes ||= DATA_CMD.test(bare.slice(cut + 1, s.open));
    if (known.yes) data.push(fillOf(s));
  }
  return fillRanges(view, [...data, ...comments]);
};
