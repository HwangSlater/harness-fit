// PreToolUse 디스패처. 프로젝트 .claude/harness.json 의 rules 에서 켜진 규칙만 돌린다.
// 설정 파일이 없는 프로젝트에서는 바로 통과한다(플러그인을 깔아도 고르기 전에는 아무것도 막지 않음).
// rules 값: true(기본 옵션으로 켬) · false(끔) · { ...옵션 }(켬).
import { loadConfig, pickLang, translator, commandCwd, repoRoot, shellOf } from './core.mjs';
import { innerCommands } from './cmdline.mjs';
import { allowReport, allowNotice, withNoReason } from './allow.mjs';
import fileRules from '../rules/files.mjs';
import shellRules from '../rules/shell.mjs';
import gitRules from '../rules/git.mjs';
import webRules from '../rules/web.mjs';
import codeRules from '../rules/code.mjs';
import historyRules from '../rules/history.mjs';
import commitRules from '../rules/commit.mjs';
import langRules from '../rules/lang.mjs';
import pushRules from '../rules/push.mjs';
import { docsWrite } from '../rules/docs.mjs';

const ALL = [...fileRules, ...codeRules, ...langRules, docsWrite, ...shellRules, ...gitRules, ...pushRules, ...historyRules, ...commitRules, ...webRules];

const kindOf = (tool) =>
  /^(Bash|PowerShell)$/.test(tool) ? 'shell' : /^(Write|Edit|NotebookEdit)$/.test(tool) ? 'write' : tool === 'WebFetch' ? 'fetch' : null;

// errors: 터진 규칙 id 를 모은다(부른 쪽이 「검사가 오류로 멈췄어요」를 알리려고). 막지는 않는다.
// notes: 막지 않고 알릴 글(허용 주석으로 통과시킨 줄 목록). 막는 글이 있으면 부른 쪽이 알리지 않는다.
export const evaluate = (input, errors = [], notes = []) => {
  const cwd = input.cwd || process.cwd();
  const cfg = loadConfig(cwd);
  if (!cfg) return [];
  const tool = input.tool_name || '';
  const on = kindOf(tool);
  if (!on) return [];

  const t = translator(pickLang(cfg.lang));
  const command = input.tool_input?.command;
  const outer = typeof command === 'string' ? command : '';
  // 따옴표·이스케이프를 읽는 방법이 셸마다 다르다(bash ↔ PowerShell). 규칙은 이 값으로 명령을 읽는다.
  // `bash -c "…"`·`pwsh -Command "…"` 처럼 따옴표 속 글을 실행하는 꼴은 그 안쪽 명령도 따로 본다.
  const shell = shellOf(tool);
  const commands = on === 'shell' ? [{ cmd: outer, shell }, ...innerCommands(outer, shell)] : [{ cmd: '', shell }];

  const out = new Set();
  const allows = allowReport(); // 규칙들이 허용 주석으로 넘긴 줄을 여기에 적는다
  for (const { cmd, shell: sh } of commands) {
    const cmdCwd = on === 'shell' ? commandCwd(cmd, cwd) : cwd;
    const root = on === 'shell' && /\bgit\b/.test(cmd) ? repoRoot(cmdCwd) : null;
    const shared = {}; // 이 명령 하나를 보는 동안 규칙끼리 나눠 쓰는 계산(커밋 계획 등)
    for (const rule of ALL) {
      const setting = cfg.rules[rule.id];
      if (!setting || rule.on !== on) continue;
      const opts = typeof setting === 'object' ? setting : {};
      try {
        const msg = rule.check({ input, cmd, shell: sh, cwd: cmdCwd, root, project: cfg.root, opts, t, shared, allows });
        if (msg) out.add(withNoReason(msg, allows, rule.id, t));
      } catch {
        // 규칙 하나가 터져도 작업을 막지 않는다(사용자 결정 2026-11-06: 막으면 그 프로젝트의 모든 명령·수정이 멈춘다). 대신 알린다.
        if (!errors.includes(rule.id)) errors.push(rule.id);
      }
    }
  }
  const used = allowNotice(allows, t, cwd);
  if (used) notes.push(used);
  return [...out];
};
