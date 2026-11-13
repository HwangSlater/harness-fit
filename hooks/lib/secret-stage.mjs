// 비밀값이 흐르는 명령 조각(파이프 한 칸) 하나를 가린다 — lib/secret-sink.mjs 가 부른다(역할극 15 회차 세 번째 검토, 2026-11-12).
// 「헛물음이 놓침보다 나쁘다」: 받은 것을 그대로(또는 풀어서) 화면에 내보낸다고 알려진 도구만 「흘려보냄」(passes)으로 친다.
// 모르는 도구(kubeseal·docker login --password-stdin·gpg -e·wc·clip …)는 받아 삼킨다고 본다 — 놓침은 docs/decisions-hooks.md 에 적는다.
import { POWERSHELL, splitWords } from './cmdline.mjs';

export const exe = (w) => w.replace(/^["']|["']$/g, '').split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();

// 넘겨쓰기 낱말(> x · 2>&1 · &> · <<< · < x). 낱말 그 자체면 다음 낱말(받는 곳)도 뺀다
const REDIR = /^(?:\d+|\*|&)?(?:>>?|>\||<<<|<<?)(?:&(?:\d+|-)?)?/;
const DUP_ONLY = /&(?:\d+|-)$/;
// 명령 앞에 붙는 말(sudo -u x · env · busybox · { · PowerShell & 호출 · then·do)
const PREFIX = new Set(['sudo', 'doas', 'env', 'command', 'exec', 'nohup', 'time', 'nice', 'stdbuf', 'busybox', '{', '!', '&', 'then', 'do', 'else']);

// raw: 조각 글(원래 명령), bare: 같은 자리의 따옴표 속을 비운 글
export const parseStage = (raw, bare, shell) => {
  const words = splitWords(raw, shell);
  const args = [];
  for (let i = 0; i < words.length; i++) {
    const m = REDIR.exec(words[i]);
    if (m && m[0]) { if (m[0] === words[i] && !DUP_ONLY.test(words[i])) i++; continue; }
    args.push(words[i]);
  }
  let i = 0;
  while (i < args.length) {
    if (/^[A-Za-z_]\w*=/.test(args[i])) { i++; continue; }
    if (!PREFIX.has(exe(args[i]))) break;
    i++;
    while (i < args.length && args[i].startsWith('-')) i += /^-[ugCn]$/.test(args[i]) ? 2 : 1;
  }
  return { raw, bare, words, args, lead: args.slice(0, i), name: i < args.length ? exe(args[i]) : '', rest: args.slice(i + 1), shell };
};

// 받는 곳 가리기: 화면(/dev/stdout · /dev/tty · CON …), 버림(/dev/null · $null · NUL), 그 밖은 파일
const SCREEN = /^(?:\/dev\/(?:stdout|stderr|tty|console|fd\/[0-2]|pts\/\d+)|\/proc\/self\/fd\/[0-2]|con:?|conout\$|\\\\\.\\con|-|)$/i;
const NULL_SINK = /^(?:\/dev\/null|nul:?|\$null)$/i;
const sinkKind = (target) => (SCREEN.test(target) ? 'screen' : NULL_SINK.test(target) ? 'null' : 'file');
const targetAt = (raw, at) => {
  const t = /^\s*("[^"]*"|'[^']*'|[^\s;&|<>()]+)?/.exec(raw.slice(at));
  return (t[1] || '').replace(/^["']|["']$/g, '');
};

// 조각의 표준 출력이 가는 곳: default(넘겨쓰기 없음) · screen · null · file. 뒤 것이 이긴다.
// 2> · 2>&1 · 3> 은 오류 흐름이라 표준 출력을 바꾸지 않는다. &> · >&파일 · *> 는 둘 다 파일로. >&2 는 화면(오류 흐름)
const OUT_OP = /(\d+|\*|&)?(>>?|>\|)(&(?:\d+|-)?)?/g;
export const stdoutOf = (st) => {
  let to = { kind: 'default' };
  for (const m of st.bare.matchAll(OUT_OP)) {
    const fd = m[1] || '1';
    if (fd !== '1' && fd !== '*' && fd !== '&') continue;
    const dup = m[3];
    if (dup && dup !== '&') {
      if (dup === '&-') to = { kind: 'null' };
      else if (dup !== '&1') to = { kind: 'screen' };
      continue;
    }
    const target = targetAt(st.raw, m.index + m[0].length);
    to = { kind: sinkKind(target), target };
  }
  return to;
};
// < 파일 로 읽는 곳(<< · <<< · <& · <( 는 아님)
const inputsOf = (st) => {
  const out = [];
  for (const m of st.bare.matchAll(/(?<![<\d])\d?<(?![<&(])/g)) out.push(targetAt(st.raw, m.index + m[0].length));
  return out;
};

const has = (st, re) => st.rest.some((a) => re.test(a));
// kubectl -o 값(- 뒤 붙여 쓴 꼴도)
const outputOf = (w) => {
  for (let i = 0; i < w.length; i++) {
    if (w[i] === '-o' || w[i] === '--output') return w[i + 1] || '';
    if (w[i].startsWith('--output=')) return w[i].slice(9);
    if (/^-o[^-]/.test(w[i])) return w[i].slice(2).replace(/^=/, '');
  }
  return '';
};
const VALUE_OUT = /^(?:ya?ml|json|jsonpath|jsonpath-as-json|go-template|template|custom-columns)(?:[=,]|$)/;
// kubectl apply|create|replace … -o yaml 은 보낸 것(값 포함)을 다시 찍는다. -o name·없음은 「secret/x created」 만
const kubePrints = (st) => /^(?:apply|create|replace|patch|set|annotate|label)$/.test(st.rest[0] || '') && VALUE_OUT.test(outputOf(st.rest).replace(/^["']|["']$/g, ''));

// jq·yq 필터가 이름표 칸(.metadata.name 등)·키 이름·개수만 꺼내는지 — 쉽게 알 수 있는 꼴만. 나머지는 값을 찍는다고 본다
const META_PATH = /^\.(?:(?:items)?\[\d*\]\.|items\.)?(?:metadata\.(?:name|namespace|labels(?:\.[\w.-]+|\["[^"]*"\])?|creationTimestamp|uid|resourceVersion)|type|kind|apiVersion)$/;
const ITER = /^\.(?:items(?:\[\d*\])?|\[\d*\])$/;
const DATA = /^\.(?:(?:items)?\[\d*\]\.|items\.)?(?:data|stringData)$/;
const COUNT = /^(?:keys(?:_unsorted)?(?:\[\])?|length)$/;
export const jqSafe = (filter) => {
  if (!filter) return false;
  const parts = filter.split('|').map((s) => s.trim());
  return parts.every((p, i) => {
    const last = i === parts.length - 1;
    return p.split(',').map((s) => s.trim()).every((x) => META_PATH.test(x) || COUNT.test(x) || (!last && (ITER.test(x) || DATA.test(x))));
  });
};
const filterOf = (st) => {
  const r = st.rest;
  let i = st.name === 'yq' && /^(?:e|eval|ea|eval-all)$/.test(r[0] || '') ? 1 : 0;
  for (; i < r.length; i++) {
    const a = r[i];
    if (/^--(?:arg|argjson|slurpfile|rawfile)$/.test(a)) i += 2;
    else if (/^(?:--indent|-L|-o|-p|-I|--output-format|--input-format)$/.test(a)) i++;
    else if (/^(?:-f|--from-file)$/.test(a)) return null;
    else if (!a.startsWith('-')) return a;
  }
  return null;
};

// 받은 것을 그대로·풀어서·골라서 찍는 도구(이름만으로)
const PASS = new Set(['cat', 'bat', 'batcat', 'less', 'more', 'most', 'head', 'tail', 'tac', 'base64', 'base32', 'basenc', 'xxd', 'od', 'hexdump', 'strings',
  'sed', 'awk', 'gawk', 'mawk', 'nawk', 'column', 'sort', 'uniq', 'cut', 'tr', 'rev', 'fold', 'nl', 'iconv', 'fmt', 'paste', 'expand', 'zcat', 'gunzip', 'bzcat', 'xzcat',
  'tee', 'kubectl-neat', 'sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'pwsh', 'powershell']);
// PowerShell: 받은 것을 다음으로 넘기거나 화면에 낸다
const PS_PASS = new Set(['convertfrom-json', 'convertto-json', 'convertfrom-yaml', 'convertto-yaml', 'convertfrom-csv', 'convertto-csv', 'convertfrom-stringdata',
  'select-string', 'sls', 'format-list', 'fl', 'format-table', 'ft', 'format-wide', 'fw', 'format-custom', 'format-hex', 'fhx', 'out-string', 'out-host', 'oh',
  'write-host', 'write-output', 'write', 'echo', 'select-object', 'select', 'where-object', 'where', '?', 'foreach-object', 'foreach', '%', 'sort-object', 'sort',
  'get-unique', 'gu', 'group-object', 'group', 'tee-object', 'tee', 'cat', 'gc', 'type', 'get-content']);
const GREP = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag']);
const GREP_QUIET = /^(?:-[a-zA-Z]*[qclL][a-zA-Z]*|--quiet|--silent|--count|--files-with(?:out)?-match(?:es)?)$/;
const RUNNER = /^(?:python[\d.]*|py|node|nodejs|perl|ruby|php|deno|bun)$/;
const CODE_FLAG = /^(?:-[cmpEr]|--eval|--print|-[a-zA-Z]*e)$/;
const XARGS_VALUE = /^-[InLPdEsa]$/;

export const passes = (st) => {
  const { name, rest } = st;
  if (st.shell === POWERSHELL) {
    if (/^(?:set-content|add-content|set-clipboard|scb)$/.test(name)) return has(st, /^-PassThru$/i);
    if (PS_PASS.has(name)) return true;
  }
  if (GREP.has(name)) return !has(st, GREP_QUIET);
  if (name === 'jq' || name === 'yq' || name === 'gojq') return !jqSafe(filterOf(st));
  if (PASS.has(name)) return true;
  if (/^(?:gzip|bzip2|xz)$/.test(name)) return has(st, /^(?:-[a-zA-Z]*[dc][a-zA-Z]*|--decompress|--stdout)$/);
  if (name === 'openssl') return /^(?:base64|enc|rsa|pkey|ec|dsa|pkcs8|pkcs12)$/.test(rest[0] || '') && !has(st, /^-(?:noout|out)$/);
  if (name === 'gpg' || name === 'gpg2' || name === 'age') return has(st, /^(?:-d|--decrypt)$/) && !has(st, /^(?:-o|--output)$/);
  if (name === 'kubectl') return rest[0] === 'neat' || kubePrints(st);
  if (RUNNER.test(name)) return has(st, CODE_FLAG) || !rest.some((a) => !a.startsWith('-'));
  if (name === 'xargs') {
    let i = 0;
    while (i < rest.length && rest[i].startsWith('-')) i += XARGS_VALUE.test(rest[i]) ? 2 : 1;
    return i >= rest.length || /^(?:echo|printf)$/.test(exe(rest[i]));
  }
  return false;
};

// 인자를 그대로 찍는 명령(치환 결과·변수를 인자로 받을 때): 'host' 는 넘겨쓰기와 상관없이 화면(Write-Host)
export const echoes = (st) => {
  const { name } = st;
  if (/^(?:write-host|out-host|oh)$/.test(name) && st.shell === POWERSHELL) return 'host';
  if (name === 'echo' || name === 'print') return true;
  if (name === 'printf') return !st.rest.includes('-v');
  if (st.shell === POWERSHELL && /^(?:write-output|write|write-information)$/.test(name)) return true;
  if (name === 'cat' && st.words.some((w) => w.startsWith('<<<'))) return true;
  return name === 'kubectl' && kubePrints(st);
};
export const hostWriter = (st) => st.shell === POWERSHELL && /^(?:write-host|out-host|oh)$/.test(st.name);

// 이 조각이 쓰는 파일(tee · Tee-Object · Out-File · Set-Content · Add-Content). 화면인 곳은 teeScreen 이 본다
const PS_FILE_OPT = /^-(?:FilePath|Path|LiteralPath)$/i;
const PS_VALUE_OPT = /^-(?:Encoding|Width|Value|Stream|Delimiter|Variable|InputObject)$/i;
export const writtenFiles = (st) => {
  const { name, rest } = st;
  if (name === 'tee' && st.shell !== POWERSHELL) return rest.filter((a) => !a.startsWith('-') && sinkKind(a) === 'file');
  if (!/^(?:tee|tee-object|out-file|set-content|add-content|sc|ac)$/.test(name)) return [];
  for (let i = 0; i < rest.length; i++) {
    if (PS_FILE_OPT.test(rest[i])) return rest[i + 1] ? [rest[i + 1]] : [];
    if (PS_VALUE_OPT.test(rest[i])) i++;
    else if (!rest[i].startsWith('-')) return [rest[i]];
  }
  return [];
};
export const teeScreen = (st) => st.name === 'tee' && st.shell !== POWERSHELL && st.rest.some((a) => a === '-' || (!a.startsWith('-') && sinkKind(a) === 'screen'));

// 파일을 읽어 찍는 도구. 편집기(vim·code)·sed -i·rm 은 대화에 찍지 않는다
const READERS = new Set(['cat', 'bat', 'batcat', 'less', 'more', 'most', 'head', 'tail', 'tac', 'grep', 'egrep', 'fgrep', 'rg', 'jq', 'yq', 'base64', 'xxd', 'od',
  'hexdump', 'strings', 'sed', 'awk', 'gawk', 'nl', 'sort', 'uniq', 'cut', 'diff', 'type', 'gc', 'get-content', 'select-string', 'sls', 'format-hex']);
const norm = (f, ps) => {
  const n = f.replace(/^["']|["']$/g, '').replace(/\\/g, '/').replace(/^\.\//, '');
  return ps ? n.toLowerCase() : n;
};
export const readsFile = (st, files) => {
  const ps = st.shell === POWERSHELL;
  const want = new Set(files.map((f) => norm(f, ps)));
  const hit = (a) => want.has(norm(a, ps));
  if (inputsOf(st).some(hit) && passes(st)) return true;
  if (!READERS.has(st.name)) return false;
  if (st.name === 'sed' && has(st, /^(?:-[a-zA-Z]*i|--in-place)/)) return false;
  if (GREP.has(st.name) && has(st, GREP_QUIET)) return false;
  return st.rest.some(hit);
};
// 프로세스 치환 <( … ) 을 파일로 받아 찍는지
export const readsArgFile = (st) => READERS.has(st.name) || passes(st);

// 클립보드: 넣는 도구 뒤에 꺼내는 도구(pbpaste · Get-Clipboard)가 오면 찍힌다
export const clipWriter = (st) => /^(?:pbcopy|wl-copy|clip|set-clipboard|scb)$/.test(st.name) || (st.name === 'xclip' && !has(st, /^-o(?:ut)?$/)) || (st.name === 'xsel' && !has(st, /^(?:-o|--output)$/));
export const clipReader = (st) => /^(?:pbpaste|wl-paste|get-clipboard|gcb)$/.test(st.name) || (st.name === 'xclip' && has(st, /^-o(?:ut)?$/)) || (st.name === 'xsel' && has(st, /^(?:-o|--output)$/)) || /\bGet-Clipboard\b/i.test(st.raw);

// 변수 v({ name, exported, env })를 받아 찍는 조각인지 — echo $X · printf "$X" · printenv · set · declare -p · PowerShell $x · "$x" · Write-Output $x · dir variable:
export const refRe = (v, ps) => (ps
  ? new RegExp(String.raw`\$\{?${v.env ? 'env:' : '(?:(?:global|script|local|private):)?'}${v.name}(?!\w)`, 'i')
  : new RegExp(String.raw`\$(?:\{[!]?)?${v.name}(?!\w)`));
export const refEmits = (st, v) => {
  const ps = st.shell === POWERSHELL;
  const ref = refRe(v, ps);
  const { name, rest, lead, args } = st;
  const after = st.raw.slice(Math.max(0, st.raw.search(/\S/)));
  if (echoes(st)) return ref.test(after.slice(after.search(/\s|$/)));
  if (ps) {
    const w0 = args[0] || '';
    const start = after[0];
    // 문장 맨 앞의 변수·문자열은 그대로 찍힌다($x · $x.data · "값: $x"). 다시 넣기($x = …)는 아니다
    if ((start === '$' || start === '"' || start === '(' || after.startsWith('@"')) && ref.test(w0) && !/^=(?!=)/.test(args[1] || '') && !/[^=!<>]=$/.test(w0)) return true;
    if (/^(?:get-variable|gv)$/.test(name)) return !v.env && (!rest.some((a) => !a.startsWith('-')) || rest.some((a) => a.toLowerCase() === v.name.toLowerCase()));
    const drive = v.env ? /^env:\\?/i : /^variable:\\?/i;
    if (/^(?:dir|ls|gci|get-childitem|gi|get-item|gc|get-content)$/.test(name)) return rest.some((a) => drive.test(a) && (a.replace(drive, '') === '' || a.replace(drive, '').toLowerCase() === v.name.toLowerCase()));
    return v.env && /\[(?:System\.)?Environment\]::GetEnvironmentVariables?\s*\(/i.test(after) && (/GetEnvironmentVariables/i.test(after) || after.toLowerCase().includes(v.name.toLowerCase()));
  }
  if (name === 'cat' && st.words.includes('<<<')) return ref.test(after);
  if (name === 'printenv') return !rest.length ? v.exported : rest.includes(v.name);
  if (!name && lead.length && exe(lead[0]) === 'env') return v.exported;
  if (name === 'set') return !rest.length;
  if (name === 'declare' || name === 'typeset') {
    const names = rest.filter((a) => !a.startsWith('-'));
    if (rest.includes('-x') && !names.length) return v.exported;
    return (rest.includes('-p') || !rest.length) && (!names.length || names.includes(v.name));
  }
  if (name === 'export') return v.exported && (!rest.length || (rest.length === 1 && rest[0] === '-p'));
  return false;
};
// X=$(…) env · X=$(…) printenv 처럼 받자마자 환경을 찍는 명령
export const envDump = (st) => st.name === 'printenv' || (!st.name && st.lead.some((w) => exe(w) === 'env'));
