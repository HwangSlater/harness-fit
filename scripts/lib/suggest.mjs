// 저장소 단서로 훅 옵션을 미리 채운다(역할극 7·8·9 회차: 사용자의 가장 큰 걱정 — 원본 데이터·긴 학습·ssh 배포·비밀 설정 파일 —
// 이 처음 추천에 없고, 사용자가 말한 뒤에야 들어갔다, 2026-11-11).
// - ask: 실행 전에 물을 명령. 긴 학습·탐색(train·tune·sweep…)과 원격에 닿는 배포 스크립트(안에서 ssh·scp·rsync 를 부름).
//   표본·빠른 꼴(train-sample·train-quick)은 넣지 않는다 — 사용자가 「빨리 확인할 때 쓰는 것」으로 만든 명령이다.
// - protect: Claude 가 쓰거나 지우지 못하게 할 경로. .gitignore 에 적힌 원본 데이터 폴더와 비밀 설정 파일·키 폴더만
//   (git 밖이라 지우면 되살릴 수 없고, 코드가 아니라 Claude 가 고칠 일이 없다). 추적 중인 코드·설정은 넣지 않는다.
// 지어내지 않는다: 저장소 파일에 실제로 있는 이름만.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readText, filesIn } from './stack-scan.mjs';
import { makefileText, makeTargets, makeVars, makeRecipes, expandVars, headTargets } from './makefile.mjs';
import { migrateBack } from './commands.mjs';
import { readFastlane, shipLanes, releaseFastlane } from './fastlane.mjs';
import { commandSegments } from '../../hooks/lib/cmdline.mjs';
import { runWords } from '../../hooks/lib/run-prefix.mjs';
import { remoteCommand } from '../../hooks/lib/remote-cmd.mjs';
import { forbiddenFile } from '../../hooks/lib/secrets.mjs';
import { recordOffers } from './record-folders.mjs';

// 묻는 명령 한도(6 → 8: iOS 출시 레인·dbt 운영 명령이 더해지면 6개로는 make·스크립트·레인 셋 중 하나가 밀려났다 — 역할극 10·16 회차, 2026-11-13.
// 8 → 10: 출시 레인 하나를 스크립트·make 대상·레인 셋으로 부르는 앱 저장소는 레인 셋이면 9개가 된다 — 검토 2026-11-13)
const MAX = 10;
// 보호 경로는 더 넉넉히(인프라 저장소는 상태·계획·kubeconfig·Vault·tfvars·secrets/ 만으로 6개를 넘는다 — 역할극 15 회차)
const MAX_PROTECT = 10;
// 긴 일: 이름 낱말이 train·tune… 이고 표본·빠른 꼴이 아닐 때
const LONG_WORD = /(?:^|[-_.:])(?:train|training|tune|tuning|sweep|finetune|fine-tune|pretrain|hpo)(?:[-_.:](?:all|full|prod|gpu))?$/i;
const QUICK = /(?:sample|smoke|quick|fast|tiny|small|debug|dry|test|mini)/i;
const isLong = (name) => LONG_WORD.test(name) && !QUICK.test(name);

