// git 의 pre-commit 훅으로 커밋 때 다시 보기. 설치(scripts/apply.mjs)와 「이 저장소에 우리 훅이 돌고 있나」 판단(hooks/rules/commit.mjs)이 함께 쓴다.
// 왜 git 훅인가: PreToolUse 는 명령이 돌기 전에 보므로, 같은 명령 앞부분이 파일을 쓰면 커밋될 내용을 미리 알 수 없었다.
// git 훅은 커밋하는 순간 실제 색인을 본다 — 짐작 없이 정확하다. 설치된 파일은 플러그인을 찾아 hooks/git-pre-commit.mjs 를 돌리는 작은 실행기다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from './core.mjs';
import { gitSegments, commandSegments, shortFlags } from './cmdline.mjs';
import { COMMIT_VALUE_FLAGS } from './commit-args.mjs';

// 우리가 넣은 훅인지 알아보는 표시(첫 줄 근처). 이 글이 없는 pre-commit 은 남의 것이라 덮어쓰지 않는다.
export const MARKER = 'harness-fit:git-pre-commit';
// 커밋 때 다시 보는 쓰기 훅(rules/commit.mjs 와 같은 목록 — hooks/test 가 같은지 본다)
export const COMMIT_HOOK_IDS = ['secrets', 'protected-files', 'unsafe-html', 'pin-deps', 'gha-inject', 'file-size', 'swift-unsafe', 'python-unsafe'];
export const HOOK_NAME = 'pre-commit';
export const SCRIPT = path.join('hooks', 'git-pre-commit.mjs');
// 이 플러그인 폴더(설치할 때 실행기에 적어 두는 경로)
export const PLUGIN_DIR = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const RECORDED = /^\/\/ recorded: (.*)$/m;
const MAX_HOOK_BYTES = 64 * 1024;

// 플러그인 폴더 찾기. 실행기 안에도 이 함수의 글을 그대로 넣는다(toString) — 훅이 「돌 수 있다」고 보는 것과 실행기가 찾는 것이 같게.
// 1) CLAUDE_PLUGIN_ROOT  2) installed_plugins.json 의 harness-fit 중 이 저장소(projectPath)·사용자 범위  3) 설치할 때 적어 둔 경로
export function locatePlugin(fs, os, path, env, cwd, recorded) {
  const script = path.join('hooks', 'git-pre-commit.mjs');
  const ok = (dir) => typeof dir === 'string' && dir !== '' && fs.existsSync(path.join(dir, script));
  const norm = (p) => { const r = path.resolve(p); return process.platform === 'win32' ? r.toLowerCase() : r; };
  if (ok(env.CLAUDE_PLUGIN_ROOT)) return env.CLAUDE_PLUGIN_ROOT;
  try {
    const home = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const list = JSON.parse(fs.readFileSync(path.join(home, 'plugins', 'installed_plugins.json'), 'utf8'))?.plugins?.['harness-fit@harness-fit'];
    const entries = Array.isArray(list) ? list.filter((p) => p && typeof p === 'object') : [];
    const here = entries.filter((p) => typeof p.projectPath === 'string' && norm(p.projectPath) === norm(cwd));
    for (const p of [...here, ...entries.filter((p) => p.scope === 'user')]) if (ok(p.installPath)) return p.installPath;
  } catch {}
  return ok(recorded) ? recorded : null;
}

// 설치하는 훅 파일. sh 로 돈다(Windows 의 Git 도 자기 sh 로 훅을 돌린다). node 나 플러그인을 못 찾으면 한 줄 알리고 통과한다
// — 플러그인을 옮겼다고 사용자의 커밋을 막지 않게. 그때는 Claude Code 안의 커밋 검사(PreToolUse)가 다시 맡는다.
// 경로에 줄바꿈이 있으면 주석 줄·heredoc 밖으로 새어 나가 코드가 될 수 있어 지운다(경로는 JSON 글자로도 넣는다).
export const launcherText = (rawRecorded) => {
  const recorded = String(rawRecorded).replace(/[\r\n]/g, '');
  return launcherBody(recorded);
};
const launcherBody = (recorded) => `#!/bin/sh
# ${MARKER} — harness-fit 이 넣은 훅이에요. 되돌리기: /harness-fit:setup undo
# 커밋할 내용을 harness-fit 쓰기 검사(.claude/harness.json 에서 켠 것)로 봐요. 남의 훅과 함께 쓰려면 그 훅에서 이 파일을 부르세요.
if ! command -v node >/dev/null 2>&1; then
  echo "harness-fit: node 를 찾지 못해 커밋 전 검사를 건너뛰어요." >&2
  exit 0
fi
exec node --input-type=module - <<'HARNESS_FIT_LAUNCHER'
// recorded: ${recorded}
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const locatePlugin = ${locatePlugin.toString()};
const dir = locatePlugin(fs, os, path, process.env, process.cwd(), ${JSON.stringify(recorded)});
if (!dir) {
  process.stderr.write('harness-fit: 플러그인을 찾지 못해 커밋 전 검사를 건너뛰어요(다시 적용하면 고쳐져요).\\n');
} else {
  try {
    await import(pathToFileURL(path.join(dir, 'hooks', 'git-pre-commit.mjs')).href);
  } catch {
    process.stderr.write('harness-fit: 커밋 전 검사를 돌리지 못해 건너뛰어요.\\n');
    process.exitCode = 0;
  }
}
HARNESS_FIT_LAUNCHER
`;

