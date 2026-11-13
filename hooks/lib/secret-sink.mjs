// 비밀값 명령(lib/secret-read.mjs)의 출력이 화면(그러니 대화 기록)에 분명히 닿는지 — ask-cmd 의 비밀값 판정에 딸림.
// 프로젝트 원칙 「헛물음이 놓침보다 나쁘다」(세 번째 검토 2026-11-12, docs/decisions-hooks.md): 닿는 것이 분명할 때만 묻는다.
//   1) 비밀값 명령의 표준 출력이 그대로 화면으로(파이프·파일 넘겨쓰기·$( )·변수 받기 없이). 2>&1 · 2> · &> 는 넘겨쓰기로 읽는다
//   2) 파이프로 넘겨도, 받은 것을 찍는 도구(lib/secret-stage.mjs passes — cat·jq·base64·grep·tee·sh·python -c·ConvertFrom-Json …)만
//      지나 끝까지 가면. 모르는 도구(kubeseal·kubectl apply -f -·gpg·clip·wc …)를 만나면 거기서 멈춘다
//   3) $( )·백틱·<( ) 의 값은 그 바깥 명령이 찍는 명령(echo·printf·Write-Host·Write-Output·cat <<<·kubectl create -o yaml)일 때만.
//      변수에 받으면(X=$( ) · export · PowerShell $x = …) 같은 명령줄 뒤에서 그 변수를 찍는 명령(echo $X · printenv · set · $x · dir variable:)이 있을 때만
//   4) 파일로 넘기면 같은 명령줄 뒤에서 그 파일을 찍는 도구(cat·less·head·Get-Content …)로 읽을 때만. 클립보드는 꺼내면(pbpaste·Get-Clipboard)
// 명령줄은 파이프 한 칸(조각) 단위로 본다: 안쪽 치환은 _ 로 채워 한 낱말로 만들고(바깥 구조만 남게), 치환마다 그 본문을 따로 나눈다.
import { POWERSHELL, commandSegments, stripQuoted, fillRanges } from './cmdline.mjs';
import { parseStage, stdoutOf, passes, echoes, hostWriter, writtenFiles, teeScreen, readsFile, readsArgFile, clipWriter, clipReader, refEmits, envDump } from './secret-stage.mjs';