// pyproject 의 설치 명령 이름
const projectScripts = (root) => {
  const out = [];
  let inTable = false;
  for (const raw of readText(path.join(root, 'pyproject.toml')).split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[')) { inTable = /^\[\s*(?:project\.scripts|tool\.poetry\.scripts)\s*\]$/.test(line); continue; }
    const m = inTable && /^"?([\w.-]+)"?\s*=/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
};
// package.json 스크립트: 긴 낱말이 맨 앞 마디일 때만(train·train:full — build:tune·storybook:tune 은 아님), npm 의 pre·post 자동 스크립트는 빼고
const scriptsJson = (root) => {
  try {
    return Object.keys(JSON.parse(readText(path.join(root, 'package.json'))).scripts || {}).filter((s) => !/^(?:pre|post)/.test(s) && /^(?:train|tune|sweep|finetune|fine-tune|hpo)(?::|$)/.test(s));
  } catch {
    return [];
  }
};
// 원격에 닿는 배포 스크립트: 맨 위·scripts/·bin/·deploy/ 의 *.sh 가운데 안에서 원격에 닿는 명령을 부르는 것.
// 이름만 deploy 인 것(로컬 빌드만 하는 deploy.sh)은 아니다. 주석·echo·printf 줄은 보지 않는다(「ssh 로 접속하세요」 안내 글 — 검토 2026-11-11)
// 원격 판정은 훅과 같은 것(hooks/lib/remote-cmd.mjs — 읽기만 하는 kubectl get·terraform plan 은 아님, 검토 2026-11-11)에
// 배포 도구 몇 가지를 더한다(훅은 이 도구들을 묻지 않지만, 스크립트가 부르면 배포 스크립트다)
// 앱 출시: xcrun 의 App Store 올리기·공증(역할극 16 회차, 2026-11-13). fastlane 은 「이 저장소 명령」과 같은 판정(fastlane.mjs releaseFastlane —
// 출시 레인 이름, Fastfile 레인 본문의 올리기 동작, readonly 없는 match, fastlane 뒤 ios·android·mac 낱말 건너뛰기)
const DEPLOY_TOOL = /^(?:firebase\s+deploy|vercel\b.*--prod|wrangler\s+(?:deploy|publish)|serverless\s+deploy|sls\s+deploy|fly(?:ctl)?\s+deploy|git\s+push\s+(?:heroku|dokku|production|prod)\b|cap\s+\S+\s+deploy|kamal\s+deploy|(?:xcrun\s+)?(?:altool\b.*--upload-(?:app|package)|notarytool\s+submit)\b)/;
// lanes: Fastfile 레인 → 본문(readFastlane). 이름이 평범한 레인(ship)도 본문이 올리면 출시다
const callsRemote = (text, lanes = new Map()) => text.split(/\r?\n/).some((l) => {
  const line = l.trim();
  if (!line || line.startsWith('#')) return false;
  return commandSegments(line).some((seg) => {
    const words = seg.words;
    if (!words.length || /^(?:echo|printf|:)$/.test(words[0])) return false;
    const run = runWords(words);
    const cmd = run.join(' ');
    return remoteCommand(words, run) || DEPLOY_TOOL.test(cmd) || (run[0] === 'fastlane' && releaseFastlane(cmd, lanes));
  });
});
const shellScripts = (root) => ['.', 'scripts', 'bin', 'deploy'].flatMap((dir) => filesIn(root, dir).filter((x) => /\.sh$/i.test(x)).slice(0, 40).map((f) => (dir === '.' ? f : `${dir}/${f}`)));
const deployScripts = (root, lanes) => shellScripts(root).filter((rel) => callsRemote(readText(path.join(root, rel)).slice(0, 64 * 1024), lanes)).map((rel) => `./${rel}`);
// 스크립트 속 운영 명령(dbt build --target prod — Claude 가 같은 명령을 바로 칠 수 있다).
// 역슬래시로 이은 줄은 한 줄로 붙여 읽는다 — `ssh host \⏎ spark-submit … \⏎ --env prod` 의 운영 옵션이 끝 줄에 있어 놓쳤다(역할극 10 회차 M2, 2026-11-13).
// 주석 줄 끝의 역슬래시는 잇지 않는다(셸에서도 주석은 줄 끝에서 끝난다)
const joinedLines = (text) => {
  const out = [];
  let cur = '';
  for (const l of text.split(/\r?\n/)) {
    if (!cur && l.trim().startsWith('#')) { out.push(l); continue; }
    if (/\\$/.test(l)) { cur += `${l.slice(0, -1)} `; continue; }
    out.push(cur + l);
    cur = '';
  }
  if (cur) out.push(cur);
  return out;
};
const scriptProdCommands = (root) => shellScripts(root).flatMap((rel) => joinedLines(readText(path.join(root, rel)).slice(0, 64 * 1024))
  .filter((l) => !l.trim().startsWith('#') && !DRY.test(l)).map(prodCommand).filter(Boolean).map((v) => ({ v, k: 'prod', at: rel })));

// .gitignore 의 원본 데이터·비밀 파일 줄
const RAW_DATA = /^\/?(?:data|datasets?)\/(?:raw|original|source|external)\/?$|^\/?(?:raw[-_]?data|data[-_]?raw)\/?$/i;
// 맨 위 기준으로 적은 /data/·/datasets/ 도(앞 / 가 없는 data/ 는 하위 폴더까지 뜻해 소스 폴더일 수 있다 — 역할극 3 회차, 2026-11-13).
// 바로 위 주석이 프로그램·시험이 만드는 폴더라고 하면 아니다(kv-server 가 만드는 /data/ — 역할극 11 회차)
const TOP_DATA = /^\/(?:data|datasets?)\/?$/i;
const GENERATED_NOTE = /created\s+by|generated|\boutputs?\b|\bcache\b|\btests?\b|만들어지|생성(?:되|한|된|하)|결과물/i;
// 데이터·체크포인트 파일 확장자(*.hdf5 …)와 체크포인트 폴더 — git 밖이라 지우면 되살릴 수 없다(역할극 3·7 회차)
const DATA_EXT = /^\.(?:hdf5|h5|parquet|npz|ckpt)$/i;
const CHECKPOINT_DIR = /^checkpoints?\/$/i;
// 비밀 파일: 이름의 한 마디가 secret(s)·credentials 이고 예시 파일이 아닐 때(secret_santa.json·credentials.example.json 은 아님 — 검토 2026-11-11)
const SECRET_FILE = /(?:^|\/)(?:(?:[\w-]+[-_.])?secrets?(?:[-_.](?:local|dev|prod|production|staging|test))?\.(?:ya?ml|json|properties|toml)|credentials?\.json|service[-_]account[\w-]*\.json)$/i;
const EXAMPLE = /[-_.](?:example|sample|template|dist|default)\b/i;
// Terraform 상태·계획(비밀값이 평문으로 든다), kubeconfig, Ansible Vault 비밀번호 파일
const INFRA_SECRET = /tfstate|\.tfplan|kubeconfig|(?:^|\/)\.kube\/?$|vault[-_.]?pass/i;
const SECRET_DIR = /(?:^|\/)(?:keys|secrets|certs|credentials)\/$/i;
// 이름이 *.env 인 파일(lab.env 처럼 .env 로 시작하지 않는 것 — 역할극 11 회차)
const ENV_FILE = /(?:^|\/)[\w-]+\.env$/i;
// 바로 위 주석이 비밀·개인정보라고 말하는 묶음(빈 줄까지) — 「never commit」「사용자 id·ip」「개인정보」(역할극 10·11·12 회차)
// 낱말 단위로만(tokenizer cache·Personal IDE settings·IP 목록 생성 결과 같은 주석에 걸리던 일 — 검토 2026-11-11)
const SENSITIVE_NOTE = /never\s+commit|do\s+not\s+commit|don'?t\s+commit|\bsecrets?\b|\bcredentials?\b|\bpasswords?\b|\b(?:api\s+)?tokens?\b|personal\s+(?:data|information|info)|\bpii\b|비밀|개인정보|개인\s*정보|커밋하지|올리지\s*않|(?:사용자|고객|user)\s*(?:id|ip|정보|데이터)|고객\s*데이터|계정\s*정보/i;
// 같은 묶음이어도 빌드·캐시·편집기 결과물은 넣지 않는다(지우는 것이 정상 — spark-warehouse·target·logs·.idea)
const BUILD_OUTPUT = /(?:^|\/)(?:target|build|dist|out|tmp|temp|cache|\.cache(?:\/.*)?|logs?|warehouse|spark-warehouse|metastore_db|node_modules|\.terraform|\.idea|\.vscode|generated|gen|coverage|__pycache__|\.venv|venv)\/?$|\.log$/i;
const ignoredProtect = (root, has) => {
  const out = [];
  let note = false; // 지금 묶음 위 주석이 민감하다고 했는지
  let gen = false; // 지금 묶음 위 주석이 만들어지는 결과물이라고 했는지
  for (const raw of readText(path.join(root, '.gitignore')).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { note = false; gen = false; continue; }
    if (line.startsWith('#')) { note = note || SENSITIVE_NOTE.test(line); gen = gen || GENERATED_NOTE.test(line); continue; }
    if (line.startsWith('!') || EXAMPLE.test(line)) continue;
    // 확장자 하나짜리 글롭(*.evtx)은 확장자 꼴(.evtx)로, 그 밖의 글롭은 보지 않는다
    const ext = /^\*(\.[\w-]+)$/.exec(line)?.[1];
    // 인프라 비밀 파일은 * 만 든 글롭도 그대로(*.tfstate.*·kubeconfig*·ansible/.vault_pass* — 파일 보호가 * 를 맞춘다. 역할극 15 회차, 2026-11-12)
    const infraGlob = INFRA_SECRET.test(line) && !/[?[]/.test(line);
    if (/[*?[]/.test(line) && !ext && !infraGlob) continue;
    // 앞 / 는 맨 위만이라는 뜻 — 이름 하나(/kubeconfig*·/profiles.yml)면 / 를 남긴다(떼면 internal/kubeconfig.go 까지 막았다, 검토 2026-11-12).
    // 안에 / 가 있거나 끝이 / 인 꼴(scripts/lab.env·secrets/)은 파일 보호가 이미 맨 위 기준으로 본다
    const bare = line.replace(/^\//, '');
    const keep = (p) => (line.startsWith('/') && p === bare && !p.includes('/') ? `/${p}` : p);
    const push = (v, k) => out.push({ v, k });
    if (INFRA_SECRET.test(line)) { push(ext || keep(bare), 'infra'); continue; }
    const p = ext || bare;
    // .env·키 파일처럼 이미 늘 막는 것은 넣지 않는다(자리만 차지해 .pcap 같은 것이 밀려났다)
    if (forbiddenFile(ext ? `x${ext}` : p)) continue;
    const dir = p.endsWith('/');
    if (RAW_DATA.test(line) || (TOP_DATA.test(line) && !gen)) push(dir ? p : `${p}/`, 'raw');
    else if ((ext && DATA_EXT.test(ext)) || CHECKPOINT_DIR.test(p)) push(p, 'data');
    else if (dir && SECRET_DIR.test(p)) push(p, 'secret');
    else if (SECRET_FILE.test(p) || ENV_FILE.test(p)) push(keep(p), 'secret');
    else if (p === 'profiles.yml' && has('dbt_project.yml')) push(keep(p), 'dbt'); // dbt 접속 정보(비밀번호)
    else if (note && !BUILD_OUTPUT.test(p)) push(keep(p), 'note');
  }
  return out;
};

// Makefile 대상 가운데 레시피가 원격 스크립트를 부르거나 원격 명령을 바로 쓰는 것(make backfill → ./scripts/backfill.sh — 역할극 10 회차).
// 이름이 dry·plan 이거나 레시피가 DRY_RUN=1 로 부르는 것은 아니다(make backfill-dry)
const DRY = /\bDRY_RUN=(?:1|true|yes)\b|--dry-run\b|--plan\b/i;
// 운영 환경을 고르는 옵션(--env prod·--target prod — detctl deploy·dbt build, 역할극 10·12 회차)
// --profile 은 자격 증명 고르기일 때가 많아 뺀다(aws s3 ls --profile prod — 검토 2026-11-11)
const PROD_FLAG = /(?:^|\s)(--(?:env|target|environment|stage))[= ](prod|production)\b/;
// 운영 옵션이 있어도 바꾸지 않는 일: 화면 빌드 도구(webpack --env production 은 빌드 설정)와 보기·검사 하위 명령(dbt docs·compile·test)
const BUILD_TOOL = /^(?:webpack|vite|next|nuxt|tsc|esbuild|rollup|parcel|gulp|grunt|ng|vue-cli-service|react-scripts)$/;
const READ_SUB = /^(?:docs|ls|list|describe|show|get|status|diff|plan|compile|lint|test|validate|check|parse|debug|help)$/;
// 그 명령의 앞 낱말(하위 명령까지) + 운영 옵션 → 「detctl deploy --env prod」(묻는 명령은 옵션 자리를 가리지 않는다)
// dbt 의 짧은 꼴 -t prod(다른 도구의 -t 는 이름표·시간이라 dbt 일 때만 — docker build -t prod 는 아님, 독립 검토 2026-11-13)
const DBT_SHORT = /(?:^|\s)(-t)[= ](prod|production)\b/;
// ssh [옵션] 호스트 명령 … 이면 원격에서 도는 명령의 낱말(따옴표는 뗀다). 원격 명령이 없으면 null(「ssh --env prod」 를 만들지 않게 — 역할극 10 회차)
const SSH_VALUE = /^-[bcDEeFIiJLlmOopQRSWw]$/;
const remoteWords = (words) => {
  if (words[0] !== 'ssh') return words;
  let i = 1;
  while (i < words.length && words[i].startsWith('-')) i += SSH_VALUE.test(words[i]) ? 2 : 1;
  const rest = words.slice(i + 1).map((x) => x.replace(/^["']|["']$/g, '')).filter(Boolean);
  // 원격 글이 여러 명령이면(cd /srv && spark-submit …) 운영 옵션이 든 조각만 — 「cd --env prod」 를 만들던 일(독립 검토 2026-11-13)
  const segs = [[]];
  for (const x of rest) {
    if (/^(?:&&|\|\||;|\|)$/.test(x)) { segs.push([]); continue; }
    const end = /;$/.test(x);
    segs.at(-1).push(end ? x.slice(0, -1) : x);
    if (end) segs.push([]);
  }
  const seg = segs.find((s) => PROD_FLAG.test(` ${s.join(' ')}`) || (s.includes('dbt') && DBT_SHORT.test(` ${s.join(' ')}`)));
  return seg?.filter(Boolean).length ? runWords(seg.filter(Boolean)) : null;
};
const prodCommand = (line) => {
  if (!/\bprod/.test(line)) return null; // 줄마다 낱말을 나누지 않게 먼저 거른다
  const raw = line.trim().split(/\s+/);
  if (!raw.length || raw[0].startsWith('-')) return null; // 앞 줄에서 이어지는 옵션 줄
  const words = remoteWords(runWords(raw)); // uv run dbt build … → dbt build …, ssh host spark-submit … → spark-submit …
  if (!words) return null;
  const m = PROD_FLAG.exec(line) || (words[0] === 'dbt' && DBT_SHORT.exec(line));
  if (!m) return null;
  if (!words.length || words[0].startsWith('-') || /^(?:echo|printf|make|\$\(MAKE\))$/.test(words[0]) || /[$`]/.test(words[0])) return null;
  const head = /^[a-z][\w-]*$/.test(words[1] || '') ? words.slice(0, 2) : words.slice(0, 1);
  if (BUILD_TOOL.test(words[0].replace(/^.*[\\/]/, '')) || READ_SUB.test(head[1] || '')) return null;
  return `${head.join(' ')} ${m[1]} ${m[2]}`;
};
const makeRemoteTargets = (root, scripts, lanes) => {
  const text = makefileText(root);
  const out = [];
  // 낱말 하나인 make 변수(TF ?= terraform · KUBECTL := kubectl)는 그 값으로 — $(TF) apply 를 terraform 으로 못 알아보던 일(역할극 15 회차, 2026-11-12)
  const vars = makeVars(text);
  for (const [target, lines] of makeRecipes(text)) {
    if (QUICK.test(target) || /plan/i.test(target)) continue;
    if (migrateBack(target)) { out.push({ v: `make ${target}`, k: 'migrate-down', at: 'Makefile' }); continue; }
    for (const raw of lines) {
      // 모르는 make 변수 $(BUCKET)·${X} 는 값 자리표시로 — 괄호가 명령 조각을 끊어 내려받기(s3://$(B) data/)를 올리기로 읽던 일.
      // $ 를 남겨 $(MAKE)·$(DBT) 로 시작하는 명령은 prodCommand 가 거른다(검토 2026-11-11)
      const line = expandVars(raw, vars, '$VAR');
      if (DRY.test(line)) continue;
      const prod = prodCommand(line);
      // 스크립트 경로는 낱말 단위로 맞춘다 — 글자 포함으로 보면 ./predeploy.sh 가 deploy.sh 로 맞아 엉뚱한 까닭을 붙였다(독립 검토 2026-11-12)
      const words = line.split(/[\s;&|()"'`<>]+/).map((w) => w.replace(/^\.\//, ''));
      const script = scripts.find((s) => { const n = s.replace(/^\.\//, ''); return words.some((w) => w === n || w.endsWith(`/${n}`)); });
      if (prod || script || callsRemote(line, lanes)) {
        // 이유: 운영 옵션 > 원격 스크립트를 부름 > 원격 명령을 바로 씀
        const k = prod ? 'prod' : script ? 'make-script' : 'remote';
        out.push({ v: `make ${target}`, k, at: 'Makefile', ref: script || null }, ...(prod ? [{ v: prod, k: 'prod', at: 'Makefile' }] : []));
        break;
      }
    }
  }
  return out;
};

// ── 역할극 3·10·16 회차에서 처음 추천에 없던 것(2026-11-13) ──────────
// 학습 입구 스크립트: README·Makefile·셸 스크립트에 「python scripts/train.py」「python -m scripts.train」 꼴로 적혀 있고 그 파일이 실제로 있는 것.
// 이름이 train·tune… 으로 시작해야 한다(train_bc.py 는 맞고 trainer.py·train_utils.py 는 학습 실행이 아닌 모듈 — 아님)
const LONG_FILE = /^(?:train|training|tune|tuning|sweep|finetune|fine[-_]tune|pretrain|hpo)(?:[-_][a-z0-9]+)*$/i;
const MODULE_PART = /(?:^|[-_])(?:utils?|helpers?|common|lib|config|base|core)(?:$|[-_])/i;
const PY_CALL = /(?:^|[\s`'"(;&|])python3?\s+(?:-[A-Za-z]+\s+)*?(?:-m\s+([\w.]+)|((?:\.\/)?[\w./-]+\.py))(?=[\s`'")]|$)/gm;
const entryScripts = (root, texts) => {
  const out = [];
  for (const [at, text] of texts) {
    for (const m of text.matchAll(PY_CALL)) {
      const rel = (m[1] ? `${m[1].replace(/\./g, '/')}.py` : m[2]).replace(/^\.\//, '');
      const stem = path.basename(rel, '.py');
      if (rel.includes('..') || !LONG_FILE.test(stem) || QUICK.test(stem) || MODULE_PART.test(stem.replace(/^[a-z]+/i, ''))) continue;
      if (fs.existsSync(path.join(root, rel))) out.push({ v: `python ${rel}`, k: 'long', at });
    }
  }
  return out;
};
// Makefile 대상의 「## 설명」 이 리드·관리자만 쓴다고 하는 것(make beta ## TestFlight 배포 — 리드만).
// 「운영」 「prod」 는 보지 않는다 — 「## Build production bundle」 「## prod-like env」 처럼 운영용으로 만드는 일반 대상이 묻는 명령이 됐다(독립 검토 2026-11-13)
const LEAD_NOTE = /리드만|관리자만|담당자만|lead[\s-]+only|maintainers?[\s-]+only|admins?[\s-]+only/i;
const makeNoteTargets = (text) => text.split(/\r?\n/).flatMap((raw) => {
  const at = raw.indexOf('##');
  if (at < 0 || /^\t/.test(raw)) return [];
  const targets = headTargets(raw.slice(0, at));
  const note = LEAD_NOTE.exec(raw.slice(at + 2));
  return targets && note ? targets.filter((t) => !QUICK.test(t) && !/plan|dry/i.test(t)).map((t) => ({ v: `make ${t}`, k: 'make-note', at: 'Makefile', ref: note[0] })) : [];
});
// fastlane 레인 가운데 출시·올리기 레인(beta·release·deploy·upload_testflight …, 이름이 평범해도 본문이 upload_to_testflight 를 부르는 ship).
// test·certs·screenshots 는 아니다. private_lane 은 명령줄에서 부를 수 없어 뺀다.
// Matchfile 이 있으면 fastlane match 도(readonly 없이 돌리면 인증서를 새로 만들거나 지운다. --readonly·readonly:true·MATCH_READONLY 는 훅의 dryMarked 가 지나보낸다 — 4차 검토 2026-11-13).
// 기준은 「이 저장소 명령」과 같은 것(fastlane.mjs shipLanes·laneShips). 묻는 명령 맞추기가 fastlane 뒤 ios·android·mac 을 건너뛰어
// `fastlane ship` 하나로 `fastlane ios ship` 도 묻는다(hooks/lib/ask-match.mjs)
const fastlaneAsks = (root, fl) => {
  if (!fl.at) return [];
  const dir = path.posix.dirname(fl.at);
  const match = fs.existsSync(path.join(root, dir, 'Matchfile')) ? [{ v: 'fastlane match', k: 'fastlane-match', at: `${dir}/Matchfile` }] : [];
  return [...shipLanes(fl).map((l) => ({ v: `fastlane ${l}`, k: 'fastlane', at: fl.at })), ...match];
};
// fastlane 서명·계정 설정(Matchfile: 인증서 저장소, Appfile: 앱 ID·팀 ID)은 보호 경로로 제안한다 — 커밋된 파일이라 .gitignore 로는 안 잡힌다(역할극 16 회차 M5, 2026-11-13)
const FASTLANE_LOCKED = ['Matchfile', 'Appfile'];
const fastlaneProtect = (root, fl) => {
  if (!fl.at) return [];
  const dir = path.posix.dirname(fl.at);
  return FASTLANE_LOCKED.filter((f) => fs.existsSync(path.join(root, dir, f))).map((f) => ({ v: `${dir}/${f}`, k: 'fastlane-config', at: `${dir}/${f}` }));
};
// dbt 운영 대상: 프로필(예시)에 운영 출력(prod·production)이 있으면 run·build·seed 를 그 대상으로 묻는다.
// 증분 모델이 있으면 --full-refresh 도(증분 표를 지우고 처음부터 다시 만든다). 앞 낱말 dbt + 옵션 하나로 run·build 모두 맞춘다(ask-match.mjs)
const DBT_PROFILES = ['profiles.yml.example', 'profiles.example.yml', 'profiles.yml.sample', 'profiles.yml'];
const MODELS_MAX = 400;
const sqlFiles = (root, rel, out = []) => {
  for (const e of (() => { try { return fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return []; } })()) {
    if (out.length >= MODELS_MAX) break;
    const p = `${rel}/${e.name}`;
    if (e.isDirectory()) sqlFiles(root, p, out);
    else if (/\.sql$/i.test(e.name)) out.push(p);
  }
  return out;
};
const INCREMENTAL = /materialized\s*[=:]\s*['"]?incremental\b/;
// profiles 의 outputs: 바로 아래 칸 이름 가운데 prod·production. 들여쓰기로 outputs: 블록 안만 본다 —
// 정규식으로 outputs: 뒤 아무 데서나 찾으니 블록 밖 vars: 아래의 prod: 까지 맞았다(독립 검토 2026-11-13)
const prodOutput = (text) => {
  let outAt = -1; // outputs: 줄의 들여쓰기
  let childAt = -1; // 그 블록 바로 아래 칸의 들여쓰기
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const ind = raw.length - raw.trimStart().length;
    const key = /^\s*([\w-]+):\s*(?:#.*)?$/.exec(raw)?.[1];
    if (outAt >= 0 && ind <= outAt) outAt = -1, childAt = -1;
    if (outAt < 0) { if (key === 'outputs') outAt = ind; continue; }
    if (childAt < 0) childAt = ind;
    if (ind === childAt && /^(?:prod|production)$/.test(key || '')) return key;
  }
  return null;
};
// 스크립트에 적힌 dbt 운영 명령: --target prod·-t prod(짧은 꼴) 모두
const DBT_PROD_CMD = /^dbt \w+ (?:--target|-t) (prod|production)$/;
const dbtAsks = (root, found) => {
  if (!fs.existsSync(path.join(root, 'dbt_project.yml'))) return [];
  const profile = (f) => readText(path.join(root, f)).slice(0, 64 * 1024);
  const prof = DBT_PROFILES.find((f) => prodOutput(profile(f)));
  const target = prof && prodOutput(profile(prof));
  const fromCmd = found.find((x) => DBT_PROD_CMD.test(x.v));
  const t = target || (fromCmd && DBT_PROD_CMD.exec(fromCmd.v)[1]);
  // 묻는 명령 맞추기는 짧은 별칭을 짐작하지 않는다(ask-match.mjs) — 바꾸는 하위 명령 run·build 는 -t 꼴도 함께 적는다.
  // seed 는 --target 꼴만(묻는 명령 한도 8개 안에서 make·스크립트·레인이 밀리지 않게)
  const forms = [['run', '--target'], ['build', '--target'], ['seed', '--target'], ['run', '-t'], ['build', '-t']];
  const prod = t ? forms.map(([sub, o]) => ({ v: `dbt ${sub} ${o} ${t}`, k: 'dbt-prod', at: prof || fromCmd.at })) : [];
  const inc = sqlFiles(root, 'models').find((f) => INCREMENTAL.test(readText(path.join(root, f)).slice(0, 8 * 1024)))
    || (INCREMENTAL.test(readText(path.join(root, 'dbt_project.yml'))) ? 'dbt_project.yml' : null);
  return [...prod, ...(inc ? [{ v: 'dbt --full-refresh', k: 'dbt-refresh', at: inc }] : [])];
};

// Rust 의 긴 시험: git 이 아는 .rs 파일에 #[ignore] 시험이 있으면 그것까지 돌리는 꼴(-- --ignored·--include-ignored)을 묻는다
// (역할극 11 회차 M4 「10k 시드 긴 시험」, 2026-11-13). 없으면 넣지 않는다 — 헛물음이 놓침보다 나쁘다.
// 파일은 tests/ 쪽부터 RUST_READ_MAX 개까지만 읽는다(큰 저장소에서 감지가 느려지지 않게)
// 줄 앞 빈칸은 [ \t] 만 — \s 는 줄바꿈까지 먹어 빈 줄 8만 개짜리 .rs 에서 12초 걸렸다(독립 검토 2026-11-13)
const IGNORE_ATTR = /^[ \t]*#\[ignore\b/m;
export const hasIgnoredTest = (text) => IGNORE_ATTR.test(text);
const RUST_READ_MAX = 300;
const ignoredTests = (root) => {
  if (!fs.existsSync(path.join(root, 'Cargo.toml'))) return [];
  let files = [];
  try {
    files = execFileSync('git', ['-C', root, 'ls-files', '-z', '--', '*.rs'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
  } catch {
    return [];
  }
  const inTests = (f) => (/(?:^|\/)tests\//.test(f) ? 0 : 1);
  // 남의 코드(vendor/)는 이 저장소의 시험이 아니다. 파일은 앞 256KB 만 읽는다
  const at = files.filter((f) => !/(?:^|\/)vendor\//.test(f)).sort((a, b) => inTests(a) - inTests(b)).slice(0, RUST_READ_MAX)
    .find((f) => hasIgnoredTest(readText(path.join(root, f), 256 * 1024)));
  return at ? ['cargo test -- --ignored', 'cargo test -- --include-ignored'].map((v) => ({ v, k: 'ignored', at })) : [];
};

// 같은 값은 먼저 나온 것(그 이유)만, 개수 한도까지
const firstN = (items, max) => {
  const seen = new Map();
  for (const x of items) if (!seen.has(x.v) && seen.size < max) seen.set(x.v, x);
  return [...seen.values()];
};
// 묻는 명령은 한도를 넘으면 까닭(k)마다 처음 것 하나씩을 먼저 남기고 나머지를 차례대로 채운다(차례는 그대로).
// 앞에서부터 자르니 스크립트·make 대상이 자리를 다 먹고 fastlane match(인증서 지우기)가 빠졌다(검토 2026-11-13)
const fairN = (items, max) => {
  const all = firstN(items, Infinity);
  if (all.length <= max) return all;
  const keep = new Set();
  const kinds = new Set();
  for (const x of all) if (keep.size < max && !kinds.has(x.k)) { kinds.add(x.k); keep.add(x); }
  for (const x of all) if (keep.size < max) keep.add(x);
  return all.filter((x) => keep.has(x));
};

// → { ask: ['churn-train', 'make tune', './deploy.sh'], protect: ['data/raw/', 'application-secret.yml'], offer: ['bench-results/'](있을 때만),
//     why: { './deploy.sh': { k: 'remote', at: 'deploy.sh' }, 'data/raw/': { k: 'raw', at: '.gitignore' } } }
// why: 화면이 값마다 「저장소에서 찾음: …」을 보여 준다(옵션 칸 2안, 2026-11-12). k 는 화면 문구 srcWhy_<k>
export const suggest = (root) => {
  const has = (f) => fs.existsSync(path.join(root, f));
  const pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : 'npm run';
  const fl = readFastlane(root); // Fastfile 은 한 번만 읽어 스크립트·make 대상·레인 판정이 함께 쓴다
  const deploys = deployScripts(root, fl.lanes);
  const long = (list, at) => list.filter(isLong).map((v) => ({ v, k: 'long', at }));
  const make = makefileText(root);
  const readme = ['README.md', 'README.rst', 'README'].find(has);
  const texts = [...(readme ? [[readme, readText(path.join(root, readme)).slice(0, 256 * 1024)]] : []), ['Makefile', make],
    ...shellScripts(root).map((rel) => [rel, readText(path.join(root, rel)).slice(0, 64 * 1024)])];
  const found = [
    ...long(projectScripts(root), 'pyproject.toml'),
    ...long(makeTargets(make), 'Makefile').map((x) => ({ ...x, v: `make ${x.v}` })),
    ...long(scriptsJson(root), 'package.json').map((x) => ({ ...x, v: `${pm} ${x.v}` })),
    ...entryScripts(root, texts),
    ...deploys.map((v) => ({ v, k: 'remote', at: v.replace(/^\.\//, '') })),
    ...makeRemoteTargets(root, deploys, fl.lanes),
    ...scriptProdCommands(root),
    ...makeNoteTargets(make),
    ...fastlaneAsks(root, fl),
    ...ignoredTests(root),
  ];
  const ask = fairN([...found, ...dbtAsks(root, found)], MAX);
  const protect = firstN([...ignoredProtect(root, has).map((x) => ({ ...x, at: '.gitignore' })), ...fastlaneProtect(root, fl)], MAX_PROTECT);
  // offer: 커밋해 둔 결과·논문 폴더 — 선택에 넣지 않고 적용 때 보호할지 묻는다(record-folders.mjs, 사용자 결정 2026-11-13). 없으면 칸도 없다
  const offer = recordOffers(root).filter((x) => !protect.some((p) => p.v === x.v));
  const why = Object.fromEntries([...ask, ...protect, ...offer].map(({ v, ...r }) => [v, Object.fromEntries(Object.entries(r).filter(([, x]) => x))]));
  return { ask: ask.map((x) => x.v), protect: protect.map((x) => x.v), ...(offer.length ? { offer: offer.map((x) => x.v) } : {}), why };
};
