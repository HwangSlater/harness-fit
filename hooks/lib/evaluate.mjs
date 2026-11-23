// PreToolUse 판정을 한 번에 부르는 꼴(시험·scripts 가 쓴다): 설정을 읽고 모든 규칙 모듈로 판정한다.
// 진입점 hooks/run.mjs 는 이것을 쓰지 않는다 — 설정을 한 번만 읽고, 켠 id 가 있는 모듈만 불러 pretool.mjs 의 judge 를 부른다.
// 설정은 진입점과 같이 호출이 닿는 저장소에서 찾는다(lib/target-config.mjs configsFor).
import { pickLang, translator } from './core.mjs';
import { kindOf, loadRules, judge, KINDS } from './pretool.mjs';
import { configsFor } from './target-config.mjs';

const ALL = Object.fromEntries(await Promise.all(KINDS.map(async (on) => [on, await loadRules(on)])));

// errors · notes · hints · asks: pretool.mjs judge 와 같다.
export const evaluate = (input, errors = [], notes = [], hints = [], asks = []) => {
  const on = kindOf(input.tool_name || '');
  if (!on) return [];
  const out = new Set();
  for (const { cfg, scope } of configsFor(input).found) {
    for (const m of judge(input, cfg, on, ALL[on], translator(pickLang(cfg.lang)), errors, notes, hints, asks, scope)) out.add(m);
  }
  return [...out];
};
