// CLAUDE.md 에 넣을 규칙 문장 만들기.
// 규칙 조각(rules/<id>.<lang>.md)의 줄 끝 표시로, 실제로 켠 훅과 문장이 어긋나지 않게 한다.
//   `… {{hook:commit-msg}}`  그 훅이 켜졌을 때만 넣는다
//   `… {{!hook:commit-msg}}` 그 훅이 꺼졌을 때만 넣는다
//   `… {{!skill:pr-writer}}`  그 스킬을 넣지 않았을 때만 넣는다(스킬이 같은 일을 하면 규칙 줄은 겹친다)
//   `… {{judge}}`             판단이 필요해 검사로 막을 수 없는 줄(늘 넣는다)
//   `… {{skill:id}}`          그 스킬을 넣었을 때만. 뒤에 `{{kind:…}}`(저장소 종류)·`{{fmt:…}}`(감지한 커밋·PR 형식)가 더 붙을 수 있다
// 모든 줄은 이 가운데 하나를 단다(scripts/test/rules.test.mjs). 검사로 막을 수 있는 것을 글로만 두지 않으려고 — 글은 놓친다(2026-11-05 사용자 지적).
// 훅이 켜졌을 때 「훅이 막는다」고 알리는 줄은 두지 않는다. 훅이 막을 때 이유를 알려 주므로 매 대화 읽히는 글로 또 적으면 겹친다.
// 예외: 「PR·MR 은 열고 멈춘다」({{hook:self-merge}}) — 훅이 못 보는 길(스크립트 파일)을 Claude 가 아예 시도하지 않게(decisions-hooks.md).
// 줄 속 `{{pr}}` 은 저장소 위치에 맞는 낱말(PR·MR — rule-files.mjs prWord), `{{cmd:…}}` 은 이 저장소 명령으로 채운다.
import { TAG, PR_SLOT, prWord, kindFits, fmtFits, ruleFiles, ruleFileLines, lineByHash } from './rule-files.mjs';
import { vcsTexts, enforcedBy } from './vcs-text.mjs';
import { askPatterns, matches, variants, dryMarked, blockHit, cmdList } from '../../hooks/lib/ask-match.mjs';
import { runWords } from '../../hooks/lib/run-prefix.mjs';

export const START = '<!-- harness-fit:start -->';
export const END = '<!-- harness-fit:end -->';
// 스킬은 여럿을 | 로 이을 수 있다: {{!skill:caveman|ponytail}} = 둘 다 없을 때만
export { TAG };
// 줄 가운데 `{{cmd:test}}` 는 저장소에서 읽은 그 종류의 명령으로 채운다(scripts/lib/commands.mjs). 명령이 없으면 그 줄은 넣지 않는다.
// `{{cmd:testOne|file=파일}}` 처럼 이름=말을 붙이면 명령 속 자리표시 `<file>` 을 그 언어 말 `<파일>` 로 바꾼다(말은 규칙 파일에 둔다).
const CMD = /\{\{cmd:(\w+)((?:\|\w+=[^|}]+)*)\}\}/;
// `{{pr}}` 은 저장소 위치에 맞는 낱말로(rule-files.mjs prWord — 충돌 창 conflicts.mjs 도 같이 쓴다)
export { prWord };
// → 명령을 채운 줄. 명령 자리가 없으면 그대로, 그 종류의 명령을 못 찾았으면 null(줄을 넣지 않는다).
// `{{fmt:commit}}` 은 감지한 커밋·PR 형식 글(cmds.fmt — scripts/lib/vcs-text.mjs vcsTexts)로 채운다. 글이 없으면 그 줄은 넣지 않는다.
const FMT = /\{\{fmt:(\w+)\}\}/g;
export const fillCmd = (text, cmds = {}) => {
  // {{pr}} 은 renderRuleDetail 이 먼저 채운다. 줄만 보여 주는 곳(overlap.mjs ruleLines)은 cmds.pr, 없으면 둘 다
  text = text.replace(PR_SLOT, cmds.pr || 'PR/MR');
  const keys = [...text.matchAll(FMT)].map((x) => x[1]);
  if (keys.length) {
    if (keys.some((k) => typeof cmds.fmt?.[k] !== 'string' || !cmds.fmt[k])) return null;
    text = text.replace(FMT, (m, k) => cmds.fmt[k]);
  }
  const c = text.match(CMD);
  if (!c) return text;
  const list = cmds[c[1]] || [];
  if (!list.length) return null;
  const words = Object.fromEntries(c[2].split('|').filter(Boolean).map((x) => x.split('=')));
  const say = (cmd) => cmd.replace(/<(\w+)>/g, (m, k) => (words[k] ? `<${words[k]}>` : m));
  return text.replace(CMD, list.map((x) => `\`${say(x)}\``).join(' · '));
};

