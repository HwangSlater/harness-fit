// 비밀값을 화면(그러니 대화 기록)에 꺼내는 명령인지 — ask-cmd 의 remote 에 딸림(역할극 15 회차 인프라, 2026-11-12).
// 값을 실제로 찍는 꼴만 묻는다. 이름·목록·크기만 보이는 것(kubectl get secrets 표, describe secret, list-secrets, kv list·metadata)은 묻지 않는다.
import fs from 'node:fs';
import path from 'node:path';
// 넘겨쓰기(> x · 2>/dev/null · >>x)는 낱말로 치지 않는다 — terraform output 2>/dev/null 의 「2>/dev/null」 을 output 이름으로 읽던 일(2026-11-12)
const REDIRECT = /^(?:\d|&|\*)?>>?(&\d)?/;
const words = (w, valueOpt) => {
  const out = [];
  for (let i = 1; i < w.length; i++) {
    const r = REDIRECT.exec(w[i]);
    if (r) { if (r[0] === w[i] && !r[1]) i++; continue; }
    if (!w[i].startsWith('-')) out.push(w[i]);
    else if (valueOpt.test(w[i])) i++;
  }
  return out;
};

// aws: secretsmanager get-secret-value·batch-get-secret-value, ssm get-parameter(s)·get-parameters-by-path·get-parameter-history 의 --with-decryption
const AWS_VALUE = /^(?:--profile|--region|--output|--query|--endpoint-url|--color|--cli-input-json|--ca-bundle|--cli-read-timeout|--cli-connect-timeout|--secret-id|--version-id|--version-stage|--name|--names|--path|--max-items|--page-size|--starting-token)$/;
const awsSecret = (w) => {
  const [service, op = ''] = words(w, AWS_VALUE);
  if (service === 'secretsmanager') return /^(?:get-secret-value|batch-get-secret-value)$/.test(op);
  return service === 'ssm' && /^get-parameter(?:s|s-by-path|-history)?$/.test(op) && w.includes('--with-decryption');
};

