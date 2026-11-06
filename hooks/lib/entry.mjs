// Stop · SessionStart · UserPromptSubmit 진입점이 함께 쓰는 틀(hooks/run.mjs 와 같은 원칙).
//   설정(.claude/harness.json)이 없으면 바로 통과 — 규칙 모듈은 설정이 있고 그 때의 규칙이 켜졌을 때만 불러온다.
//   어디서 터지든 막지 않고 통과하되, 그 검사 없이 진행된다고 알린다(systemMessage).
//   Stop 은 이미 한 번 막아서 다시 도는 중(stop_hook_active)이면 통과한다(같은 것을 거듭 묻지 않게, 끝없이 돌지 않게).
// 설정이 깨졌다는 알림은 PreToolUse(run.mjs)가 한다 — 여기서도 하면 답마다·메시지마다 같은 알림이 겹친다.
import { readInput, loadConfig, pickLang, translator, crashNotice } from './core.mjs';

// 때마다 켜질 수 있는 훅 id(규칙 모듈을 불러오기 전에 거르려고 — hooks/test 가 lib/events.mjs 의 규칙과 같은지 본다)
export const EVENT_HOOK_IDS = {
  stop: ['commit-hash', 'answer-lang', 'docs-check'],
  'session-start': ['work-checklist'],
  prompt: ['work-checklist'],
};
const EVENT_NAME = { stop: 'Stop', 'session-start': 'SessionStart', prompt: 'UserPromptSubmit' };

const write = (obj) => {
  process.stdout.write(JSON.stringify(obj));
  process.exit(0);
};

export const runEvent = async (on) => {
  let msgs = [];
  const errors = [];
  let t = null;
  try {
    const input = readInput();
    if (on === 'stop' && input.stop_hook_active === true) write({});
    const cfg = loadConfig(input.cwd || process.cwd());
    if (!cfg || cfg.broken || !EVENT_HOOK_IDS[on].some((id) => cfg.rules[id])) write({});
    t = translator(pickLang(cfg.lang));
    const { evaluateEvent } = await import('./events.mjs');
    msgs = evaluateEvent(on, input, errors);
  } catch {
    errors.push('*');
  }
  const out = {};
  try {
    if (errors.length) out.systemMessage = crashNotice(errors, t);
  } catch {}
  if (msgs.length) {
    if (on === 'stop') Object.assign(out, { decision: 'block', reason: msgs.join('\n\n') });
    else out.hookSpecificOutput = { hookEventName: EVENT_NAME[on], additionalContext: msgs.join('\n\n') };
  }
  write(out);
};
