// 셸 명령(Bash/PowerShell) 규칙: 위험 명령·명령줄 비밀번호. 비밀값 커밋은 rules/commit.mjs.
// 둘 다 「적어 둔 꼴」만 막는다(packs.json detail 에 적은 목록). 실행되지 않는 글(커밋 메시지·echo 인자·cat heredoc)은 비운 뒤 본다.
import { git, GIT, dataMasked, stripQuoted, gitSegments } from '../lib/core.mjs';
import { wipesEverything } from '../lib/delete.mjs';

// 받은 것을 실행하는 셸·언어(프로세스 치환 꼴용)
const RUNNER = String.raw`(?:(?:ba|z|da|k)?sh|fish|pwsh|powershell|python[23]?|node|perl|ruby|php)`;
const PS_FETCH = String.raw`(?:irm|iwr|Invoke-RestMethod|Invoke-WebRequest|\(?\s*New-Object\s+(?:System\.)?Net\.WebClient\s*\)?\s*\.\s*DownloadString)`;

// 받은 것을 파이프로 바로 실행: curl … | sh, wget -qO- … | sudo bash, curl … | tee x | sh, iwr … | iex.
// 받는 명령은 파이프 단계의 명령 자리에 있을 때만(`cat curl-out.json` 은 아니다), 실행기는 표준 입력을 코드로 읽을 때만
// (`python3 -m json.tool`·`node -e "…"`·`bash script.sh` 은 받은 것을 실행하지 않는다).
const FETCHERS = new Set(['curl', 'wget', 'iwr', 'invoke-webrequest', 'irm', 'invoke-restmethod']);
const EVALUATORS = new Set(['iex', 'invoke-expression']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);
const RUNNERS = new Set([...SHELLS, 'pwsh', 'powershell', 'python', 'python2', 'python3', 'node', 'perl', 'ruby', 'php']);
// 실행기마다 「표준 입력 대신 다른 코드·모듈을 돌리는」 옵션
const NOT_STDIN = { python: /^-[mc]/, node: /^(?:-e|-p|--eval|--print)$/, perl: /^-[a-zA-Z]*e/, ruby: /^-[a-zA-Z]*e/, php: /^-r$/, pwsh: /^-(?:c|command|f|file)$/i };
const STAGE_PREFIX = /^(?:sudo|env|nohup|command|exec)$|^[A-Za-z_]\w*=|^-/;
const exeName = (w) => w.replace(/^["']|["']$/g, '').split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();
const stageWords = (stage) => {
  const w = stage.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < w.length && STAGE_PREFIX.test(w[i])) i++;
  return w.slice(i);
};
const readsStdin = (name, args) => {
  const family = /^python/.test(name) ? 'python' : name === 'powershell' ? 'pwsh' : name;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-' || (SHELLS.has(name) && /^-[a-zA-Z]*s/.test(a))) return true;
    if (SHELLS.has(name) && /^-[a-zA-Z]*c/.test(a)) return false;
    if (NOT_STDIN[family]?.test(a)) return family === 'pwsh' && args[i + 1] === '-';
    if (!a.startsWith('-')) return false; // 스크립트 파일
  }
  return true;
};
export const pipedRun = (view) =>
  view.split(/&&|\|\||[;\n]|(?<![|&])&(?!&)/).some((line) => {
    const stages = line.split('|').map(stageWords);
    const from = stages.findIndex((w) => w[0] && FETCHERS.has(exeName(w[0])));
    return from !== -1 && stages.slice(from + 1).some(([cmd, ...args]) => {
      const name = exeName(cmd || '');
      return EVALUATORS.has(name) || (RUNNERS.has(name) && readsStdin(name, args));
    });
  });

