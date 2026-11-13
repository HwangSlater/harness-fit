// 사용자가 이미 가진 훅(전역·프로젝트 settings·켜진 플러그인)이 harness-fit 훅과 같은 일을 하는지 알아본다.
// 보는 때: PreToolUse, 그리고 harness-fit 훅이 도는 Stop · SessionStart · UserPromptSubmit(2026-11-06 — 커밋 해시·체크리스트·문서·답 언어).
// PostToolUse 는 셈하지 않는다 — 쓴 뒤에 알려 줄 뿐 막지 못한다. 그걸 같은 훅으로 보고 쓰기 전 차단을 끄면 더 약해진다(2026-11-05 검토).
// 이름이나 코드를 읽어 짐작하지 않고, catalog/probes.json 의 시험 입력을 실제로 넣어 본다(2026-11-05 사용자 결정).
// 「막아야 하는 입력」을 모두 막고 「막으면 안 되는 입력」을 모두 통과시키면 같은 훅으로 본다. 시험 입력의 꼴은 probe-run.mjs.
// 시험은 임시 git 저장소에서 하고 끝나면 지운다. 기존 훅마다 시험 입력 수만큼(수십 번) 불린다.
// 어떤 때의 시험이든 홈·설정 폴더(HOME·USERPROFILE·APPDATA·XDG_*·CLAUDE_CONFIG_DIR)를 임시 폴더로 바꿔 돌린다
// — 로그·상태를 남기는 훅이 시험 기록을 사용자 홈에 쌓지 않게(2026-11-06 검토). 명령 속 홈 경로는 expandHomeRefs 가 실제 값으로 펼친다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PLUGIN_ROOT, readJson } from './paths.mjs';
import { listPlugins } from './installed.mjs';
import { claudeHome } from '../../hooks/lib/claude-home.mjs';
import { probeCacheFile, probeCacheKey, readProbeCache, writeProbeCache } from './probe-cache.mjs';
import { eventOf, ownSpace, makeSpace, makeHome, eventInput, spaceEnv, runCommand, verdict, seedChecklist, gitAsync, removeDir, HOME_VARS } from './probe-run.mjs';

const DEFAULT_TIMEOUT_S = 10; // settings 에 timeout 이 없을 때(Claude Code 기본값보다 짧게 — 시험이 화면을 오래 막지 않게)
const MAX_PARALLEL = 6;
const OLD_DATE = { GIT_AUTHOR_DATE: '2020-01-01T00:00:00+0000', GIT_COMMITTER_DATE: '2020-01-01T00:00:00+0000' };
export const PROBE_EVENTS = ['PreToolUse', 'Stop', 'SessionStart', 'UserPromptSubmit'];

// 시험은 홈·설정 폴더 환경 변수를 임시 폴더로 바꿔 돌리므로, 명령 속 `~/…`·`$HOME`·`${HOME}`·`%USERPROFILE%`·`$env:USERPROFILE` 같은
// 스크립트 경로는 미리 실제 값으로 펼친다(안 펼치면 스크립트를 못 찾아 「통과」로 읽혀 겹침을 놓친다). 환경은 그대로 임시 폴더.
const realValues = (home) => {
  const out = {};
  for (const k of HOME_VARS) {
    const v = k === 'HOME' || k === 'USERPROFILE' ? home : process.env[k];
    if (v) out[k.toUpperCase()] = v;
  }
  return out;
};
const varPattern = (names) => {
  const n = names.join('|');
  return new RegExp(String.raw`\$\{(${n})\}|\$(${n})(?!\w)|%(${n})%|\$env:(${n})(?!\w)`, 'gi');
};
const LEADING_TILDE = /^~(?=[\\/]|$)/;
const expandVars = (s, re, real) => s.replace(re, (m, a, b, c, d) => real[(a || b || c || d).toUpperCase()] ?? m);
const expandWord = (s, home, re, real) => expandVars(s.replace(LEADING_TILDE, () => home), re, real);
// 셸 꼴: 작은따옴표 속은 펼치지 않고(bash 와 같게), 따옴표 없는 낱말의 값에 빈칸이 생기면 그 낱말을 큰따옴표로 싼다
const SHELL_SEG = /"[^"]*"|'[^']*'|[^\s"']+/g;
export const expandHomeRefs = (command, args, home) => {
  const real = realValues(home);
  const re = varPattern(Object.keys(real));
  if (Array.isArray(args)) return { command: expandWord(command, home, re, real), args: args.map((a) => expandWord(a, home, re, real)) };
  const shell = command.replace(SHELL_SEG, (seg) => {
    if (seg.startsWith("'")) return seg;
    if (seg.startsWith('"')) return expandVars(seg, re, real);
    const out = expandWord(seg, home, re, real);
    return out !== seg && /\s/.test(out) ? `"${out}"` : out;
  });
  return { command: shell, args: null };
};

