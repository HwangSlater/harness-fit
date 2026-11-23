// 도구 호출 하나에 쓸 설정(.claude/harness.json) 고르기 — 세션 cwd 의 설정에 더해, 호출이 실제로 닿는 저장소의 설정도 본다.
// ⚠️ 설정이 없는 폴더(orca/projects/naver)에서 연 세션이 `cd …/portal-deploy && git …`·`git -C …` 로 팀 저장소를 만졌는데
//    loadConfig(세션 cwd) 가 null 이라 PreToolUse 규칙이 하나도 돌지 않았다(2026-11-21). 결정은 docs/decisions-hooks.md 「호출이 닿는 저장소의 설정도 본다」.
// 닿는 곳: 셸은 명령 조각마다(바깥 명령 + `bash -c "…"` 속 명령) commandCwd(`cd X &&`·Set-Location·pushd·`git -C X`), 파일 도구는 파일의 폴더.
// cwd 설정(own)은 늘 호출 전체를 본다(지금까지와 같음). 대상 설정은 그 위에 더해 자기에게 닿는 조각만 본다 — 막는 것은 합친다.
//   ⚠️ 처음에는 대상 설정이 own 을 대신했는데, 느슨한·빈·깨진 설정 폴더로 먼저 cd 하면 cwd 저장소에서 도는 위험 명령이 통과했다(독립 검토 2026-11-23).
// 이 함수는 플러그인을 켠 모든 프로젝트의 도구 호출마다 돈다 — git 을 띄우지 않고, 셸 명령은 옮겨 가는 낱말이 있을 때만 읽는다.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, commandCwd, shellOf } from './core.mjs';
import { innerCommands } from './cmdline.mjs';

// 글자 거르기: 이것이 없으면 commandCwd 가 cwd 를 그대로 돌려줄 명령이다(cd 류는 대소문자 무시 — PowerShell, -C 는 git 옵션이라 대문자만)
const MOVES = /\b(?:cd|chdir|pushd|set-location|push-location)\b/i;
const DASH_C = /\s-C\b/;
const FILE_TOOL = /^(?:Write|Edit|MultiEdit|NotebookEdit|Read)$/;
const SHELL_TOOL = /^(?:Bash|PowerShell)$/;
// 서로 다른 대상 폴더가 이보다 많으면 대상 설정은 보지 않는다(own 만) — 조각을 수천 개 만든 명령에 폴더마다 설정 찾기를 하지 않게
export const MAX_TARGETS = 16;
// 실제로 있을 수 없는 길이(PATH_MAX 4096 넘음)는 닿는 곳으로 보지 않는다
const MAX_PATH = 4096;

const existsDir = (dir) => {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
};
// 대상 폴더의 설정. 대상으로 치는 것은 저장소 맨 위(.git 이 있는 폴더)의 설정과 작업 폴더 설정(workspace 표시)뿐 —
// 저장소 밖 아무 폴더나 저장소 속 하위 폴더의 .claude/harness.json 은 치지 않는다(모델이 빈 설정을 써 두고 cd 로 돌아가는 꼴을 줄이려고).
// 아직 없는 폴더(새 파일의 새 폴더)는 .claude·.git 이 있을 수 없으니 있는 폴더까지 먼저 올라간다 —
// loadConfig 는 층마다 stat 을 두 번 해, 아주 깊은 경로(`a/a/a/…` 2만 층)에서 27초 걸렸다(crash-inproc ReDoS 사례).
const targetConfig = (dir) => {
  if (dir.length > MAX_PATH) return null;
  let d = dir;
  while (!existsDir(d) && path.dirname(d) !== d) d = path.dirname(d);
  const cfg = loadConfig(d);
  if (!cfg) return null;
  return cfg.workspace || fs.existsSync(path.join(cfg.root, '.git')) ? cfg : null;
};

// 셸 명령 조각들(바깥 + 속)과 조각마다 닿는 폴더 — pretool.mjs judge 가 도는 차례와 같다
const shellCommands = (cmd, tool, cwd) => {
  const shell = shellOf(tool);
  return [{ cmd, shell }, ...innerCommands(cmd, shell)].map((c) => ({ ...c, dir: path.resolve(commandCwd(c.cmd, cwd)) }));
};

// 도구 호출이 닿는 곳. commands: 셸 조각(judge 에 넘겨 두 번 나누지 않는다), dirs: 닿는 폴더들. 옮겨 가지 않으면 null.
const targetsOf = (input, cwd) => {
  const tool = input.tool_name || '';
  const ti = input.tool_input || {};
  if (SHELL_TOOL.test(tool)) {
    const cmd = typeof ti.command === 'string' ? ti.command : '';
    if (!MOVES.test(cmd) && !DASH_C.test(cmd)) return null;
    const commands = shellCommands(cmd, tool, cwd);
    return { commands, dirs: commands.map((c) => c.dir) };
  }
  if (FILE_TOOL.test(tool)) {
    const file = ti.file_path || ti.notebook_path;
    if (typeof file !== 'string' || !file || file.includes('\0')) return null;
    return { commands: null, dirs: [path.dirname(path.resolve(cwd, file))] };
  }
  return null;
};

// → { found: [{ cfg, scope }], broken: [깨진 대상 설정 파일] }
//    found 의 차례: own(있으면, scope.only 없음 — 호출 전체) → 대상 설정들(scope.only = 그 설정에 닿는 조각의 폴더).
//    아무 설정에도 닿지 않으면 found 는 []. 깨진 own 은 found 에 그대로(진입점이 지금처럼 알린다), 깨진 대상 설정은 broken 으로만.
export const configsFor = (input) => {
  const cwd = path.resolve(input.cwd || process.cwd());
  const own = loadConfig(cwd);
  const targets = targetsOf(input, cwd);
  const commands = targets?.commands || null;
  const found = own ? [{ cfg: own, scope: { only: null, commands } }] : [];
  const broken = [];
  const distinct = new Set((targets?.dirs || []).filter((d) => d !== cwd));
  if (!distinct.size || distinct.size > MAX_TARGETS) return { found, broken };
  const ownRoot = own ? path.resolve(own.root) : null;
  const groups = new Map(); // 설정 폴더 → { cfg, only }
  for (const dir of distinct) {
    const cfg = targetConfig(dir);
    if (!cfg) continue;
    const key = path.resolve(cfg.root);
    if (key === ownRoot) continue; // own 이 이미 본다
    if (cfg.broken) {
      if (!broken.includes(cfg.broken)) broken.push(cfg.broken);
      continue;
    }
    if (!groups.has(key)) groups.set(key, { cfg, only: new Set() });
    groups.get(key).only.add(dir);
  }
  // 파일 도구는 닿는 곳이 하나라 only 가 필요 없다(judge 의 쓰기 판정은 조각을 나누지 않는다)
  for (const g of groups.values()) found.push({ cfg: g.cfg, scope: { only: commands ? g.only : null, commands } });
  return { found, broken };
};
