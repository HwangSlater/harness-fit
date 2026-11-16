// 인프라 설정의 안전장치를 끄는 고침(iac-edit, kind ask) — 역할극 15 회차(인프라) G1·M5·M6, 2026-11-16.
// 사용자들이 가장 걱정한 것: Claude 가 삭제 보호·마지막 스냅숏·prevent_destroy 를 끄거나, DB·포트를 인터넷에 여는 것.
// 이 호출 「뒤」 파일과 「앞」 파일에서 같은 꼴의 수를 세어, 늘면(prevent_destroy 는 줄면) 묻는다 — 이미 있던 설정은 묻지 않는다.
// 주석 속 글은 보지 않는다. 셸로 쓴 .tf(sed -i · cat >)는 보지 않는다(decisions-hooks.md).
import path from 'node:path';
import { fileAfter, targetFile, normPath } from './lines.mjs';

const MAX_TEXT = 2 * 1024 * 1024;
const MAX_HITS = 500;
// OpenTofu(.tofu)와 JSON 꼴(.tf.json · .tofu.json · .tfvars.json)도 — JSON 은 "키": 값 이라 아래 SETTINGS·webOnly 가 = 와 : 를 같이 받는다
const TF_FILE = /\.(?:tf|tofu|tfvars|hcl)(?:\.json)?$/i;
const YAML_FILE = /\.ya?ml$/i;
// 경로 낱말 prod·production·prd·live(products·productivity·liveness 는 아님). 파일 이름도 센다(apps/api-prod.yaml — app-of-apps 에서 흔한 이름).
// 운영 낱말이 있으면 아래 시험·개발 자리보다 앞선다(envs/prod/examples/main.tf · envs/prd/dev-db.tf 는 묻는다 — 검토 2026-11-16)
const PROD_PATH = /(?:^|[^a-z0-9])(?:prod|production|prd)(?:[^a-z0-9]|$)/i;
// 시험·예시 자리는 묻지 않는다(검토 2026-11-16 — 일부러 안전장치를 끈 예시가 많다). 폴더 조각이 그 이름일 때와 *.tftest.hcl 만.
// 파일 이름 속 _test 는 보지 않는다 — load_test_db.tf · ab_testing.tf 가 지나갔다
const SAMPLE_DIRS = new Set(['test', 'tests', 'fixtures', 'testdata', 'examples']);
const SAMPLE_FILE = /\.tftest\.hcl$/i;
// 개발용 자리(dev·sandbox·playground): 지우고 다시 만드는 일이 흔해 삭제 보호·마지막 스냅숏은 묻지 않는다. 공개·열린 포트는 여전히 묻는다.
// 폴더 조각만 보고 파일 이름은 보지 않는다(dev-db.tf · dev-tools.tf). modules/ 밑의 폴더 이름(modules/dev-portal)은 자리가 아니라 모듈 이름이다
const DEV_WORD = /(?:^|[^a-z0-9])(?:dev|develop|development|sandbox|playground)(?:[^a-z0-9]|$)/i;
const DEV_SKIP = new Set(['iac.deletion', 'iac.snapshot']);
const dirsOf = (rel) => rel.split('/').slice(0, -1).filter((s) => s && s !== '.');
const samplePath = (rel) => SAMPLE_FILE.test(rel) || dirsOf(rel).some((s) => SAMPLE_DIRS.has(s.toLowerCase()));
const devPath = (rel) => {
  const dirs = dirsOf(rel);
  const mod = dirs.findIndex((s) => s.toLowerCase() === 'modules');
  // 환경마다 나눈 변수 파일(environments/dev.tfvars · dev.tfvars)은 파일 이름이 곧 환경이다
  if (/\.tfvars(?:\.json)?$/i.test(rel) && DEV_WORD.test(rel.split('/').pop().replace(/\.tfvars(?:\.json)?$/i, ''))) return true;
  return (mod < 0 ? dirs : dirs.slice(0, mod)).some((s) => DEV_WORD.test(s));
};

// heredoc(<<EOT · <<-EOT … 줄에 EOT 만): 여는 표시가 i 에 있으면 [본문 시작, 본문 끝(닫는 줄 시작), 닫는 줄 뒤] 또는 null.
// 본문 속 /* · 홀수 개의 " · skip_final_snapshot = true 같은 글(정책 JSON·스크립트)은 설정이 아니다(검토 2026-11-16). 닫는 줄이 없으면 파일 끝까지
const HEREDOC = /<<-?([A-Za-z_][\w-]*)[ \t]*\r?\n/y;
const heredocAt = (text, i) => {
  if (text[i] !== '<' || text[i + 1] !== '<') return null;
  HEREDOC.lastIndex = i;
  const m = HEREDOC.exec(text);
  if (!m) return null;
  const start = i + m[0].length;
  for (let ls = start; ls < text.length;) {
    const nl = text.indexOf('\n', ls);
    const le = nl < 0 ? text.length : nl;
    if (text.slice(ls, le).trim() === m[1]) return [start, ls, le];
    if (nl < 0) break;
    ls = nl + 1;
  }
  return [start, text.length, text.length];
};