// skip: 넣지 않을 「- 」 줄 번호(1부터, 파일에 적힌 순서 — scripts/overlap.mjs 가 보여 주는 번호). 프로젝트·전역 CLAUDE.md 에 이미 같은 말이 있는 줄이다(setup 때 Claude 가 견줌).
// cmds: { test: ['npm test'], … }(이 저장소 명령). 모든 줄이 빠지면 그 규칙은 통째로 넣지 않는다.
// → { text, dropped } — dropped 는 훅·스킬이 맡거나 이미 CLAUDE.md 에 있어 뺀 줄: { at: 글 몇째 줄 앞에 있었는지, text, by: hook|skill|existing, who: [id] }
//   (화면 「뺀 줄 보기」. 꺼진 훅 전용 줄처럼 그 조건에 해당하지 않아 안 넣는 줄은 「뺀 줄」이 아니다.)
// kinds: 저장소 종류(detect.mjs). {{kind:…}} 줄은 맞는 종류일 때만 넣는다(모르면 넣는다).
// mine: 사용자 규칙과 반대라 넣지 않을 줄 번호(사용자가 「내 규칙」을 고른 것 — scripts/lib/conflicts.mjs). 뺀 줄에 by: 'conflict' 로 남는다.
export const renderRuleDetail = (id, lang, hooks, skip = [], skills = [], cmds = {}, kinds = null, mine = []) => {
  const raw = ruleFileLines(id, lang);
  if (!raw) return { text: '', dropped: [] };
  // {{pr}}: 저장소에 맞는 낱말 하나(GitHub PR · GitLab MR, 모르면 둘 다) — cmds.pr 는 renderAll 이 저장소 위치로 채운다
  const word = cmds.pr || prWord(null, lang);
  const lines = raw.map((l) => l.replace(PR_SLOT, word));
  const on = new Set([...hooks.map((x) => `hook:${x}`), ...skills.map((x) => `skill:${x}`)]);
  const drop = new Set(skip);
  const against = new Set(mine);
  const out = [];
  const dropped = [];
  let n = 0;
  let kept = 0;
  for (const line of lines) {
    // 줄 번호는 파일에 적힌 「- 」 줄 순서 그대로(훅을 켜고 꺼도 번호가 밀리지 않게)
    const bullet = /^- /.test(line);
    if (bullet) n++;
    const m = line.match(TAG);
    if (!kindFits(m, kinds) || !fmtFits(m, cmds.fmt)) continue;
    const who = m?.[2] ? m[3].split('|').filter((x) => on.has(`${m[2]}:${x}`)) : [];
    const text = !m ? line : !m[2] || (m[1] === '!') !== who.length > 0 ? line.replace(TAG, '') : null;
    if (text == null) {
      if (m[1] === '!') dropped.push({ at: out.length, text: line.replace(TAG, ''), by: m[2], who });
      continue;
    }
    const filled = fillCmd(text, cmds);
    if (filled == null) continue;
    if (bullet) {
      if (against.has(n)) {
        dropped.push({ at: out.length, text: filled, by: 'conflict', who: [], line: n });
        continue;
      }
      if (drop.has(n)) {
        dropped.push({ at: out.length, text: filled, by: 'existing', who: [] });
        continue;
      }
      kept++;
    }
    out.push(filled);
  }
  return kept ? { text: out.join('\n').trim(), dropped } : { text: '', dropped };
};
export const renderRule = (...a) => renderRuleDetail(...a).text;

