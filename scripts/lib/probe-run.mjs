// 시험 입력(catalog/probes.json) 하나를 실제 훅 입력으로 만들고 돌리는 도구 — 기존 훅 겹침 알아보기(existing-hooks.mjs)와
// harness-fit 자신의 시험(hooks/test)이 함께 쓴다.
// 도구 호출(PreToolUse) 말고도 Stop · SessionStart · UserPromptSubmit 시험을 받는다. 그런 시험과 저장소 준비(setup)가 있는 시험은
// 자기만의 임시 저장소에서 돈다. 어떤 시험이든 홈과 설정 폴더(HOME·USERPROFILE·APPDATA·XDG_*·CLAUDE_CONFIG_DIR 등)는 임시 폴더로 바꾼다
// — 기존 훅이 로그·상태를 쓰더라도 사용자 홈이 아니라 임시 폴더에 쓰게(spaceEnv).
// 시험 입력의 꼴:
//   event       'PreToolUse'(기본) · 'Stop' · 'SessionStart' · 'UserPromptSubmit'
//   setup       { commits: n(지금 브랜치에 커밋 n개), files: { 경로: 내용 }(커밋하지 않은 새 파일) }
//   transcript  대화 기록 줄들(배열). 글 속 <probe>·<hash>(setup 의 마지막 커밋)·<today>·<ts:초>(지금 기준 몇 초 앞뒤 시각)를 채운다
//   checklist   UserPromptSubmit 시험: 세션 시작 훅들이 알려 준 .md 경로(임시 홈·저장소 안만)에 이 글을 써 둔다
//   expect      이 글이 훅 출력에 보이면 「막음」(보여 주기만 하는 훅의 시험), 없으면 종료 코드 2 · block · deny 가 「막음」
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';

export const PROBE_SESSION = 'harness-fit-probe';
export const eventOf = (x) => x.event || 'PreToolUse';
// 자기만의 저장소·홈이 필요한 시험
export const ownSpace = (x) => eventOf(x) !== 'PreToolUse' || !!x.setup;

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const PLACEHOLDER = /<(probe|hash|today)>|<ts:([+-]?\d+)>/g;
export const fillText = (s, vars) =>
  s.replace(PLACEHOLDER, (m, k, off) => (off !== undefined ? new Date(Date.now() + Number(off) * 1000).toISOString() : vars[k] ?? m));

// 시험 입력의 값 채우기: 글의 자리 표시, content 배열은 이어 붙이고 { repeat, times } 는 되풀이
export const fillValue = (v, vars) => {
  if (typeof v === 'string') return fillText(v, vars);
  if (Array.isArray(v)) return v.map((x) => fillValue(x, vars)).join('');
  if (v && typeof v === 'object' && 'repeat' in v) return String(v.repeat).repeat(v.times);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fillValue(x, vars)]));
  return v;
};
// 대화 기록 한 줄은 배열을 이어 붙이지 않는다(content 배열은 기록의 꼴이다)
const fillRecord = (v, vars) => {
  if (typeof v === 'string') return fillText(v, vars);
  if (Array.isArray(v)) return v.map((x) => fillRecord(x, vars));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fillRecord(x, vars)]));
  return v;
};

// 임시 홈 아래 자리(홈·설정 폴더 환경 변수를 모두 여기로 돌린다 — 훅이 로그·상태를 쓰더라도 사용자 홈·AppData 가 아니라 여기에 쓰게)
const HOME_DIRS = {
  APPDATA: ['AppData', 'Roaming'], LOCALAPPDATA: ['AppData', 'Local'], CLAUDE_CONFIG_DIR: ['.claude'],
  XDG_CONFIG_HOME: ['.config'], XDG_DATA_HOME: ['.local', 'share'], XDG_STATE_HOME: ['.local', 'state'], XDG_CACHE_HOME: ['.cache'],
};
// 시험 동안 임시 폴더로 바꾸는 환경 변수 이름(existing-hooks.mjs 가 명령 속 이 변수들을 실제 값으로 펼칠 때도 쓴다)
export const HOME_VARS = Object.freeze(['HOME', 'USERPROFILE', ...Object.keys(HOME_DIRS)]);

