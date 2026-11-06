// 비밀값 모양 찾기. 패턴은 자기 자신과 맞지 않게 적는다(이 파일을 고칠 때 비밀값 훅에 걸리지 않게).
import path from 'node:path';

export const SECRET_PATTERNS = [
  { id: 'private-key', re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/ },
  { id: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,})\b/ },
  { id: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'api-key-sk', re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}\b/ },
  { id: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { id: 'stripe-key', re: /\b[rs]k_live_[A-Za-z0-9]{20,}\b/ },
];

// 이름 앞에 다른 낱말이 붙은 꼴(DB_PASSWORD · OPENAI_API_KEY · dbPassword)도 잡는다 — 앞에 \b 만 두면 _ 와 낙타 표기를 놓쳤다(2026-11-05 검토)
const ASSIGNED_VALUE = String.raw`["']?\s*[:=]\s*["'](?<value>[^"'\s]{8,})["']`;
// 이름 뒤에 _낱말이 붙은 꼴(SECRET_KEY · AWS_SECRET_ACCESS_KEY · STRIPE_SECRET_KEY)도 잡는다
const ASSIGNED = new RegExp(String.raw`(?:\b|(?<=_))(?:password|passwd|pwd|secret|api_?key|access_?token|auth_?token|private_?key|client_?secret)(?<suffix>(?:_[A-Za-z0-9]+)*)\b` + ASSIGNED_VALUE, 'i');
// 값이 아니라 그 값을 가리키는 이름(api_key_header = "X-Api-Key", SECRET_NAME = "prod/db", PASSWORD_ENV = "DB_PASS")
const META_SUFFIX = /_(?:header|name|names|env|var|field|label|url|uri|path|file|id|type|prefix|suffix|len|length|hint|regex|pattern|param|placeholder|title|message|msg|text)$/i;
const ASSIGNED_CAMEL = new RegExp(String.raw`(?<=[a-z0-9])(?:Password|Passwd|Secret|ApiKey|AccessToken|AuthToken|PrivateKey|ClientSecret)\b` + ASSIGNED_VALUE);
const PLACEHOLDER = /your|example|sample|changeme|placeholder|dummy|xxx|\*\*\*|<|\$\{|\$\(|process\.env|os\.environ|getenv|import\.meta\.env|secrets\./i;

export const isTestFile = (p) =>
  /(^|[\\/])(tests?|__tests__|spec|fixtures?)[\\/]|\.(test|spec)\.[a-z]+$|_test\.(py|go)$|(^|[\\/])test_[^\\/]+\.py$/i.test(p);

const mask = (s) => (s.length <= 12 ? s.slice(0, 4) + '…' : s.slice(0, 8) + '…' + s.slice(-2));

// 경로 모양 값(pwd 에 담은 /var/www/html, C:\app\data 같은 것)은 비밀번호가 아니다. 구분자가 둘 이상인 것만 경로로 본다.
const PATH_VALUE = /^(?:~|\.{1,2}|[A-Za-z]:)?(?:[\\/][\w.-]+){2,}[\\/]?$/;
// 화면 문구(「Password」「Required」처럼 대문자로 시작하는 영어 낱말 하나)는 값이 아니다
const UI_WORD = /^[A-Z][a-z]+$/;

// 줄마다 본다. allow(줄 번호, 줄) 가 true 인 줄(허용 주석 — 훅 옵션 allowComment 를 켰을 때만 넘어온다)은 그 줄의 모든 검사를 건너뛴다.
// 패턴 하나는 한 번만 알린다(같은 키가 여러 줄에 있어도. 허용한 줄의 것은 세지 않는다).
// 위 패턴·이름이 맞으려면 줄에 꼭 있어야 하는 글자 조각(대소문자 무시 — 넓게 잡는다). 이 조각이 든 줄만 아래에서 본다
// — 10MB 파일을 줄마다 정규식 10개로 보느라 8초 걸리던 것을 한 번 훑기로(2026-11-06 crash 시험). 패턴을 고치면 여기도 고친다.
const MAY_HIT = /-----BEGIN |gh[pousr]_|github_pat_|AKIA|sk-|xox[abprs]-|AIza|eyJ|k_live_|passw|pwd|secret|api_?key|access_?token|auth_?token|private_?key/gi;
// 반환: [{ line, i }] — i 는 몇째 줄(0부터). 줄바꿈은 지나온 만큼만 센다(글 전체를 한 번 훑는 셈).
const candidateLines = (text) => {
  const out = [];
  const re = new RegExp(MAY_HIT.source, MAY_HIT.flags);
  let row = 0;
  let counted = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const start = text.lastIndexOf('\n', m.index) + 1;
    for (let k = text.indexOf('\n', counted); k !== -1 && k < start; k = text.indexOf('\n', k + 1)) row++;
    counted = start;
    const nl = text.indexOf('\n', m.index);
    const end = nl === -1 ? text.length : nl;
    out.push({ line: text.slice(start, end), i: row });
    re.lastIndex = end; // 같은 줄의 나머지 조각은 건너뛴다(한 줄에 수만 번 나와도 한 번만)
  }
  return out;
};

export const findSecrets = (text, filePath = '', allow = null) => {
  const hits = [];
  const seen = new Set();
  const checkAssigned = !isTestFile(filePath);
  for (const { line, i } of candidateLines(String(text))) {
    let ok; // 이 줄을 허용했는지 — 찾은 것이 있을 때만 묻는다
    const allowed = () => (ok ??= !!allow?.(i, line));
    for (const { id, re } of SECRET_PATTERNS) {
      if (seen.has(id)) continue;
      const m = line.match(re);
      if (m && !allowed()) {
        seen.add(id);
        hits.push(`${id}(${mask(m[0])})`);
      }
    }
    if (!checkAssigned) continue;
    const m = line.match(ASSIGNED) || line.match(ASSIGNED_CAMEL);
    const v = m?.groups.value;
    if (m && !META_SUFFIX.test(m.groups.suffix || '') && !PLACEHOLDER.test(v) && !PATH_VALUE.test(v) && !UI_WORD.test(v) && !allowed()) hits.push(`assigned(${mask(m[0])})`);
  }
  return hits;
};

// 저장소에 두면 안 되는 파일. 반환값은 문구 키.
export const forbiddenFile = (filePath, extra = []) => {
  const base = path.basename(filePath).toLowerCase();
  // .env.d.ts·.env.ts 같은 코드 파일은 .env 가 아니다
  if (/^\.env(\..+)?$/.test(base) && !/\.(example|sample|template)$/.test(base) && !/\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|dart|php|cs)$/.test(base)) return 'file.env';
  if (/\.(p8|p12|pfx|pem|key|mobileprovision|keystore|jks)$/.test(base)) return 'file.key';
  // id_rsa·id_rsa_deploy·id_ed25519-work (공개 키 .pub 은 둔다)
  if (/^id_(rsa|ed25519|ecdsa|dsa)(?:[_-][\w.-]*)?$/.test(base) && !base.endsWith('.pub')) return 'file.ssh';
  const norm = filePath.replace(/\\/g, '/');
  if (extra.some((g) => norm.endsWith(g) || norm.includes(`/${g}/`))) return 'file.protected';
  return null;
};
