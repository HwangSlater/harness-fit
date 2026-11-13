// 명령 조각의 「실제로 실행되는 도구」부터의 낱말. 앞붙이(sudo·env·VAR=값·timeout·xargs·npx·pnpm exec·uv run·python -m·
// bash 스크립트·docker run 이미지·docker compose exec <서비스>·kubectl exec … --·xcrun)를 벗긴다. 맨 앞 낱말만 경로·.exe 를 뗀다(인자는 그대로).
// danger-cmd 의 DB 지우기(rules/shell.mjs dbWipe)와 ask-cmd 가 함께 쓴다. 두 번의 독립 검토로 넓혔다(2026-11-11).
const head = (x) => String(x || '').replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase();
// 값을 받는 옵션: sudo -u 사람 · -g 무리 · -C 폴더, env -u 이름 -C 폴더
const SUDO_VALUE = /^-(?:[ugCDhprTU]|-user|-group|-chdir|-host)$/;
// sudo -iu postgres 처럼 붙여 쓴 묶음의 끝 글자가 값을 받으면 다음 낱말도 건너뛴다
const sudoValue = (x) => SUDO_VALUE.test(x) || /^-[a-zA-Z]*[ugCDhprTU]$/.test(x);
const EXEC_VALUE = /^(?:-[euw]|--env|--user|--workdir|--index|--env-file)$/;
const RUNNERS = new Set(['npx', 'bunx', 'pnpx']);
const RUNNER_VALUE = /^(?:-p|--package)$/;
// npx -c "명령" · npm exec -c "명령": 따옴표 속 명령을 다시 나눠 이어서 본다(값으로 건너뛰어 놓치던 회귀 — 네 번째 검토)
const CALL = /^(?:-c|--call)$/;
const runnerRest = (w) => {
  const i = skipOpts(w, (x) => RUNNER_VALUE.test(x) || CALL.test(x));
  const c = w.findIndex((x, k) => k < i && CALL.test(x));
  return c >= 0 && w[c + 1] ? w[c + 1].trim().split(/\s+/) : w.slice(i);
};
const RUN_TOOLS = new Set(['uv', 'poetry', 'pipenv', 'pdm', 'hatch', 'bundle', 'rye']);
// pnpm·yarn·bun 의 자체 명령(이 밖의 첫 낱말은 node_modules/.bin 의 도구를 바로 부르는 꼴 — `pnpm prisma migrate reset`)
const PM_OWN = new Set(['install', 'i', 'add', 'remove', 'rm', 'uninstall', 'run', 'test', 't', 'build', 'dev', 'start', 'init', 'create', 'why', 'list', 'ls',
  'outdated', 'update', 'up', 'upgrade', 'link', 'unlink', 'publish', 'pack', 'audit', 'info', 'config', 'cache', 'exec', 'dlx', 'x', 'workspace', 'workspaces',
  'import', 'store', 'patch', 'rebuild', 'prune', 'dedupe', 'set', 'version', 'help', 'login', 'logout', 'whoami', 'node', 'env', 'setup', 'bin', 'root', 'global', 'fetch', 'deploy', 'licenses', 'recursive', 'r']);
// 패키지 관리자 자체 옵션 가운데 값을 받는 것(pnpm --filter web · -C apps/web · npm --prefix app)
// (pnpm 의 -w 는 값이 없다 — npm 의 -w 는 --workspace 로만 받는다)
const PM_VALUE = /^(?:--filter|-F|-C|--dir|--prefix|--cwd|--workspace)$/;
// compose 자체 옵션 가운데 값을 받는 것
const COMPOSE_VALUE = /^(?:-f|--file|-p|--project-name|--env-file|--profile|--project-directory|--ansi|--progress)$/;
// docker run·compose run 의 값 받는 옵션(--gpus all 의 all 을 이미지로 읽던 일 — 검토)
const RUN_VALUE = /^(?:-[eluvwpmh]|--env|--env-file|--label|--user|--volume|--workdir|--publish|--name|--network|--entrypoint|--mount|--platform|--add-host|--hostname|--gpus|--cpus|--memory|--runtime|--ipc|--device|--restart|--pull|--shm-size|--ulimit|--cap-add|--cap-drop|--security-opt|--log-driver|--log-opt|--tmpfs|--dns|--cidfile|--link|--volumes-from|--group-add|--pid|--uts|--cgroupns|--stop-signal|--health-cmd|--expose|-a|--attach)$/;
// python 자체 옵션 가운데 값을 받는 것(-X 값 · -W 값)
const PY_VALUE = /^-[XW]$/;
// timeout [옵션] 시간 명령 · xargs [옵션] 명령 · watch [옵션] 명령
const TIMEOUT_VALUE = /^(?:-s|--signal|-k|--kill-after)$/;
const XARGS_VALUE = /^(?:-[IEdLnPs]|--replace|--delimiter|--max-args|--max-procs|--arg-file|-a)$/;
const WATCH_VALUE = /^(?:-n|--interval|-d|--differences)$/;
// xcrun 의 값 받는 옵션과, 도구를 돌리지 않고 경로·SDK 를 보여 주기만 하는 옵션(xcrun --help)
const XCRUN_VALUE = /^(?:--?sdk|--?toolchain)$/;
const XCRUN_LOOK = /^(?:-f|--find|--show-sdk-[\w-]+|-h|--help|--version)$/;

