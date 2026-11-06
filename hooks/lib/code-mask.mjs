// Swift·Python 코드에서 주석과 글자(문자열) 속을 띄어쓰기로 바꾼 같은 길이의 글을 만든다(줄바꿈은 그대로).
// 「코드에 쓴 try!·eval(」만 보려고 — 주석·글자 속 낱말은 막지 않는다. 글자 속에서 코드가 도는 자리
// (Swift 의 `\( … )`, Python f-글자의 `{ … }`)는 코드로 남긴다.
// 글자를 한 번만 앞에서 뒤로 읽는다(정규식을 쓰지 않아 긴 글에서도 오래 걸리지 않는다).

// 가린 구간들 [시작, 끝) → 가린 글
const blankOut = (s, ranges) => {
  if (!ranges.length) return s;
  const parts = [];
  let at = 0;
  for (const [a, b] of ranges) {
    if (b <= a) continue;
    parts.push(s.slice(at, a), s.slice(a, b).replace(/[^\n]/g, ' '));
    at = b;
  }
  parts.push(s.slice(at));
  return parts.join('');
};

const lineEnd = (s, i) => {
  const e = s.indexOf('\n', i);
  return e === -1 ? s.length : e;
};

// Swift: // 와 /* */(겹쳐 쓸 수 있다), "…"·"""…""", 날 글자 #"…"#(# 개수만큼). 이스케이프는 \ + # 개수.
export const maskSwift = (s) => {
  const blank = [];
  const outer = []; // \( 안에 들어갈 때 바깥 글자와 괄호 깊이를 쌓는다
  const n = s.length;
  let str = null; // { hashes, multi, from }
  let depth = 0;
  let i = 0;
  while (i < n) {
    const c = s[i];
    if (str) {
      if (c === '\\' && s.startsWith('#'.repeat(str.hashes), i + 1)) {
        const j = i + 1 + str.hashes;
        if (s[j] === '(') {
          blank.push([str.from, i]);
          outer.push({ str, depth });
          str = null;
          depth = 0;
          i = j + 1;
        } else i = j + 1; // 이스케이프된 글자 하나를 건너뛴다
        continue;
      }
      if (c === '"') {
        const q = str.multi ? 3 : 1;
        if ((!str.multi || s.startsWith('"""', i)) && s.startsWith('#'.repeat(str.hashes), i + q)) {
          blank.push([str.from, i]);
          i += q + str.hashes;
          str = null;
          continue;
        }
      }
      if (c === '\n' && !str.multi) {
        // 닫히지 않은 한 줄 글자는 줄 끝에서 끝난 것으로 본다(고치는 중인 코드에서 뒤 줄 전체를 글자로 보지 않게)
        blank.push([str.from, i]);
        str = null;
      }
      i++;
      continue;
    }
    if (c === '/' && s[i + 1] === '/') {
      const e = lineEnd(s, i);
      blank.push([i, e]);
      i = e;
      continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      let d = 1;
      let j = i + 2;
      while (j < n && d) {
        if (s[j] === '/' && s[j + 1] === '*') (d++, (j += 2));
        else if (s[j] === '*' && s[j + 1] === '/') (d--, (j += 2));
        else j++;
      }
      blank.push([i, j]);
      i = j;
      continue;
    }
    if (c === '#' || c === '"') {
      let j = i;
      while (s[j] === '#') j++;
      if (s[j] === '"') {
        const multi = s.startsWith('"""', j);
        str = { hashes: j - i, multi, from: j + (multi ? 3 : 1) };
        i = str.from;
        continue;
      }
      i = j;
      continue;
    }
    if (outer.length) {
      if (c === '(') depth++;
      else if (c === ')') {
        if (depth === 0) {
          const f = outer.pop();
          str = f.str;
          str.from = i + 1;
          depth = f.depth;
          i++;
          continue;
        }
        depth--;
      }
    }
    i++;
  }
  if (str) blank.push([str.from, n]);
  return blankOut(s, blank);
};

// Python: # 주석, '…' "…" '''…''' """…""", 앞붙이 r·b·u·f·t(둘까지). f-글자의 {{ }} 는 글자, { … } 안은 코드.
// 줄 잇기(\ + 줄바꿈)의 \ 도 가린다(`shell=\` 다음 줄 `True` 를 한 덩어리로 보려고).
const PREFIX = /^(?:[rRuUbBfFtT]|[rR][bBfFtT]|[bBfFtT][rR])$/;
const WORD = /[\w]/;
export const maskPython = (s) => {
  const blank = [];
  const stack = []; // { t: 'str', q, triple, f, from } · { t: 'field', depth }
  const n = s.length;
  let i = 0;
  while (i < n) {
    const top = stack[stack.length - 1];
    const c = s[i];
    if (top?.t === 'str') {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (top.f && c === '{') {
        if (s[i + 1] === '{') {
          i += 2;
          continue;
        }
        blank.push([top.from, i]);
        stack.push({ t: 'field', depth: 0 });
        i++;
        continue;
      }
      if (top.f && c === '}' && s[i + 1] === '}') {
        i += 2;
        continue;
      }
      const close = top.triple ? top.q.repeat(3) : top.q;
      if (c === top.q && s.startsWith(close, i)) {
        blank.push([top.from, i]);
        stack.pop();
        i += close.length;
        continue;
      }
      if (c === '\n' && !top.triple) {
        blank.push([top.from, i]);
        stack.pop();
      }
      i++;
      continue;
    }
    if (c === '#') {
      const e = lineEnd(s, i);
      blank.push([i, e]);
      i = e;
      continue;
    }
    if (c === '\\' && (s[i + 1] === '\n' || (s[i + 1] === '\r' && s[i + 2] === '\n'))) {
      blank.push([i, i + 1]);
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      let k = i;
      while (k > 0 && /[A-Za-z]/.test(s[k - 1]) && i - k < 3) k--;
      const pre = s.slice(k, i);
      const isPrefix = pre && PREFIX.test(pre) && (k === 0 || !WORD.test(s[k - 1]));
      const triple = s.startsWith(c.repeat(3), i);
      const len = triple ? 3 : 1;
      stack.push({ t: 'str', q: c, triple, f: isPrefix && /[fFtT]/.test(pre), from: i + len });
      i += len;
      continue;
    }
    if (top?.t === 'field') {
      if (c === '(' || c === '[' || c === '{') top.depth++;
      else if (c === ')' || c === ']') top.depth--;
      else if (c === '}') {
        if (top.depth <= 0) {
          stack.pop();
          stack[stack.length - 1].from = i + 1;
          i++;
          continue;
        }
        top.depth--;
      }
    }
    i++;
  }
  const open = stack[stack.length - 1];
  if (open?.t === 'str') blank.push([open.from, n]);
  return blankOut(s, blank.sort((a, b) => a[0] - b[0]));
};
