// 훅 공통: 입력 읽기, 결과 내보내기, 프로젝트 설정·문구 불러오기, git 도우미.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { QUOTED_OR_WORD, GIT_CMD, stripQuoted } from './cmdline.mjs';
import { findRepo, headOf, refExists, hasRemoteRefsOf } from './repo-files.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CONFIG_FILE = path.join('.claude', 'harness.json');

// 훅 입력. 깨진 입력(JSON 아님, 배열·숫자·null)은 빈 입력으로 — 막지 않고 통과한다(쓰레기 입력에 작업을 막지 않게).
// 값의 모양도 여기서 맞춘다: tool_name·cwd 는 글자, tool_input 은 객체여야 규칙이 그대로 쓴다.
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const normalizeInput = (raw) => {
  if (!isObject(raw)) return {};
  const out = { ...raw };
  if (typeof out.tool_name !== 'string') delete out.tool_name;
  if (typeof out.cwd !== 'string' || !out.cwd || out.cwd.includes('\0')) delete out.cwd;
  out.tool_input = isObject(out.tool_input) ? strings({ ...out.tool_input }) : {};
  // edits(지금 Claude Code 에는 없는 옛 MultiEdit 꼴 — 들어와도 받아 준다): 객체만, 그 안의 칸도 글자만(모양이 틀린 입력은 Claude Code 쪽 문제라 오류 알림 없이 지나가게)
  if ('edits' in out.tool_input) {
    const edits = out.tool_input.edits;
    out.tool_input.edits = Array.isArray(edits) ? edits.filter(isObject).map((e) => strings({ ...e })) : [];
  }
  return out;
};
// 규칙이 글자로 읽는 칸은 글자가 아니면 지운다(숫자·객체 file_path 등).
const TEXT_FIELDS = ['file_path', 'notebook_path', 'path', 'content', 'new_string', 'old_string', 'new_source', 'command', 'url'];
function strings(o) {
  for (const k of TEXT_FIELDS) if (k in o && typeof o[k] !== 'string') delete o[k];
  return o;
}
export const readInput = () => {
  try {
    return normalizeInput(JSON.parse(fs.readFileSync(0, 'utf8') || '{}'));
  } catch {
    return {};
  }
};

export const pass = () => {
  process.stdout.write('{}');
  process.exit(0);
};

// 막지 않고 사용자에게 알리기(설정이 깨졌을 때)
export const notice = (message) => {
  process.stdout.write(JSON.stringify({ systemMessage: message }));
  process.exit(0);
};

// 막지 않고 Claude 문맥에 글을 더한다(PreToolUse additionalContext). message 가 있으면 사용자에게도 알린다.
export const hint = (context, message = '') => {
  const out = { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: context } };
  if (message) out.systemMessage = message;
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
};

// 막지 않고 사용자에게 확인을 받는다(Claude Code 가 확인 창을 띄운다 — 권한 건너뛰기 모드에서도). reason 은 사용자에게 보인다.
// message: 함께 알릴 글(검사 오류·허용 주석 알림 — 묻기 때문에 사라지지 않게, 검토 2026-11-11)
// context: 같은 명령에서 나온 알림(notice 규칙 — back-merge·branch-age)을 Claude 문맥에 함께 — 묻기만 내보내면 알림이 버려졌다(점검 2026-11-26)
export const ask = (reason, message = '', context = '') => {
  const out = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason, ...(context ? { additionalContext: context } : {}) } };
  if (message) out.systemMessage = message;
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
};

export const deny = (reason) => {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }),
  );
  process.exit(0);
};

// git 을 못 찾거나(PATH 에 없음), 저장소가 깨졌거나, 출력이 maxBuffer 를 넘으면 null.
// windowsHide 는 주지 않는다 — Windows 에서 git 한 번이 70ms → 250ms 로 느려졌다(2026-11-06 측정). 멈춘 git 은 Claude Code 의 훅 시간 한도가 끊는다.
// timeout 은 기본으로 주지 않고, 알림만 하는 훅(branch-age)처럼 늦으면 그냥 넘어가도 되는 곳만 준다(timeout 만은 54→55ms 로 거의 같다 — 2026-11-17 측정).
// input: 표준 입력으로 줄 글(git check-ignore --stdin 등). okCodes: 실패가 아닌 끝 코드(check-ignore 는 맞는 것이 없으면 1) — 그때는 그 출력
export const git = (cwd, args, { maxBuffer = 1024 * 1024, input = null, okCodes = [], timeout = 0 } = {}) => {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: [input === null ? 'ignore' : 'pipe', 'pipe', 'ignore'], maxBuffer, ...(input === null ? {} : { input }), ...(timeout > 0 ? { timeout } : {}) });
  } catch (e) {
    return okCodes.includes(e.status) && typeof e.stdout === 'string' ? e.stdout : null;
  }
};