// 다른 훅(husky·pre-commit·lefthook)에 이어 붙일 한 줄. 파일이 없으면(플러그인을 옮김) 건너뛴다.
// 경로는 작은따옴표로 감싼다(sh 가 $·백틱·" 를 풀지 않게). 경로 속 작은따옴표는 '\'' 로 잇는다.
export const chainCommand = (pluginRoot) => {
  const p = path.join(pluginRoot, SCRIPT).split(path.sep).join('/');
  const q = `'${p.replace(/'/g, `'\\''`)}'`;
  // `[ -f … ] && …` 꼴은 훅 맨 끝 줄이면 파일이 없을 때 1 로 끝나 커밋을 막는다 — if 로 쓴다.
  return `if [ -f ${q} ]; then node ${q} || exit 1; fi`;
};

const same = (a, b) => (process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));
const readHook = (file) => {
  try {
    const st = fs.statSync(file);
    return st.isFile() && st.size <= MAX_HOOK_BYTES ? fs.readFileSync(file, 'utf8') : '';
  } catch {
    return null;
  }
};
// 우리가 넣는 자리: 저장소의 .git/hooks/pre-commit (백업·되돌리기가 이 경로 하나만 허용한다)
export const ownHookPath = (root) => path.join(root, '.git', 'hooks', HOOK_NAME);

// 설치할 수 있는지 → { state, file }
//   none       훅이 없고 .git/hooks 에 넣을 수 있다
//   ours       우리 훅이 이미 있다(다시 쓰면 된다)
//   other      남의 pre-commit 이 있다 → 넣지 않는다
//   hooks-path core.hooksPath 가 설정돼 있다(husky·pre-commit·lefthook) → 넣지 않는다
//   elsewhere  훅 폴더가 이 폴더 밖이다(git worktree·submodule) → 넣지 않는다
//   no-git     git 저장소가 아니거나 git 을 못 읽는다
export const gitHookState = (root) => {
  const out = git(root, ['rev-parse', '--git-path', 'hooks']);
  if (out === null) return { state: 'no-git', file: null };
  const file = path.join(path.resolve(root, out.trim()), HOOK_NAME);
  const custom = (git(root, ['config', '--get', 'core.hooksPath']) || '').trim();
  if (custom) return { state: 'hooks-path', file };
  if (!same(file, ownHookPath(root)) || !fs.existsSync(path.join(root, '.git')) || !fs.statSync(path.join(root, '.git')).isDirectory()) return { state: 'elsewhere', file };
  const text = readHook(file);
  if (text === null) return { state: 'none', file };
  return { state: text.includes(MARKER) ? 'ours' : 'other', file };
};

// 이 저장소에서 우리 git 훅이 실제로 돌까: 훅 폴더(core.hooksPath 를 따름)의 pre-commit 이 우리 것이고,
// (Windows 밖에서는) 실행 권한이 있고, 실행기가 플러그인을 찾을 수 있을 때. 아니면 PreToolUse 커밋 검사가 맡는다(팀원의 새 clone 등).
// .git 에는 쓰지 않는다 — PreToolUse 훅은 고치지 않고 보기만 한다.
export const gitHookActive = (root) => {
  // 우리는 .git/hooks/pre-commit 에만 넣는다. 거기 없으면 git 을 띄우지 않고 바로 아니라고 본다(훅은 도구 호출마다 돌아 빨라야 한다).
  if (!(readHook(ownHookPath(root)) || '').includes(MARKER)) return false;
  // 있어도 core.hooksPath 가 다른 폴더를 가리키면 git 은 그 폴더의 훅을 돌린다.
  const out = git(root, ['rev-parse', '--git-path', 'hooks']);
  if (out === null) return false;
  const file = path.join(path.resolve(root, out.trim()), HOOK_NAME);
  const text = readHook(file);
  if (!text || !text.includes(MARKER)) return false;
  if (process.platform !== 'win32') {
    try {
      fs.accessSync(file, fs.constants.X_OK);
    } catch {
      return false;
    }
  }
  const recorded = (text.match(RECORDED) || [])[1] || null;
  return locatePlugin(fs, os, path, process.env, root, recorded) !== null;
};

// 이 명령이 git 훅을 건너뛰거나 바꿀 수 있는지. 그러면 git 훅을 믿지 않고 PreToolUse 커밋 검사가 미리 본다.
//   commit 의 -n·--no-verify(줄임 포함), core.hooksPath·GIT_CONFIG_*(git -c·환경 변수), 다른 저장소·색인을 가리키는 GIT_DIR·--git-dir 등,
//   훅 파일을 건드릴 수 있는 낱말(.git·hooks·pre-commit 을 가리키는 경로) — 커밋 메시지 속 글은 보지 않는다.
const ENV_OR_CONFIG = /hookspath|GIT_CONFIG|GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_OBJECT_DIRECTORY|GIT_COMMON_DIR|--git-dir|--work-tree|--config-env/i;
const HOOK_PATH_WORD = /(?:^|[\\/])(?:\.git|hooks)(?:[\\/]|$)|pre-commit/i;
const NO_VERIFY = /^--no-v(?:e(?:r(?:i(?:f(?:y)?)?)?)?)?$/;
export const bypassesGitHook = (cmd, shell) => {
  if (ENV_OR_CONFIG.test(cmd)) return true;
  const commits = gitSegments(cmd, 'commit', shell);
  if (commits.some((c) => shortFlags(c.bare, COMMIT_VALUE_FLAGS).has('n') || c.words.some((w) => NO_VERIFY.test(w)))) return true;
  const isCommit = (s) => commits.some((c) => s.start <= c.start && c.start <= s.start + s.raw.length);
  return commandSegments(cmd, shell).some((s) => !isCommit(s) && s.words.some((w) => HOOK_PATH_WORD.test(w)));
};