// kubectl get secret(s) … -o yaml·json·jsonpath·go-template·custom-columns(값이 든 .data 를 찍는다). -o name·wide 와 표는 이름만
const KUBE_VALUE = /^(?:-o|--output|-n|--namespace|--context|--cluster|--kubeconfig|--user|-s|--server|--as|--token|-l|--selector|--field-selector|--sort-by|-L|--label-columns|--template|-f|--filename|--chunk-size|--raw)$/;
const VALUE_OUT = /^(?:ya?ml|json|jsonpath|jsonpath-as-json|jsonpath-file|go-template|go-template-file|template|templatefile|custom-columns|custom-columns-file)(?:[=,]|$)/;
const outputOf = (w) => {
  for (let i = 1; i < w.length; i++) {
    const x = w[i];
    if (x === '-o' || x === '--output') return w[i + 1] || '';
    if (x.startsWith('--output=')) return x.slice(9);
    if (x.startsWith('-o=')) return x.slice(3);
    if (/^-o[^-]/.test(x)) return x.slice(2);
  }
  return '';
};
// secret · secrets · secret.v1 · secrets.v1. (빈 그룹을 적은 온전한 이름) · secrets.v1/app
const SECRET_KIND = /^secrets?(?:\.v1\.?)?(?:\/|$)/;
// kubectl get --raw /api/v1/namespaces/x/secrets/app · /api/v1/secrets(목록도 값이 든다)
const RAW_SECRET = /\/secrets(?:\/|\?|$)/i;
const rawPath = (w) => {
  for (let i = 1; i < w.length; i++) {
    if (w[i] === '--raw') return w[i + 1] || '';
    if (w[i].startsWith('--raw=')) return w[i].slice(6);
  }
  return null;
};
// --template 값(-o go-template 과 함께 쓰는 꼴)
const templateOf = (w) => {
  for (let i = 1; i < w.length; i++) {
    if (w[i] === '--template') return w[i + 1] || '';
    if (w[i].startsWith('--template=')) return w[i].slice(11);
  }
  return '';
};
// 틀(jsonpath·go-template·custom-columns)은 꺼내는 칸이 모두 이름표 쪽(metadata·type·kind·apiVersion)일 때만 묻지 않는다 —
// {.items[*].metadata.name} 은 이름만. 나머지({@} · {$} · {{.}} · {{index . "data"}} · custom-columns=V:data)는 값이 나올 수 있다(검토 2026-11-12, 뒤집음).
// 틀 파일(-file)은 안을 못 보니 묻지 않는다(헛물음이 놓침보다 나쁘다)
const TEMPLATE_OUT = /^(?:jsonpath|jsonpath-as-json|go-template|template|custom-columns)(?:[=,]|$)/;
// metadata 는 이 칸들만 — annotations 의 kubectl.kubernetes.io/last-applied-configuration 에 data 가 통째로 들고, {.metadata} 는 그것까지 찍는다(세 번째 검토 2026-11-12)
const META = new Set(['type', 'kind', 'apiVersion']);
const META_FIELDS = new Set(['name', 'namespace', 'labels', 'creationTimestamp', 'uid', 'resourceVersion']);
const LITERAL = /"(?:[^"\\]|\\.)*"|'[^']*'|`[^`]*`/g;
const BRACKET = /\[[^[\]]*\]/g;
const HAS_BRACKET = /\[[^[\]]*\]/;
// 칸 경로 하나(앞의 . · @ · $ 를 뗀 것): 맨 앞 items(목록)를 건너뛴 첫 칸이 이름표 쪽인지. 목록 자체(range .items)는 괜찮다
const pathSafe = (p) => {
  const parts = p.split('.').filter((x) => x && x !== '*');
  let i = 0;
  while (parts[i] === 'items') i++;
  if (i === parts.length) return i > 0;
  if (parts[i] === 'metadata') return META_FIELDS.has(parts[i + 1]);
  return META.has(parts[i]);
};
// kind: jsonpath · go · cc(custom-columns). go-template 의 맨 낱말은 함수(index·printf)라 보지 않고, $이름 은 변수(그 값을 준 경로를 따로 본다)
const refsSafe = (text, kind) => {
  let t = text.replace(LITERAL, ' ');
  for (let g = 0; g < 16 && HAS_BRACKET.test(t); g++) t = t.replace(BRACKET, '');
  if (kind === 'cc') t = t.split(',').map((c) => c.slice(c.indexOf(':') + 1)).join(' ');
  for (const tok of t.split(/[\s{}()|,:=<>!&]+/)) {
    if (!tok) continue;
    let p;
    if (tok[0] === '$') {
      if (tok !== '$' && !/^\$[.[]/.test(tok)) continue;
      p = tok.slice(1);
    } else if (tok[0] === '@' || tok[0] === '.') p = tok.replace(/^@/, '');
    else if (kind !== 'go' && /^[A-Za-z_]/.test(tok) && !(kind === 'jsonpath' && /^(?:range|end)$/.test(tok))) p = tok;
    else continue;
    if (!pathSafe(p)) return false;
  }
  return true;
};
const printsValue = (w) => {
  const out = outputOf(w).replace(/^["']|["']$/g, '');
  if (!VALUE_OUT.test(out)) return false;
  if (/^(?:ya?ml|json)$/.test(out)) return true;
  if (!TEMPLATE_OUT.test(out)) return false;
  const eq = out.indexOf('=');
  const text = `${eq === -1 ? '' : out.slice(eq + 1)} ${templateOf(w)}`;
  const kind = /^custom-columns/.test(out) ? 'cc' : /^(?:go-)?template/.test(out) ? 'go' : 'jsonpath';
  return !refsSafe(text, kind);
};
const kubeSecret = (w) => {
  const pos = words(w, KUBE_VALUE);
  // kubectl view-secret 플러그인은 값을 풀어 찍는다
  if (pos[0] === 'view-secret') return true;
  if (pos[0] !== 'get') return false;
  const raw = rawPath(w);
  if (raw !== null) return RAW_SECRET.test(raw.replace(/^["']|["']$/g, ''));
  // 종류는 get 바로 뒤 낱말(쉼표로 여럿)과 종류/이름 꼴만 — kubectl get configmap secrets·get pod secret 의 secret 은 이름이다(검토 2026-11-12)
  const kinds = [...(pos[1] || '').split(','), ...pos.slice(2).filter((x) => x.includes('/'))];
  return kinds.some((k) => SECRET_KIND.test(k.toLowerCase())) && printsValue(w);
};

// terraform·tofu output: 이름 없이 그냥 output 은 sensitive 값을 <sensitive> 로 가린다. 이름 없는 -json 은 모든 값을 그대로 찍어 늘 묻는다.
// 이름을 주면(-raw 든 아니든) 그 값을 그대로 찍는다(공식 문서: 이름으로 고르면 가리지 않음) — 그 이름이 .tf 에서 sensitive = true 일 때만 묻는다.
// vpc_id 같은 보통 값까지 물으면 헛물음이라서. .tf 를 못 읽거나 output 블록을 못 찾으면(모듈·다른 폴더) 모르니 묻는다.
const TF_SCAN_MAX = 200;
const TF_FILE_MAX = 1 << 20;
const tfSensitive = (dir, name) => {
  let files;
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.tf')).slice(0, TF_SCAN_MAX); } catch { return true; }
  const head = `output "${name}"`;
  for (const f of files) {
    let text;
    try {
      const p = path.join(dir, f);
      if (fs.statSync(p).size > TF_FILE_MAX) continue;
      text = fs.readFileSync(p, 'utf8');
    } catch { continue; }
    const at = text.indexOf(head);
    if (at === -1) continue;
    // 블록 끝: 다음 최상위 블록(줄 맨 앞 낱말 + 따옴표) 앞까지
    const rest = text.slice(at + head.length);
    const next = rest.search(/\n[a-z_]+\s+"/);
    return /\bsensitive\s*=\s*true\b/.test(next === -1 ? rest : rest.slice(0, next));
  }
  return true;
};
const tfOutput = (w, ctx) => {
  const pos = words(w, /^$/);
  if (pos[0] !== 'output') return false;
  const name = pos[1];
  if (!name) return w.some((x) => /^--?json$/.test(x));
  const chdir = w.find((x) => /^--?chdir=/.test(x));
  const dir = path.resolve(ctx.cwd || process.cwd(), chdir ? chdir.slice(chdir.indexOf('=') + 1) : '.');
  return tfSensitive(dir, name);
};

// gcloud secrets versions access, az keyvault secret show·download
const GCLOUD_VALUE = /^(?:--project|--secret|--format|--account|--configuration|--location|--impersonate-service-account|--out-file)$/;
const gcloudSecret = (w) => {
  const [a, b, c] = words(w, GCLOUD_VALUE);
  return a === 'secrets' && b === 'versions' && c === 'access';
};
const AZ_VALUE = /^(?:--vault-name|--name|-n|--version|--id|--subscription|--query|--output|-o|--file|-f|--encoding|-e)$/;
const azSecret = (w) => {
  const [a, b, c] = words(w, AZ_VALUE);
  return a === 'keyvault' && b === 'secret' && /^(?:show|download)$/.test(c || '');
};

// vault kv get·vault read(값을 찍는다). kv list·kv metadata get·status 는 아님.
// vault read sys/…(health·mounts·policies 같은 서버 상태)는 비밀값이 아니다 — sys/raw(저장소 날것)만 묻는다(검토 2026-11-12)
// 옵션은 -address 도 --address 도 된다(값을 붙인 -address=… 는 낱말 하나라 그냥 건너뛴다)
export const VAULT_VALUE = /^--?(?:address|namespace|ns|field|format|mount|version|ca-cert|ca-path|client-cert|client-key|tls-server-name|wrap-ttl|header|agent-address|policy-override|mfa|cas)$/;
const vaultSecret = (w) => {
  const [a, b = ''] = words(w, VAULT_VALUE);
  if (a === 'read') return !/^\/?sys\//.test(b) || /^\/?sys\/raw(?:\/|$)/.test(b);
  return a === 'kv' && b === 'get';
};

const BY_TOOL ={ aws: awsSecret, kubectl: kubeSecret, terraform: tfOutput, tofu: tfOutput, gcloud: gcloudSecret, az: azSecret, vault: vaultSecret };
// w: 앞붙이를 벗긴 낱말(첫 낱말은 도구 이름), ctx.cwd: 명령이 도는 폴더(terraform output 의 .tf 를 읽는 자리)
export const secretRead = (w, ctx = {}) => Object.hasOwn(BY_TOOL, w[0] || '') && BY_TOOL[w[0]](w, ctx);
