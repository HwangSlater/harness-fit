// PreToolUse 디스패처. 프로젝트 .claude/harness.json 의 rules 에서 켜진 규칙만 돌린다.
// 설정 파일이 없는 프로젝트에서는 바로 통과한다(플러그인을 깔아도 고르기 전에는 아무것도 막지 않음).
// rules 값: true(기본 옵션으로 켬) · false(끔) · { ...옵션 }(켬).
import { loadConfig, pickLang, translator, commandCwd, repoRoot, shellOf } from './core.mjs';
import fileRules from '../rules/files.mjs';
import shellRules from '../rules/shell.mjs';
import gitRules from '../rules/git.mjs';
import webRules from '../rules/web.mjs';

const ALL = [...fileRules, ...shellRules, ...gitRules, ...webRules];

export const evaluate = (input) => {
  const cwd = input.cwd || process.cwd();
  const cfg = loadConfig(cwd);
  if (!cfg) return [];
  const tool = input.tool_name || '';
  const on = /^(Bash|PowerShell)$/.test(tool) ? 'shell' : /^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool) ? 'write' : tool === 'WebFetch' ? 'fetch' : null;
  if (!on) return [];

  const t = translator(pickLang(cfg.lang));
  const cmd = String(input.tool_input?.command || '');
  // 따옴표·이스케이프를 읽는 방법이 셸마다 다르다(bash ↔ PowerShell). 규칙은 이 값으로 명령을 읽는다.
  const shell = shellOf(tool);
  const cmdCwd = on === 'shell' ? commandCwd(cmd, cwd) : cwd;
  const root = on === 'shell' && /\bgit\b/.test(cmd) ? repoRoot(cmdCwd) : null;

  const out = [];
  for (const rule of ALL) {
    const setting = cfg.rules[rule.id];
    if (!setting || rule.on !== on) continue;
    const opts = typeof setting === 'object' ? setting : {};
    try {
      const msg = rule.check({ input, cmd, shell, cwd: cmdCwd, root, opts, t });
      if (msg) out.push(msg);
    } catch {
      // 규칙 하나가 터져도 작업을 막지 않는다.
    }
  }
  return out;
};