// 들어갈 규칙 id(이 저장소 명령 → 브랜치 전략 → 나머지 순서. 명령이 맨 위 — 매번 쓰는 것이라)
const ruleOrder = (sel) => {
  const rules = sel.rules || [];
  // 커밋·PR 형식은 협업 지침 바로 뒤(없으면 맨 뒤) — 저장소에서 읽은 글이지만 커밋·PR 을 쓸 때만 본다
  const rest = rules.filter((id) => id !== 'commands' && id !== 'vcs-format');
  if (rules.includes('vcs-format')) rest.splice(rest.includes('collab') ? rest.indexOf('collab') + 1 : rest.length, 0, 'vcs-format');
  return [rules.includes('commands') ? 'commands' : null, sel.flow !== 'none' ? sel.flow : null, ...rest].filter(Boolean);
};
// 「실행 전에 묻기」(ask-cmd)에 든 명령은 「이 저장소 명령」에 평소 명령으로 적지 않는다 — 같은 글이 「쓸 명령」과 「사람이 정할 명령」을
// 함께 말하던 일(make backfill·make apply-dev — 역할극 10·15 회차, 2026-11-13). 맞추기는 훅과 같은 꼴(hooks/lib/ask-match.mjs)이라
// make backfill 을 물어도 make backfill-dry 는 남는다. 화면에서 묻는 명령을 고치면 이 줄도 따라 바뀐다.
// 훅이 묻지 않는 시험 실행·읽기 전용 꼴(make -n …·fastlane match --readonly)도 남긴다(dryMarked — 훅과 같은 판정)
const split = (s) => String(s).trim().split(/\s+/).filter(Boolean);
// 막는 명령(block)에 든 것도 뺀다 — 훅이 막는 명령이 「그 밖의 명령」 에 남던 일(검토 2026-11-13). 막기는 시험 실행 표시도 보지 않으므로 그 꼴도 뺀다
const listOf = (v) => {
  try {
    return cmdList(v);
  } catch {
    return [];
  }
};
export const withoutAsked = (cmds, ask, block = []) => {
  const list = listOf(ask);
  const blocked = listOf(block);
  if (!list.length && !blocked.length) return cmds;
  const pats = askPatterns(list, {}, split);
  const bpats = askPatterns(blocked, {}, split);
  const asked = (c) => {
    const w = split(c);
    const line = runWords(w);
    return (!dryMarked(w, line) && variants(line, {}, w).some((l) => pats.some((p) => matches(l, p)))) || blockHit(w, line, bpats, {});
  };
  const out = {};
  for (const [kind, v] of Object.entries(cmds || {})) {
    const keep = Array.isArray(v) ? v.filter((c) => !asked(c)) : v;
    if (!Array.isArray(keep) || keep.length) out[kind] = keep;
  }
  return out;
};
// 「사람이 실행하는 명령」 줄({{cmd:asked}} — rules/commands.*.md)에 보일 묻는 명령 수. 저장소에서 찾은 것(make apply-prod·scripts/*.sh)이 목록 앞이다
// (평소 명령에서 뺀 것을 어디에도 적지 않아, 사람이 쓰는 명령이라는 표시가 없었다 — 역할극 15 회차 M8, 2026-11-13)
const ASKED_SHOWN = 5;
// 막는 명령(block)도 사람이 실행하는 명령이다 — 막는 명령을 먼저 둔다(같은 것은 한 번). 묻는 명령 뒤에 이으면
// 묻는 명령이 많을 때 막는 make release·release.sh 가 앞 5개에 들지 못해 보이지 않았다(역할극 16 회차 다시, 2026-11-13)
export const askedCmds = (ask, block = []) => [...new Set([...listOf(block), ...listOf(ask)])].slice(0, ASKED_SHOWN);
const renderAll = (sel) => {
  // 이미 있는 훅이 막아 주는 것(covered)도 「켜짐」으로 친다 — 꺼짐 전용 줄이 그 훅과 겹치지 않게
  const hooks = [...(sel.hooks || []), ...(sel.covered || [])];
  const ask = sel.hookOpts?.['ask-cmd']?.commands;
  const block = sel.hookOpts?.['ask-cmd']?.block;
  const base = hooks.includes('ask-cmd') ? { ...withoutAsked(sel.commands || {}, ask, block), asked: askedCmds(ask, block) } : sel.commands || {};
  // 감지한 커밋·PR 형식 글({{fmt:…}} — 「커밋·PR 형식」 지침을 넣을 때만). 우리 커밋 형식 훅이 막는 것(타입·언어)은 글에서 뺀다
  const fmt = (sel.rules || []).includes('vcs-format') ? vcsTexts(sel.vcs, sel.lang, enforcedBy(sel.hooks || [], sel.hookOpts?.['commit-msg'])) : {};
  const cmds = { ...base, fmt, pr: prWord(sel.host, sel.lang) };
  // 사용자 규칙과 반대라 「내 규칙」을 고른 줄(selection.conflicts — scripts/lib/conflicts.mjs). 순환 import 를 피하려고 여기서 바로 고른다.
  // 줄은 지문(hash)으로 다시 찾는다 — 번호만 믿으면 플러그인 업데이트로 줄이 끼어들 때 엉뚱한 줄이 빠진다. 못 찾으면 빼지 않는다
  const lineOf = (c) => (typeof c.hash === 'string' ? lineByHash(c.id, c.lang === 'en' || c.lang === 'ko' ? c.lang : sel.lang, c.hash) : c.line);
  const mine = (id) => (Array.isArray(sel.conflicts) ? sel.conflicts : []).filter((c) => c.kind === 'rule' && c.choice === 'mine' && c.id === id).map(lineOf).filter(Number.isInteger);
  return ruleOrder(sel).map((id) => [id, renderRuleDetail(id, sel.lang, hooks, sel.skipLines?.[id] || [], sel.skills || [], cmds, sel.kinds || null, mine(id))]);
};