// 위험 명령은 실행되지 않는 글(커밋 메시지·echo 인자·실행기로 가지 않는 heredoc 본문)을 비운 명령에서 찾는다(dataMasked).
// `bash -c "…"`·`eval "…"` 처럼 실행되는 따옴표 속은 그대로 본다.
const DANGER = [
  // rm·Remove-Item·del·rd 등으로 루트·홈·지금 폴더를 통째로 지우기(정책은 lib/delete.mjs 맨 위)
  wipesEverything,
  pipedRun,
  // 프로세스 치환 `bash <(curl …)`, `sh -c "$(curl …)"`
  new RegExp(String.raw`\b(?:${RUNNER}|source)\s+<\(\s*(?:curl|wget)\b|\b${RUNNER}\s+-c\s+["']?\$\(\s*(?:curl|wget)\b`, 'i'),
  // PowerShell: iex (irm …), Invoke-Expression ((New-Object Net.WebClient).DownloadString(…)), [scriptblock]::Create((irm …))
  new RegExp(String.raw`\b(?:iex|Invoke-Expression)\b\s*(?:-Command\s*)?\(+\s*${PS_FETCH}|\[scriptblock\]::Create\(\s*\(*\s*${PS_FETCH}`, 'i'),
  // 모두에게 쓰기 권한: chmod 777 · 0777 · a+rwx · ugo+rwx (옵션 앞뒤 순서 상관없음)
  /\bchmod\s+(?:-{1,2}[\w-]+\s+)*(?:0?777|(?:a|ugo)\+rw[xX])(?=\s|$)/,
  // 디스크 통째 지우기: mkfs, dd of=/dev/디스크, Format-Volume, Clear-Disk, format C:
  /\bmkfs(?:\.\w+)?\s|\bdd\s+[^\n]*\bof=\/dev\/(?:sd|nvme|disk|hd|vd|xvd|mmcblk)/,
  /\b(?:Format-Volume|Clear-Disk)\b|(?:^|[\s;&|])format(?:\.com)?\s+[A-Za-z]:/i,
  // fork bomb
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
];

export const dangerCmd = {
  id: 'danger-cmd',
  on: 'shell',
  check({ cmd, shell, t }) {
    const view = dataMasked(cmd, shell);
    return DANGER.some((d) => (typeof d === 'function' ? d(view) : d.test(view))) ? t('danger.cmd') : null;
  },
};

// 커밋하지 않은 변경을 날리는 명령은 작업 트리가 깨끗할 때만 둔다.
// restore --staged 만 주면 stage 만 비우고 파일은 그대로라 뺀다(--worktree 를 같이 주면 지운다).
// checkout 은 `checkout HEAD -- .`·`checkout main .` 처럼 커밋을 앞에 줘도 지금 폴더 전체를 덮어쓴다. restore 는 `-s HEAD .` 도.
const DISCARD = new RegExp(GIT + String.raw`(?:reset\s+[^;&|\n]*--hard|clean\s+(?:-[a-zA-Z]*\s+)*(?:-[a-zA-Z]*f|--force)|checkout\s+(?:-f\s+|--force\s+)?(?:[^\s;&|-]\S*\s+)?(?:--\s+)?\.(?=\s|$)|restore\s+((?:(?:-s|--source)\s+\S+\s+|--?\S+\s+)*)\.(?=\s|$))`);
export const discardChanges = {
  id: 'danger-cmd',
  on: 'shell',
  check({ cmd, shell, root, t }) {
    if (!root) return null;
    const bare = stripQuoted(cmd, shell);
    const m = bare.match(DISCARD);
    if (!m) return null;
    if (m[1] !== undefined && /(?:^|\s)(?:--staged|-S)\s/.test(m[1]) && !/(?:^|\s)(?:--worktree|-W)\s/.test(m[1])) return null;
    const rest = bare.slice(m.index);
    const seg = rest.slice(0, rest.search(/[;&|\n]|$/));
    // clean 은 추적 안 된 파일을(-x·-X 면 무시 목록의 파일 — .env 같은 것 — 도), 나머지는 추적 중인 파일의 변경을 지운다.
    const clean = /\bclean\b/.test(m[0]);
    if (clean && /(?:^|\s)(?:-[a-zA-Z]*n[a-zA-Z]*|--dry-run)(?=\s|$)/.test(seg)) return null; // 보기만
    const ignored = clean && /(?:^|\s)-[a-zA-Z]*[xX]/.test(seg);
    // -X 는 무시 목록의 파일만 지운다(추적 안 된 보통 파일은 그대로)
    const onlyIgnored = clean && /(?:^|\s)-[a-zA-Z]*X/.test(seg);
    // 같은 명령 앞에서 git stash 로 보관했으면 지울 것이 없다(clean 은 -u·-a 로 추적 안 된 파일까지 보관했을 때만)
    const stashed = gitSegments(cmd, 'stash', shell).some((s) => {
      if (s.start >= m.index || !(s.words.length === 0 || /^(?:push|save|-)/.test(s.words[0]))) return false;
      const opts = s.words.join(' ');
      return !clean || (ignored ? /(?:^|\s)(?:-a|--all)(?=\s|$)/ : /(?:^|\s)(?:-u|--include-untracked|-a|--all)(?=\s|$)/).test(opts);
    });
    if (stashed) return null;
    const args = ['status', '--porcelain', `--untracked-files=${clean ? 'normal' : 'no'}`, ...(ignored ? ['--ignored'] : [])];
    const dirty = (git(root, args) || '').split('\n').filter((l) => l.trim() && (!onlyIgnored || l.startsWith('!!')));
    return dirty.length ? t('danger.discard', { count: dirty.length }) : null;
  },
};

