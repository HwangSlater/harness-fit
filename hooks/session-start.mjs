// SessionStart 훅 진입점. 판정은 lib/events.mjs, 틀(설정 없으면 바로 통과·오류면 통과하고 알림)은 lib/entry.mjs.
import { runEvent } from './lib/entry.mjs';

await runEvent('session-start');
