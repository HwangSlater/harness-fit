// 켠 규칙 돌리기 — PreToolUse(pretool.mjs) · 다른 때(events.mjs) · git pre-commit(git-pre-commit.mjs) 가 함께 쓴다.
// 규칙 하나가 터져도 다른 규칙은 돌고, 터진 규칙 id 는 errors 에 모은다(막지 않고 「검사 없이 진행」을 알리려고).
import { withNoReason } from './allow.mjs';

// harness.json rules 값 → 규칙 옵션. true 면 기본 옵션({}), 객체면 그대로, 그 밖의 모양(배열 등)은 {}.
export const ruleOpts = (setting) => (setting && typeof setting === 'object' && !Array.isArray(setting) ? setting : {});

// rules 가운데 cfg 에서 켠 것만 call(rule, opts) 로 돌려, 나온 글을 차례대로 돌려준다.
// allows(허용 주석 기록)를 주면 이유 없는 허용 주석 안내를 글에 붙인다.
export const runRules = (rules, cfg, call, { errors, allows = null, t = null }) => {
  const out = [];
  for (const rule of rules) {
    const setting = cfg.rules[rule.id];
    if (!setting) continue;
    try {
      const msg = call(rule, ruleOpts(setting));
      if (msg) out.push(allows ? withNoReason(msg, allows, rule.id, t) : msg);
    } catch {
      // 규칙 하나가 터져도 작업을 막지 않는다(사용자 결정 2026-11-06: 막으면 그 프로젝트의 모든 명령·수정이 멈춘다). 대신 알린다.
      if (!errors.includes(rule.id)) errors.push(rule.id);
    }
  }
  return out;
};
