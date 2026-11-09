// PreToolUse 훅 진입점. 판정은 lib/pretool.mjs.
// 설정(.claude/harness.json)이 없는 프로젝트가 대부분이므로, 규칙 모듈은 설정이 있을 때만 불러온다.
// 설정이 깨졌으면 막지 않고 「검사가 모두 꺼져 있다」고 알린다(조용히 꺼지지 않게).
// 어디서 터지든(git 없음, 모르는 오류) 막지 않고 통과하되, 검사 없이 진행된다고 알린다 — 훅 오류로 작업이 멈추지 않게, 그러나 조용히 꺼지지도 않게.
// 깨진 입력(JSON 아님 등)은 readInput 이 빈 값으로 바꾸므로 오류가 아니다.
import { readInput, pass, deny, notice, hint, loadConfig, pickLang, translator, crashNotice } from './lib/core.mjs';

// 막지 않을 때 알릴 것(검사 오류, 허용 주석으로 통과시킨 줄)은 한 알림에 줄을 나눠 함께 낸다.
let msgs = [];
const errors = [];
const notes = [];
const hints = []; // 막지 않고 Claude 에게 건넬 글(notice 규칙)
let t = null;
try {
  const input = readInput();
  const cfg = loadConfig(input.cwd || process.cwd());
  if (!cfg) pass();
  if (cfg.broken) notice(translator(pickLang())('config.broken', { file: cfg.broken }));
  t = translator(pickLang(cfg.lang));
  const { kindOf, loadRules, judge } = await import('./lib/pretool.mjs');
  const on = kindOf(input.tool_name || '');
  if (!on) pass();
  // 설정은 여기서 한 번만 읽고 넘긴다. 규칙 모듈은 이 도구 종류에 켠 id 가 있는 것만 불러온다.
  msgs = judge(input, cfg, on, await loadRules(on, cfg), t, errors, notes, hints);
} catch {
  errors.push('*'); // 바깥에서 터짐(규칙 모듈을 못 불러옴 등)
}
if (msgs.length) deny(msgs.join('\n'));
try {
  if (errors.length) notes.unshift(crashNotice(errors, t));
  if (hints.length) hint(hints.join('\n'), notes.join('\n'));
  if (notes.length) notice(notes.join('\n'));
} catch {}
pass();