// settings 파일들과 켜진 플러그인(hooks/hooks.json)에서 훅 명령을 모은다. scope: user(이 PC 의 나만) · project(저장소에 있어 팀원도 받음)
// harness-fit 자신은 listPlugins 가 뺀다.
// home: 시험이 임시 홈을 넘긴다. 안 주면 설정은 CLAUDE_CONFIG_DIR → ~/.claude, 명령 속 ~ 는 실제 홈으로 펼친다.
export const listHooks = (root, homeArg) => {
  const home = homeArg || os.homedir();
  const dot = claudeHome(homeArg);
  const files = [
    ['user', path.join(dot, 'settings.json')],
    ['user', path.join(dot, 'settings.local.json')],
    ['project', path.join(root, '.claude', 'settings.json')],
    ['project-local', path.join(root, '.claude', 'settings.local.json')], // 커밋하지 않는 파일이라 팀원은 없다
  ];
  const out = [];
  // 플러그인 훅의 ${CLAUDE_PLUGIN_ROOT} 는 셸마다 펼치는 방법이 달라 글자 그대로 바꿔 넣는다
  const sources = [...files.map(([scope, file]) => [scope, file, readJson(file), null]),
    ...listPlugins(root, homeArg).map((p) => [p.scope, path.join(p.dir, 'hooks', 'hooks.json'), readJson(path.join(p.dir, 'hooks', 'hooks.json')), p])];
  for (const [scope, file, s, plugin] of sources) {
    for (const event of PROBE_EVENTS) {
      for (const group of s?.hooks?.[event] || []) {
        for (const h of group.hooks || []) {
          if (h.type !== 'command' || !h.command) continue;
          const sub = (v) => (plugin ? v.split('${CLAUDE_PLUGIN_ROOT}').join(plugin.dir) : v);
          // args 가 있으면 exec 꼴: 셸 없이 command 를 그대로 띄우고 args 를 하나씩 넘긴다(code.claude.com/docs/en/hooks 「Exec form and shell form」)
          const run = expandHomeRefs(sub(h.command), Array.isArray(h.args) ? h.args.filter((a) => typeof a === 'string').map(sub) : null, home);
          out.push({ scope, file, event, matcher: group.matcher || '', command: run.command, ...(run.args ? { args: run.args } : {}), timeout: Number(h.timeout) || DEFAULT_TIMEOUT_S, plugin: plugin?.id || null });
        }
      }
    }
  }
  return out;
};

// matcher: 비었거나 * 면 모두, 아니면 정규식(Claude Code 와 같게 이름 전체가 맞아야 함).
// 도구 때는 도구 이름, SessionStart 는 시작 까닭(startup)과 견준다. Stop·UserPromptSubmit 은 matcher 를 쓰지 않는다.
const matches = (matcher, name) => {
  if (!matcher || matcher === '*') return true;
  try { return new RegExp(`^(?:${matcher})$`).test(name); } catch { return matcher === name; }
};
const hookFits = (h, x) => {
  const ev = eventOf(x);
  if (h.event !== ev) return false;
  if (ev === 'PreToolUse') return matches(h.matcher, x.tool_name);
  if (ev === 'SessionStart') return matches(h.matcher, 'startup');
  return true;
};

