// PreToolUse 훅 진입점. 판정은 lib/pretool.mjs.
// 설정(.claude/harness.json)이 없는 프로젝트가 대부분이므로, 규칙 모듈은 설정이 있을 때만 불러온다.
// 설정이 깨졌으면 막지 않고 「검사가 모두 꺼져 있다」고 알린다(조용히 꺼지지 않게).
// 어디서 터지든(git 없음, 모르는 오류) 막지 않고 통과하되, 검사 없이 진행된다고 알린다 — 훅 오류로 작업이 멈추지 않게, 그러나 조용히 꺼지지도 않게.
// 깨진 입력(JSON 아님 등)은 readInput 이 빈 값으로 바꾸므로 오류가 아니다.
import { readInput, pass, deny, ask, notice, hint, pickLang, translator, crashNotice } from './lib/core.mjs';
import { configsFor } from './lib/target-config.mjs';

// 막지 않을 때 알릴 것(검사 오류, 허용 주석으로 통과시킨 줄)은 한 알림에 줄을 나눠 함께 낸다.
const msgs = [];
const errors = [];
const notes = [];
const hints = []; // 막지 않고 Claude 에게 건넬 글(notice 규칙)
const asks = []; // 실행 전에 사용자에게 물을 까닭(ask 규칙) — 막는 글이 없을 때만 묻는다
let t = null;
try {
  const input = readInput();
  // cwd 의 설정 + 호출이 닿는 저장소의 설정(lib/target-config.mjs) — 보통은 cwd 의 설정 하나
  const { found, broken } = configsFor(input);
  const valid = found.filter((f) => !f.cfg.broken);
  const brokenFiles = [...found.filter((f) => f.cfg.broken).map((f) => f.cfg.broken), ...broken];
  const brokenNote = () => brokenFiles.map((file) => translator(pickLang())('config.broken', { file })).join('\n');
  // 볼 설정이 없으면 통과 — 깨진 설정이 있으면 지금처럼 알리고 끝낸다. 볼 설정이 있으면 판정하고 깨진 것은 함께 알린다
  if (!valid.length) {
    if (brokenFiles.length) notice(brokenNote());
    pass();
  }
  if (brokenFiles.length) notes.push(brokenNote());
  const { kindOf, loadRules, judge } = await import('./lib/pretool.mjs');
  const on = kindOf(input.tool_name || '');
  if (!on) pass();
  for (const { cfg, scope } of valid) {
    const say = translator(pickLang(cfg.lang));
    t ||= say;
    // 설정은 여기서 한 번만 읽고 넘긴다. 규칙 모듈은 이 도구 종류에 켠 id 가 있는 것만 불러온다. 같은 막는 글은 한 번만
    for (const m of judge(input, cfg, on, await loadRules(on, cfg), say, errors, notes, hints, asks, scope)) if (!msgs.includes(m)) msgs.push(m);
  }
} catch {
  errors.push('*'); // 바깥에서 터짐(규칙 모듈을 못 불러옴 등)
}
if (msgs.length) deny(msgs.join('\n'));
if (asks.length) {
  if (errors.length) notes.unshift(crashNotice(errors, t));
  ask(asks.join('\n'), notes.join('\n'));
}
try {
  if (errors.length) notes.unshift(crashNotice(errors, t));
  if (hints.length) hint(hints.join('\n'), notes.join('\n'));
  if (notes.length) notice(notes.join('\n'));
} catch {}
pass();
