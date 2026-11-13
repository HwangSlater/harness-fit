// fastlane 레인·동작이 출시·서명에 닿는지. commands.mjs(「이 저장소 명령」에서 빼기)와 suggest.mjs(묻는 명령·배포 스크립트·make 대상·레인)가
// 이 파일 하나의 기준을 쓴다 — 두 곳이 따로 판정해 make ship 이 평소 명령에서는 빠지고 묻는 명령에도 없던 일(검토 2026-11-13).
// 시험·빌드·준비 레인(test·unit_tests·gym·setup_tools·certs 의 match readonly)은 평소 명령이고,
// 출시 레인(beta·release·deploy·upload_testflight …)·올리기 동작·인증서를 새로 만들거나 지우는 동작(readonly 없는 match·cert·sigh·produce·nuke)만 출시·서명으로 본다.
import fs from 'node:fs';
import path from 'node:path';
import { readText } from './stack-scan.mjs';
import { SHIP_ACTION, MATCH_ACTION } from '../../hooks/lib/fastlane-actions.mjs';

// 출시·올리기 레인 이름. NOT_SHIP 은 이름에 출시 낱말이 있어도 글·검사만 하는 레인(release_notes·beta_lint).
// test 뒤 flight 는 뺀다 — upload_testflight·beta_testflight 가 「테스트 레인」으로 빠졌다(검토 2026-11-13)
export const SHIP_LANE = /^(?:beta|release|deploy|deliver|upload|submit|publish|distribute|testflight|appstore|app_store|production|prod|alpha|internal|playstore|play_store)(?:_[a-z0-9]+)*$|_(?:release|deploy|upload|submit|publish|testflight|appstore|production)$/i;
// 디버그 기호 올리기(upload_symbols·upload_dsyms·upload_symbols_to_crashlytics)도 출시가 아니다 — 앱을 바꾸지 않는다(독립 검토 2026-11-13)
export const NOT_SHIP = /notes|changelog|screenshots?|metadata|check|lint|test(?!flight)|dry|symbols?|dsyms?/i;
export const shipLane = (name) => SHIP_LANE.test(name) && !NOT_SHIP.test(name);

// 올리기·서명 동작 목록은 훅과 함께 쓴다(hooks/lib/fastlane-actions.mjs). match·sync_code_signing 은 readonly 일 때만 받기다
const READONLY_ARG = /--readonly\b|readonly:\s*true\b/;

// Fastfile 읽기 → { at: 'fastlane/Fastfile', lanes: 레인 이름 → 본문(다음 레인 머리까지), privates: private_lane 이름 }.
// 문자열·주석·heredoc 본문은 지운다(desc "TestFlight 배포" 가 동작으로 읽히지 않게). Fastfile 이 없으면 at 은 null
const LANE_HEAD = /^\s*(private_)?lane\s+:([A-Za-z_]\w*)/;