// 저장소 맨 위. .git 을 파일로 찾고(lib/repo-files.mjs), 애매할 때만 git 에게 묻는다.
export const repoRoot = (dir) => {
  const found = findRepo(dir);
  if (found) return found.root;
  if (found === false) return null;
  const out = git(dir, ['rev-parse', '--show-toplevel']);
  return out ? path.resolve(out.trim()) : null;
};

// 저장소 하나의 HEAD 상태(지금 브랜치·커밋이 있나·원격 추적 브랜치가 있나). 값마다 처음 물을 때 한 번만 구한다 —
// 파일로 읽고, 애매하면 git 에게. memo: 도구 호출 하나 동안 같은 저장소를 나눠 쓰는 표(lib/pretool.mjs judge 가 만든다).
export const repoState = (root, memo = null) => {
  if (memo?.has(root)) return memo.get(root);
  let repo;
  const files = () => (repo === undefined ? (repo = (root && findRepo(root)) || null) : repo);
  const cache = {};
  const once = (k, f) => (k in cache ? cache[k] : (cache[k] = f()));
  const head = () => once('head', () => headOf(files()));
  const state = {
    branch: () => once('branch', () => head()?.branch ?? (git(root, ['symbolic-ref', '--short', 'HEAD']) || '').trim()),
    hasHead: () => once('hasHead', () => head()?.hasHead ?? git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']) !== null),
    // 브랜치가 있나(refs/heads/<이름> 이 커밋을 가리키나)
    isBranch: (name) => once(`b:${name}`, () => refExists(files(), `refs/heads/${name}`) ?? git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}^{commit}`]) !== null),
    hasRemoteRefs: () => once('remotes', () => hasRemoteRefsOf(files()) ?? (git(root, ['for-each-ref', '--count=1', 'refs/remotes']) || '').trim() !== ''),
  };
  memo?.set(root, state);
  return state;
};

// 프로젝트 설정. cwd 에서 위로 올라가며 .claude/harness.json 을 찾되, 저장소 맨 위(.git 이 있는 폴더)에서 멈춘다(작업 폴더는 아래 workspaceConfig).
// 없으면 null — 이 프로젝트에서는 아무것도 하지 않는다.
// 이 훅은 플러그인을 켠 모든 프로젝트의 도구 호출마다 돌므로 git 프로세스를 띄우지 않고 파일만 본다.
// 설정이 이보다 크면 손으로 쓴 설정이 아니다 — 읽지 않고 깨진 것으로 알린다(큰 파일을 도구 호출마다 읽지 않게).
export const MAX_CONFIG_BYTES = 256 * 1024; // 고르기 화면(scripts/lib/picker-state.mjs)도 같은 한도로 읽는다
const readConfig = (dir, file) => {
  try {
    if (fs.statSync(file).size > MAX_CONFIG_BYTES) throw new Error('too big');
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    // rules 는 { 훅 id: true | false | { 옵션 } } 이어야 한다. 모양이 다르면(배열·글자) 깨진 설정으로 알린다.
    if (!isObject(cfg) || (cfg.rules !== undefined && !isObject(cfg.rules))) throw new Error('shape');
    // workspace: 작업 폴더 표시(적용이 적은 저장소 폴더 이름들 — scripts/lib/workspace.mjs). 글자 목록일 때만
    const ws = Array.isArray(cfg.workspace) && cfg.workspace.length && cfg.workspace.every((x) => typeof x === 'string') ? { workspace: cfg.workspace } : {};
    return { root: dir, lang: cfg.lang, rules: cfg.rules || {}, ...ws };
  } catch {
    // 깨진 설정은 「검사 없음」으로 조용히 넘기지 않는다 — 모든 검사가 꺼진 줄 모르게 된다(2026-11-05 검토). 막지는 않고 알린다(고치는 쓰기까지 막지 않게).
    return { root: dir, lang: undefined, rules: {}, broken: file };
  }
};
// 저장소 맨 위에서 멈추는 까닭: 위 폴더의 남의 설정(홈 폴더·다른 프로젝트에 적용한 것)이 이 저장소로 새지 않게.
// 다만 바로 위 폴더가 작업 폴더(git 저장소가 아닌 폴더 + 바로 아래 저장소 여럿 — 적용이 workspace 를 적은 설정)면 그 설정을 쓴다.
// ⚠️ 작업 폴더 맨 위에서 연 세션도 Claude Code 가 cd 를 이어 가 cwd 가 messenger/ 안이 되면, 여기서 messenger/.git 에 멈춰
//    설정을 못 찾고 모든 검사가 조용히 꺼졌다(0.2.0 에서 잼, 2026-11-19). 표시가 없거나 깨진 위 설정은 지금처럼 보지 않는다(작업 폴더인지 알 수 없다).
const workspaceConfig = (repo) => {
  const parent = path.dirname(repo);
  const file = path.join(parent, CONFIG_FILE);
  if (parent === repo || !fs.existsSync(file)) return null;
  const cfg = readConfig(parent, file);
  return cfg.workspace ? cfg : null;
};
export const loadConfig = (cwd) => {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    const file = path.join(dir, CONFIG_FILE);
    if (fs.existsSync(file)) return readConfig(dir, file);
    if (fs.existsSync(path.join(dir, '.git'))) return workspaceConfig(dir);
    if (path.dirname(dir) === dir) return null;
  }
};

export const pickLang = (cfgLang) => {
  if (cfgLang === 'ko' || cfgLang === 'en') return cfgLang;
  const sys = process.env.LANG || process.env.LC_ALL || Intl.DateTimeFormat().resolvedOptions().locale || '';
  return /^ko/i.test(sys) ? 'ko' : 'en';
};

// 문구: messages/<lang>.json. {이름} 자리를 vars 로 채운다(값이 없으면 빈칸 — 화면 picker/dom.js fmt 와 같다). 없는 키는 영어 → 키 이름 순으로 대신한다.
const cache = {};
const loadMessages = (lang) => {
  if (!cache[lang]) {
    try {
      cache[lang] = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'messages', `${lang}.json`), 'utf8'));
    } catch {
      cache[lang] = {};
    }
  }
  return cache[lang];
};
export const translator = (lang) => (key, vars = {}) => {
  const text = loadMessages(lang)[key] ?? loadMessages('en')[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
};

// 검사가 오류로 멈췄다는 알림 한 줄(run.mjs · entry.mjs 가 함께 쓴다). errors: 터진 규칙 id 들, '*' 는 바깥에서 터짐.
// t 가 없으면(설정을 읽기 전에 터짐) 시스템 언어로.
export const crashNotice = (errors, t) => {
  const say = t || translator(pickLang());
  return errors.includes('*') ? say('hook.crashed') : say('hook.ruleCrashed', { ids: errors.join(', ') });
};

// 명령줄 읽기 도우미는 cmdline.mjs 에 있다(규칙 파일이 core 하나만 불러도 되게 다시 내보낸다).
export { GIT, SUB_END, BASH, POWERSHELL, shellOf, stripQuoted, shortFlags, splitWords, gitSegments, dataMasked } from './cmdline.mjs';

// 명령이 도는 저장소: `cd 경로 &&` 나 `git -C 경로` 를 따른다.
const unquote = (s) => s.replace(/^["']|["']$/g, '');
// Windows 의 Git Bash 경로(/c/Users/…)는 C:/Users/… 로 읽는다 — 그대로 두면 지금 드라이브의 \c\Users 로 풀렸다(독립 검토 2026-11-23)
const nativePath = (p) => (process.platform === 'win32' ? p.replace(/^\/([a-zA-Z])(?=\/|$)/, (_, d) => `${d.toUpperCase()}:`) : p);
const toDir = (base, raw) => path.resolve(base, nativePath(unquote(raw)));
// PowerShell 의 Set-Location·Push-Location·pushd 도(Set-Location shop; git rm -r --cached . 가 맨 위로 읽히던 일 — 검토 2026-11-11), -Path·-LiteralPath 도.
// 줄바꿈도 명령 구분으로 본다(`cd x` 다음 줄에 `git commit`).
// 따옴표 속(커밋 메시지의 "wip; cd foo")은 보지 않는다 — 따옴표를 가린 글에서 자리를 찾고 원래 글에서 경로를 읽는다. 두 글자 sl 은 Sapling 과 겹쳐 뺐다
const CD = /(?:^|[;&|\n]\s*)(?:cd|chdir|pushd|set-location|push-location)\s+(?:-(?:literal)?path\s+)?("[^"]+"|'[^']+'|[^\s;&|]+)\s*(?:&&|;|\n)/i;
const DASH_C = new RegExp(String.raw`${GIT_CMD}(?:(?:-c\s+${QUOTED_OR_WORD}|--[\w-]+(?:=${QUOTED_OR_WORD})?|-[pP])\s+)*-C\s+(${QUOTED_OR_WORD})`);
const MORE_C = new RegExp(String.raw`\s+-C\s+(${QUOTED_OR_WORD})`, 'y'); // git -C a -C b 는 a 에서 b 로(git 처럼 이어서)
export const commandCwd = (cmd, cwd) => {
  let dir = cwd;
  const bare = stripQuoted(cmd);
  const at = CD.exec(bare);
  const cd = at ? CD.exec(cmd.slice(at.index)) : null;
  if (cd) dir = toDir(dir, cd[1]);
  // `git -C` 도 따옴표 밖에서만(echo "git -C ../other …" 가 다른 저장소로 읽히지 않게 — 2026-11-23). `bash -c "git -C …"` 속은 judge 가 속 명령으로 따로 본다
  const atC = DASH_C.exec(bare);
  const rest = atC ? cmd.slice(atC.index) : '';
  const dashC = atC ? DASH_C.exec(rest) : null;
  if (dashC) {
    dir = toDir(dir, dashC[1]);
    MORE_C.lastIndex = dashC.index + dashC[0].length;
    for (let m; (m = MORE_C.exec(rest)); ) dir = toDir(dir, m[1]);
  }
  return dir;
};
