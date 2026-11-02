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

const ASSIGNED = /\b(?:password|passwd|pwd|secret|api_?key|access_?token|auth_?token|private_?key|client_?secret)\b["']?\s*[:=]\s*["']([^"'\s]{8,})["']/i;
const PLACEHOLDER = /your|example|sample|changeme|placeholder|dummy|xxx|\*\*\*|<|\$\{|\$\(|process\.env|os\.environ|getenv|import\.meta\.env|secrets\./i;
export const ALLOW = /harness:allow\s+secret\s+\S/;

export const isTestFile = (p) =>
  /(^|[\\/])(tests?|__tests__|spec|fixtures?)[\\/]|\.(test|spec)\.[a-z]+$|_test\.(py|go)$|(^|[\\/])test_[^\\/]+\.py$/i.test(p);

const mask = (s) => (s.length <= 12 ? s.slice(0, 4) + '…' : s.slice(0, 8) + '…' + s.slice(-2));

// 경로 모양 값(pwd 에 담은 /var/www/html, C:\app\data 같은 것)은 비밀번호가 아니다. 구분자가 둘 이상인 것만 경로로 본다.
const PATH_VALUE = /^(?:~|\.{1,2}|[A-Za-z]:)?(?:[\\/][\w.-]+){2,}[\\/]?$/;

// 줄마다 본다. `harness:allow secret <이유>` 가 달린 줄은 패턴·대입 검사 모두 건너뛴다.
// 패턴 하나는 한 번만 알린다(같은 키가 여러 줄에 있어도).
export const findSecrets = (text, filePath = '') => {
  const hits = [];
  const seen = new Set();
  const checkAssigned = !isTestFile(filePath);
  for (const line of text.split('\n')) {
    if (ALLOW.test(line)) continue;
    for (const { id, re } of SECRET_PATTERNS) {
      if (seen.has(id)) continue;
      const m = line.match(re);
      if (m) {
        seen.add(id);
        hits.push(`${id}(${mask(m[0])})`);
      }
    }
    if (!checkAssigned) continue;
    const m = line.match(ASSIGNED);
    if (m && !PLACEHOLDER.test(m[1]) && !PATH_VALUE.test(m[1])) hits.push(`assigned(${mask(m[0])})`);
  }
  return hits;
};

// 저장소에 두면 안 되는 파일. 반환값은 문구 키.
export const forbiddenFile = (filePath, extra = []) => {
  const base = path.basename(filePath).toLowerCase();
  if (/^\.env(\..+)?$/.test(base) && !/\.(example|sample|template)$/.test(base)) return 'file.env';
  if (/\.(p8|p12|pfx|pem|key|mobileprovision|keystore|jks)$/.test(base)) return 'file.key';
  if (/^id_(rsa|ed25519|ecdsa|dsa)$/.test(base)) return 'file.ssh';
  const norm = filePath.replace(/\\/g, '/');
  if (extra.some((g) => norm.endsWith(g) || norm.includes(`/${g}/`))) return 'file.protected';
  return null;
};