// 주석(# · // · /* */)과 heredoc 본문을 같은 길이의 빈칸으로 — 자리(줄·중괄호)를 그대로 두려고. 따옴표 속은 그대로 둔다.
export const maskHclComments = (text) => {
  const out = text.split('');
  let quote = false;
  let block = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (!block && !quote && c === '<') {
      const h = heredocAt(text, i);
      if (h) {
        for (let k = h[0]; k < h[1]; k++) if (text[k] !== '\n') out[k] = ' ';
        i = h[2] - 1;
        continue;
      }
    }
    if (block) {
      if (c === '*' && text[i + 1] === '/') { out[i] = out[i + 1] = ' '; i++; block = false; } else if (c !== '\n') out[i] = ' ';
      continue;
    }
    if (quote) {
      if (c === '\\') i++;
      else if (c === '"' || c === '\n') quote = false;
      continue;
    }
    if (c === '"') { quote = true; continue; }
    if (c === '/' && text[i + 1] === '*') { out[i] = out[i + 1] = ' '; i++; block = true; continue; }
    if (c === '#' || (c === '/' && text[i + 1] === '/')) {
      for (; i < text.length && text[i] !== '\n'; i++) out[i] = ' ';
    }
  }
  return out.join('');
};

const count = (re, text) => {
  let n = 0;
  for (const _ of text.matchAll(re)) if (++n > MAX_HITS) break;
  return n;
};
const SETTINGS = [
  { key: 'iac.deletion', re: /\b(?:enable_)?deletion_protection(?:_enabled)?"?\s*[=:]\s*"?false\b/g, more: true },
  { key: 'iac.snapshot', re: /\bskip_final_snapshot"?\s*[=:]\s*"?true\b/g, more: true },
  { key: 'iac.public', re: /\bpublicly_accessible"?\s*[=:]\s*"?true\b/g, more: true },
  { key: 'iac.preventDestroy', re: /\bprevent_destroy"?\s*[=:]\s*"?true\b/g, more: false },
];

// 중괄호를 한 번 훑어 { 자리 → 짝 } 자리와, 열린 곳 0.0.0.0/0·::/0 마다 그 자리를 감싼 { 들(안쪽이 끝)을 얻는다. 따옴표 속 중괄호(${…})는 세지 않는다.
const OPEN_CIDR = /^["'](0\.0\.0\.0\/0|::\/0)["']/;
const scanBlocks = (text) => {
  const close = new Map();
  const stack = [];
  const hits = [];
  let quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === '"' || c === '\n') quote = false; // HCL 글자는 줄을 넘지 않는다(닫히지 않은 " 가 파일 끝까지 가지 않게)
      continue;
    }
    // heredoc 본문은 건너뛴다(maskHclComments 를 거치지 않은 글도 같게)
    if (c === '<') {
      const h = heredocAt(text, i);
      if (h) { i = h[2] - 1; continue; }
    }
    if (c === '"' || c === "'") {
      const m = OPEN_CIDR.exec(text.slice(i, i + 12));
      if (m && hits.length < MAX_HITS) hits.push({ at: i, cidr: m[1], stack: stack.slice(-3) });
      if (c === '"') quote = true;
      continue;
    }
    if (c === '{') stack.push(i);
    else if (c === '}' && stack.length) close.set(stack.pop(), i);
  }
  return { close, hits };
};
const lineStart = (text, i) => text.lastIndexOf('\n', i - 1) + 1;
const headerOf = (text, open) => text.slice(lineStart(text, open), open);
const bodyOf = (text, open, close) => text.slice(open, (close.get(open) ?? text.length - 1) + 1);