// { 규칙 id: [훅 id] } — 켜면 그 규칙의 줄 하나를 대신 맡는 훅({{!hook:id}}, 파일에 적힌 순서). 화면 「줄을 대신 맡는 훅」 칩.
export const ruleHookTags = (lang) => {
  const out = {};
  for (const [rule, lines] of ruleFiles(lang)) {
    const ids = [];
    for (const line of lines) {
      const t = line.match(TAG);
      if (t?.[1] === '!' && t[2] === 'hook') for (const id of t[3].split('|')) if (!ids.includes(id)) ids.push(id);
    }
    if (ids.length) out[rule] = ids;
  }
  return out;
};

// 고른 것 → { 규칙 id: 들어갈 문장 }. 브랜치 방식도 규칙 하나로 친다.
export const ruleTexts = (sel) => Object.fromEntries(renderAll(sel).filter(([, r]) => r.text).map(([id, r]) => [id, r.text]));
// 고른 것 → { 규칙 id: 뺀 줄 목록 }(뺀 줄이 있는 규칙만 — 화면 「뺀 줄 보기」)
export const ruleDropped = (sel) => Object.fromEntries(renderAll(sel).filter(([, r]) => r.dropped.length).map(([id, r]) => [id, r.dropped]));

// 관리 구역(START~END) 찾기. 표시는 줄 하나가 통째로 표시일 때만(앞뒤 공백은 봐준다), 코드 울타리(``` · ~~~) 밖에서만 센다 —
// 사용자가 문장 안에 표시를 인용하거나 코드 예시로 적은 것을 구역으로 보고 그 사이 글을 지우던 일(검토 2026-11-16).
// → { lines, eol, start, end }(줄 번호, 0부터) · null(표시 없음) · { lines, eol, bad: true }(시작이 둘 이상·끝이 없음·끝이 먼저 등 짝이 안 맞음)
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
// 줄마다 원래 줄바꿈(seps)을 지킨다 — CRLF 줄 하나 때문에 LF 파일 전체가 CRLF 로 바뀌던 일. 새로 넣는 줄은 첫 줄의 줄바꿈을 따른다.
// 맨 앞 BOM 은 떼어 두었다가 다시 붙인다(첫 줄이 시작 표시면 BOM 이 사라지던 일 — 회귀 확인 2026-11-16)
const BOM = '﻿';
const scanMarkers = (lines, useFence) => {
  const starts = [];
  const ends = [];
  let fence = null;
  lines.forEach((line, i) => {
    const f = useFence && line.match(FENCE);
    if (fence) {
      // 닫는 울타리: 같은 글자로 같거나 더 길게, 뒤에 다른 글 없이
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !line.trim().slice(f[1].length).trim()) fence = null;
      return;
    }
    if (f) return void (fence = f[1]);
    const t = line.trim();
    if (t === START) starts.push(i);
    else if (t === END) ends.push(i);
  });
  return { starts, ends, open: !!fence };
};
export const findBlock = (text) => {
  if (!text) return null;
  const bom = text.startsWith(BOM) ? BOM : '';
  const body = bom ? text.slice(1) : text;
  const parts = body.split(/(\r?\n)/);
  const lines = [];
  const seps = [];
  for (let i = 0; i < parts.length; i += 2) { lines.push(parts[i]); seps.push(parts[i + 1] || ''); }
  const crlf = (body.match(/\r\n/g) || []).length;
  const eol = crlf * 2 > (body.match(/\n/g) || []).length ? '\r\n' : '\n'; // 새로 넣는 줄은 더 많은 쪽을 따른다
  // 닫히지 않은 울타리(``` 만 적고 끝냄)가 위에 있으면 그 아래 표시를 모두 코드로 봐 구역을 못 찾고 적용마다 새 구역을 더했다 — 그때는 울타리를 보지 않고 다시 센다
  let m = scanMarkers(lines, true);
  if (m.open) m = scanMarkers(lines, false);
  const { starts, ends } = m;
  if (!starts.length && !ends.length) return null;
  if (starts.length !== 1 || ends.length !== 1 || ends[0] < starts[0]) return { lines, seps, eol, bom, bad: true };
  return { lines, seps, eol, bom, start: starts[0], end: ends[0] };
};
// 줄 번호 [from, to) 를 원래 줄바꿈 그대로 잇기
const joinLines = (b, from, to) => b.lines.slice(from, to).map((l, i) => l + b.seps[from + i]).join('');
// 표시가 짝이 안 맞는지(지우기·적용이 손대지 않고 알린다)
export const blockBroken = (text) => !!findBlock(text)?.bad;
export const extractBlock = (text) => {
  const b = findBlock(text);
  return b && !b.bad ? b.lines.slice(b.start, b.end + 1).join(b.eol) : '';
};
// 구역이 몇 줄인가(지우기 미리보기에 크기를 보이려고 — 표시 줄 포함). 구역이 없으면 0
export const blockLineCount = (text) => {
  const b = findBlock(text);
  return b && !b.bad ? b.end - b.start + 1 : 0;
};