// 시험용 저장소: main 에 커밋 하나, 지금은 feature/probe(브랜치 보호 훅이 시험 자체를 막지 않게), 바뀐 파일 하나를 올려 둠.
// 그 커밋은 원격(origin/main)에도 있는 것으로 둔다 — 「올린 커밋 다시 쓰기」 시험(amend)이 막힐 자리. 원격 저장소는 없고 참조만 만든다.
// 만드는 순서(동기·비동기 판이 같은 순서를 쓴다): 글자 배열이면 git 인자, 함수면 파일 쓰기, { args, env } 는 환경을 바꾼 git
const probeRepoSteps = (dir) => [
  ['init', '-q', '-b', 'main'],
  ['config', 'user.email', 'probe@example.com'], ['config', 'user.name', 'probe'],
  ['config', 'core.autocrlf', 'false'],
  () => { fs.mkdirSync(path.join(dir, 'src')); fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'export const a = 1;\n'); },
  ['add', 'src/app.js'],
  // 시작 커밋은 오래전 것으로(reflog 시각 = 커밋 시각) — 「이번 턴에 만든 커밋」 시험에 섞이지 않게
  { args: ['commit', '-q', '-m', 'chore: 시작'], env: { ...process.env, ...OLD_DATE } },
  ['update-ref', 'refs/remotes/origin/main', 'HEAD'],
  ['switch', '-q', '-c', 'feature/probe'],
  () => fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'export const a = 2;\n'),
  ['add', 'src/app.js'],
];
const newProbeDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'harness-probe-'));
export const makeProbeRepo = () => {
  const dir = newProbeDir();
  for (const s of probeRepoSteps(dir)) {
    if (typeof s === 'function') s();
    else execFileSync('git', ['-C', dir, ...(s.args || s)], { stdio: 'ignore', env: s.env || process.env });
  }
  return dir;
};
// 비동기 판(고르기 서버가 시험하는 동안 화면 요청을 막지 않게)
export const makeProbeRepoAsync = async () => {
  const dir = newProbeDir();
  for (const s of probeRepoSteps(dir)) {
    if (typeof s === 'function') s();
    else await gitAsync(dir, s.args || s, s.env);
  }
  return dir;
};
// 한 번 만든 시험용 저장소를 복사해 새 자리로(git 을 열 번 부르는 대신 파일 복사 한 번 — 2026-11-13).
// 커밋 날짜를 고정해 두어 복사본도 새로 만든 것과 커밋·브랜치·올린 참조가 같다.
const copyProbeRepo = (template) => async () => {
  const dir = newProbeDir();
  await fs.promises.cp(template, dir, { recursive: true });
  return dir;
};

// 동시에 너무 많이 띄우지 않게
const limit = async (jobs, n) => {
  const results = new Array(jobs.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => { while (next < jobs.length) { const i = next++; results[i] = await jobs[i](); } }));
  return results;
};

// 시험 자리 만들기(git 을 열 번 남짓 부른다)는 동시에 MAX_SETUP 개까지만 — 한꺼번에 띄워 PC 전체를 느리게 하지 않게
const MAX_SETUP = 2;
const gate = (n) => {
  let free = n;
  const waiting = [];
  return async (fn) => {
    if (free > 0) free--;
    else await new Promise((r) => waiting.push(r));
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else free++;
    }
  };
};
const setupGate = gate(MAX_SETUP);
// 훅 프로세스는 모든 시험을 통틀어 동시에 MAX_PROCS 개까지(코어 수, 2~8). 기다리는 동안은 시간을 세지 않는다(시간은 띄운 뒤부터).
const MAX_PROCS = Math.max(2, Math.min(8, os.availableParallelism?.() ?? os.cpus().length));
const procGate = gate(MAX_PROCS);