// 명령줄에 그대로 적은 비밀번호. 값이 $변수·$(…)·`…`·(…)·[…]·파일 읽기 명령이면 둔다(값이 명령줄에 안 남는다).
const NOT_VAR = String.raw`(?!["']?[$\x60(\[])(?!(?:Get-Content|gc|Get-Secret|Read-Host|cat|type)\b)`;
const NOT_SWITCH = String.raw`(?!["']?(?:yes|no|true|false|on|off|[01])["']?(?:[\s;|&)]|$))`;
const PASSWORD_ON_CLI = [
  // --password=값 · --password 값 (--password-stdin·--password-file 은 둔다)
  new RegExp(String.raw`--password(?:=|\s+)(?!-)${NOT_VAR}\S+`, 'i'),
  // mysql 계열의 -p값(붙여 씀). -P 는 포트라 대소문자를 가린다.
  new RegExp(String.raw`\b(?:mysql|mysqldump|mysqladmin|mariadb)\b[^|;&\n]*\s-p(?!\s|$)${NOT_VAR}\S+`),
  // mongo·mongosh 의 -p 값(띄어 씀도 비밀번호)
  new RegExp(String.raw`\bmongo(?:sh|dump|restore|import|export)?\b[^|;&\n]*\s-p(?:\s+(?!-)|(?!\s|$))${NOT_VAR}\S+`),
  new RegExp(String.raw`\bsshpass\s+-p\s*${NOT_VAR}\S+`, 'i'),
  // docker·podman login -p 값
  new RegExp(String.raw`\b(?:docker|podman)\s+login\b[^|;&\n]*\s-p(?:\s+(?!-)|(?!\s|$))${NOT_VAR}\S+`),
  // curl -u 아이디:비번 · --user 아이디:비번
  new RegExp(String.raw`\bcurl\b[^|;&\n]*\s(?:-u|--user)(?:\s+|=|(?=[^\s-]))["']?[^\s:"'$]+:${NOT_VAR}[^\s"']+`),
  // 비밀번호 환경 변수에 값 넣기: PGPASSWORD=값, MYSQL_PWD=값, POSTGRES_PASSWORD=값(-e 포함), $env:PGPASSWORD = "값"
  // (PowerShell 환경 변수 이름은 대소문자를 가리지 않는다: $env:db_password)
  // 켜고 끄는 값(MYSQL_ALLOW_EMPTY_PASSWORD=yes · MYSQL_RANDOM_ROOT_PASSWORD=1)은 비밀번호가 아니다.
  new RegExp(String.raw`(?:\b|\$env:)(?:PGPASSWORD|MYSQL_PWD|(?:[A-Z][A-Z0-9_]*_)?(?:PASSWORD|PASSWD))\s*=\s*${NOT_VAR}${NOT_SWITCH}["']?[^\s"'$]`),
  new RegExp(String.raw`\$env:(?:\w*_)?(?:password|passwd|pgpassword|mysql_pwd)\s*=\s*${NOT_VAR}${NOT_SWITCH}["']?[^\s"'$]`, 'i'),
  // 주소 속 비밀번호: postgres://아이디:비번@, redis://:비번@, https://user:token@
  new RegExp(String.raw`\b[a-z][a-z0-9+.-]*://[^\s:/@"'$]*:${NOT_VAR}[^\s@/"'$]+@`, 'i'),
];
export const passwordCli = {
  id: 'password-cli',
  on: 'shell',
  check({ cmd, shell, t }) {
    const view = dataMasked(cmd, shell);
    return PASSWORD_ON_CLI.some((re) => re.test(view)) ? t('password.cli') : null;
  },
};

export default [dangerCmd, discardChanges, passwordCli];