// 관리 구역만 block 으로 바꾼다(빈 문자열이면 구역을 뺀다). 사용자가 쓴 나머지는 건드리지 않는다. 줄바꿈은 파일 것(CRLF 도)을 따른다.
// 표시가 짝이 안 맞으면 아무것도 바꾸지 않는다(어디까지가 우리 글인지 알 수 없다 — 부르는 쪽이 blockBroken 으로 알린다).
// 구역 앞의 빈 줄은 없애고, 뒤의 글은 그대로 둔다(앞에 글이 없으면 뒤 글 머리의 빈 줄도 없앤다).
export const setBlock = (current, block) => {
  const b = findBlock(current);
  if (b?.bad) return current;
  const eol = b?.eol || (current?.match(/\r?\n/) || ['\n'])[0];
  const blockLines = block ? block.split('\n').map((l) => l.replace(/\r$/, '')) : [];
  if (b) {
    // 구역 앞의 빈 줄은 없애고(줄 번호 head), 뒤의 글은 원래 줄바꿈 그대로(tailFrom~)
    let head = b.start;
    while (head > 0 && !b.lines[head - 1].trim()) head--;
    let tailFrom = b.end + 1;
    if (!head && !blockLines.length) while (tailFrom < b.lines.length - 1 && !b.lines[tailFrom].trim()) tailFrom++;
    // 앞 글은 원래 줄바꿈 그대로(앞 글의 마지막 줄 뒤에는 늘 줄바꿈이 있다 — 그 뒤에 구역이나 빈 줄이 있었으니)
    const headText = joinLines(b, 0, head);
    const mid = blockLines.length ? `${head ? eol : ''}${blockLines.join(eol)}${eol}` : '';
    const tail = joinLines(b, tailFrom, b.lines.length);
    // 구역 끝 표시가 파일 마지막 줄(줄바꿈 없음)이면 tail 이 비어 있다 — mid 가 이미 줄바꿈으로 끝난다
    return b.bom + headText + mid + tail;
  }
  if (!block) return current;
  return current ? `${current.replace(/\s*$/, '')}${eol}${eol}${blockLines.join(eol)}${eol}` : `${block}\n`;
};

export const buildClaudeMd = (current, sel) => {
  const body = Object.values(ruleTexts(sel)).join('\n\n');
  return setBlock(current, body ? `${START}\n${body}\n${END}` : '');
};
