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

// detail: 진입점(hooks/run.mjs)이 출력을 고르는 재료 전부 — 막는 글·물을 까닭·Claude 에게 건넬 글·알림·오류(strict-run.mjs 가 진입점과 같은 순서로 결정을 고른다)
// stdout: 판정 동안 규칙이 표준 출력에 쓴 글 — 진입점에서는 출력 JSON 을 깨뜨리므로 strict-run.mjs 가 실패로 본다(검토 2026-11-19)
const detailed = (raw) => {
  const [errors, notes, hints, asks] = [[], [], [], []];
  let stdout = '';
  const saved = { write: process.stdout.write, log: console.log, info: console.info, debug: console.debug, dir: console.dir };
  process.stdout.write = (chunk) => ((stdout += String(chunk)), true);
  for (const k of ['log', 'info', 'debug', 'dir']) console[k] = (...a) => { stdout += a.map(String).join(' ') + '\n'; };
  try {
    const msgs = evaluate(normalizeInput(raw), errors, notes, hints, asks);
    return { msgs, asks, hints, notes, errors, stdout };
  } finally {
    process.stdout.write = saved.write;
    for (const k of ['log', 'info', 'debug', 'dir']) console[k] = saved[k];
  }
};

parentPort.on('message', ({ id, raw, event, pathValue, budget, tries, detail }) => {
  const saved = process.env.PATH;
  if (pathValue !== undefined) process.env.PATH = pathValue; // git 없음(이 일꾼의 환경만 바뀐다)
  try {
    if (detail) return parentPort.postMessage({ id, ...detailed(raw) });
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