// 한 줄의 코드 부분: 문자열은 ""(큰따옴표 속 #{…} 도 함께 — 안의 따옴표·괄호까지), 문자열 밖의 # 부터는 주석.
// 예전엔 주석을 먼저 지워 match(git_url: "#{ENV['U']}", readonly: true) 의 readonly 가 # 뒤로 사라졌다(검토 2026-11-13)
// st: 줄을 넘는 문자열 상태({ quote, depth }) — 닫히지 않은 desc "…⏎ deliver …" 의 다음 줄도 글로 본다.
// 줄마다 따로 읽어 여러 줄 desc 속 낱말이 앞 레인 본문에 새어 fastlane test 를 물었다(검토 2026-11-13)
// 문자열 안(st.quote)에서 i 부터 읽어 닫는 따옴표 자리를 돌려준다. 줄 끝까지 안 닫히면 line.length(st 는 그대로 남는다)
const scanString = (line, i, st) => {
  const c = st.quote;
  for (; i < line.length; i++) {
    if (line[i] === '\\') i++;
    else if (c === '"' && line[i] === '#' && line[i + 1] === '{') { st.depth++; i++; }
    else if (st.depth && line[i] === '{') st.depth++;
    else if (st.depth && line[i] === '}') st.depth--;
    else if (!st.depth && line[i] === c) { st.quote = ''; return i; }
  }
  return line.length;
};
export const codeOf = (line, st = { quote: '', depth: 0 }) => {
  let out = '';
  let i = 0;
  if (st.quote) {
    i = scanString(line, 0, st) + 1;
    if (st.quote) return out;
    out += '""';
  }
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '#') break;
    // 따옴표 친 heredoc 끝 표시(<<~'EOS')는 문자열이 아니라 그대로 둔다
    const doc = c === '<' ? /^<<[~-]?(["'`])\w+\1/.exec(line.slice(i, i + 80)) : null;
    if (doc) { out += doc[0]; i += doc[0].length - 1; continue; }
    if (c !== '"' && c !== "'") { out += c; continue; }
    st.quote = c;
    st.depth = 0; // 큰따옴표 속 #{ … } 깊이
    i = scanString(line, i + 1, st);
    if (st.quote) return out; // 다음 줄로 이어지는 문자열
    out += '""';
  }
  return out;
};
// heredoc 머리(<<~ID·<<-ID, 따옴표 친 ID, 대문자 <<ID). 본문 줄은 글이다 — 「deliver 는 리드만」 이 동작으로 읽혔다(검토 2026-11-13)
const HEREDOC = /<<([~-]?)(["'`]?)([A-Za-z_]\w*)\2/g;
const heredocEnds = (code) => [...code.matchAll(HEREDOC)].filter((m) => m[1] || m[2] || /^[A-Z_]+$/.test(m[3])).map((m) => ({ id: m[3], indented: !!m[1] }));
export const readFastlane = (root) => {
  const dir = ['fastlane', '.fastlane'].find((d) => fs.existsSync(path.join(root, d, 'Fastfile')));
  const lanes = new Map();
  const privates = new Set();
  if (!dir) return { at: null, lanes, privates };
  let cur = null;
  const ends = []; // 기다리는 heredoc 끝 표시(한 줄에 여럿이면 차례대로)
  const st = { quote: '', depth: 0 }; // 줄을 넘는 문자열
  for (const raw of readText(path.join(root, dir, 'Fastfile')).split(/\r?\n/)) {
    if (ends.length) {
      if ((ends[0].indented ? raw.trim() : raw) === ends[0].id) ends.shift();
      continue;
    }
    const head = LANE_HEAD.exec(raw);
    // 레인 머리에서는 열린 문자열을 닫는다 — 짝 없는 따옴표 하나(?' 글자 꼴 등)가 파일 끝까지 삼키지 않게(놓침을 레인 하나로 묶는다)
    if (head) { st.quote = ''; cur = head[2]; lanes.set(cur, ''); if (head[1]) privates.add(cur); continue; }
    if (!st.quote && /^\s*(?:error|before_all|after_all|before_each|after_each)\s+do\b/.test(raw)) cur = null;
    // 머리가 있는 줄의 나머지 코드는 본다(text = <<~T 의 text =)
    const code = codeOf(raw, st);
    ends.push(...heredocEnds(code));
    if (cur) lanes.set(cur, `${lanes.get(cur)}${code}\n`);
  }
  return { at: `${dir}/Fastfile`, lanes, privates };
};
export const fastlaneLanes = (root) => readFastlane(root).lanes;

// 레인 본문이 올리기·서명 자료 만들기를 하는지: 올리기 동작, readonly 없는 match(여러 줄 인자도 닫는 괄호까지 본다)
// calls: 이미 구한 laneCalls(body)(레인마다 한 번만 구하려고)
export const bodyShips = (body, calls = laneCalls(body)) => {
  // 부르는 자리의 낱말만(laneCalls — options[:deliver]·deliver: true 는 동작이 아님)
  if (calls.some((w) => SHIP_ACTION.test(w) || /^upload_to_\w+$/.test(w))) return true;
  return [...body.matchAll(/\b(?:match|sync_code_signing)\s*\(([^)]*)\)?/g)].some((m) => !READONLY_ARG.test(m[1] || ''));
};

// 레인 전부의 판정을 한 번에: 스스로 출시인 레인(이름·본문)에서 「그 레인을 부르는 레인」 쪽으로 거꾸로 퍼뜨린다(명시적 대기열 —
// 몇 단계든, 서로 부르는 레인도 끝난다). 예전엔 레인마다 본문 낱말을 다시 구하고 재귀로 따라가 레인 300개에 3.3초,
// 1500개 × 부르기 50개에 113초, 3000개 사슬에서 호출 스택이 넘쳤다(검토 2026-11-13). lanes Map 하나에 판정 하나를 기억한다
const VERDICTS = new WeakMap();
const verdictsOf = (lanes) => {
  const hit = VERDICTS.get(lanes);
  if (hit && hit.size === lanes.size) return hit.ships;
  const callers = new Map(); // 레인 → 그 레인을 부르는 레인들
  const ships = new Set();
  const queue = [];
  for (const [name, body] of lanes) {
    const calls = laneCalls(body);
    for (const w of calls) if (w !== name && lanes.has(w)) (callers.get(w) || callers.set(w, []).get(w)).push(name);
    if (shipLane(name) || bodyShips(body, calls)) { ships.add(name); queue.push(name); }
  }
  for (let k = 0; k < queue.length; k++) {
    for (const c of callers.get(queue[k]) || []) if (!ships.has(c)) { ships.add(c); queue.push(c); }
  }
  VERDICTS.set(lanes, { size: lanes.size, ships });
  return ships;
};

// 레인 하나가 출시·서명인지: 이름, 본문, 본문이 부르는 다른 레인(lane :ship do beta end)
export const laneShips = (name, lanes = new Map()) => shipLane(name) || (lanes.has(name) && verdictsOf(lanes).has(name));

// 본문에서 레인을 부르는 자리의 낱말만: 앞(빈칸 건너)이 : . [ @ $ 가 아니고(options[:release]·tag: release·x.release·@release),
// 뒤가 : 가 아니며(release: true), 값을 넣는 지역 변수(release = …)가 아닌 것. 아무 낱말이나 레인 부르기로 세어
// `ci` 레인의 options[:release]·`tag` 레인의 add_git_tag(tag: release) 가 출시 레인이 됐다(검토 2026-11-13).
// cond ? beta : release 의 release 는 놓친다(드묾 — 헛물음이 놓침보다 나쁘다)
const prevChar = (s, at) => { let i = at - 1; while (i >= 0 && /\s/.test(s[i])) i--; return s[i] || ''; };
const nextChar = (s, at) => { let i = at; while (i < s.length && /[ \t]/.test(s[i])) i++; return s.slice(i, i + 2); };
export const laneCalls = (body) => {
  const words = [...body.matchAll(/\b[A-Za-z_]\w*\b/g)];
  const assigned = new Set(words.filter((m) => /^=(?![=~>])/.test(nextChar(body, m.index + m[0].length))).map((m) => m[0]));
  return [...new Set(words.filter((m) => !/[:.[@$]/.test(prevChar(body, m.index)) && !nextChar(body, m.index + m[0].length).startsWith(':')
    && !assigned.has(m[0])).map((m) => m[0]))];
};

// 명령줄에서 부를 수 있는(private_lane 이 아닌) 출시·서명 레인 이름, Fastfile 에 적힌 차례대로
export const shipLanes = ({ lanes, privates }) => [...lanes.keys()].filter((n) => !privates.has(n) && laneShips(n, lanes));

// 명령 줄이 출시·서명 fastlane 을 부르는지. lanes: readFastlane(...).lanes(모르면 이름으로만 본다).
// fastlane 바로 뒤 플랫폼 낱말(ios·android·mac)은 건너뛴다 — `bundle exec fastlane ios upload_testflight`
const FASTLANE_CALL = /(?:^|[\s;&|(])fastlane\s+(?:(?:ios|android|mac)\s+)?([a-z_]\w*)([^;&|]*)/gi;
export const releaseFastlane = (line, lanes = new Map()) => [...String(line).matchAll(FASTLANE_CALL)].some(([, first, rest]) => {
  // fastlane run <동작> 은 동작 하나를 바로 부른다
  const run = first === 'run' ? /^\s*([a-z_]\w*)(.*)$/i.exec(rest) : null;
  const [name, args] = run ? [run[1], run[2]] : [first, rest];
  if (MATCH_ACTION.test(name)) return /\bnuke\b/.test(args) || !READONLY_ARG.test(args);
  if (SHIP_ACTION.test(name) || /^upload_to_\w+$/.test(name)) return true;
  return laneShips(name, lanes);
});
