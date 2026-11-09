// 판정 일꾼(worker_threads): 받은 사례를 진입점과 같은 길(normalizeInput → evaluate)로 판정하고 결과·시간을 돌려준다.
// 판정은 git 을 동기로 띄우므로 한 스레드에서는 하나씩밖에 못 돈다 — 일꾼 여럿에 나눠 돌린다(helpers/judge-pool.mjs).
import { parentPort } from 'node:worker_threads';
import { normalizeInput } from '../../lib/core.mjs';
import { evaluate } from '../../lib/evaluate.mjs';
import { evaluateEvent } from '../../lib/events.mjs';

// event: 없으면 도구 호출(PreToolUse), 'stop' | 'session-start' | 'prompt' 면 그 때의 판정
const once = (raw, event) => {
  const errors = [];
  const notes = [];
  const t0 = performance.now();
  const msgs = event ? evaluateEvent(event, normalizeInput(raw), errors) : evaluate(normalizeInput(raw), errors, notes);
  const ms = performance.now() - t0;
  const shapeOk = Array.isArray(msgs) && msgs.every((m) => typeof m === 'string' && m.length > 0);
  return { got: msgs.length ? 'block' : errors.length || notes.length ? 'notice' : 'pass', errors, ms, shapeOk };
};

parentPort.on('message', ({ id, raw, event, pathValue, budget, tries }) => {
  const saved = process.env.PATH;
  if (pathValue !== undefined) process.env.PATH = pathValue; // git 없음(이 일꾼의 환경만 바뀐다)
  try {
    // 한도를 넘으면 두 번 더 재어 가장 빠른 값으로(다른 시험과 CPU 를 나눠 쓰는 순간의 느림을 거르려고)
    let best = once(raw, event);
    for (let i = 1; i < tries && best.ms >= budget; i++) {
      const r = once(raw, event);
      if (r.ms < best.ms) best = r;
    }
    parentPort.postMessage({ id, ...best });
  } catch (e) {
    parentPort.postMessage({ id, threw: String(e?.stack || e).slice(0, 500) });
  } finally {
    if (pathValue !== undefined) process.env.PATH = saved;
  }
});
