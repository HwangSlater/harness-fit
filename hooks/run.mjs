// PreToolUse 훅 진입점. 판정은 lib/evaluate.mjs.
// 설정(.claude/fys.json)이 없는 프로젝트가 대부분이므로, 규칙 모듈은 설정이 있을 때만 불러온다.
import { readInput, pass, deny, loadConfig } from './lib/core.mjs';

const input = readInput();
if (!loadConfig(input.cwd || process.cwd())) pass();
const { evaluate } = await import('./lib/evaluate.mjs');
const msgs = evaluate(input);
if (msgs.length) deny(msgs.join('\n'));
pass();
