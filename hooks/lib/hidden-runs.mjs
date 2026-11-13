// 조각 나누기(cmdline.mjs commandSegments)로는 안 보이는 「실행되는 글」 — ask-cmd 의 막기·묻기, danger-cmd, 보호 파일(shell-writes)이 함께 쓴다.
// 검토 2026-11-13: echo `X`·echo "X" | bash·bash <<<"X"·find … -exec X \; 꼴로 막을 명령이 지나갔다.
// 다시 검토 2026-11-13: echo "$(X)"·printf '%s\n' X | bash·… | tee … | bash·find -delete·Start-Process … -ArgumentList @(…) 도.
// 따옴표 속 글을 실행하는 꼴(bash -c "…"·eval "…"·cmd /c "…")은 pretool.mjs 가 innerCommands 로 이미 따로 본다.
import { BASH, POWERSHELL, commandSegments, dataMasked } from './cmdline.mjs';
import { runWords } from './run-prefix.mjs';
import { substitutions } from './secret-sink.mjs';

const SHELLS = /^(?:ba|z|da|k)?sh$/;
const MAX_DEPTH = 3;
const MAX_RUNS = 32;

// 명령 치환 속 글: bash 의 $(…)·백틱·<(…)·>(…)(큰따옴표 안 포함, 작은따옴표 밖), PowerShell 의 $(…)·$x = (…)
// 맨 바깥 치환만 돌려준다 — 안쪽은 hiddenRuns 가 한 겹씩 다시 본다(모두 돌려주면 $(echo $(echo …)) 에서 겹마다 다시 세어 100초가 걸렸다)
const substituted = (view, shell) => {
  if (!/\$\(|`|[<>]\(|\(/.test(view)) return [];
  const out = [];
  let end = -1;
  for (const s of substitutions(view, shell)) {
    if (s.open < end) continue;
    out.push(view.slice(s.from, s.to));
    end = s.to;
    if (out.length >= MAX_RUNS) break;
  }
  return out;
};

// 셸이 스크립트 파일 없이 표준 입력을 읽는가(bash · bash -s · sh -e). runWords 가 스크립트를 벗기면 첫 낱말이 셸이 아니다.
// -n(문법만 봄)·-c(글을 실행)는 표준 입력을 실행하지 않는다
const readsStdin = (words) => {
  const line = runWords(words);
  return SHELLS.test(line[0] || '') && line.slice(1).every((x) => /^[-+]/.test(x) && !/[cn]/.test(x.slice(1)));
};
const PS_EVAL = /^(?:iex|invoke-expression)$/;
const head = (x) => String(x || '').replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase();
// 파이프 가운데서 받은 글을 그대로 넘기는 단계(… | tee x | bash · … | cat | sh)
const passThrough = (w) => {
  const h = head(w[0]);
  return h === 'tee' || h === 'tee-object' || (h === 'cat' && w.slice(1).every((x) => x === '-'));
};
const pipedTo = (view, a, b) => {
  const end = a.start + a.raw.length;
  return !!b && view[end] === '|' && view[end + 1] !== '|';
};

// printf 의 글: 형식이 %s·%b 만이면 뒤 인자들을 줄로, 아니면 형식 글(\n 은 줄바꿈)
const printfText = (w) => {
  const fmt = w[1] || '';
  if (/^(?:%[sb](?:\\n)?)+$/.test(fmt)) return w.slice(2).join('\n');
  return fmt.replace(/\\n/g, '\n');
};

// 앞 조각이 파이프로 셸에 글을 넘기는가: echo "X" | bash · printf 'X\n' | sh · "X" | iex · echo X | tee log | bash
const pipedText = (view, segs, k, shell) => {
  const seg = segs[k];
  if (!pipedTo(view, seg, segs[k + 1])) return null;
  const w = seg.words;
  const h = head(w[0]);
  let text = null;
  if (h === 'echo' || h === 'write-output') text = w.slice(1).filter((x) => !/^-[neE]+$/.test(x)).join(' ');
  else if (h === 'printf') text = printfText(w);
  else if (shell !== BASH && w.length === 1) text = w[0];
  if (!text) return null;
  let j = k + 1;
  while (j < segs.length - 1 && passThrough(segs[j].words) && pipedTo(view, segs[j], segs[j + 1])) j++;
  const next = segs[j];
  const nw = runWords(next.words);
  return (shell === BASH ? readsStdin(next.words) : PS_EVAL.test(nw[0] || '')) ? text : null;
};

// here-string 을 셸에 넘김: bash <<<"X" · bash <<< X
const hereString = (words) => {
  const at = words.findIndex((x) => x.startsWith('<<<'));
  if (at < 1 || !readsStdin(words.slice(0, at))) return null;
  const body = words[at].length > 3 ? words[at].slice(3) : words.slice(at + 1).join(' ');
  return body || null;
};

// PowerShell Start-Process X -ArgumentList @('a','b') — 괄호에서 조각이 나뉘어 runWords 가 목록을 못 본다. 원래 글에서 「X a b」 를 만든다
const SAPS_LIST = /(?:^|[\s;|&({])(?:Start-Process|saps|start)\s+(?:-FilePath\s+)?(["']?)([^\s"',]+)\1\s+(?:-ArgumentList|-Args)\s+@\(([^)]{0,2000})\)/gi;
const sapsLists = (view) => [...view.matchAll(SAPS_LIST)].slice(0, MAX_RUNS)
  .map((m) => [m[2], ...m[3].split(',').map((x) => x.trim().replace(/^["']|["']$/g, ''))].filter(Boolean).join(' '));

// find 의 시작 경로와, 그 뒤 식에 거르는 조건이 있는지. 거르는 조건이 없으면 -exec 의 {} 는 시작 경로 자신도 받는다
const FIND_VALUE = /^-(?:maxdepth|mindepth)$/;
const FIND_FLAG = /^-(?:depth|xdev|mount|follow|noleaf|daystart|ignore_readdir_race|d)$/;
const findShape = (w, until) => {
  let i = 1;
  while (/^-[HLP]$/.test(w[i] || '')) i++;
  const roots = [];
  while (i < until && !/^[-(!\\]/.test(w[i])) roots.push(w[i++]);
  const expr = [];
  for (; i < until; i++) {
    if (FIND_VALUE.test(w[i])) i++;
    else if (!FIND_FLAG.test(w[i])) expr.push(w[i]);
  }
  // -name 낱말(글롭 아님) 하나만 거르면 그 이름이 대상이다(find . -name .env -delete)
  const name = expr.length === 2 && /^-i?name$/.test(expr[0]) && !/[*?[\]]/.test(expr[1]) ? expr[1] : null;
  return { roots: roots.length ? roots : ['.'], open: expr.length === 0, name };
};
const targetsOf = (shape) => (shape.open ? shape.roots : shape.name ? shape.roots.map((r) => `${r.replace(/\/+$/, '')}/${shape.name}`) : null);

// find … -exec 명령 … ; · -execdir · -ok — 그 명령 낱말들(조각 하나 안에서). 거르는 조건이 없거나 -name 하나면 {} 를 그 대상으로 바꾼다
// (find ~ -maxdepth 0 -exec rm -rf {} \; 는 rm -rf ~ 다). -delete 는 rm 으로 본다(거르는 조건이 없으면 폴더째)
export const execForms = (words) => {
  const line = runWords(words);
  if (head(words[0]) !== 'find' && line[0] !== 'find') return [];
  const w = line[0] === 'find' ? line : words;
  const out = [];
  for (let i = 0; i < w.length; i++) {
    if (w[i] === '-delete') {
      const t = targetsOf(findShape(w, i));
      if (t) out.push(['rm', ...(findShape(w, i).open ? ['-rf'] : ['-f']), ...t]);
      continue;
    }
    if (!/^-(?:exec|execdir|ok|okdir)$/.test(w[i])) continue;
    const from = i + 1;
    let j = from;
    while (j < w.length && !/^(?:\\?;|\+|\\)$/.test(w[j])) j++;
    if (j > from) {
      const t = targetsOf(findShape(w, i));
      out.push(t ? w.slice(from, j).flatMap((x) => (x === '{}' ? t : [x])) : w.slice(from, j));
    }
    i = j;
  }
  return out;
};

// 명령 글 → [{ cmd, shell }] 숨은 곳에서 실행되는 글(몇 겹까지)
// 한 도구 호출에서 여러 규칙(danger-cmd·막기·묻기·보호 파일)이 같은 명령을 묻는다 — 맨 위 결과를 몇 개만 기억한다
const memo = new Map();
export const hiddenRuns = (cmd, shell, view = cmd, depth = 0) => {
  if (depth === 0) {
    const key = `${shell}\0${view}`;
    if (!memo.has(key)) {
      if (memo.size >= 8) memo.delete(memo.keys().next().value);
      memo.set(key, hiddenFrom(view, shell, 0));
    }
    return memo.get(key);
  }
  return hiddenFrom(view, shell, depth);
};
// subst: 명령 치환(백틱·$(…))에서 나온 글인지(바깥 겹이 치환이면 안쪽도) — 막는 글에 「셸이 실제로 실행한다」를 덧붙인다(substNote)
const hiddenFrom = (view, shell, depth, inSubst = false) => {
  if (depth >= MAX_DEPTH) return [];
  const subs = substituted(view, shell);
  const found = [...subs];
  if (shell === POWERSHELL && /@\(/.test(view)) found.push(...sapsLists(view));
  if (view.includes('|') || view.includes('<<<')) {
    const segs = commandSegments(view, shell);
    segs.forEach((seg, k) => {
      const piped = view.includes('|') ? pipedText(view, segs, k, shell) : null;
      if (piped) found.push(piped);
      const here = shell === BASH ? hereString(seg.words) : null;
      if (here) found.push(here);
    });
  }
  const out = [];
  found.slice(0, MAX_RUNS).some((body, k) => {
    if (!body.trim()) return false;
    const subst = inSubst || k < subs.length;
    out.push({ cmd: body, shell, subst }, ...hiddenFrom(body, shell, depth + 1, subst));
    return out.length >= MAX_RUNS * 4;
  });
  return out;
};

// 백틱·$(…)·따옴표 없는 heredoc 속 치환 때문에 막거나 물을 때 덧붙이는 글(검토 2026-11-13: 커밋 메시지 자체가 막힌 줄 알았다)
export const substNote = (t, shell) => ` ${t(shell === POWERSHELL ? 'hidden.substPs' : 'hidden.subst')}`;

// 명령 글 → 조각마다 { seg, words: 원래 낱말 또는 find -exec 속 낱말, line: 앞붙이를 벗긴 낱말 } — 숨은 실행까지.
// skip(seg): 그 조각을 건너뛸지(export 만 하는 조각 등 — 부르는 쪽이 정한다)
export const runForms = function* (cmd, shell, skip = null) {
  const view = dataMasked(cmd, shell);
  for (const { cmd: c, shell: sh, subst = false } of [{ cmd, shell }, ...hiddenRuns(cmd, shell, view)]) {
    const text = c === cmd ? view : dataMasked(c, sh);
    for (const seg of commandSegments(text, sh)) {
      if (skip?.(seg)) continue;
      // 따옴표 밖 $(…) 속은 조각 나누기가 바로 내놓는다 — 그 조각도 치환 속이다
      const inSubst = subst || text.slice(Math.max(0, seg.start - 2), seg.start) === '$(';
      for (const words of [seg.words, ...execForms(seg.words)]) yield { seg, words, line: runWords(words), shell: sh, subst: inSubst };
    }
  }
};