const skipOpts = (w, valueOpt) => {
  let i = 0;
  while (i < w.length && w[i].startsWith('-')) i += (typeof valueOpt === 'function' ? valueOpt(w[i]) : valueOpt.test(w[i])) ? 2 : 1;
  return i;
};
// exec 뒤 옵션을 건너뛰고 컨테이너·서비스 이름 다음부터
const afterTarget = (w) => w.slice(skipOpts(w, EXEC_VALUE) + 1);
const isPython = (a) => /^python[\d.]*$/.test(a);
const isShell = (a) => /^(?:ba|z|da|k)?sh$/.test(a);

// 셸의 자기 옵션(bash -x · -e · -o pipefail · --login). -c(글)·-s(표준 입력)·-i 가 있으면 스크립트를 부르는 꼴이 아니다
const SHELL_LONG = /^--(?:login|norc|noprofile|posix|verbose|debugger|restricted|noediting)$/;
const SHELL_LONG_VALUE = /^--(?:rcfile|init-file)$/;
const shellScriptAt = (w) => {
  let i = 1;
  while (i < w.length && /^[-+]/.test(w[i])) {
    const x = w[i];
    if (x === '--') return i + 1 < w.length ? i + 1 : -1;
    if (SHELL_LONG.test(x)) i++;
    else if (SHELL_LONG_VALUE.test(x) || x === '-o' || x === '+o') i += 2;
    // -n 은 문법만 보고 실행하지 않는다(bash -n x.sh — 검토 2026-11-13)
    else if (/^[-+][A-Za-z]+$/.test(x) && !/[csin]/.test(x.slice(1))) i++;
    else return -1;
  }
  return i < w.length ? i : -1;
};
// 명령 앞에 붙어 그 명령을 그대로 실행하는 셸 낱말·블록 여는 표시(검토 2026-11-13 — exec X·builtin command X·{ X; }·if … { X }·eval X·source x.sh 가 막기를 지나갔다)
// 다시 검토 2026-11-13: if·while·until X(조건 자리의 명령도 실행된다)·coproc X·PowerShell 의 & X(부르기 연산자)
const PASS_WORDS = new Set(['exec', 'builtin', 'eval', 'source', '.', '{', '!', 'then', 'do', 'else', 'elif', 'try', 'finally', 'if', 'while', 'until', 'coproc', '&']);
const EXEC_OPT_VALUE = /^-a$/; // exec -a 이름 명령
// 앞붙이마다 값을 받는 옵션 — 한 목록으로 보니 time -p·command -p 의 -p(값 없음)가 다음 낱말(명령)을 값으로 먹었다
const PREFIX_VALUE = {
  doas: /^-[uC]$/,
  env: /^-(?:u|C|-unset|-chdir)$/,
  command: /^$/,
  nohup: /^$/,
  time: /^-(?:f|o|-format|-output)$/,
  setsid: /^$/,
  stdbuf: /^-[oei]$/, // stdbuf -o L · -oL(붙여 씀은 낱말 하나)
};
// 스크립트 블록을 받아 그 안을 실행하는 PowerShell 명령(1..3 | % { X } · Invoke-Command -ScriptBlock { X } · Start-Job { X })
const PS_BLOCK = new Set(['foreach-object', '%', 'invoke-command', 'icm', 'start-job', 'sajb']);
// PowerShell 의 if (조건) { X } · while (조건) { X } — 조건 괄호 낱말을 건너뛴다
const PS_COND = new Set(['if', 'elseif', 'while', 'switch', 'foreach', 'for']);
// 따옴표 속 명령 글을 받는 옵션: su -c "X" · env -S "X"(낱말로 다시 나눈다)
const payload = (w, re) => {
  const k = w.findIndex((x, i) => i > 0 && re.test(x));
  if (k < 0) return null;
  const eq = w[k].indexOf('=');
  const text = eq > 0 && w[k].startsWith('--') ? w[k].slice(eq + 1) : w[k + 1];
  return text ? [...text.trim().split(/\s+/), ...(eq > 0 ? w.slice(k + 1) : w.slice(k + 2))] : null;
};
// wsl [옵션] [--|-e] 명령 — 리눅스 명령을 돌린다. 값 받는 옵션은 건너뛰고, 그 밖의 -- 로 시작하는 옵션(--install·--list)은 명령이 아니다
const WSL_VALUE = /^(?:-d|--distribution|-u|--user|--cd|--shell-type)$/;
const wslRest = (w) => {
  let i = 1;
  while (i < w.length && w[i].startsWith('-')) {
    if (w[i] === '--' || w[i] === '-e' || w[i] === '--exec') return w.slice(i + 1);
    if (!WSL_VALUE.test(w[i])) return null;
    i += 2;
  }
  return w.slice(i);
};
// PowerShell Start-Process [-FilePath] 프로그램 [-ArgumentList] 인자(쉼표·띄어쓰기로 나눔)
const SAPS_VALUE = /^-(?:FilePath|ArgumentList|Args|WorkingDirectory|Verb|WindowStyle|RedirectStandardInput|RedirectStandardOutput|RedirectStandardError|Credential|Environment)$/i;
const startProcess = (w) => {
  let file = null;
  let args = null;
  const pos = [];
  for (let i = 1; i < w.length; i++) {
    const x = w[i];
    if (/^-(?:FilePath|PSPath|Path)$/i.test(x)) file = w[++i];
    else if (/^-(?:ArgumentList|Args)$/i.test(x)) args = w[++i];
    else if (SAPS_VALUE.test(x)) i++;
    else if (x.startsWith('-')) continue;
    else pos.push(x);
  }
  file ??= pos.shift();
  args ??= pos.shift();
  if (!file) return null;
  // @('/c','rd') 꼴의 목록도(괄호에서 조각이 나뉘는 꼴은 lib/hidden-runs.mjs 가 원래 글에서 다시 만든다)
  const list = String(args ?? '').replace(/^@\(|\)$/g, '');
  return [file, ...list.split(/[,\s]+/).map((x) => x.replace(/^["']|["']$/g, '')).filter(Boolean)];
};
// pwsh·powershell [옵션] -Command X … — 뒤 낱말들이 명령이다(Start-Process powershell -ArgumentList "-Command","X" 를 벗긴 꼴 — 검토 2026-11-13).
// 따옴표 친 한 낱말(-Command "X Y")은 다시 나눈다. -File·-EncodedCommand 는 보지 않는다
const PS_CMD = /^-(?:c|command)$/i;
const psCommand = (w) => {
  const k = w.findIndex((x, i) => i > 0 && PS_CMD.test(x));
  if (k < 0 || !w[k + 1]) return null;
  return [...w[k + 1].trim().split(/\s+/), ...w.slice(k + 2)];
};
// 따옴표 없이 붙여 쓴 블록 {terraform apply} · .{X} · &{X}: 앞의 { 와 맨 끝의 } 를 뗀다
const unbrace = (w) => {
  const out = [w[0].replace(/^[.&]?\{/, ''), ...w.slice(1)].filter((x, i) => i > 0 || x);
  const close = out.findIndex((x) => x === '}');
  const cut = close >= 0 ? out.slice(0, close) : out;
  if (cut.length && cut.at(-1).endsWith('}') && !cut.at(-1).includes('{')) cut[cut.length - 1] = cut.at(-1).slice(0, -1);
  return cut.filter(Boolean);
};
// 앞붙이를 벗길 수 있는 최대 횟수. 넘으면 capped 표시를 단다 — 막기(blockHit)는 이때 막는다(지키는 쪽)
const MAX_PREFIX = 32;

// keepXcrun: xcrun 앞에서 멈춘다 — 사용자가 「xcrun」·「xcrun --sdk iphoneos」 처럼 도구 없이 적은 묻는 명령을 맞추려고(ask-match.mjs variants)
// hostOnly: 컨테이너·원격 안에서 도는 명령(docker exec·compose run·kubectl exec·wsl)은 벗기지 않는다 — 이 PC 의 파일을 쓰는지 볼 때(lib/shell-writes.mjs)
const GUEST = /^(?:docker|podman|docker-compose|podman-compose|kubectl|wsl)$/;
export const runWords = (words, { keepXcrun = false, hostOnly = false } = {}) => {
  let w = Array.isArray(words) ? words.map(String) : [];
  let guard = 0;
  for (; guard < MAX_PREFIX && w.length; guard++) {
    const a = head(w[0]);
    const b = w[1];
    if (hostOnly && GUEST.test(a)) break;
    if (/^\w+=/.test(w[0])) w = w.slice(1);
    else if (/^[.&]?\{./.test(w[0])) w = unbrace(w); // {terraform apply} · .{X} · &{X}
    else if (PS_COND.has(a) && b?.startsWith('(')) {
      // if (조건) { X }: 괄호가 닫히는 낱말까지 건너뛴다
      let depth = 0;
      let k = 1;
      for (; k < w.length; k++) {
        depth += (w[k].match(/\(/g) || []).length - (w[k].match(/\)/g) || []).length;
        if (depth <= 0) break;
      }
      w = w.slice(k + 1);
    } else if (PS_BLOCK.has(a)) {
      const k = w.findIndex((x, i) => i > 0 && x.startsWith('{'));
      if (k < 0) break;
      w = w.slice(k);
    } else if (a === 'function' && b) w = w.slice(2).filter((x, i) => !(i === 0 && x === '()')); // function 이름 { X; }
    else if (a === 'command' && /^-[a-zA-Z]*[vV]/.test(b || '')) break; // command -v X 는 찾기만 한다
    else if (PASS_WORDS.has(a)) w = w.slice(1 + (a === 'exec' ? skipOpts(w.slice(1), EXEC_OPT_VALUE) : 0));
    else if (a === 'su') {
      const p = payload(w, /^(?:-c|--command(?:=.*)?)$/);
      if (!p) break;
      w = p;
    } else if (a === 'env' && w.slice(1).some((x) => /^(?:-S|--split-string(?:=.*)?)$/.test(x))) {
      const p = payload(w, /^(?:-S|--split-string(?:=.*)?)$/);
      if (!p) break;
      w = p;
    } else if (a === 'wsl') {
      const r = wslRest(w);
      if (!r) break;
      w = r;
    } else if ((a === 'pwsh' || a === 'powershell') && psCommand(w)) w = psCommand(w);
    else if (a === 'cmd' && /^\/[A-Za-z]$/.test(b || '')) {
      // cmd /c 명령 · cmd /s /c 명령(따옴표 없는 꼴 — 따옴표 친 꼴은 cmdline.mjs innerCommands 가 따로 본다)
      const c = w.findIndex((x, k) => k > 0 && /^\/[ck]$/i.test(x));
      if (c < 0 || w.slice(1, c).some((x) => !/^\/[A-Za-z]$/.test(x))) break;
      w = w.slice(c + 1);
    } else if (a === 'start-process' || a === 'saps' || a === 'start') {
      const s = startProcess(w);
      if (!s) break;
      w = s;
    } else if (a === 'sudo') w = w.slice(1 + skipOpts(w.slice(1), sudoValue));
    else if (Object.hasOwn(PREFIX_VALUE, a)) w = w.slice(1 + skipOpts(w.slice(1), PREFIX_VALUE[a]));
    else if (a === 'nice' || a === 'ionice') w = w.slice(1 + skipOpts(w.slice(1), /^(?:-[ncpt]|--adjustment|--class|--classdata)$/)); // nice -n 10 · ionice -c 3
    else if (a === 'timeout') w = w.slice(1 + skipOpts(w.slice(1), TIMEOUT_VALUE) + 1); // 시간 다음부터
    else if (a === 'xargs') w = w.slice(1 + skipOpts(w.slice(1), XARGS_VALUE));
    else if (a === 'watch') w = w.slice(1 + skipOpts(w.slice(1), WATCH_VALUE));
    else if (RUNNERS.has(a)) w = runnerRest(w.slice(1));
    else if (RUN_TOOLS.has(a) && (b === 'run' || b === 'exec')) w = w.slice(2 + skipOpts(w.slice(2), /^--(?:with|python|env-file|project|directory)$/));
    else if (['npm', 'pnpm', 'yarn', 'bun'].includes(a) && b?.startsWith('-')) {
      // 패키지 관리자 앞 옵션(pnpm --filter web …, npm --prefix app …)은 건너뛰고 다시 본다
      const i = 1 + skipOpts(w.slice(1), PM_VALUE);
      if (i >= w.length) break;
      w = [w[0], ...w.slice(i)];
    } else if (a === 'yarn' && b === 'workspace' && w[2]) w = [w[0], ...w.slice(3)]; // yarn workspace web prisma …
    else if ((a === 'pnpm' || a === 'yarn' || a === 'bun') && (b === 'exec' || b === 'dlx' || b === 'x')) w = runnerRest(w.slice(2));
    else if (a === 'npm' && b === 'exec') w = runnerRest(w.slice(2)).filter((x, k) => !(k === 0 && x === '--'));
    else if ((a === 'pnpm' || a === 'yarn' || a === 'bun') && b && !PM_OWN.has(b)) w = w.slice(1);
    else if (isPython(a)) {
      // python [옵션] -m 모듈 … · python [옵션] 파일.py …(-u·-O·-B 는 값 없음, -X 값·-W 값은 값까지 건너뜀, -c 는 글이라 그대로 둔다)
      let j = 1;
      let next = null;
      while (j < w.length && w[j].startsWith('-')) {
        if (w[j] === '-m') {
          next = w.slice(j + 1);
          break;
        }
        if (w[j] === '-c') break;
        j += PY_VALUE.test(w[j]) ? 2 : 1;
      }
      if (next) w = next;
      else if (/\.py$/i.test(w[j] || '')) w = w.slice(j); // python manage.py flush
      else break;
    } else if (isShell(a) && shellScriptAt(w) > 0) w = w.slice(shellScriptAt(w)); // bash scripts/deploy.sh · bash -x deploy · sh -e x.sh
    else if ((a === 'docker' || a === 'podman') && (b === 'exec' || b === 'run')) w = b === 'exec' ? afterTarget(w.slice(2)) : w.slice(2 + skipOpts(w.slice(2), RUN_VALUE) + 1); // run: 이미지 다음부터
    else if (a === 'docker' || a === 'podman' || a === 'docker-compose' || a === 'podman-compose') {
      // compose 의 하위 명령(앞의 -f 파일·-p 이름 같은 값은 건너뜀): exec·run 이면 서비스 다음부터
      const from = a.endsWith('-compose') ? 1 : b === 'compose' ? 2 : -1;
      if (from < 0) break;
      const i = from + skipOpts(w.slice(from), COMPOSE_VALUE);
      if (w[i] === 'exec') w = afterTarget(w.slice(i + 1));
      else if (w[i] === 'run') w = w.slice(i + 1 + skipOpts(w.slice(i + 1), RUN_VALUE) + 1);
      else break;
    } else if (a === 'kubectl' && b === 'exec' && w.includes('--')) w = w.slice(w.indexOf('--') + 1);
    else if (a === 'xcrun' && !keepXcrun) {
      // xcrun [--sdk 값] 도구 … 는 그 도구를 돌린다(xcrun agvtool new-marketing-version — 역할극 16 회차 다시 매기기, 2026-11-13).
      // 찾기·보기 옵션(-f·--find·--show-sdk-*·도움말·버전)이 있으면 도구를 돌리지 않는다
      const i = 1 + skipOpts(w.slice(1), XCRUN_VALUE);
      if (i >= w.length || w.slice(1, i).some((x) => XCRUN_LOOK.test(x))) break;
      w = w.slice(i);
    }
    else break;
  }
  if (!w.length) return [];
  // gmake 는 GNU make 다(적은 「make apply-prod」 와 맞게)
  const first = head(w[0]);
  const out = [first === 'gmake' ? 'make' : first, ...w.slice(1)];
  if (guard >= MAX_PREFIX) Object.defineProperty(out, 'capped', { value: true });
  return out;
};

// 패키지 스크립트 실행(npm run X · pnpm run X · yarn X · bun run X)을 「스크립트 X」 하나의 꼴로 — 사용자가 적은 「pnpm deploy:prod」 와
// 「pnpm run deploy:prod」 가 서로 맞게(ask-cmd). 스크립트가 아니면 null.
export const scriptName = (w) => {
  if (!['npm', 'pnpm', 'yarn', 'bun'].includes(w[0])) return null;
  if ((w[1] === 'run' || w[1] === 'run-script') && w[2]) return w[2];
  if (w[0] !== 'npm' && w[1] && !w[1].startsWith('-') && !PM_OWN.has(w[1])) return w[1];
  return null;
};
