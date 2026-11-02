// 셸별 따옴표·주석·heredoc 구간 읽기. cmdline.mjs 가 이 결과로 따옴표 속을 비우고 낱말을 나눈다.
// 셸마다 규칙이 다르므로 훅 입력의 tool_name 으로 고른다(한쪽으로 읽어 보고 안 맞으면 다시 읽는 추측은 하지 않는다).
//  - bash: 역슬래시가 다음 글자를 이스케이프한다(따옴표 밖·큰따옴표 안). 작은따옴표 안은 그대로, $'…' 안만 역슬래시 이스케이프.
//          heredoc(<<WORD) 본문은 따옴표로 읽지 않고 건너뛴다.
//  - PowerShell: 역슬래시는 그냥 글자다(`"C:\repo\"` 는 경로 끝 `\` + 닫는 따옴표). 이스케이프는 백틱,
//          따옴표 안에서 두 번 쓴 따옴표('' "")는 따옴표 글자. here-string(@'…'@, @"…"@)은 줄 맨 앞의 '@·"@ 에서 닫힌다.
//  - 둘 다: 낱말 첫머리의 # 부터 줄 끝까지는 주석(PowerShell 은 <# … #> 도). 큰따옴표 안 $( … ) 는 안쪽 따옴표까지 한 덩어리.
//  - 닫히지 않은 따옴표를 만나면 거기서 읽기를 멈춘다(셸은 그 명령을 아예 돌리지 않으므로, 뒤를 모두 드러내 두는 쪽이 안전하다).

export const BASH = 'bash';
export const POWERSHELL = 'powershell';
export const shellOf = (toolName) => (toolName === 'PowerShell' ? POWERSHELL : BASH);