// 한 시험 자리에서 훅들을 함께 돌린다 → [{ h, blocked, timedOut }]
// 훅마다 따로 판정하고(같은 입력·같은 자리), 서로의 출력을 보지 않으므로 차례로 돌린 것과 판정이 같다(2026-11-13 — 이 PC 13개 훅으로 견줌).
const runHooks = async (x, hooks, space, env) => {
  const input = eventInput(x, space);
  return Promise.all(hooks.map(async (h) => {
    const r = await procGate(() => runCommand(h.command, input, { cwd: space.dir, env, timeoutS: h.timeout, args: h.args }));
    return { h, blocked: verdict(x, r), timedOut: !!r.timedOut };
  }));
};

// 시험 입력 하나 × 그 때에 걸리는 훅들 → [{ h, blocked }]. 자기 자리가 필요한 시험은 자리를 만들고 끝나면 지운다.
// 도구 시험은 함께 쓰는 저장소(sharedDir)에서 돌되, 홈은 언제나 임시 폴더(sharedHome — 없으면 이 시험만의 것을 만들고 지운다).
// startCommands: 체크리스트 시험 전에 돌릴 세션 시작 명령들(그 훅들이 알려 준 경로에 체크리스트를 써 둔다)
// makeRepo: 자기 자리 저장소를 만드는 함수(겹침 알아보기는 미리 만든 저장소를 복사한다)
export const runProbeCase = async (x, hooks, { sharedDir, sharedHome = null, startCommands = [], prepare = () => {}, makeRepo = makeProbeRepoAsync } = {}) => {
  if (!ownSpace(x)) {
    const home = sharedHome || makeHome();
    try {
      const space = { dir: sharedDir, home, vars: { probe: sharedDir.split(path.sep).join('/') } };
      return await runHooks(x, hooks, space, spaceEnv(space));
    } finally {
      if (!sharedHome) removeDir(home);
    }
  }
  const space = await setupGate(() => makeSpace(x, makeRepo));
  try {
    prepare(space.dir);
    const env = spaceEnv(space);
    await seedChecklist(x, space, startCommands, { cwd: space.dir, env, timeoutS: DEFAULT_TIMEOUT_S });
    return await runHooks(x, hooks, space, env);
  } finally {
    space.cleanup();
  }
};

// 결과: { <harness 훅 id>: { scope: 'project'|'user', by: ['guard-git.mjs', …], from: [{ label, scope, plugin }] } } — 같은 일을 하는 기존 훅이 있는 것만.
// scope 가 user 면 이 PC 의 나에게만 있는 훅이라 팀원 공유를 켜면 harness-fit 훅이 다시 필요하다.
// 저장소 쪽 훅(프로젝트 settings·프로젝트 범위 플러그인)은 Claude Code 안에서만 돌린다 — Claude Code 는 폴더를 믿는다고 한 뒤에만
// 그 훅을 돌리는데, npx 로 받은 저장소를 열 때 여기서 돌리면 그 확인을 건너뛰게 된다. 밖에서는 내 전역 훅만 시험한다.
export const trustsProject = () => !!process.env.CLAUDECODE;
export const skippedProjectHooks = (root, home) => (trustsProject() ? 0 : listHooks(root, home).filter((h) => h.scope !== 'user').length);

// cache: 결과를 <설정 폴더>/harness-fit/probe-cache.json 에 담아 두고 훅·시험 입력·플러그인이 그대로면 다시 쓴다(probe-cache.mjs).
export const probeExistingHooks = async (root, { home, probes = readJson(path.join(PLUGIN_ROOT, 'catalog', 'probes.json')), trustProject = trustsProject(), cache = true } = {}) => {
  const hooks = listHooks(root, home).filter((h) => h.scope === 'user' || trustProject);
  if (!hooks.length || !probes) return {};
  const file = probeCacheFile(home);
  const key = cache ? await probeCacheKey(hooks, probes) : null;
  if (key) {
    const hit = await readProbeCache(file, key);
    if (hit) return hit;
  }
  const { out, timedOut } = await probeHooks(hooks, probes);
  if (key && !timedOut) await writeProbeCache(file, key, out);
  return out;
};