// 그 블록이 80·443 하나만 연다고 분명히 적었는지(공개 로드 밸런서의 예외)
const WEB = new Set(['80', '443']);
const allWeb = (list) => list.length > 0 && list.every((x) => WEB.has(x));
const quotedItems = (s) => [...s.matchAll(/"([^"]*)"/g)].map((m) => m[1].trim());
const webOnly = (body) => {
  const from = /\bfrom_port"?\s*[=:]\s*"?(\d+)/.exec(body);
  const to = /\bto_port"?\s*[=:]\s*"?(\d+)/.exec(body);
  if (from && to) return from[1] === to[1] && WEB.has(from[1]);
  // GCP: allow { ports = ["443"] } — 모든 ports 목록이 80·443 만
  const ports = [...body.matchAll(/\bports"?\s*[=:]\s*\[([^\]]*)\]/g)].map((m) => quotedItems(m[1]));
  if (ports.length) return ports.every(allWeb);
  // Azure: destination_port_range(s)
  const one = /\bdestination_port_range"?\s*[=:]\s*"([^"]*)"/.exec(body);
  if (one) return WEB.has(one[1].trim());
  const many = /\bdestination_port_ranges"?\s*[=:]\s*\[([^\]]*)\]/.exec(body);
  if (many) return allWeb(quotedItems(many[1]));
  // terraform-aws-modules/security-group: ingress_rules = ["https-443-tcp", "http-80-tcp"]
  const named = /\bingress_rules"?\s*[=:]\s*\[([^\]]*)\]/.exec(body);
  if (named) return quotedItems(named[1]).every((x) => /^(?:https-443|http-80)-tcp$/.test(x)) && quotedItems(named[1]).length > 0;
  return false;
};

const RESOURCE = /\bresource\s+"([^"]+)"/;
// 열린 cidr 하나가 인바운드 규칙 안인지
const ingressOf = (text, close, hit) => {
  const ls = lineStart(text, hit.at);
  const attr = text.slice(ls, hit.at);
  if (/egress/i.test(attr)) return null;
  const [inner] = hit.stack.slice(-1);
  if (/\bingress\w*"?\s*[=:]/.test(attr)) return { body: inner === undefined ? attr : bodyOf(text, inner, close) };
  if (inner === undefined) return null;
  const head = headerOf(text, inner);
  const body = bodyOf(text, inner, close);
  if (/^\s*"?egress\b/.test(head)) return null;
  if (/^\s*"?ingress\b/.test(head)) return { body };
  // dynamic "ingress" { content { … } }
  const dyn = hit.stack.map((o) => /^\s*dynamic\s+"(ingress|egress)"/.exec(headerOf(text, o))?.[1]).filter(Boolean).at(-1);
  if (dyn) return dyn === 'ingress' ? { body } : null;
  // 목록 속 객체: ingress_with_cidr_blocks = [ { … cidr_blocks = "0.0.0.0/0" } ]
  const outer = hit.stack.length > 1 ? hit.stack[hit.stack.length - 2] : 0;
  const before = text.slice(Math.max(outer, inner - 300), inner);
  if (/\begress\w*"?\s*[=:]\s*\[[^\]=]*$/.test(before)) return null;
  if (/\bingress\w*"?\s*[=:]\s*\[[^\]=]*$/.test(before)) return { body };
  const type = RESOURCE.exec(head)?.[1] || '';
  if (type === 'aws_vpc_security_group_ingress_rule') return { body };
  if (type === 'aws_security_group_rule') return /\btype"?\s*[=:]\s*"ingress"/.test(body) ? { body } : null;
  if (type === 'google_compute_firewall') return /\bsource_ranges\b/.test(attr) && !/\bdirection"?\s*[=:]\s*"EGRESS"/i.test(body) ? { body } : null;
  // Azure: security_rule { direction = "Inbound" access = "Allow" … } · azurerm_network_security_rule
  if (/\bdirection"?\s*[=:]\s*"Inbound"/i.test(body) && /\baccess"?\s*[=:]\s*"Allow"/i.test(body)) return { body };
  return null;
};
// 80·443 이 아닌 포트를 인터넷 전체에 여는 인바운드 규칙들(cidr 글자 목록)
export const openIngress = (masked) => {
  const { close, hits } = scanBlocks(masked);
  const out = [];
  for (const hit of hits) {
    const rule = ingressOf(masked, close, hit);
    if (rule && !webOnly(rule.body)) out.push(hit.cidr);
  }
  return out;
};

// JSON 꼴로 쓴 Application({"apiVersion": "argoproj.io/v1alpha1", …} — YAML 은 JSON 도 받는다): 읽히면 값을 따라가며 센다. 안 읽히면 null(줄 단위로 센다)
const MAX_JSON_NODES = 100000;
const jsonPrune = (text) => {
  const t = text.trim();
  if (!/^[[{]/.test(t)) return null;
  let root;
  try {
    root = JSON.parse(t);
  } catch {
    return null;
  }
  let n = 0;
  let seen = 0;
  const todo = [root];
  while (todo.length && seen++ < MAX_JSON_NODES) {
    const v = todo.pop();
    if (!v || typeof v !== 'object') continue;
    const prune = v.syncPolicy?.automated?.prune;
    if (prune === true || prune === 'true') n++;
    for (const x of Object.values(v)) if (x && typeof x === 'object') todo.push(x);
  }
  return n;
};

// Argo CD Application 의 syncPolicy.automated.prune: true 수(들여쓰기로 부모 키를 따라간다). ApplicationSet 의 template 속도.
export const autoPrune = (text) => {
  const json = jsonPrune(text);
  if (json !== null) return json;
  let n = 0;
  let stack = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (/^---/.test(line)) { stack = []; continue; }
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const m = /^(\s*)(-\s+)?([\w.-]+|"[^"]*"|'[^']*')\s*:(?:\s+(.*))?$/.exec(line);
    if (!m) continue;
    const indent = m[1].length + (m[2] ? m[2].length : 0);
    const key = m[3].replace(/^["']|["']$/g, '');
    const value = (m[4] || '').replace(/\s+#.*$/, '').trim().replace(/,$/, ''); // 여러 줄 JSON 의 끝 쉼표
    while (stack.length && stack.at(-1).indent >= indent) stack.pop();
    const parent = stack.at(-1)?.key;
    const underSync = stack.some((s) => s.key === 'syncPolicy');
    if (key === 'prune' && /^["']?true["']?$/.test(value) && parent === 'automated' && underSync) n++;
    if (key === 'automated' && parent === 'syncPolicy' && /\{[^}]*\bprune\s*:\s*["']?true\b/.test(value)) n++;
    stack.push({ indent, key });
    if (n > MAX_HITS) break;
  }
  return n;
};
const ARGO_APP = /^\s*kind:\s*["']?Application(?:Set)?["']?\s*$/m;
const ARGO_API = /^\s*apiVersion:\s*["']?argoproj\.io\//m;
// JSON 꼴("키": "값" — 한 줄이어도). 검토 2026-11-16
const ARGO_APP_JSON = /"kind"\s*:\s*"Application(?:Set)?"/;
const ARGO_API_JSON = /"apiVersion"\s*:\s*"argoproj\.io\//;
const isArgoApp = (t) => (ARGO_APP.test(t) || ARGO_APP_JSON.test(t)) && (ARGO_API.test(t) || ARGO_API_JSON.test(t));

// 이 쓰기 전과 뒤의 글. 고치기에서 파일을 못 읽거나 old_string 을 못 찾으면 고치는 조각끼리 견준다
const beforeAfter = (ti, cwd) => {
  const { before, after } = fileAfter(ti, cwd);
  if (after != null) return { before: before || '', after };
  const edits = ti.edits || (typeof ti.new_string === 'string' ? [ti] : []);
  return { before: edits.map((e) => e.old_string || '').join('\n'), after: edits.map((e) => e.new_string || '').join('\n') };
};

// 찾은 것 → 문구 키 목록(+ 값). 없으면 []
export const findIacEdits = (ti, cwd, project) => {
  const file = targetFile(ti);
  if (!file) return [];
  const isTf = TF_FILE.test(file);
  const isYaml = YAML_FILE.test(file);
  if (!isTf && !isYaml) return [];
  const root = project || cwd || process.cwd();
  const relRaw = normPath(path.relative(root, path.resolve(cwd || process.cwd(), file)));
  const rel = relRaw.startsWith('..') || path.isAbsolute(relRaw) ? normPath(file) : relRaw;
  const prod = PROD_PATH.test(rel);
  if (!prod && samplePath(rel)) return [];
  if (isYaml && !prod) return [];
  const { before, after } = beforeAfter(ti, cwd);
  if (after.length > MAX_TEXT || before.length > MAX_TEXT) return [];
  if (isYaml) {
    // 진짜 apiVersion: argoproj.io/… 줄만 센다(주석 속 argoproj.io 에 apiVersion 이 app.k8s.io 인 파일을 Argo CD 로 보던 일)
    if (!isArgoApp(after)) return [];
    return autoPrune(after) > autoPrune(before) ? [{ key: 'iac.prune' }] : [];
  }
  const a = maskHclComments(after);
  const b = maskHclComments(before);
  const out = [];
  const dev = !prod && devPath(rel);
  for (const s of SETTINGS) {
    if (dev && DEV_SKIP.has(s.key)) continue;
    const na = count(s.re, a);
    const nb = count(s.re, b);
    if (s.more ? na > nb : na < nb) out.push({ key: s.key });
  }
  const openA = openIngress(a);
  if (openA.length > openIngress(b).length) out.push({ key: 'iac.openIngress', cidr: [...new Set(openA)].join(' · ') });
  return out;
};
