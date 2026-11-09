// PreToolUse 판정. 프로젝트 .claude/harness.json 의 rules 에서 켜진 규칙만 돌린다.
// rules 값: true(기본 옵션으로 켬) · false(끔) · { ...옵션 }(켬).
// 규칙 모듈은 도구 종류(셸·쓰기·웹)에 켠 id 가 있는 것만 불러온다(모두 부르면 호출마다 70ms 쯤 — 2026-11-09 측정).
import { commandCwd, repoRoot, shellOf } from './core.mjs';
import { innerCommands } from './cmdline.mjs';
import { allowReport, allowNotice } from './allow.mjs';
import { runRules } from './dispatch.mjs';

// 규칙 모듈 표. 차례가 곧 막는 글의 차례다. ids 는 그 모듈이 그 종류로 내는 규칙 id(hooks/test/pretool.test.mjs 가 실제 모듈과 같은지 본다).
export const RULE_MODULES = [
  { on: 'write', ids: ['secrets', 'protected-files', 'file-size'], load: () => import('../rules/files.mjs') },
  { on: 'write', ids: ['unsafe-html', 'pin-deps', 'gha-inject'], load: () => import('../rules/code.mjs') },
  { on: 'write', ids: ['swift-unsafe', 'python-unsafe'], load: () => import('../rules/lang.mjs') },
  { on: 'write', ids: ['docs-check'], load: async () => [(await import('../rules/docs.mjs')).docsWrite] },
  { on: 'shell', ids: ['danger-cmd', 'password-cli'], load: () => import('../rules/shell.mjs') },
  { on: 'shell', ids: ['git-add-all', 'protect-branch', 'commit-msg', 'branch-name', 'no-verify'], load: () => import('../rules/git.mjs') },
  { on: 'shell', ids: ['squash-push'], load: () => import('../rules/push.mjs') },
  { on: 'shell', ids: ['no-rewrite-pushed', 'pr-merge'], load: () => import('../rules/history.mjs') },
  { on: 'shell', ids: ['secrets', 'protected-files', 'file-size', 'unsafe-html', 'pin-deps', 'gha-inject', 'swift-unsafe', 'python-unsafe'], load: () => import('../rules/commit.mjs') },
  { on: 'fetch', ids: ['prefer-gh'], load: () => import('../rules/web.mjs') },
];

export const kindOf = (tool) =>
  /^(Bash|PowerShell)$/.test(tool) ? 'shell' : /^(Write|Edit|NotebookEdit)$/.test(tool) ? 'write' : tool === 'WebFetch' ? 'fetch' : null;

const rulesOf = (mod) => (Array.isArray(mod) ? mod : mod.default);

// on 종류의 규칙 중 cfg 에서 켠 id 가 있는 모듈만 불러 차례대로 돌려준다. cfg 가 없으면 모두.
export const loadRules = async (on, cfg = null) => {
  const mods = RULE_MODULES.filter((m) => m.on === on && (!cfg || m.ids.some((id) => cfg.rules[id])));
  const loaded = await Promise.all(mods.map((m) => m.load()));
  return loaded.flatMap(rulesOf).filter((r) => r.on === on);
};

// errors: 터진 규칙 id 를 모은다(부른 쪽이 「검사가 오류로 멈췄어요」를 알리려고). 막지는 않는다.
// notes: 막지 않고 알릴 글(허용 주석으로 통과시킨 줄 목록). 막는 글이 있으면 부른 쪽이 알리지 않는다.
// hints: 막지 않고 Claude 에게 건넬 글(notice 규칙 — prefer-gh). 부른 쪽이 additionalContext 로 낸다.
// rules: loadRules(on, cfg) 결과. t: 문구.
export const judge = (input, cfg, on, rules, t, errors = [], notes = [], hints = []) => {
  if (!rules.some((r) => cfg.rules[r.id])) return [];
  const cwd = input.cwd || process.cwd();
  const command = input.tool_input?.command;
  const outer = typeof command === 'string' ? command : '';
  // 따옴표·이스케이프를 읽는 방법이 셸마다 다르다(bash ↔ PowerShell). 규칙은 이 값으로 명령을 읽는다.
  // `bash -c "…"`·`pwsh -Command "…"` 처럼 따옴표 속 글을 실행하는 꼴은 그 안쪽 명령도 따로 본다.
  const shell = shellOf(input.tool_name || '');
  const commands = on === 'shell' ? [{ cmd: outer, shell }, ...innerCommands(outer, shell)] : [{ cmd: '', shell }];

  const out = new Set();
  const allows = allowReport(); // 규칙들이 허용 주석으로 넘긴 줄을 여기에 적는다
  for (const { cmd, shell: sh } of commands) {
    const cmdCwd = on === 'shell' ? commandCwd(cmd, cwd) : cwd;
    const root = on === 'shell' && /\bgit\b/.test(cmd) ? repoRoot(cmdCwd) : null;
    const shared = {}; // 이 명령 하나를 보는 동안 규칙끼리 나눠 쓰는 계산(커밋 계획 등)
    const ctx = { input, cmd, shell: sh, cwd: cmdCwd, root, project: cfg.root, t, shared, allows };
    // notice 규칙의 글은 막는 글이 아니라 hints 로 보낸다
    const call = (rule, opts) => {
      const msg = rule.check({ ...ctx, opts });
      if (!msg || !rule.notice) return msg;
      if (!hints.includes(msg)) hints.push(msg);
      return null;
    };
    for (const msg of runRules(rules, cfg, call, { errors, allows, t })) out.add(msg);
  }
  const used = allowNotice(allows, t, cwd);
  if (used) notes.push(used);
  return [...out];
};
