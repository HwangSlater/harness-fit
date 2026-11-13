// 도구 호출이 아닌 때(Stop · SessionStart · UserPromptSubmit)의 디스패처. 프로젝트 .claude/harness.json 에서 켠 규칙만 돌린다.
// on: 'stop' | 'session-start' | 'prompt'. 규칙은 막을 이유(stop) 또는 Claude 에게 보여 줄 글(그 밖)을 돌려준다.
// 규칙 하나가 터져도 다른 규칙은 돌고, 터진 규칙 id 는 errors 에 모은다(부른 쪽이 「검사 없이 진행」을 알린다).
import { loadConfig, pickLang, translator } from './core.mjs';
import { runRules } from './dispatch.mjs';
import turnRules from '../rules/turn.mjs';
import docsRules from '../rules/docs.mjs';
import checklistRules from '../rules/checklist.mjs';
import scratchRules from '../rules/scratch.mjs';

export const EVENT_RULES = [...turnRules, ...docsRules, ...checklistRules, ...scratchRules].filter((r) => r.on !== 'write' && r.on !== 'shell');

// cfg: 진입점(entry.mjs)이 이미 읽은 설정(없으면 여기서 읽는다)
export const evaluateEvent = (on, input, errors = [], cfg = loadConfig(input.cwd || process.cwd())) => {
  const cwd = input.cwd || process.cwd();
  if (!cfg || cfg.broken) return [];
  const t = translator(pickLang(cfg.lang));
  const shared = {}; // 같은 기록·커밋 목록을 규칙마다 다시 읽지 않게
  const rules = EVENT_RULES.filter((r) => r.on === on);
  return runRules(rules, cfg, (rule, opts) => rule.check({ input, cwd, project: cfg.root, opts, t, shared }), { errors });
};
