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
export const GIT_CMD = String.raw`\bgit(?:\.exe|\.cmd)?["']?\s+`;
export const GIT = String.raw`${GIT_CMD}(?:${GIT_GLOBAL}\s+)*`;
// 하위 명령 이름의 끝. `\b` 는 `commit-graph` 의 `-` 앞에서도 끝나므로 `-` 까지 이어지면 다른 명령으로 본다.
export const SUB_END = String.raw`(?![\w-])`;
// 따옴표로 감싼 git 실행 파일 경로. 명령 자리에 있으면 비우지 않고 남겨 GIT 패턴이 찾게 한다.
const GIT_EXE_PATH = /^(?:.*[\\/])?git(?:\.exe|\.cmd)?$/i;
const COMMAND_START = /[;&|\n(]/;
const BLANK = /[ \t]/;

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
const CACHE_MAX = 256;
const memo = (cache, key, make) => {
  if (cache.has(key)) return cache.get(key);
  if (cache.size >= CACHE_MAX) cache.clear();
  const value = make();
  cache.set(key, value);
  return value;
};
const parsed = new Map();
const segmentsMemo = new Map();

// { docs: heredoc 목록, spans, comments, bare: 따옴표 속·heredoc 본문·주석을 비운 명령 }
const parse = (cmd, shell) =>
  memo(parsed, `${shell}\0${cmd}`, () => {
    const docs = shell === BASH ? heredocs(cmd) : [];
    const { spans, comments } = scanQuotes(cmd, shell, new Map(docs.map((h) => [h.start, h.end])));
    const fills = spans.filter((s) => !isGitExe(cmd, s)).map(fillOf);
    const bare = fillRanges(cmd, [...fills, ...docs.map((h) => [h.start, h.end]), ...comments]);
    return { docs, spans, comments, bare };
  });

// 따옴표 안 글자(커밋 메시지 등)·heredoc 본문·주석을 비운다. 옵션을 찾을 때 메시지 속 `-n`·`-a` 를 옵션으로 읽지 않게.
// 길이는 그대로라 여기서 찾은 위치로 원래 명령을 잘라 쓸 수 있다.
export const stripQuoted = (cmd, shell = BASH) => parse(cmd, shell).bare;

// 낱말 나누기. 따옴표는 벗기고 붙은 조각(`"+"main`)은 한 낱말로 잇는다. 주석은 뺀다.
export const splitWords = (s, shell = BASH) => {
  const { spans, comments } = parse(s, shell);
  const words = [];
  let cur = null;
  let k = 0;
  let c = 0;
  const flush = () => {
    if (cur !== null) words.push(cur);
    cur = null;
  };
  for (let i = 0; i < s.length; i++) {
    if (spans[k] && i === spans[k].open) {
      cur = (cur ?? '') + valueOf(s, spans[k]);
      i = spans[k].close;
      k++;
    } else if (comments[c] && i === comments[c][0]) {
      flush();
      i = comments[c][1] - 1;
      c++;
    } else if (/\s/.test(s[i])) flush();
    else cur = (cur ?? '') + s[i];
  }
  flush();
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
  memo(segmentsMemo, `${shell}\0${sub}\0${cmd}`, () => {
    const re = new RegExp(GIT + `(?:${sub})` + SUB_END + String.raw`([^;&|\n]*)`, 'g');
    return [...stripQuoted(cmd, shell).matchAll(re)].map((m) => {
      const start = m.index + m[0].length - m[1].length;
      const raw = cmd.slice(start, start + m[1].length);
      return { start, bare: m[1], raw, words: splitWords(raw, shell) };
    });
  });

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
const CAT_BEFORE = /\bcat\s+$/;

export const dataMasked = (cmd, shell = BASH) => {
  if (PIPE_TO_SHELL.test(stripQuoted(cmd, shell))) return cmd;
  const substitution = SUBSTITUTION[shell] || SUBSTITUTION[BASH];
  const docs = parse(cmd, shell)
    .docs.filter((h) => CAT_BEFORE.test(cmd.slice(0, h.op)) && (h.quotedDelim || !substitution.test(h.body)))
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