// $( … ) · bash 백틱 · bash <( … ) · >( … ) · PowerShell 의 = ( … ) 를 찾는다(작은따옴표 밖 — 큰따옴표 안도).
// { open, from, to, kind }: open 은 $·`·<·( 자리, [from, to) 는 본문, to 는 닫는 자리. kind: sub · in(<( )) · out(>( ))
// 깊이는 SUB_DEPTH 까지만 들어간다(아주 깊은 중첩이 스택을 넘치지 않게)
const SUB_DEPTH = 8;
const closeParen = (s, at, end, esc) => {
  let depth = 0;
  for (let i = at; i < end; i++) {
    const c = s[i];
    if (c === esc) i++;
    else if (c === "'") { const j = s.indexOf("'", i + 1); if (j === -1 || j >= end) return -1; i = j; }
    else if (c === '"') { let j = i + 1; while (j < end && s[j] !== '"') j += s[j] === esc ? 2 : 1; if (j >= end) return -1; i = j; }
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
};
export const substitutions = (s, shell) => {
  const ps = shell === POWERSHELL;
  const esc = ps ? '`' : '\\';
  const out = [];
  const scan = (from, end, depth) => {
    let dq = false;
    for (let i = from; i < end; i++) {
      const c = s[i];
      if (c === esc) { i++; continue; }
      if (!dq && c === "'") { const j = s.indexOf("'", i + 1); if (j === -1 || j >= end) return; i = j; continue; }
      if (c === '"') { dq = !dq; continue; }
      const group = ps && !dq && c === '(' && /=\s*$/.test(s.slice(Math.max(from, i - 16), i));
      const proc = !ps && !dq && (c === '<' || c === '>') && s[i + 1] === '(' && s[i - 1] !== c;
      if ((c === '$' && s[i + 1] === '(') || group || proc) {
        const at = group ? i : i + 1;
        const close = closeParen(s, at, end, esc);
        if (close === -1) return;
        out.push({ open: i, from: at + 1, to: close, kind: proc ? (c === '<' ? 'in' : 'out') : 'sub' });
        if (depth < SUB_DEPTH) scan(at + 1, close, depth + 1);
        i = close;
        continue;
      }
      if (!ps && c === '`') {
        let j = i + 1;
        while (j < end && s[j] !== '`') j += s[j] === '\\' ? 2 : 1;
        if (j >= end) return;
        out.push({ open: i, from: i + 1, to: j, kind: 'sub' });
        if (depth < SUB_DEPTH) scan(i + 1, j, depth + 1);
        i = j;
      }
    }
  };
  scan(0, s.length, 0);
  return out;
};
// at 을 품은 가장 안쪽 치환(but 은 빼고)
const innermost = (subs, at, but = null) => {
  let best = null;
  for (const s of subs) if (s !== but && s.from <= at && at < s.to && (!best || s.from > best.from)) best = s;
  return best;
};

// 문장(파이프라인)과 조각 나누기 — bare(따옴표 속을 비운 글) 위에서. 2>&1 · >&2 · &> · >| 의 & · | 는 나누지 않는다.
// PowerShell 은 ( ) { } [ ] 안(메서드 호출·스크립트 블록)을 나누지 않고, & 는 줄 끝의 백그라운드만 나눈다(앞의 & 는 호출 연산자)
const layout = (bare, ps) => {
  const pipes = [];
  let stages = [];
  let from = 0;
  let depth = 0;
  const cutStage = (to) => { stages.push({ from, to }); from = to + 1; };
  const cutPipe = (to, skip = 0) => { cutStage(to); pipes.push(stages); stages = []; from = to + 1 + skip; };
  for (let i = 0; i < bare.length; i++) {
    const c = bare[i];
    if (ps && (c === '(' || c === '{' || c === '[')) { depth++; continue; }
    if (ps && (c === ')' || c === '}' || c === ']')) { if (depth) depth--; continue; }
    if (depth) continue;
    if (c === '\n' || c === ';' || (!ps && (c === '(' || c === ')'))) cutPipe(i);
    else if (c === '&') {
      if (bare[i + 1] === '&') { cutPipe(i, 1); i++; }
      else if (ps ? /^[ \t]*(?:$|[\r\n;])/.test(bare.slice(i + 1, i + 64)) : bare[i - 1] !== '>' && bare[i - 1] !== '<' && bare[i + 1] !== '>') cutPipe(i);
    } else if (c === '|') {
      if (bare[i + 1] === '|') { cutPipe(i, 1); i++; }
      else if (bare[i - 1] !== '>') { cutStage(i); if (!ps && bare[i + 1] === '&') { from++; i++; } }
    }
  }
  cutPipe(bare.length);
  return pipes;
};

// 한 판(맨 위 명령줄 또는 치환 본문): 안쪽 치환을 _ 로 채운 글 위의 문장·조각
const boxOf = (ctx, sub) => {
  const key = sub ? sub.open : -1;
  if (ctx.boxes.has(key)) return ctx.boxes.get(key);
  const from = sub ? sub.from : 0;
  const to = sub ? sub.to : ctx.view.length;
  const fills = [];
  let reach = -1;
  for (const s of ctx.subs) {
    if (s === sub || s.open < from || s.to >= to || s.open <= reach) continue;
    fills.push([s.open - from, s.to + 1 - from]);
    reach = s.to;
  }
  const raw = fillRanges(ctx.cmd.slice(from, to), fills);
  const bare = stripQuoted(fillRanges(ctx.view.slice(from, to), fills), ctx.shell);
  const box = { sub, from, raw, bare, pipes: layout(bare, ctx.ps), parsed: new Map() };
  ctx.boxes.set(key, box);
  return box;
};
const stageOf = (ctx, box, pi, si) => {
  const k = `${pi}:${si}`;
  if (!box.parsed.has(k)) {
    const { from, to } = box.pipes[pi][si];
    box.parsed.set(k, { ...parseStage(box.raw.slice(from, to), box.bare.slice(from, to), ctx.shell), from, to });
  }
  return box.parsed.get(k);
};
const find = (box, p) => {
  for (const [pi, stages] of box.pipes.entries()) {
    for (const [si, s] of stages.entries()) if (p <= s.to) return [pi, si];
  }
  return [box.pipes.length - 1, box.pipes.at(-1).length - 1];
};

// PowerShell 의 $x = 명령 · [string]$x = … · $env:X = …
const PS_TAKE = /^\s*(?:\[[\w.[\]]+\]\s*)?\$(?:(env):|(?:global|script|local|private):)?([A-Za-z_]\w*)\s*=(?!=)/i;
// bash 의 X=$( · export X=$( · X="…$( (치환 앞 글)
const BASH_ASSIGN = /^\s*(?:(export|local|declare|typeset|readonly)(?:\s+-\w+)*\s+)?(?:[A-Za-z_]\w*=\S*\s+)*([A-Za-z_]\w*)=(?:"[^"]*|')?$/;

// 조각 si 의 표준 출력에 값이 있을 때, 그것이 화면에 닿는지
const flow = (ctx, box, pi, si, depth) => {
  if (depth > SUB_DEPTH) return false;
  const stages = box.pipes[pi];
  const files = [];
  for (let j = si; j < stages.length; j++) {
    const st = stageOf(ctx, box, pi, j);
    if (j > si) {
      if (!passes(st)) return later(ctx, box, pi, [...files, ...writtenFiles(st)], clipWriter(st), depth);
      if (teeScreen(st)) return true;
      files.push(...writtenFiles(st));
    }
    if (hostWriter(st)) return true;
    const out = stdoutOf(st);
    if (out.kind === 'screen') return true;
    if (out.kind === 'file') files.push(out.target);
    if (out.kind !== 'default') return later(ctx, box, pi, files, false, depth);
  }
  return ends(ctx, box, pi, depth) || later(ctx, box, pi, files, false, depth);
};

// bash ( … ) 안의 문장이면, 그 묶음을 닫는 ) 바로 뒤에서 시작하는 문장의 자리(-1: 묶음 밖). layout 이 ( ) 에서 나누므로
// 「) > s.yaml」·「) | kubeseal」 은 그 뒤 문장이 된다 — 묶음의 출력은 그 문장의 첫 조각이 받는다
const groupTail = (box, pi) => {
  let depth = 0;
  for (let i = box.pipes[pi].at(-1).to; i < box.bare.length; i++) {
    const c = box.bare[i];
    if (c === '(') depth++;
    else if (c === ')' && depth-- === 0) return box.pipes.findIndex((p) => p[0].from === i + 1);
  }
  return -1;
};

// 문장 끝까지 넘겨쓰기 없이 간 값: ( ) 묶음 안이면 묶음 뒤를, 맨 위면 화면, PowerShell $x = … 면 그 변수, 치환 본문이면 바깥을 따른다
const ends = (ctx, box, pi, depth) => {
  if (ctx.ps) {
    const m = PS_TAKE.exec(stageOf(ctx, box, pi, 0).raw);
    if (m) return varShown(ctx, box, pi, { name: m[2], env: !!m[1], exported: !!m[1] }, depth);
  } else {
    const pj = groupTail(box, pi);
    if (pj > pi) return flow(ctx, box, pj, 0, depth + 1);
  }
  if (!box.sub) return true;
  if (box.sub.kind === 'out') return true;
  return subShown(ctx, box.sub, depth + 1);
};

// 치환의 값이 바깥 조각에서 어떻게 쓰이는지
const subShown = (ctx, sub, depth) => {
  const box = boxOf(ctx, innermost(ctx.subs, sub.open, sub));
  const p = sub.open - box.from;
  const [pi, si] = find(box, p);
  const st = stageOf(ctx, box, pi, si);
  if (sub.kind === 'in') return readsArgFile(st) && flow(ctx, box, pi, si, depth);
  const pre = st.raw.slice(0, p - st.from);
  if (ctx.ps) {
    // $x = $( … ) — 문장 끝(ends)이 변수로 보낸다. 문장 맨 앞의 "…$( )…" · $( ) 는 그대로 찍힌다
    if (si === 0 && PS_TAKE.test(pre + '_')) return flow(ctx, box, pi, si, depth);
    if (/^\s*(?:&\s*)?(?:@?"[^"]*)?$/.test(pre)) return flow(ctx, box, pi, si, depth);
  } else {
    const m = BASH_ASSIGN.exec(pre);
    if (m) {
      const v = { name: m[2], exported: m[1] === 'export' };
      // X=$( … ) ./deploy.sh — 그 명령의 환경으로만 간다. printenv·env 면 찍힌다
      const tail = st.raw.slice(sub.to + 1 - box.from - st.from);
      if (/^\S*\s+\S/.test(tail) && envDump(st)) return flow(ctx, box, pi, si, depth);
      return varShown(ctx, box, pi, v, depth);
    }
    // 명령 자리의 $( ) 는 값을 명령으로 돌려 「…: command not found」 로 찍는다
    if (/^\s*"?$/.test(pre)) return true;
  }
  const e = echoes(st);
  if (e === 'host') return true;
  return e ? flow(ctx, box, pi, si, depth) : false;
};

// 변수에 받은 값: 같은 판의 뒤 문장에서 그 변수를 찍는 조각이 있고 그 출력이 화면에 닿을 때만
const varShown = (ctx, box, pi, v, depth) => {
  for (let pj = pi + 1; pj < box.pipes.length; pj++) {
    for (let sj = 0; sj < box.pipes[pj].length; sj++) {
      if (refEmits(stageOf(ctx, box, pj, sj), v) && flow(ctx, box, pj, sj, depth)) return true;
    }
  }
  return false;
};

// 파일·클립보드로 넘긴 값: 같은 판의 뒤 문장에서 그것을 찍는 도구로 다시 읽을 때만
const later = (ctx, box, pi, files, clip, depth) => {
  if (!files.length && !clip) return false;
  for (let pj = pi + 1; pj < box.pipes.length; pj++) {
    for (let sj = 0; sj < box.pipes[pj].length; sj++) {
      const st = stageOf(ctx, box, pj, sj);
      if (((files.length && readsFile(st, files)) || (clip && clipReader(st))) && flow(ctx, box, pj, sj, depth)) return true;
    }
  }
  return false;
};

// 한 명령줄의 판·조각은 같은 subs 로 부르는 동안 한 번만 만든다
const contexts = new WeakMap();
const contextOf = (cmd, view, shell, subs) => {
  let ctx = contexts.get(subs);
  if (!ctx || ctx.cmd !== cmd || ctx.shell !== shell) {
    ctx = { cmd, view, shell, ps: shell === POWERSHELL, subs: [...subs].sort((a, b) => a.open - b.open), boxes: new Map() };
    contexts.set(subs, ctx);
  }
  return ctx;
};
// view 의 pos 에서 시작하는 명령의 출력이 화면에 닿는지
const shownAt = (ctx, pos) => {
  const box = boxOf(ctx, innermost(ctx.subs, pos));
  const [pi, si] = find(box, pos - box.from);
  return flow(ctx, box, pi, si, 0);
};

// PowerShell 의 $x = 앞말을 뗀 낱말(비밀값 명령을 알아보려고 — ['$s', '=', 'kubectl', …] · ['$s=kubectl', …])
// 앞의 형 지정([string]$s = … · [string] $s = … · [string[]]$s = … · [object[]]$s = …)도 받는다(독립 검토·다시 검토 2026-11-12).
// 형 이름 안의 [] 한 겹(배열)까지. 형 지정만 있는 낱말([string])은 떼고 다음 낱말을 본다
const CAST = String.raw`\[[^\[\]\s]+(?:\[\])?\]`;
const CAST_ONLY = new RegExp(`^(?:${CAST})+$`);
const PS_VAR = new RegExp(String.raw`^(?:${CAST})*\$(?:\w+:)?[A-Za-z_]\w*`);
export const afterPsAssign = (w) => {
  let i = 0;
  while (i < w.length - 1 && CAST_ONLY.test(w[i])) i++;
  const m = PS_VAR.exec(w[i] || '');
  if (!m) return w;
  const head = w[i].slice(m[0].length);
  const parts = head ? [head, ...w.slice(i + 1)] : w.slice(i + 1);
  if (!parts[0]?.startsWith('=') || parts[0].startsWith('==')) return w;
  const first = parts[0].slice(1);
  return first ? [first, ...parts.slice(1)] : parts.slice(1);
};

// cmd: 원래 명령(변수 쓰임은 가리기 전 글에서 본다 — echo "$X" 는 view 에서 가려진다), view: dataMasked 한 명령(길이가 같다),
// segs: commandSegments(view), k: 비밀값 명령 조각의 자리
export const valueShown = (cmd, view, segs, k, shell, subs = substitutions(view, shell)) => {
  const seg = segs[k];
  return shownAt(contextOf(cmd, view, shell, subs), seg.start + Math.max(0, seg.raw.search(/\S/)));
};

// 조각으로 나뉘지 않는 치환(큰따옴표 속 "$(…)" · bash 백틱) 안의 비밀값 명령. 찍히면 그 조각 글, 아니면 null.
// isSecret(낱말): 비밀값 명령인지(rules/shell.mjs 가 앞붙이를 벗겨 secretRead 로 본다)
const SECRET_TOOLS = /\b(?:aws|kubectl|terraform|tofu|gcloud|az|vault)\b/;
export const hiddenSecret = (cmd, view, segs, shell, isSecret, subs = substitutions(view, shell)) => {
  if (!SECRET_TOOLS.test(view)) return null;
  // 조각은 자리 순 — 치환 본문 안에서 시작하는 조각이 있는지 두 갈래 찾기로(치환·조각이 많아도 곱으로 늘지 않게)
  const segAt = (from) => {
    let lo = 0;
    let hi = segs.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (segs[mid].start < from) lo = mid + 1; else hi = mid; }
    return segs[lo];
  };
  for (const sub of subs) {
    if (segAt(sub.from)?.start < sub.to) continue; // 조각으로 이미 본다
    const body = view.slice(sub.from, sub.to);
    if (!SECRET_TOOLS.test(body)) continue;
    for (const s of commandSegments(body, shell)) {
      if (!isSecret(s.words)) continue;
      if (shownAt(contextOf(cmd, view, shell, subs), sub.from + s.start + Math.max(0, s.raw.search(/\S/)))) return s.raw.trim();
    }
  }
  return null;
};
