// ask-cmd 의 「사용자가 적은 명령」 맞추기(hooks/rules/shell.mjs askCmd). shell.mjs 가 400줄에 가까워 나눴다(2026-11-11).
// 적은 명령은 앞 낱말(처음으로 - 로 시작하는 낱말 앞까지)과 옵션으로 나눈다: 「dbt build --target prod」 → 앞 낱말 dbt build, 옵션 --target prod.
// 실행한 명령은 앞 낱말이 차례대로 나오고(사이에는 - 옵션과 그 값만), 적은 옵션이 모두 첫 낱말 뒤 어디에든 있으면 맞는다 —
// 「--target prod」 처럼 이어서, 또는 「--target=prod」. 짧은 옵션 별칭(-t prod)은 짐작하지 않는다 — 쓰는 꼴마다 따로 적는다
// (역할극 10 회차: dbt build --select x --target prod·dbt --target prod run·dbt run -t prod 가 지나갔다).
import fs from 'node:fs';
import path from 'node:path';
import { runWords, scriptName } from './run-prefix.mjs';
import { runActionForm } from './fastlane-actions.mjs';

const tidy = (x) => String(x).replace(/\\/g, '/').replace(/^\.\//, '');
const isOpt = (x) => String(x).startsWith('-') && x !== '-';

// 적은 명령 낱말 → { lead, opts: [{ name, value }], extra: [옵션 뒤에 남은 위치 인자] }
export const patternOf = (words) => {
  const at = words.findIndex(isOpt);
  const lead = at < 0 ? words : words.slice(0, at);
  const opts = [];
  const extra = [];
  for (let i = lead.length; i < words.length; i++) {
    const w = words[i];
    if (!isOpt(w)) extra.push(w);
    else if (w.includes('=')) opts.push({ name: w.slice(0, w.indexOf('=')), value: w.slice(w.indexOf('=') + 1) });
    else if (words[i + 1] !== undefined && !isOpt(words[i + 1])) opts.push({ name: w, value: words[++i] });
    else opts.push({ name: w, value: null });
  }
  return { lead, opts, extra };
};

// 앞 낱말을 차례대로 찾는다. 첫 낱말은 맨 앞이어야 하고, 그 뒤 앞 낱말 사이에는 - 옵션과 그 값만 올 수 있다
// (dbt --target prod run 의 --target prod). 찾으면 앞 낱말 다음 자리, 못 찾으면 -1.
// make 의 변수 대입(make DEPLOY=1 deploy-prod)도 옵션처럼 건너뛴다 — 적은 「make deploy-prod」 가 맞지 않아 묻지 않던 일(역할극 14 회차, 2026-11-13)
const MAKE = /^g?make$/;
const MAKE_VAR = /^[A-Za-z_][\w.]*=/;
// open: 낱말이 모자라도 맞는 것으로 본다(xargs 가 뒤에 표준 입력 낱말을 붙인다) — 그때는 OPEN 을 돌려준다
const OPEN = Infinity;
const leadEnd = (line, lead, open = false) => {
  if (!lead.length || line[0] !== lead[0]) return -1;
  const make = MAKE.test(line[0]);
  let p = 1;
  for (let j = 1; j < lead.length; j++) {
    for (;;) {
      if (p >= line.length) return open ? OPEN : -1;
      if (tidy(line[p]) === tidy(lead[j])) break;
      if (make && MAKE_VAR.test(line[p])) { p++; continue; }
      if (!isOpt(line[p])) return -1;
      // 옵션 다음 낱말이 찾는 앞 낱말이 아니고 옵션도 아니면 그 옵션의 값으로 건너뛴다
      p += line[p + 1] !== undefined && !isOpt(line[p + 1]) && tidy(line[p + 1]) !== tidy(lead[j]) && !line[p].includes('=') ? 2 : 1;
    }
    p++;
  }
  return p;
};

const hasOpt = (rest, { name, value }) => rest.some((x, k) => {
  if (value === null) return x === name || x.startsWith(`${name}=`);
  return (x === name && tidy(rest[k + 1] ?? '') === tidy(value)) || x === `${name}=${value}`;
});

// fastlane 의 플랫폼 낱말: Fastfile 이 레인을 `platform :ios do` 안에 두면 「fastlane ios beta」 로 부른다.
// 적은 「fastlane beta」 는 플랫폼 낱말을 건너뛰고도 맞춘다 — 적은 명령에 플랫폼 낱말이 있으면 그대로 견준다(독립 검토 2026-11-13)
const FASTLANE_PLATFORM = /^(?:ios|android|mac)$/;
const withoutPlatform = (line, pat) => (line[0] === 'fastlane' && FASTLANE_PLATFORM.test(line[1] || '') && pat.lead[1] !== line[1]
  ? [line[0], ...line.slice(2)] : line);

// 읽기만 하는 kubectl·helm 하위 명령: 적은 꼴이 그 하위 명령을 이름으로 대지 않았으면 맞지 않는 것으로 본다 —
// 「kubectl --context prod-payments」 를 적으면 get pods·logs 까지 물었다(역할극 14 회차, 2026-11-13). 「kubectl get secret」 처럼 적으면 그대로 견준다.
// 비밀값을 찍는 읽기(kubectl get secret -o yaml)는 remote 쪽(lib/secret-read.mjs)이 따로 본다
const READ_VERBS = {
  kubectl: { value: /^(?:-n|--namespace|--context|--cluster|--kubeconfig|--user|-s|--server|--as|--as-group|--token|-l|--selector|-o|--output)$/,
    verbs: /^(?:get|describe|logs|diff|top|explain|version|api-resources|api-versions|cluster-info|events|wait)$/ },
  helm: { value: /^(?:-n|--namespace|--kube-context|--kubeconfig|-o|--output)$/,
    verbs: /^(?:list|ls|status|get|history|hist|show|inspect|template|lint|search|version|diff|env)$/ },
  // vercel alias ls — 적은 「vercel alias」(set 없는 vercel alias <배포> <도메인> 꼴까지 묻는다)가 목록 보기까지 묻지 않게
  vercel: { value: /^(?:--scope|-S|--token|-t|--cwd|-A|--local-config|-Q|--global-config)$/, group: 'alias', verbs: /^(?:ls|list)$/ },
};
// 반환: { verb, pos: 하위 명령 뒤 위치 인자 } 또는 null
const readVerb = (line) => {
  const r = READ_VERBS[line[0]];
  if (!r) return null;
  const pos = [];
  for (let i = 1; i < line.length && pos.length < 64; i++) {
    if (!isOpt(line[i])) pos.push(line[i]);
    else if (r.value.test(line[i])) i++;
  }
  const at = r.group ? (pos[0] === r.group ? 1 : -1) : 0;
  const verb = at >= 0 ? pos[at] : null;
  return verb && r.verbs.test(verb) ? { verb, pos: pos.slice(at + 1) } : null;
};
// 읽기여도 비밀값을 꺼내는 꼴은 읽기로 치지 않는다(검토 2026-11-13 — 「kubectl --context prod」 를 적었는데 get secret -o yaml·helm get values 가 지나갔다):
// kubectl get·describe 의 secret(s) 자원(secret/x·pods,secrets 도), --raw 경로의 /secrets, helm get values·all·manifest
const SECRET_RES = /^secrets?(?:\.v1)?(?:\/|$)/i;
const secretLook = (line, look) => {
  if (line[0] === 'kubectl') {
    const raw = line.findIndex((x) => x === '--raw' || x.startsWith('--raw='));
    const rawPath = raw < 0 ? '' : line[raw].startsWith('--raw=') ? line[raw].slice(6) : line[raw + 1] || '';
    if (/\/secrets(?:[/?]|$)/i.test(rawPath)) return true;
    return /^(?:get|describe)$/.test(look.verb) && look.pos.some((p) => p.split(',').some((x) => SECRET_RES.test(x)));
  }
  return line[0] === 'helm' && look.verb === 'get' && /^(?:values|all|manifest)$/.test(look.pos[0] || '');
};
// 적은 꼴이 도구 이름 하나(「kubectl」)면 모두를 뜻한다 — 읽기도 묻는다
const bareTool = (pat) => pat.lead.length === 1 && !pat.opts.length && !pat.extra.length;
const readExempt = (line, pat) => {
  const look = readVerb(line);
  return !!look && !pat.lead.slice(1).includes(look.verb) && !bareTool(pat) && !secretLook(line, look);
};

// open: xargs 처럼 뒤에 표준 입력 낱말이 더 붙는 꼴. 앞 낱말이 모자란 채 끝나면(echo apply | xargs terraform) 적은 명령이
// 프로그램 낱말뿐일 때만 맞는다 — 옵션·대상까지 적은 「rm -rf build」 가 git ls-files -d | xargs rm·xargs rm -f 까지 막던 일(다시 검토 2026-11-13).
// 앞 낱말이 다 있으면 보통과 같이 적은 옵션과 그 값·대상이 모두 있어야 한다(표준 입력으로 올 대상은 짐작하지 않는다 — decisions-hooks.md)
export const matches = (full, pat, open = false) => {
  const line = withoutPlatform(full, pat);
  const end = leadEnd(line, pat.lead, open);
  if (end < 0) return false;
  if (readExempt(line, pat)) return false;
  if (end === OPEN) return !pat.opts.length && !pat.extra.length;
  // 옵션은 첫 낱말 뒤 어디든(dbt --target prod run 처럼 하위 명령 앞의 전역 옵션도), 남은 위치 인자는 앞 낱말 뒤에서 찾는다
  const rest = line.slice(end);
  return pat.opts.every((o) => hasOpt(line.slice(1), o)) && pat.extra.every((x) => rest.some((r) => tidy(r) === tidy(x)));
};

// 원래 낱말에서 바로 앞이 -m 인 모듈 이름인지(python -m tools.cmd). runWords 는 앞 낱말을 소문자로 바꾼다
const moduleForm = (name, raw) => (raw || []).some((x, k) => k > 0 && raw[k - 1] === '-m' && String(x).toLowerCase() === name);

// 같은 명령의 다른 꼴: 패키지 스크립트는 「npm run X」 「pnpm X」 「yarn X」 를 모두 「X」 로(검토 2026-11-11)
// python -m scripts.train 은 scripts/train.py 와 같은 것으로(모듈 이름의 끝 + .py)
// pyproject 의 설치 명령(churn-train = "churn.train:main")은 python -m churn.train 과 같은 것으로(역할극 7 회차)
// raw: 앞붙이를 벗기기 전 원래 낱말(-m 을 보려고, 파일 경로를 찾으려고)
export const variants = (w, entries = {}, raw = w) => {
  const s = scriptName(w);
  const out = s ? [w, [s, ...w.slice(w[1] === 'run' || w[1] === 'run-script' ? 3 : 2)]] : [w];
  // 모듈 꼴은 원래 낱말에 -m 이 바로 앞에 있을 때만. 확장자 목록으로 거르니 release.sh 가 「sh.py」 가 되거나(fd193d0 전),
  // 끝 마디가 cmd·go·r·md 인 모듈(python -m tools.cmd)을 놓치고 ./a.out·x.ksh·x.mts 는 모듈로 읽었다(검토 2026-11-13)
  if (/^[\w]+(?:\.[\w]+)+$/.test(w[0] || '') && moduleForm(w[0], raw)) out.push([`${w[0].split('.').pop()}.py`, ...w.slice(1)]);
  if (Object.hasOwn(entries, w[0] || '')) out.push([entries[w[0]], ...w.slice(1)]);
  // 파일로 부른 꼴(python src/churn/train.py) → 모듈 이름(churn.train) — 설치 명령 churn-train 과 맞추려고(역할극 7 회차 다시). 앞의 src/ 는 뗀다
  // runWords 는 스크립트를 파일 이름(train.py)으로 줄이므로 원래 낱말(raw)에서 경로를 찾는다
  const src = (raw || []).find((x) => /\.py$/i.test(String(x)) && String(x).replace(/\\/g, '/').split('/').pop() === w[0]);
  const file = src && /^(?:\.\/)?(?:src\/)?([\w]+(?:\/[\w]+)+)\.py$/.exec(String(src).replace(/\\/g, '/'));
  if (file) out.push([file[1].replace(/\//g, '.'), ...w.slice(1)]);
  // fastlane run upload_to_testflight → fastlane pilot upload(적은 도구 명령과 맞추려고 — 역할극 16 회차 다시 매기기, 2026-11-13)
  const action = runActionForm(w);
  if (action) out.push(action);
  // xcrun 을 벗기기 전 꼴(xcrun notarytool submit …)도 — 사용자가 「xcrun」 만 적은 묻는 명령이 도구를 벗긴 꼴과 맞지 않아
  // 묻지 않고 지나가던 회귀(독립 검토 2026-11-13). 적은 쪽도 같은 함수를 거치므로 「xcrun --sdk iphoneos」 도 맞는다
  const kept = runWords(raw || [], { keepXcrun: true });
  if (kept[0] === 'xcrun' && w[0] !== 'xcrun') out.push(kept);
  return out;
};

// [project.scripts]·[tool.poetry.scripts] 의 이름 → 모듈(값 "모듈:함수" 의 앞)
export const entryModules = (root) => {
  let text = '';
  try {
    text = fs.readFileSync(path.join(root || '.', 'pyproject.toml'), 'utf8').slice(0, 256 * 1024);
  } catch {
    return {};
  }
  const out = {};
  let inTable = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[')) { inTable = /^\[\s*(?:project\.(?:gui-)?scripts|tool\.poetry\.scripts)\s*\]$/.test(line); continue; }
    const m = inTable && /^"?([\w.-]+)"?\s*=\s*["']([\w.]+)(?::[\w.]+)?["']/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
};

// 도움말·버전 보기는 묻지 않는다(학습 스크립트 --help 에 확인 창이 뜨던 일 — 역할극 3 회차 2차)
// -h 는 맨 끝 낱말일 때만 도움말로 본다(psql·mysql·redis-cli 의 -h 는 호스트 — 검토 2026-11-11)
// terraform·tofu 는 -help 를 쓴다(원격 묻기도 이것을 쓴다 — lib/remote-cmd.mjs, 검토 2026-11-13)
export const justLooking = (w) => w.slice(1).some((x, i) => x === '--help' || x === '-help' || x === '--version' || (x === '-h' && i === w.length - 2));

// 시험 실행: 같은 조각의 인자 --dry-run·--dry-run=켜는 값·--plan, make 의 -n·--just-print·--dry-run·--recon,
// 또는 명령 앞 환경 변수 DRY_RUN=1·true·yes·on.
// --dry-run= 뒤는 켜는 값만(true·1·yes·on, kubectl·helm 의 client·server, all) — false·0·no·off·none 은 실제 실행이다(검토 2026-11-11).
// 앞 조각의 export·$env: 는 보지 않는다 — 그 조각에서 값을 다시 바꿀 수 있고, 스크립트가 그 변수를 읽는지도 모른다.
// 적은 스크립트가 --dry-run·--plan 을 무시하면 그대로 실행된다 — 막을 수 없다(decisions-hooks.md).
const DRY_ENV = /^DRY_?RUN=["']?(?:1|true|yes|on)["']?$/i;
const DRY_VALUE = /^--dry-run=["']?(?:true|1|yes|on|client|server|all)["']?$/i;
// make 의 값 없는 짧은 옵션 묶음 속 n(-n·-kn). -C·-f·-j 처럼 값을 받는 글자가 앞에 있으면 n 은 그 값이다.
const MAKE_DRY = /^(?:-[BbdeikLqrRsStvw]*n[A-Za-z]*|--just-print|--dry-run|--recon)$/;
// fastlane match 를 읽기 전용으로(--readonly·readonly:true·명령 앞 MATCH_READONLY=true) 돌리면 인증서를 받기만 한다 —
// Matchfile 이 있어 「fastlane match」 를 묻는 명령에 넣어도 이 꼴은 묻지 않는다(역할극 16 회차 정답지 M3). nuke 는 readonly 여도 지운다
const MATCH_RO_ENV = /^MATCH_READONLY=["']?(?:1|true|yes|on)["']?$/i;
const matchReadonly = (line, lead) => {
  const w = FASTLANE_PLATFORM.test(line[1] || '') ? [line[0], ...line.slice(2)] : line;
  const [action, args] = w[1] === 'run' ? [w[2], w.slice(3)] : [w[1], w.slice(2)];
  if (w[0] !== 'fastlane' || !/^(?:match|sync_code_signing)$/.test(action || '') || args.includes('nuke')) return false;
  // --readonly 뒤 낱말이 false·0·no·off 면 읽기 전용이 아니다(--dry-run=false 와 같은 원칙 — 역할극 16 회차: --readonly false 가 지나갔다, 2026-11-13)
  const flag = args.some((x, k) => (x === '--readonly' && !OFF.test(args[k + 1] || '')) || /^--readonly=["']?(?:true|1|yes|on)["']?$/i.test(x));
  return flag || args.some((x) => /^readonly:["']?true["']?$/i.test(x)) || lead.some((x) => MATCH_RO_ENV.test(x));
};
const OFF = /^["']?(?:false|0|no|off)["']?$/i;
export const dryMarked = (words, line) => {
  if (line.slice(1).some((x) => x === '--dry-run' || x === '--plan' || DRY_VALUE.test(x))) return true;
  if (/^g?make$/.test(line[0] || '') && line.slice(1).some((x) => MAKE_DRY.test(x))) return true;
  const at = words.findIndex((x) => tidy(x).replace(/^.*\//, '').toLowerCase() === line[0]);
  const lead = at >= 0 ? words.slice(0, at) : words.slice(0, Math.max(0, words.findIndex((x) => !/^\w+=/.test(x))));
  return lead.some((x) => DRY_ENV.test(x)) || matchReadonly(line, lead);
};

// 적은 명령 목록 → 맞출 꼴들
export const askPatterns = (list, entries, split) => list
  .flatMap((c) => { const raw = split(String(c)); return variants(runWords(raw), entries, raw); })
  .filter((w) => w.length)
  .map(patternOf);

// 명령 조각 하나가 꼴들 가운데 하나와 맞는가(묻기 commands·막기 block 이 함께 쓴다). 도움말·버전 보기와 같은 조각의 시험 실행은 맞지 않는 것으로 본다.
// words: 조각의 원래 낱말, line: 앞붙이를 벗긴 낱말(runWords)
export const segmentHit = (words, line, pats, entries) => line.length > 0 && pats.length > 0 && !justLooking(line) && !dryMarked(words, line)
  && variants(line, entries, words).some((l) => pats.some((w) => matches(l, w)));

// 막기(block)는 시험 실행 표시(--dry-run·--plan·DRY_RUN=1·make -n)를 보지 않는다 — 적은 스크립트가 그 표시를 모르면 그대로 실행된다
// (검토 2026-11-13: DRY_RUN=1 terraform apply -auto-approve·scripts/x.sh --dry-run 이 지나갔다). 도움말·버전 보기만 빼되,
// 그 낱말 하나 말고는 적은 명령의 낱말만 있을 때(terraform apply -help·kubectl delete --help). 인자가 더 붙으면(x.sh ip --version) 막는다.
// 적은 명령의 낱말(앞 낱말·옵션과 그 값·위치 인자)을 먼저 지우고 남은 것만 센다 — 적은 「psql -h prod-db」 의 -h(호스트)를 도움말로 세어
// psql -h prod-db 와 echo "DROP …" | psql -h prod-db 가 지나가던 회귀(다시 검토 2026-11-13). 남은 -h 는 맨 끝 낱말일 때만 도움말이다(값이 없다)
const HELP_WORD = /^(?:--help|-help|-h|--version|-version)$/;
const withoutPat = (rest, pat) => {
  const left = rest.map(tidy);
  const drop = (k, n = 1) => { if (k >= 0) left.splice(k, n); return k >= 0; };
  for (const o of pat.opts) {
    if (o.value === null) { drop(left.findIndex((x) => x === o.name || x.startsWith(`${o.name}=`))); continue; }
    const k = left.findIndex((x, i) => x === o.name && left[i + 1] === tidy(o.value));
    if (!drop(k, 2)) drop(left.indexOf(`${o.name}=${tidy(o.value)}`));
  }
  for (const w of [...pat.lead.slice(1), ...pat.extra]) drop(left.indexOf(tidy(w)));
  return left;
};
const helpOnly = (line, pat) => {
  const rest = line.slice(1);
  if (!rest.some((x) => HELP_WORD.test(x))) return false;
  const left = withoutPat(rest, pat);
  if (left.length !== 1 || !HELP_WORD.test(left[0])) return false;
  return left[0] !== '-h' || tidy(rest.at(-1)) === '-h';
};
// xargs 로 부른 도구(echo apply | xargs terraform)는 표준 입력 낱말이 뒤에 붙는다 — 앞 낱말이 어긋나지 않으면 맞는 것으로
const exeHead = (x) => tidy(x).replace(/^.*\//, '').replace(/\.exe$/i, '').toLowerCase();
const viaXargs = (words, line) => {
  const at = words.findIndex((x) => exeHead(x) === 'xargs');
  return at >= 0 && at < words.length - line.length;
};
export const blockHit = (words, line, pats, entries) => {
  if (!line.length || !pats.length) return false;
  // 앞붙이가 너무 많이 겹쳐 끝까지 벗기지 못했으면 막는다(lib/run-prefix.mjs MAX_PREFIX — 지키는 쪽)
  if (line.capped) return true;
  const open = viaXargs(words, line);
  return variants(line, entries, words).some((l) => pats.some((p) => matches(l, p, open) && !helpOnly(l, p)));
};

// harness.json 의 commands·block 값 → 명령 목록. 글 하나("terraform apply")는 한 줄짜리 목록으로 받는다(목록으로 안 적어 막기가 조용히 꺼지던 일 — 검토 2026-11-13).
// 그 밖의 모양(객체·숫자)은 오류로 던진다 — 부르는 쪽(runRules)이 「이 훅이 멈췄다」고 알린다. 없으면 빈 목록
export const cmdList = (v) => {
  if (v === undefined || v === null) return [];
  if (typeof v === 'string') return v.trim() ? [v] : [];
  if (!Array.isArray(v)) throw new TypeError('ask-cmd: commands/block must be a list');
  return v.filter((c) => typeof c === 'string' && c.trim());
};