// 임시 홈 하나(설정 폴더들까지 만들어 둔다 — 없는 폴더에 쓰다 터져 「통과」로 읽히지 않게)
export const makeHome = () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-probe-home-'));
  for (const parts of Object.values(HOME_DIRS)) fs.mkdirSync(path.join(home, ...parts), { recursive: true });
  return home;
};

// git 한 번(비동기 — 고르기 서버가 시험하는 동안에도 화면 요청에 답하게)
export const gitAsync = (dir, args, env = process.env) =>
  new Promise((resolve, reject) => execFile('git', ['-C', dir, ...args], { env },(e, out) => (e ? reject(e) : resolve(String(out).trim()))));

// 시험 자리: makeRepo() 가 만든 저장소(비동기도 됨)에 setup 을 하고 임시 홈을 붙인다. → { dir, home, vars, cleanup }
export const makeSpace = async (x, makeRepo) => {
  const dir = await makeRepo();
  const home = makeHome();
  const vars = { probe: dir.split(path.sep).join('/'), today: localDate() };
  const git = (...a) => gitAsync(dir, a);
  const commits = Number(x.setup?.commits) || 0;
  for (let k = 0; k < commits; k++) {
    fs.writeFileSync(path.join(dir, 'src', `step${k + 1}.js`), `export const step = ${k + 1};\n`);
    await git('add', '-A', 'src');
    await git('commit', '-q', '-m', `feat: 시험 단계 ${k + 1}`);
  }
  if (commits) vars.hash = await git('rev-parse', '--short', 'HEAD');
  for (const [rel, text] of Object.entries(x.setup?.files || {})) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, fillText(String(text), vars));
  }
  const cleanup = () => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  };
  return { dir, home, vars, cleanup };
};

// 훅에 넣을 입력(PreToolUse 는 tool_name·tool_input, 그 밖은 그 때의 칸)
export const eventInput = (x, space) => {
  const ev = eventOf(x);
  const base = { session_id: PROBE_SESSION, hook_event_name: ev, cwd: space.dir };
  if (ev === 'PreToolUse') return { ...base, tool_name: x.tool_name, tool_input: fillValue(x.tool_input, space.vars) };
  const transcript = path.join(space.home, 'transcript.jsonl');
  fs.writeFileSync(transcript, (x.transcript || []).map((r) => JSON.stringify(fillRecord(r, space.vars))).join('\n') + '\n');
  const input = { ...base, transcript_path: transcript };
  if (ev === 'Stop') return { ...input, stop_hook_active: false };
  if (ev === 'SessionStart') return { ...input, source: 'startup' };
  return { ...input, prompt: x.prompt || '계속해 주세요' };
};

// 시험 자리 밖으로 나가지 않는 환경: 홈과 설정 폴더(APPDATA·XDG_*·CLAUDE_CONFIG_DIR 등)를 모두 임시 폴더로.
// Windows 는 환경 변수 이름의 대소문자를 가리지 않으므로 같은 이름(다른 대소문자)은 먼저 지운다.
export const spaceEnv = (space) => {
  const home = space.home;
  const vars = { CLAUDE_PROJECT_DIR: space.dir, HOME: home, USERPROFILE: home, ...Object.fromEntries(Object.entries(HOME_DIRS).map(([k, parts]) => [k, path.join(home, ...parts)])) };
  if (process.platform === 'win32') {
    const { root } = path.parse(home);
    Object.assign(vars, { HOMEDRIVE: root.replace(/[\\/]$/, ''), HOMEPATH: home.slice(root.length - 1) });
  }
  const names = new Set(Object.keys(vars).map((k) => k.toUpperCase()));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !names.has(k.toUpperCase())));
  return { ...env, ...vars };
};

