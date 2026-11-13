// 비밀값 모양 찾기. 패턴은 자기 자신과 맞지 않게 적는다(이 파일을 고칠 때 비밀값 훅에 걸리지 않게).
import path from 'node:path';
import { isGlob, globMatch } from './path-glob.mjs';

export const SECRET_PATTERNS = [
  { id: 'private-key', re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/ },
  { id: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,})\b/ },
  { id: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'api-key-sk', re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}\b/ },
  // Slack 봇·사용자·앱(Socket Mode xapp-)·설정 토큰(xoxe-) — 역할극 4 회차에서 xapp- 를 놓쳤다(2026-11-11)
  { id: 'slack-token', re: /\b(?:xox[abprse]|xapp)-[A-Za-z0-9-]{10,}\b/ },
  // Voyage AI 임베딩 키(pa-), wandb.login(key="…") 에 바로 넣은 40자리 키
  // pa- 뒤에 대문자와 숫자가 함께 섞인 32~64자만(블로그 경로·k8s 이름 같은 소문자 낱말 이음은 아님 — 검토 2026-11-11)
  { id: 'voyage-key', re: /\bpa-(?=[A-Za-z0-9_-]{0,64}[A-Z])(?=[A-Za-z0-9_-]{0,64}\d)[A-Za-z0-9_-]{32,64}(?![A-Za-z0-9_-])/ },
  // 괄호 안을 200자로 묶는다(한 줄에 wandb.login( 이 거듭되면 줄 길이의 제곱 시간이 걸렸다)
  { id: 'wandb-key', re: /\bwandb\.login\s*\([^)\n]{0,200}\bkey\s*=\s*["'][0-9a-f]{40}["']/ },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { id: 'stripe-key', re: /\b[rs]k_live_[A-Za-z0-9]{20,}\b/ },
];
// 브라우저 번들로 나가는 공개 접두(NEXT_PUBLIC_·VITE_·REACT_APP_·EXPO_PUBLIC_·NUXT_PUBLIC_·PUBLIC_)에 비밀 이름을 붙인 것 — 값이 없어도
// 그 이름을 쓰는 순간 클라이언트에 실린다(역할극 13 회차: NEXT_PUBLIC_PAYMENT_SECRET 이 지나갔다, 2026-11-12).
// 이름이 비밀 낱말(+ _KEY·_TOKEN)로 끝날 때만 — REACT_APP_PASSWORD_RESET_URL·VITE_PASSWORD_MIN_LENGTH 같은 설정 이름은 아니다(검토 2026-11-12).
// 시험 파일·문서(.md 등)는 보지 않는다(「이렇게 이름 짓지 마세요」 문장)
const PUBLIC_SECRET_NAME = /\b(?:NEXT_PUBLIC|VITE|REACT_APP|EXPO_PUBLIC|NUXT_PUBLIC|GATSBY|PUBLIC)_(?:[A-Z0-9]+_){0,8}(?:SECRET|PASSWORD|PASSWD|PRIVATE_KEY|SERVICE_ROLE)(?:_(?:KEY|TOKEN))?\b/;
const PROSE_FILE = /\.(?:md|mdx|markdown|txt|rst|adoc)$/i;

// 이름 앞에 다른 낱말이 붙은 꼴(DB_PASSWORD · OPENAI_API_KEY · dbPassword)도 잡는다 — 앞에 \b 만 두면 _ 와 낙타 표기를 놓쳤다(2026-11-05 검토)
// os.environ["WANDB_API_KEY"] = "…" · process.env["X_TOKEN"] = "…" 처럼 이름 뒤에 "] 가 붙은 꼴도(역할극 3 회차)
// Go 의 := 도 대입이다(역할극 14 회차: dbPassword := "…" 가 지나갔다, 2026-11-12)
const ASSIGNED_VALUE = String.raw`["']?\]?\s*(?::=|[:=])\s*["'](?<value>[^"'\s]{8,})["']`;
// 이름 뒤에 _낱말이 붙은 꼴(SECRET_KEY · AWS_SECRET_ACCESS_KEY · STRIPE_SECRET_KEY)도 잡는다.
// 뒤 낱말은 8개·한 낱말 64자까지 — 묶지 않으면 secret_secret_…(긴 줄)에서 시작점마다 끝까지 훑어 제곱 시간이 걸렸다(검토 2026-11-11)
const ASSIGNED = new RegExp(String.raw`(?:\b|(?<=_))(?:password|passwd|pwd|secret|api_?key|api_?token|access_?token|auth_?token|private_?key|client_?secret)(?<suffix>(?:_[A-Za-z0-9]{1,64}){0,8})\b` + ASSIGNED_VALUE, 'i');
// 값이 아니라 그 값을 가리키는 이름(api_key_header = "X-Api-Key", SECRET_NAME = "prod/db", PASSWORD_ENV = "DB_PASS")
const META_SUFFIX = /_(?:header|name|names|env|var|field|label|url|uri|path|file|id|type|prefix|suffix|len|length|hint|regex|pattern|param|placeholder|title|message|msg|text)$/i;
const ASSIGNED_CAMEL = new RegExp(String.raw`(?<=[a-z0-9])(?:Password|Passwd|Secret|ApiKey|ApiToken|AccessToken|AuthToken|PrivateKey|ClientSecret)\b` + ASSIGNED_VALUE);
// 대문자 상수 이름이 _TOKEN·_KEY 로 끝나고 값이 무작위 글자처럼 보일 때(SIEM_API_TOKEN·REPUTATION_FEED_KEY — 역할극 12 회차, 2026-11-11).
// CACHE_KEY = "user:profile" 같은 이름표 값은 아니다 — 16자 넘고 영문·숫자가 섞이고 : · 공백이 없을 때만.
// 정규식은 _TOKEN·_KEY 자리에서 시작하고 이름은 거기서 뒤로 걷는다(128자까지) — 이름 앞에서 맞추면 A_B_B_…_KEY 같은 긴 줄에서
// 시작점마다 끝까지 훑어 제곱 시간이 걸렸다(400KB 한 줄에 2분 넘게 — 검토 2026-11-11).
const UPPER_TAIL = /_(?:TOKEN|KEY)["']?\]?[ \t]*(?::=|[:=])[ \t]*["']([A-Za-z0-9_\-+/=.]{16,1024})["']/g;
const UPPER_NAME = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
const NAME_MAX = 128;
// 공개용 키·이름표를 가리키는 이름 낱말(NEXT_PUBLIC_*·STRIPE_PUBLISHABLE_KEY·RECAPTCHA_SITE_KEY·ALGOLIA_SEARCH_KEY·LOCALSTORAGE_KEY·
// FEATURE_FLAG_KEY·SORT_KEY·CSRF_COOKIE_KEY·S3_KEY 같은 객체 경로 — 검토 2026-11-11)
// STORAGE·PRIMARY·COOKIE·SEARCH·ROUTING 은 진짜 비밀 이름에도 들어가 뺐다(AZURE_STORAGE_KEY·COSMOS_PRIMARY_KEY·SESSION_COOKIE_KEY·
// SEARCH_ADMIN_KEY·PAGERDUTY_ROUTING_KEY — 검토 2026-11-11). 그 꼴의 이름표 값은 labelValue 가 거른다. 공개 검색 키는 SEARCH_ONLY·SEARCH_API 만
const LABEL_NAME = /(?:^|_)(?:PUBLIC|PUBLISHABLE|SITE|SEARCH_ONLY|LOCALSTORAGE|SESSIONSTORAGE|FLAG|SORT|CACHE|PATH|S3|OBJECT|BUCKET|PARTITION|FOREIGN|I18N|LOCALE)(?:_|$)|^ALGOLIA_SEARCH$/;
const upperAssigned = (line) => {
  UPPER_TAIL.lastIndex = 0;
  for (let m = UPPER_TAIL.exec(line); m; m = UPPER_TAIL.exec(line)) {
    let s = m.index;
    while (s > 0 && m.index - s < NAME_MAX && /[A-Z0-9_]/.test(line[s - 1])) s--;
    if (s > 0 && /[A-Za-z0-9_]/.test(line[s - 1])) continue; // 128자 넘는 이름이거나 소문자에 붙은 이름(myAPP_KEY)
    const name = line.slice(s, m.index) + m[0].slice(0, m[0].search(/["'\]\s:=]/));
    if (!UPPER_NAME.test(name) || LABEL_NAME.test(name.replace(/_(?:TOKEN|KEY)$/, ''))) continue;
    if (randomish(m[1]) && !labelValue(m[1])) return { 0: line.slice(s, m.index) + m[0], groups: { name, value: m[1] } };
  }
  return null;
};
// 낙타 이름이 Key·Token 으로 끝나고 값이 무작위 글자처럼 보일 때(webhookKey := "…" — 역할극 14 회차, 2026-11-13).
// 대문자 상수보다 좁게 본다: 값 24자 이상, 이름표를 가리키는 마디(cacheKey·sortKey·publicKey·primaryKey·pageToken·i18nKey …)는 아님.
// upperAssigned 처럼 Key·Token 자리에서 시작하고 이름은 뒤로 걷는다(긴 줄에서 제곱 시간이 걸리지 않게)
const CAMEL_TAIL = /(?<=[a-z0-9])(?:Key|Token)["']?\]?[ \t]*(?::=|[:=])[ \t]*["']([A-Za-z0-9_\-+/=.]{24,1024})["']/g;
const CAMEL_NAME = /^[A-Za-z][a-z0-9]*(?:[A-Z][a-z0-9]*)*(?:Key|Token)$/;
// 이름의 마디(낙타 혹) 가운데 하나라도 이름표 낱말이면 이름표로 본다(storageKey·nextPageToken·cacheKeyPrefix…)
const CAMEL_LABEL = new Set(['public', 'publishable', 'site', 'cache', 'sort', 'storage', 'localstorage', 'session', 'primary', 'foreign', 'partition', 'flag', 'feature',
  'path', 'object', 'bucket', 's3', 'i18n', 'locale', 'translation', 'page', 'cursor', 'continuation', 'map', 'lookup', 'query', 'field', 'header',
  'param', 'route', 'event', 'message', 'metric', 'idempotency', 'dedup', 'group', 'index', 'row', 'column', 'table', 'search', 'shortcut', 'hotkey', 'react']);
const labelName = (name) => name.split(/(?=[A-Z])/).slice(0, -1).some((h) => CAMEL_LABEL.has(h.toLowerCase()));
const camelAssigned = (line) => {
  CAMEL_TAIL.lastIndex = 0;
  for (let m = CAMEL_TAIL.exec(line); m; m = CAMEL_TAIL.exec(line)) {
    let s = m.index;
    while (s > 0 && m.index - s < NAME_MAX && /[A-Za-z0-9]/.test(line[s - 1])) s--;
    if (s > 0 && /[A-Za-z0-9_$]/.test(line[s - 1])) continue;
    const name = line.slice(s, m.index) + m[0].slice(0, m[0].search(/["'\]\s:=]/));
    if (!CAMEL_NAME.test(name) || labelName(name)) continue;
    if (randomish(m[1]) && !labelValue(m[1]) && !PLACEHOLDER.test(m[1])) return { 0: line.slice(s, m.index) + m[0], groups: { name, value: m[1] } };
  }
  return null;
};
// 숫자가 셋 넘거나 대소문자가 섞이고, 점·밑줄로 이은 소문자 낱말(settings.profile.title2)이 아닐 때
const randomish = (v) => /[A-Za-z]/.test(v) && ((v.match(/[0-9]/g) || []).length >= 3 || (/[A-Z]/.test(v) && /[a-z]/.test(v) && /[0-9]/.test(v))) && !/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/.test(v);
// 키가 아닌 값: / 가 든 경로(uploads/2024/report.pdf), 공개 키 접두(pk_·pk. — Stripe·Mapbox), 낱말을 이은 낙타 표기 + 짧은 숫자 꼬리
// (myAppAuthStateV2·enableNewCheckout2024 — 3자 못 되는 마디는 하나까지. 무작위 글자는 마디가 짧고 숫자가 사이에 낀다)
const labelValue = (v) => {
  // / 가 든 값 가운데 낱말을 / 로 이은 경로 꼴만(base64 키도 / 를 품는다 — 절반을 놓치던 회귀, 검토 2026-11-11)
  if (looksPath(v) || /^pk[_.]/.test(v)) return true;
  // - · _ 로 이은 낱말·숫자 마디(XSRF-TOKEN-2024-v1) — 마디마다 글자만·숫자만·v숫자. 무작위 base64url 은 마디 안에 글자·숫자가 섞인다
  const parts = v.split(/[-_]/);
  if (parts.length >= 3 && parts.every((p) => /^(?:[A-Za-z]{2,}|\d+|v\d+)$/.test(p))) return true;
  // . · _ 로 이은 낙타 낱말 + 짧은 숫자 꼬리(appSettingsV3_2024 · orders.Created.v2024 — 검토 2026-11-11). 마디마다 낱말 같아야 한다
  const wordish = (p) => /^(?:\d+|v\d+)$/i.test(p) || (/^[A-Za-z]+\d{0,4}$/.test(p) && p.replace(/\d+$/, '').split(/(?=[A-Z])/).filter((h) => h.length < 3).length <= 1);
  const dotted = v.split(/[._-]/);
  if (dotted.length >= 2 && dotted.every(wordish) && dotted.some((p) => /[a-z]{3,}/.test(p))) return true;
  const m = /^([A-Za-z]+?)(\d{0,4})$/.exec(v);
  if (!m || !/[a-z]/.test(m[1])) return false;
  const humps = m[1].split(/(?=[A-Z])/);
  return humps.length >= 2 && humps.filter((h) => h.length < 3).length <= 1;
};
// 접속 주소 속 비밀번호(postgres://app:비번@db…) — 무작위로 보이는 것만(postgres:postgres·user:password 같은 개발 기본값은 아님).
// $ 가 든 것(${DB_PASS}·$PGPASS)은 참조다(역할극 14 회차, 2026-11-12)
// 이 PC 주소(localhost·127.*·0.0.0.0·host.docker.internal)와 아이디가 든 비밀번호(postgres:postgres123)는 개발 기본값으로 본다(검토 2026-11-12)
const URL_PASSWORD = /\b[a-z][a-z0-9+.-]{1,20}:\/\/([^\s:/@"'$]{0,64}):([^\s@/"'$]{8,256})@([^\s/:?#"'$]{1,253})/i;
const LOCAL_HOST = /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|host\.docker\.internal|\[::1\])$/i;
// 명령줄 비밀번호 훅(rules/shell.mjs password-cli)도 같은 기준: 이 PC 주소면 개발용, 점 없는 호스트(docker compose 서비스 db·postgres)는
// 아이디가 든 개발 기본값(postgres:postgres)일 때만 — 밖에 닿는 주소의 값은 그대로 막는다(검토 2026-11-13)
export const devUrlLogin = (user, pass, host) => LOCAL_HOST.test(String(host || ''))
  || (!!user && !String(host || '').includes('.') && String(host || '').length > 0 && pass.toLowerCase().includes(user.toLowerCase()));
const urlPassword = (line) => {
  const u = URL_PASSWORD.exec(line);
  if (!u || LOCAL_HOST.test(u[3]) || !randomish(u[2]) || PLACEHOLDER.test(u[2])) return null;
  return u[1] && u[2].toLowerCase().includes(u[1].toLowerCase()) ? null : u[2];
};
// 아주 긴 값은 경로로 보지 않는다(정규식이 4MB 값에서 스택을 넘겨 훅이 통과하던 일 — 검토 2026-11-12)
const pathValue = (v) => v.length <= 4096 && PATH_VALUE.test(v);
const PLACEHOLDER = /your|example|sample|changeme|placeholder|dummy|xxx|\*\*\*|<|\$\{|\$\(|process\.env|os\.environ|getenv|import\.meta\.env|secrets\./i;

export const isTestFile = (p) =>
  /(^|[\\/])(tests?|__tests__|spec|fixtures?)[\\/]|\.(test|spec)\.[a-z]+$|_test\.(py|go)$|(^|[\\/])test_[^\\/]+\.py$/i.test(p);

const mask = (s) => (s.length <= 12 ? s.slice(0, 4) + '…' : s.slice(0, 8) + '…' + s.slice(-2));

// 경로 모양 값(pwd 에 담은 /var/www/html, C:\app\data 같은 것)은 비밀번호가 아니다. 구분자가 둘 이상인 것만 경로로 본다.
// 경로 꼴: / 로 나눈 마디가 모두 낱말·숫자·파일 이름처럼 보일 때(uploads/2024/11/report.pdf, Users/John/app.log).
// 무작위 base64 는 한 마디 안에 대·소문자와 숫자가 섞여 여기 걸리지 않는다(패딩·+ 없는 base64 의 22% 를 놓치던 일 — 검토 2026-11-11)
const PATH_SEG = /^(?:[A-Z]?[a-z0-9._-]+|[A-Z0-9._-]+)$/;
const looksPath = (v) => {
  const segs = String(v).replace(/^(?:~|\.{1,2}|[A-Za-z]:)/, '').split(/[\\/]/).filter(Boolean);
  return segs.length >= 2 && !/[+=]/.test(v) && segs.every((s) => PATH_SEG.test(s));
};
// 앞에 / · ~ · ./ · 드라이브 글자가 붙은 값은 경로가 분명하다 — 마디 글꼴을 보지 않는다(/opt/MyApp/bin·C:/Users/John/AppData 를 비밀값으로 잡던 회귀, 검토 2026-11-11).
// 마디 글꼴 검사(looksPath)는 앞 기호 없는 값(labelValue — uploads/2024/report.pdf)에만
// 구분자가 겹친 꼴(코드 문자열의 "C:\\app\\data", UNC \\server\share, /opt//data)도 경로다(검토 2026-11-11)
const PATH_VALUE = /^(?:~|\.{1,2}|[A-Za-z]:)?(?:[\\/]+[\w.-]+){2,}[\\/]*$/;
// 화면 문구(「Password」「Required」처럼 대문자로 시작하는 영어 낱말 하나)는 값이 아니다
const UI_WORD = /^[A-Z][a-z]+$/;

// 설정 파일(application.yml·.properties·.toml·.ini·.conf)의 따옴표 없는 값: `password: 값`, `spring.datasource.password=값`, `jwt.secret: 값`
// — 따옴표로만 찾아 Spring 설정을 놓쳤다(역할극 8 회차, 2026-11-11). 좁게 본다: 이름이 비밀값 낱말로 끝나고, 값이 띄어쓰기 없는 8자 이상이며
// 숫자나 기호가 섞여야 한다(`password: required` 같은 낱말은 아님). 자리표시자·환경 변수 참조·암호화 값·주석 줄은 뺀다. 예시 파일·시험 폴더도.
const CONFIG_FILE = /\.(?:ya?ml|properties|toml|ini|conf)$/i;
const CONFIG_EXAMPLE = /(?:^|[._-])(?:example|sample|template)s?(?:[._-]|$)/i;
export const configTarget = (p) => CONFIG_FILE.test(p) && !CONFIG_EXAMPLE.test(path.basename(p)) && !isTestFile(p);
// 이름 = 값 · 이름: 값 (YAML 목록 「- 이름: 값」, 따옴표 친 이름도). 정규식은 줄 맨 앞에서 한 번만 맞춘다.
const CONFIG_LINE = /^\s*(?:-\s+)?["']?([\w.-]{1,200})["']?\s*[:=]\s*(.*)$/;
const CONFIG_KEY = /(?:password|passwd|secret|token|api[._-]?key|private[._-]?key|access[._-]?key|secret[._-]?key)$/i;
// 비밀값의 이름을 가리키는 키(Helm 의 existingSecret: my-db-secret, secret.name·secret-ref.token) — 값이 이름이다
const CONFIG_META_KEY = /existing|(?:^|[._-])(?:ref|name)[._-]/i;
// 값이 아니라 가리키는 것: ${…}·{{…}}·<…>·%(…)s·$VAR·ENV[…]·env(…)·ENC(…)(암호화)·{cipher}·!태그·@메이븐 치환@·*별칭·&앵커, vault:·file: 같은 참조
const CONFIG_REF = /^(?:[$<{%!@*&[]|ENV\[|env\(|ENC\(|(?:vault|file|env|secret|ssm|op|keyvault|classpath):)/i;
const configHit = (line) => {
  const m = CONFIG_LINE.exec(line);
  if (!m || !CONFIG_KEY.test(m[1]) || CONFIG_META_KEY.test(m[1])) return null;
  // 값은 첫 낱말, 그 뒤는 줄 끝 주석(# · ;)만 — 띄어쓰기가 든 글(설명·번역 문구)은 값이 아니다.
  // 정규식 대신 첫 띄어쓰기 자리로 자른다(긴 띄어쓰기 줄에서 자리마다 되훑지 않게)
  const rest = m[2].trim();
  const sp = rest.search(/\s/);
  const v = sp === -1 ? rest : rest.slice(0, sp);
  if (sp !== -1 && !/^[#;]/.test(rest.slice(sp).trimStart())) return null;
  // ASCII 글자만(번역 문구는 아님)
  if (v.length < 8 || !/^[\x21-\x7e]+$/.test(v) || /^["']/.test(v) || CONFIG_REF.test(v) || PLACEHOLDER.test(v) || pathValue(v)) return null;
  // 숫자나 기호가 하나도 없는 낱말(required·disabled)은 값으로 보지 않는다
  return /[^A-Za-z]/.test(v) ? `${m[1]}: ${v}` : null;
};
const COMMENT_LINE = /^\s*(?:#|;|!|\/\/)/;

// 줄마다 본다. allow(줄 번호, 줄) 가 true 인 줄(허용 주석 — 훅 옵션 allowComment 를 켰을 때만 넘어온다)은 그 줄의 모든 검사를 건너뛴다.
// 패턴 하나는 한 번만 알린다(같은 키가 여러 줄에 있어도. 허용한 줄의 것은 세지 않는다).
// 위 패턴·이름이 맞으려면 줄에 꼭 있어야 하는 글자 조각(대소문자 무시 — 넓게 잡는다). 이 조각이 든 줄만 아래에서 본다
// — 10MB 파일을 줄마다 정규식 10개로 보느라 8초 걸리던 것을 한 번 훑기로(2026-11-06 crash 시험). 패턴을 고치면 여기도 고친다.
// 띄어쓰기 묶음 둘을 바로 잇지 않는다(「aKey」+ 띄어쓰기 30만 자가 제곱 시간으로 84초 걸려 훅 시간을 넘겼다 — 검토 2026-11-13). 둘 사이에 :·= 가 꼭 있게.
const MAY_HIT = /-----BEGIN |gh[pousr]_|github_pat_|AKIA|sk-|xox[abprse]-|xapp-|\bpa-[A-Za-z0-9_-]{32}|wandb\.login|AIza|eyJ|k_live_|passw|pwd|secret|api_?key|access_?token|auth_?token|private_?key|_token\b|_key\b|apitoken|service_role|[a-z0-9](?:key|token)["'\]]?[ \t]*(?:(?::?=|:)[ \t]*)?["'][A-Za-z0-9_+/=.-]{24}|:\/\/[^\s:/@"'$]{0,64}:[^\s@/"'$]{8,256}@/gi;
// 반환: [{ line, i }] — i 는 몇째 줄(0부터). 줄바꿈은 지나온 만큼만 센다(글 전체를 한 번 훑는 셈).
// 설정 파일은 token·api-key·private-key(이음표) 이름도 본다
const MAY_HIT_CONFIG = new RegExp(`${MAY_HIT.source}|token|api[.-]key|private[.-]key|access[._-]?key`, 'gi');
const candidateLines = (text, may = MAY_HIT) => {
  const out = [];
  const re = new RegExp(may.source, may.flags);
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
  const prose = PROSE_FILE.test(String(filePath));
  const config = configTarget(String(filePath));
  for (const { line, i } of candidateLines(String(text), config ? MAY_HIT_CONFIG : MAY_HIT)) {
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
    if (!prose && !seen.has('public-secret-name')) {
      const p = line.match(PUBLIC_SECRET_NAME);
      if (p && !allowed()) seen.add('public-secret-name'), hits.push(`public-secret-name(${p[0]})`);
    }
    const m = line.match(ASSIGNED) || line.match(ASSIGNED_CAMEL) || upperAssigned(line) || camelAssigned(line);
    const v = m?.groups.value;
    const u = m || prose ? null : urlPassword(line);
    if (m && !META_SUFFIX.test(m.groups.suffix || '') && !PLACEHOLDER.test(v) && !pathValue(v) && !UI_WORD.test(v) && !allowed()) hits.push(`assigned(${mask(m[0])})`);
    else if (u && !allowed()) hits.push(`url-password(${mask(u)})`);
    else if (config && !m && !COMMENT_LINE.test(line)) {
      const c = configHit(line.replace(/\r$/, ''));
      if (c && !allowed()) hits.push(`config(${mask(c)})`);
    }
  }
  return hits;
};

// 저장소에 두면 안 되는 파일. 반환값은 문구 키.
export const forbiddenFile = (filePath, extra = []) => {
  const base = path.basename(filePath).toLowerCase();
  // .env.d.ts·.env.ts 같은 코드 파일은 .env 가 아니다
  if (/^\.env(\..+)?$/.test(base) && !/\.(example|sample|template)$/.test(base) && !/\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|dart|php|cs)$/.test(base)) return 'file.env';
  // .provisionprofile: iOS 프로필(역할극 16 회차 — git add -f 로 커밋됐다, 2026-11-13).
  // .cer·.certSigningRequest 는 공개 인증서·요청이라 넣지 않는다(SSL 고정용 .cer 커밋까지 막았다 — 검토 2026-11-13). 무시 파일을 억지로 올린 것은 rules/commit.mjs 가 막는다
  if (/\.(p8|p12|pfx|pem|key|mobileprovision|provisionprofile|keystore|jks)$/.test(base)) return 'file.key';
  // id_rsa·id_rsa_deploy·id_ed25519-work (공개 키 .pub 은 둔다)
  if (/^id_(rsa|ed25519|ecdsa|dsa)(?:[_-][\w.-]*)?$/.test(base) && !base.endsWith('.pub')) return 'file.ssh';
  if (extra.some((g) => protectedBy(filePath, g))) return 'file.protected';
  return null;
};

// 사용자가 적은 보호 경로 하나에 걸리는지. 이름(config/prod.json, data/raw/)은 경로 낱말 경계로, 점으로 시작하는 꼴(.hdf5)은 끝 글자로 본다.
// 앞 ./·뒤 / 와 \ 는 고르게 맞춘다 — 「data/raw/」 로 적으면 하나도 안 막던 것(역할극 4 회차, 2026-11-11).
const slash = (p) => String(p).replace(/\\/g, '/').replace(/\/{2,}/g, '/');
// 끝이 / 인 폴더(data/)는 프로젝트 맨 위 기준 — 소스 폴더 pick_policy/data/ 까지 막던 일(역할극 3 회차 2차, 2026-11-11).
// filePath 는 프로젝트 기준 상대 경로로 받는다(부르는 쪽이 맞춤). 절대 경로가 오면 예전처럼 어디서든 맞춘다.
// Windows·macOS 는 파일 이름의 대소문자를 가리지 않는다(DATA\a.csv 가 data/ 에 안 걸리던 일 — 검토 2026-11-11)
const FOLD = process.platform === 'win32' || process.platform === 'darwin';
export const foldCase = (x) => (FOLD ? x.toLowerCase() : x);
const EXAMPLE_NAME = /\.(?:example|sample|template)(?:\.|$)/i;
export const protectedBy = (filePath, g) => {
  const raw = foldCase(slash(g).trim());
  let want = raw.replace(/^\.\//, '').replace(/\/+$/, '');
  if (!want) return false;
  const rel = foldCase(slash(filePath).replace(/^\.\//, ''));
  // 글롭(*.xcconfig)·끝 글자 꼴(.xcconfig)은 예시 파일(Secrets.example.xcconfig·x.sample.json·config.example)을 빼고 본다 — .env 와 같은 예외
  // (역할극 16 회차 다시: 예시 파일을 만들지 못했다, 2026-11-13). 이름을 그대로 적은 파일은 예시 꼴이어도 막는다
  // 적은 꼴 자체가 예시 이름이면(*.example.xcconfig) 빼지 않는다
  const example = EXAMPLE_NAME.test(rel.split('/').pop() || '') && !EXAMPLE_NAME.test(raw);
  // 글롭(* · **)은 .gitignore 꼴로(lib/path-glob.mjs) — 끝 글자로만 맞춰 terraform.tfstate.backup·kubeconfig-prod 를 못 지켰다(역할극 15 회차, 2026-11-12)
  if (isGlob(raw)) return !example && globMatch(raw, rel, /^(?:\/|[A-Za-z]:)/.test(rel));
  const absRel = /^(?:\/|[A-Za-z]:)/.test(rel);
  // 앞이 / 인 이름(/kubeconfig·/secrets.yml·/data/)은 .gitignore 처럼 맨 위 기준 — 아무것도 막지 못하던 일(2026-11-12). 절대 경로가 오면 아래처럼 어디서든
  const lead = raw.startsWith('/');
  if (lead) want = want.replace(/^\/+/, '');
  if (!want) return false;
  if ((raw.endsWith('/') || lead) && !absRel) return rel.replace(/\/+$/, '') === want || rel.startsWith(`${want}/`);
  const norm = `/${rel.replace(/\/+$/, '')}`;
  if (/^\.[^/]+$/.test(want) && norm.toLowerCase().endsWith(want.toLowerCase())) return !example || norm.endsWith(`/${want}`);
  return norm.endsWith(`/${want}`) || norm.includes(`/${want}/`);
};