// ── heredoc(bash) ───────────────────────────────────────────────
// 여는 표시(<<WORD, <<-'WORD'). `<<<`(here-string)는 heredoc 이 아니다.
const HEREDOC_OP = /(?<!<)<<-?[ \t]*(['"]?)(\w+)\1/g;
// 끝 줄: 앞뒤 공백 + 낱말 하나(`"$(cat <<'EOF' … EOF)"` 처럼 바로 `)` 가 붙어도).
const HEREDOC_END = /^[ \t]*(\w+)[ \t\r]*(?:\)|$)/;

// 정렬된 배열에서 x 보다 큰 첫 값의 자리(없으면 길이).
const upperBound = (arr, x) => {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

// heredoc 본문 구간 [start, end). 줄마다 끝 낱말을 한 번만 모아 두고 여는 표시마다 그 뒤 첫 끝 줄을 찾는다
// — 닫히지 않은 <<WORD 가 많아도 명령 길이에 비례하는 시간만 쓴다. 따옴표 안(`"$(cat <<'EOF' …`)에 있어도 찾는다.
export const heredocs = (cmd) => {
  if (!cmd.includes('<<')) return [];
  const starts = [0];
  for (let i = cmd.indexOf('\n'); i !== -1; i = cmd.indexOf('\n', i + 1)) starts.push(i + 1);
  const lineEnd = (n) => (n + 1 < starts.length ? starts[n + 1] - 1 : cmd.length);
  const ends = new Map(); // 끝 낱말 → 그 낱말만 있는 줄 번호들(오름차순)
  starts.forEach((s, n) => {
    const m = HEREDOC_END.exec(cmd.slice(s, lineEnd(n)));
    if (!m) return;
    if (!ends.has(m[1])) ends.set(m[1], []);
    ends.get(m[1]).push(n);
  });
  const out = [];
  let done = 0;
  for (const m of cmd.matchAll(HEREDOC_OP)) {
    if (m.index < done) continue; // 앞 heredoc 본문 안의 글
    const line = upperBound(starts, m.index) - 1;
    const rows = ends.get(m[2]);
    const last = rows && rows[upperBound(rows, line)];
    if (last === undefined) continue;
    const start = starts[line + 1];
    const end = Math.max(start, starts[last] - 1);
    out.push({ op: m.index, start, end, quotedDelim: m[1] !== '', body: cmd.slice(start, end) });
    done = end;
  }
  return out;
};

// ── 따옴표·주석 ─────────────────────────────────────────────────
// 주석 # 이 낱말 첫머리인지 볼 때 앞 글자. `a#b`·`$#`·`${#x}` 는 주석이 아니다.
const WORD_BREAK = /[\s;&|()]/;
const atWordStart = (cmd, i) => i === 0 || WORD_BREAK.test(cmd[i - 1]);
// here-string 닫는 줄(줄 맨 앞 '@·"@). 앞 공백은 너그럽게 받는다(일찍 닫을수록 뒤가 드러나 안전하다).
const HERE_END = { "'": /\r?\n[ \t]*'@/g, '"': /\r?\n[ \t]*"@/g };
const NOT_FOUND = -1;
const MAX_NEST = 64;

// span: { open, close: 여는·닫는 표시 자리, from, to: 비울 구간 [from, to), vs, ve: 값 구간 [vs, ve), q: 따옴표 글자 }
// 반환: { spans, comments: [시작, 끝) 목록 }. 모두 위치 순.
export const scanQuotes = (cmd, shell, jumps = new Map()) => {
  const ps = shell === POWERSHELL;
  const esc = ps ? '`' : '\\';
  const n = cmd.length;
  // here-string 이 이 자리 뒤에서 안 닫힌다고 이미 안 곳(같은 검색을 되풀이하지 않게).
  const hereFailedFrom = { "'": Infinity, '"': Infinity };

  const closeSingle = (i) => {
    const ansi = !ps && cmd[i - 1] === '$';
    for (let j = i + 1; j < n; j++) {
      if (jumps.has(j)) j = jumps.get(j) - 1;
      else if (ansi && cmd[j] === '\\') j++;
      else if (cmd[j] === "'") {
        if (ps && cmd[j + 1] === "'") j++;
        else return j;
      }
    }
    return NOT_FOUND;
  };

  // 큰따옴표 안 $( 다음 자리 k 에서 짝이 되는 ) 자리. 안쪽은 명령이라 따옴표가 다시 열릴 수 있다.
  // 너무 깊게 겹친 것은 안 닫힌 것으로 본다(스택이 넘쳐 규칙이 통째로 건너뛰어지지 않게).
  let nest = 0;
  const closeSubst = (k) => {
    if (nest >= MAX_NEST) return NOT_FOUND;
    nest++;
    try {
      return closeSubstAt(k);
    } finally {
      nest--;
    }
  };
  const closeSubstAt = (k) => {
    let depth = 1;
    for (let j = k; j < n; j++) {
      const ch = cmd[j];
      if (jumps.has(j)) j = jumps.get(j) - 1;
      else if (ch === esc) j++;
      else if (ch === '(') depth++;
      else if (ch === ')') {
        if (--depth === 0) return j;
      } else if (ch === '"' || ch === "'") {
        const close = ch === '"' ? closeDouble(j) : closeSingle(j);
        if (close === NOT_FOUND) return NOT_FOUND;
        j = close;
      }
    }
    return NOT_FOUND;
  };

  const closeDouble = (i) => {
    for (let j = i + 1; j < n; j++) {
      const ch = cmd[j];
      if (jumps.has(j)) j = jumps.get(j) - 1;
      else if (ch === esc) j++;
      else if (ch === '$' && cmd[j + 1] === '(') {
        const close = closeSubst(j + 2);
        if (close === NOT_FOUND) return NOT_FOUND;
        j = close;
      } else if (ch === '"') {
        if (ps && cmd[j + 1] === '"') j++;
        else return j;
      }
    }
    return NOT_FOUND;
  };

  // PowerShell here-string: `@'` 뒤에는 줄바꿈만 온다. 값은 첫 줄바꿈 다음부터 닫는 줄 앞까지.
  const hereString = (i) => {
    const q = cmd[i + 1];
    let k = i + 2;
    while (cmd[k] === ' ' || cmd[k] === '\t') k++;
    if (cmd[k] === '\r') k++;
    if (cmd[k] !== '\n' || k >= hereFailedFrom[q]) return null;
    const re = HERE_END[q];
    re.lastIndex = k;
    const m = re.exec(cmd);
    if (!m) {
      hereFailedFrom[q] = k;
      return null;
    }
    const close = m.index + m[0].length - 1;
    return { open: i, close, from: i + 2, to: close - 1, vs: k + 1, ve: Math.max(k + 1, m.index), q };
  };

  const spans = [];
  const comments = [];
  const comment = (i, end) => {
    comments.push([i, end]);
    return end - 1;
  };
  for (let i = 0; i < n; i++) {
    const c = cmd[i];
    if (jumps.has(i)) {
      i = jumps.get(i) - 1;
      continue;
    }
    if (c === esc) {
      i++;
      continue;
    }
    if (ps && c === '<' && cmd[i + 1] === '#' && atWordStart(cmd, i)) {
      const e = cmd.indexOf('#>', i + 2);
      i = comment(i, e === NOT_FOUND ? n : e + 2);
      continue;
    }
    if (c === '#' && atWordStart(cmd, i)) {
      const e = cmd.indexOf('\n', i);
      i = comment(i, e === NOT_FOUND ? n : e);
      continue;
    }
    let span = ps && c === '@' && (cmd[i + 1] === "'" || cmd[i + 1] === '"') ? hereString(i) : null;
    if (!span && (c === '"' || c === "'")) {
      const close = c === '"' ? closeDouble(i) : closeSingle(i);
      if (close === NOT_FOUND) break;
      span = { open: i, close, from: i + 1, to: close, vs: i + 1, ve: close, q: c };
    }
    if (span) {
      spans.push(span);
      i = span.close;
    }
  }
  return { spans, comments };
};