const MAX_OUT = 256 * 1024; // 훅 출력은 이만큼만 모은다(판정에는 앞부분이면 된다)
// 시간이 넘은 훅은 손자 프로세스까지 끝낸다(셸 꼴은 셸만 끝내면 그 아래 훅이 남는다)
const killTree = (child) => {
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {});
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    try { child.kill('SIGKILL'); } catch {}
  }
};

// 명령 하나를 돌린다 → { code, out } (시간이 넘으면 timedOut)
// args 가 있으면 exec 꼴(셸 없이 command + args — hooks 문서의 권장 꼴). ${CLAUDE_PROJECT_DIR} 는 셸이 없으니 글자 그대로 바꿔 넣는다.
// Windows 밖에서는 새 프로세스 묶음으로 띄워(detached) 시간이 넘으면 묶음째 끝낸다.
export const runCommand = (command, input, { cwd, env, timeoutS, args = null }) =>
  new Promise((resolve) => {
    const opts = { cwd, windowsHide: true, env, detached: process.platform !== 'win32' };
    const child = Array.isArray(args)
      ? spawn(command, args.map((a) => a.split('${CLAUDE_PROJECT_DIR}').join(cwd)), { ...opts, shell: false })
      : spawn(command, { ...opts, shell: true });
    let out = '';
    const timer = setTimeout(() => {
      if (child.pid) killTree(child);
      resolve({ code: null, out, timedOut: true });
    }, timeoutS * 1000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      if (out.length < MAX_OUT) out += d.slice(0, MAX_OUT - out.length);
    });
    child.stderr.resume(); // 오류 출력은 보지 않지만 비워 둔다(관이 차서 훅이 멈추지 않게)
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: null, out, failed: true });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
    child.stdin.on('error', () => {}); // 입력을 안 읽고 끝나는 훅
    child.stdin.end(JSON.stringify(input));
  });

const parsed = (out) => {
  try {
    return JSON.parse(String(out).trim());
  } catch {
    return null; // 글로 답하는 훅
  }
};
// 훅이 Claude·사용자에게 보여 준 글(JSON 이면 그 칸들, 아니면 출력 그대로)
const shownText = (out) => {
  const j = parsed(out);
  if (!j || typeof j !== 'object') return String(out);
  return [j.hookSpecificOutput?.additionalContext, j.systemMessage, j.reason].filter((s) => typeof s === 'string').join('\n');
};
// 막았는가(expect 가 있으면 그 글을 보여 줬는가)
export const verdict = (x, r) => {
  if (r.timedOut || r.failed) return false;
  if (typeof x.expect === 'string') return r.code === 0 && shownText(r.out).includes(x.expect);
  const j = parsed(r.out);
  return r.code === 2 || !!(j && (j.decision === 'block' || j.hookSpecificOutput?.permissionDecision === 'deny' || j.continue === false));
};

// 출력 속 .md 절대 경로(체크리스트 파일)
const MD_PATH = /(?:[A-Za-z]:[\\/]|\/)[^\n"'`<>|*?]*?\.md\b/g;
const inside = (p, dir) => {
  const rel = path.relative(dir, p);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
};
// 체크리스트 시험: 세션 시작 명령들을 돌려 알려 준 경로에 x.checklist 를 써 둔다(임시 홈·저장소 밖 경로에는 쓰지 않는다)
export const seedChecklist = async (x, space, startCommands, opts) => {
  if (typeof x.checklist !== 'string') return;
  const input = { session_id: PROBE_SESSION, hook_event_name: 'SessionStart', source: 'startup', cwd: space.dir, transcript_path: path.join(space.home, 'transcript.jsonl') };
  for (const start of startCommands) {
    const { command, args } = typeof start === 'string' ? { command: start, args: null } : start; // 글자 하나(셸 꼴) 또는 { command, args }(exec 꼴)
    const r = await runCommand(command, input, { ...opts, args });
    for (const m of shownText(r.out).matchAll(MD_PATH)) {
      const p = path.resolve(m[0]);
      if (!inside(p, space.home) && !inside(p, space.dir)) continue;
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, x.checklist);
    }
  }
};
