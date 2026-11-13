// CLAUDE.md 에 넣을 규칙 문장 만들기.
// 규칙 조각(rules/<id>.<lang>.md)의 줄 끝 표시로, 실제로 켠 훅과 문장이 어긋나지 않게 한다.
//   `… {{hook:commit-msg}}`  그 훅이 켜졌을 때만 넣는다
//   `… {{!hook:commit-msg}}` 그 훅이 꺼졌을 때만 넣는다
//   `… {{!skill:pr-writer}}`  그 스킬을 넣지 않았을 때만 넣는다(스킬이 같은 일을 하면 규칙 줄은 겹친다)
//   `… {{judge}}`             판단이 필요해 검사로 막을 수 없는 줄(늘 넣는다)
// 모든 줄은 이 넷 중 하나를 단다(scripts/test/rules.test.mjs). 검사로 막을 수 있는 것을 글로만 두지 않으려고 — 글은 놓친다(2026-11-05 사용자 지적).
// 훅이 켜졌을 때 「훅이 막는다」고 알리는 줄은 두지 않는다. 훅이 막을 때 이유를 알려 주므로 매 대화 읽히는 글로 또 적으면 겹친다.
import { TAG, kindFits, ruleFiles, ruleFileLines } from './rule-files.mjs';
import { askPatterns, matches, variants, dryMarked, blockHit, cmdList } from '../../hooks/lib/ask-match.mjs';
import { runWords } from '../../hooks/lib/run-prefix.mjs';

export const START = '<!-- harness-fit:start -->';
export const END = '<!-- harness-fit:end -->';
// 스킬은 여럿을 | 로 이을 수 있다: {{!skill:caveman|ponytail}} = 둘 다 없을 때만
export { TAG };
// 줄 가운데 `{{cmd:test}}` 는 저장소에서 읽은 그 종류의 명령으로 채운다(scripts/lib/commands.mjs). 명령이 없으면 그 줄은 넣지 않는다.
// `{{cmd:testOne|file=파일}}` 처럼 이름=말을 붙이면 명령 속 자리표시 `<file>` 을 그 언어 말 `<파일>` 로 바꾼다(말은 규칙 파일에 둔다).
const CMD = /\{\{cmd:(\w+)((?:\|\w+=[^|}]+)*)\}\}/;
// → 명령을 채운 줄. 명령 자리가 없으면 그대로, 그 종류의 명령을 못 찾았으면 null(줄을 넣지 않는다).
export const fillCmd = (text, cmds = {}) => {
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
export const renderRuleDetail = (id, lang, hooks, skip = [], skills = [], cmds = {}, kinds = null) => {
  const lines = ruleFileLines(id, lang);
  if (!lines) return { text: '', dropped: [] };
  const on = new Set([...hooks.map((x) => `hook:${x}`), ...skills.map((x) => `skill:${x}`)]);
  const drop = new Set(skip);
  const out = [];
  const dropped = [];
  let n = 0;
  let kept = 0;
  for (const line of lines) {
    // 줄 번호는 파일에 적힌 「- 」 줄 순서 그대로(훅을 켜고 꺼도 번호가 밀리지 않게)
    const bullet = /^- /.test(line);
    if (bullet) n++;
    const m = line.match(TAG);
    if (!kindFits(m, kinds)) continue;
    const who = m?.[2] ? m[3].split('|').filter((x) => on.has(`${m[2]}:${x}`)) : [];
    const text = !m ? line : !m[2] || (m[1] === '!') !== who.length > 0 ? line.replace(TAG, '') : null;
    if (text == null) {
      if (m[1] === '!') dropped.push({ at: out.length, text: line.replace(TAG, ''), by: m[2], who });
      continue;
    }
    const filled = fillCmd(text, cmds);
    if (filled == null) continue;
    if (bullet) {
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
  return [rules.includes('commands') ? 'commands' : null, sel.flow !== 'none' ? sel.flow : null, ...rules.filter((id) => id !== 'commands')].filter(Boolean);
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
  const cmds = hooks.includes('ask-cmd') ? { ...withoutAsked(sel.commands || {}, ask, block), asked: askedCmds(ask, block) } : sel.commands || {};
  return ruleOrder(sel).map((id) => [id, renderRuleDetail(id, sel.lang, hooks, sel.skipLines?.[id] || [], sel.skills || [], cmds, sel.kinds || null)]);
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

// 관리 구역(START~END) 한 덩어리. 표시가 없거나 순서가 거꾸로면(END 가 먼저) 없는 것으로 본다.
const BLOCK = new RegExp(`\\n*${START}[\\s\\S]*?${END}\\n?`);
export const extractBlock = (text) => text?.match(new RegExp(`${START}[\\s\\S]*?${END}`))?.[0] || '';

// 관리 구역만 block 으로 바꾼다(빈 문자열이면 구역을 뺀다). 사용자가 쓴 나머지는 건드리지 않는다.
// 표시가 짝이 안 맞게 남아 있으면(END 만 있음 등) 지우지 않고 끝에 새 구역을 붙인다.
export const setBlock = (current, block) => {
  if (current && BLOCK.test(current)) return current.replace(BLOCK, block ? `\n\n${block}\n` : '\n').replace(/^\n+/, '');
  if (!block) return current;
  return current ? `${current.replace(/\s*$/, '')}\n\n${block}\n` : `${block}\n`;
};

export const buildClaudeMd = (current, sel) => {
  const body = Object.values(ruleTexts(sel)).join('\n\n');
  return setBlock(current, body ? `${START}\n${body}\n${END}` : '');
};