// 시험을 실제로 돌린다 → { out, timedOut(시간이 넘은 훅이 있었나) }
const probeHooks = async (hooks, probes) => {
  // 자리마다 git 으로 새로 만들지 않고 하나를 만들어 복사한다(함께 쓰는 저장소도 복사본 — 원본은 손대지 않게 둔다)
  const template = await makeProbeRepoAsync();
  const makeRepo = copyProbeRepo(template);
  const sharedHome = makeHome();
  let sharedDir = null;
  try {
    sharedDir = await makeRepo();
    const cases = Object.entries(probes).filter(([id]) => !id.startsWith('_'))
      .flatMap(([id, p]) => [...p.block.map((x) => ({ id, want: 'block', x })), ...p.pass.map((x) => ({ id, want: 'pass', x }))]);
    const startCommands = hooks.filter((h) => h.event === 'SessionStart' && matches(h.matcher, 'startup')).map((h) => ({ command: h.command, args: h.args }));
    // 입력 하나마다 그 때·도구에 걸리는 기존 훅들
    const jobs = cases.map((c) => async () => {
      const fit = hooks.filter((h) => hookFits(h, c.x));
      if (!fit.length) return [];
      return (await runProbeCase(c.x, fit, { sharedDir, sharedHome, startCommands, makeRepo })).map((r) => ({ c, ...r }));
    });
    const results = (await limit(jobs, MAX_PARALLEL)).flat();
    const timedOut = results.some((r) => r.timedOut);
    const out = {};
    for (const id of new Set(cases.map((c) => c.id))) {
      // 기존 훅마다 따로 본다: 그 훅 하나가 block 을 모두 막고 pass 를 모두 통과시켜야 같은 훅
      const byHook = new Map();
      for (const r of results.filter((r) => r.c.id === id)) {
        const key = `${r.h.scope}\u0000${commandLine(r.h)}`;
        const v = byHook.get(key) || { h: r.h, ok: true, seen: 0 };
        v.seen++; if ((r.c.want === 'block') !== r.blocked) v.ok = false;
        byHook.set(key, v);
      }
      const need = cases.filter((c) => c.id === id).length;
      const same = [...byHook.values()].filter((v) => v.ok && v.seen === need).map((v) => v.h);
      if (!same.length) continue;
      // 팀원도 받는 것(project)이 있으면 그것, 없으면 이 저장소의 이 PC 만(project-local), 그다음 전역(user)
      const scope = ['project', 'project-local', 'user'].find((s) => same.some((h) => h.scope === s));
      // exec 꼴은 args 의 스크립트 이름을 먼저 본다(command 는 대개 node.exe 같은 실행 파일이라)
      const labelOf = (h) => hookLabel(h.args?.length ? [...h.args, h.command].join(' ') : h.command);
      // from: 화면 「이미 쓰고 있는 훅」 창이 보여 줄 것 — 훅마다 짧은 이름·어디에 적혔는지(scope)·플러그인 id. 명령 전체·파일 경로는 보내지 않는다.
      const from = [...new Map(same.map((h) => [`${h.scope}\u0000${h.plugin || ''}\u0000${labelOf(h)}`, { label: labelOf(h), scope: h.scope, plugin: h.plugin }])).values()];
      out[id] = { scope, by: [...new Set(same.map(labelOf))], from };
    }
    return { out, timedOut };
  } finally {
    for (const d of [template, sharedDir, sharedHome]) if (d) removeDir(d);
  }
};

// 훅 하나를 가리키는 한 줄(exec 꼴은 command 뒤에 args 를 붙인다)
const commandLine = (h) => [h.command, ...(h.args || [])].join(' ');

// 화면에 보일 짧은 이름: 명령 안의 스크립트 파일 이름(없으면 첫 낱말)
export const hookLabel = (command) => {
  const file = command.match(/[\w.-]+\.(?:mjs|cjs|js|ts|py|sh|ps1|exe)\b/);
  return file ? file[0] : command.trim().split(/\s+/)[0].split(/[\\/]/).pop();
};
