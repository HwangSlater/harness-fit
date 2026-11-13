// 「파일이 없을 때만」 도는 구간 — 보호 파일 훅이 예시 파일로 처음 만들기(cp .env.example .env)를 둘 때,
// 지금 파일이 있어도 앞의 있는지 확인으로 덮어쓰지 않는 꼴이면 처음 만들기로 본다(검토 2026-11-13: 막는 글이 권한
// 「Test-Path 로 먼저 확인」 을 따른 명령도 막혔다). 같은 경로를 확인할 때만이다.
// bash: if [ ! -f X ]; then …; fi · if [ -f X ]; then …; else …; fi · [ -f X ] || … · test -e X || … · [ -f X ] && … || … · [ ! -f X ] && …
// PowerShell: if (-not (Test-Path X)) { … } · if (!(Test-Path X)) { … }
// → [{ path, from, to }] — 명령 조각의 시작 자리(cmdline.mjs commandSegments 의 start)가 from < start < to 이면 그 구간 안이다.
// 겹친 if 는 읽지 않는다(구간을 내지 않아 지키는 쪽).
import { BASH, POWERSHELL, stripQuoted, splitWords } from './cmdline.mjs';

const MAX_GUARDS = 16;
// 경로 낱말: 따옴표는 비운 채 남아 있어 그대로 한 낱말이다. 괄호·대괄호·중괄호·구분자는 넣지 않는다
const WORD = String.raw`[^\s()\[\]{};|&]+`;
// 확인 식의 앞자리: 명령 처음(줄 처음·; · 줄바꿈 · then·do·else 뒤). && · || 뒤는 아니다 — 앞 명령의 결과가 섞인다
const LEAD = String.raw`(?:^|[;\n{(]|\b(?:then|do|else)\b)[ \t]*`;
const BASH_TEST = new RegExp(String.raw`${LEAD}(if[ \t]+)?(![ \t]+)?(?:\[\[?[ \t]+(![ \t]+)?-[ef][ \t]+(${WORD})[ \t]+\]\]?|test[ \t]+(![ \t]+)?-[ef][ \t]+(${WORD}))`, 'g');
const SEP = /[;&|\n)]/;
const pathOf = (cmd, from, to, shell) => splitWords(cmd.slice(from, to), shell)[0] || '';

// bare 의 at 부터 다음 구분자 자리(없으면 끝)
const nextSep = (bare, at) => {
  for (let i = at; i < bare.length; i++) if (SEP.test(bare[i])) return i;
  return bare.length;
};
// 명령 처음 자리의 낱말(fi·else·elif·if) 찾기 — 구분자 뒤 공백 다음
const KEYWORD = /(^|[;\n])[ \t]*(if|then|else|elif|fi)(?![\w-])/g;
// 구간 안에 다른 if 가 있으면(then if … 처럼 구분자 뒤가 아니어도) 읽지 않는다 — 안쪽 else 를 바깥 것으로 읽지 않게
const NESTED_IF = /(?<![\w-])if(?![\w-])/;
const keywords = (bare, from) => {
  KEYWORD.lastIndex = from;
  const out = [];
  for (let m; (m = KEYWORD.exec(bare));) out.push({ word: m[2], sep: m.index + m[1].length - 1, end: m.index + m[0].length });
  return out;
};

const bashGuards = (cmd) => {
  const bare = stripQuoted(cmd, BASH);
  const out = [];
  for (const m of bare.matchAll(BASH_TEST)) {
    if (out.length >= MAX_GUARDS) break;
    const negated = !!m[2] !== !!(m[3] || m[5]);
    const word = m[4] ?? m[6];
    const at = m.index + m[0].lastIndexOf(word);
    const path = pathOf(cmd, at, at + word.length, BASH);
    const end = m.index + m[0].length;
    if (m[1]) {
      // if 확인; then … [else …] fi — 다음 낱말이 then 이어야 하고, 사이에 다른 if 가 있으면 읽지 않는다
      const ks = keywords(bare, end);
      if (ks[0]?.word !== 'then' || bare.slice(end, ks[0].sep).trim()) continue;
      const close = ks.findIndex((k, i) => i > 0 && k.word !== 'then');
      if (close < 0 || ks[close].word === 'if' || ks[close].word === 'elif') continue;
      const nested = (to) => NESTED_IF.test(bare.slice(end, to));
      if (negated) {
        if (!nested(ks[close].sep)) out.push({ path, from: end, to: ks[close].sep });
      } else if (ks[close].word === 'else') {
        const fi = ks[close + 1];
        if (fi?.word === 'fi' && !nested(fi.sep)) out.push({ path, from: ks[close].sep, to: fi.sep });
      }
      continue;
    }
    // [ ! -f X ] && … · [ -f X ] [&& …]* || …
    let i = end;
    while (bare[i] === ' ' || bare[i] === '\t') i++;
    if (negated) {
      if (bare.startsWith('&&', i)) out.push({ path, from: i, to: nextSep(bare, i + 2) });
      continue;
    }
    while (bare.startsWith('&&', i)) {
      i = nextSep(bare, i + 2);
      if (bare[i] !== '&' && bare[i] !== '|') break;
    }
    if (bare.startsWith('||', i)) out.push({ path, from: i, to: nextSep(bare, i + 2) });
  }
  return out;
};

// PowerShell: if (-not (Test-Path …)) { … } · if (!(Test-Path …)) { … } — 경로는 -Path·-LiteralPath 값이나 첫 위치 인자
const PS_TEST = /\bif\s*\(\s*(?:-not\s*|!\s*)\(\s*Test-Path((?:\s+[^\s(){}]+){1,6})\s*\)\s*\)\s*\{/gi;
const PS_VALUE = /^-(?:PathType|Filter|Include|Exclude|Credential)$/i;
const psPath = (args) => {
  for (let i = 0; i < args.length; i++) {
    if (/^-(?:Path|LiteralPath)$/i.test(args[i])) return args[i + 1] || '';
    if (PS_VALUE.test(args[i])) i++;
    else if (!args[i].startsWith('-')) return args[i];
  }
  return '';
};
const psGuards = (cmd) => {
  const bare = stripQuoted(cmd, POWERSHELL);
  const out = [];
  for (const m of bare.matchAll(PS_TEST)) {
    if (out.length >= MAX_GUARDS) break;
    const at = m.index + m[0].indexOf(m[1]);
    const path = psPath(splitWords(cmd.slice(at, at + m[1].length), POWERSHELL));
    const open = m.index + m[0].length - 1;
    // 맞는 } 까지(따옴표 속 중괄호는 비워져 있다)
    let depth = 0;
    let close = -1;
    for (let i = open; i < bare.length; i++) {
      if (bare[i] === '{') depth++;
      else if (bare[i] === '}' && --depth === 0) { close = i; break; }
    }
    // 조각은 조건을 닫는 ) 바로 뒤에서 시작한다 — 구간의 앞을 그 ) 로
    if (path && close > 0) out.push({ path, from: bare.lastIndexOf(')', open), to: close });
  }
  return out;
};

const memo = new Map();
export const missingOnly = (cmd, shell = BASH) => {
  const key = `${shell}\0${cmd}`;
  if (!memo.has(key)) {
    if (memo.size >= 8) memo.delete(memo.keys().next().value);
    const quick = shell === POWERSHELL ? /test-path/i.test(cmd) : /\[|\btest\b/.test(cmd);
    memo.set(key, quick ? (shell === POWERSHELL ? psGuards(cmd) : bashGuards(cmd)) : []);
  }
  return memo.get(key);
};
