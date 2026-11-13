// 저장소 단서 몇 가지(detect.mjs 가 부른다): 로그인이 있는지, 의존성을 범위(^·~)로 두는지, 커밋 훅 관리 도구·형식 도구.
// detect.mjs 가 길어져 나눴다(2026-11-13).
//
// 로그인(kinds 의 auth — 보안 지침 「요청한 사람의 데이터인지 서버에서 검사」 줄이 본다):
//   로그인이 없는 Next.js 쇼핑몰 화면에 그 줄이 들어가던 일(역할극 13 회차 1·2회차 모두 실패 원인, 2026-11-13).
//   단서 둘 중 하나 — 1) 인증 라이브러리 의존성(이름을 통째로, 범위째인 것은 범위로) 2) 소스 경로에 로그인 마디(login·signin·auth …).
//   @supabase/supabase-js·firebase 만으로는 아니다(DB·저장소로만 쓰는 저장소가 흔하다) — 그때는 경로 단서나 @supabase/ssr·auth-helpers 로 안다.
//   서버(backend 종류)는 이 단서 없이도 그 줄을 받는다(rules/security.*.md 의 {{kind:backend|auth}}).
const JS_AUTH = /^(?:next-auth|@auth\/[\w.-]+|@clerk\/[\w.-]+|lucia|@lucia-auth\/[\w.-]+|better-auth|iron-session|passport|passport-[\w.-]+|express-session|cookie-session|@supabase\/ssr|@supabase\/auth-helpers-[\w.-]+|@supabase\/auth-ui-react|@react-native-firebase\/auth|firebaseui|react-firebase-hooks|@auth0\/[\w.-]+|@okta\/[\w.-]+|@kinde-oss\/[\w.-]+|@azure\/msal-[\w.-]+|keycloak-js|oidc-client-ts|@logto\/[\w.-]+|jsonwebtoken|@nestjs\/passport|@nestjs\/jwt|@fastify\/session|@fastify\/jwt|@fastify\/passport)$/;
// Python 의존성 이름(정규화 — stack-scan.mjs pythonDeps)
const PY_AUTH = /^(?:flask-login|flask-jwt-extended|flask-security(?:-too)?|django-allauth|djangorestframework-simplejwt|dj-rest-auth|fastapi-users|authlib|pyjwt|python-jose|social-auth-[\w-]+|python-keycloak)$/;
// go.mod 모듈 경로
const GO_AUTH = /github\.com\/(?:golang-jwt\/jwt|dgrijalva\/jwt-go|gorilla\/sessions|coreos\/go-oidc|markbates\/goth|alexedwards\/scs|lestrrat-go\/jwx)\b|golang\.org\/x\/oauth2\b/;
// build.gradle·pom.xml
const JVM_AUTH = /spring-boot-starter-security|spring-security|spring-boot-starter-oauth2|org\.keycloak/;
// Gemfile
const GEM_AUTH = /^\s*gem\s+["'](?:devise|omniauth[\w-]*|sorcery|rodauth[\w-]*|authlogic|clearance)["']/m;
// 토큰·비밀번호 해시·Amplify(검토 2026-11-13 — jose·bcryptjs 와 LoginForm.tsx 가 있는 Next.js 앱에 로그인 줄이 빠졌다)
const JS_AUTH_MORE = /^(?:jose|bcrypt|bcryptjs|argon2|@node-rs\/argon2|@node-rs\/bcrypt|aws-amplify|@aws-amplify\/[\w.-]+)$/;
// firebase 는 인증을 불러올 때만(DB·저장소로만 쓰는 저장소가 흔하다): firebase/auth·firebase/compat/auth·getAuth(
const FIREBASE_AUTH = /["']firebase\/(?:compat\/)?auth["']|\bgetAuth\s*\(/;
const FIREBASE_FILES = 400;
const FIREBASE_HEAD = 64 * 1024;
const JS_SOURCE = /\.(?:[cm]?[jt]sx?|vue|svelte)$/;
// 경로 마디(폴더 이름 또는 확장자를 뗀 파일 이름)의 낱말 — app/(auth)/login/page.tsx·lib/auth.ts·pages/api/auth/[...nextauth].ts.
// 낙타 표기·-·_ 로 나눈 낱말로도 본다: LoginForm.tsx·SignInButton·sign_up·useAuth(검토 2026-11-13)
// session·sessions 는 홀로는 로그인이 아니다 — SessionTimer·app/sessions·jupyter_session·ChatSession·useSessionStorage 가 걸렸다(검토 2026-11-13).
// session-auth·sessionAuth·authSession 은 auth 낱말로 걸린다
const AUTH_WORDS = new Set(['auth', 'authn', 'authentication', 'login', 'logout', 'signin', 'signup', 'signout', 'oauth', 'sso', 'nextauth']);
// 둘로 나뉘어 쓰는 낱말(LogIn·SignUp) — 대소문자 경계로 나뉜 것만 잇는다. -·_ 로 나뉜 것(log_in_file.py)은 다른 낱말이다.
// sign_up·sign-in 은 흔한 꼴이라 sign 다음의 in·up·out 은 -·_ 를 건너서도 잇는다
const AUTH_PAIRS = new Set(['login', 'logout', 'signin', 'signup', 'signout']);
const SIDE = /(?:^|\/)(?:tests?|__tests__|spec|specs|e2e|mocks?|__mocks__|fixtures?|testdata|examples?|docs?|vendor|third_party|node_modules|stories|\.storybook)\//i;
const stem = (part) => part.replace(/\.[\w.]+$/, '');
const camel = (chunk) => chunk.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/).filter(Boolean).map((w) => w.toLowerCase());
const chunksOf = (part) => stem(part).replace(/[()[\].]/g, ' ').split(/[\s_-]+/).filter(Boolean).map(camel);
const pairIn = (w) => w.some((x, i) => i > 0 && AUTH_PAIRS.has(w[i - 1] + x));
const authPart = (part) => {
  const chunks = chunksOf(part);
  const flat = chunks.flat();
  if (flat.some((x) => AUTH_WORDS.has(x)) || chunks.some(pairIn)) return true;
  return flat.some((x, i) => i > 0 && flat[i - 1] === 'sign' && /^(?:in|up|out)$/.test(x));
};
const authPath = (p) => !SIDE.test(p) && p.split('/').some(authPart);
const firebaseAuth = (files, read) => files.filter((p) => JS_SOURCE.test(p) && !SIDE.test(p)).slice(0, FIREBASE_FILES).some((p) => FIREBASE_AUTH.test(read(p, FIREBASE_HEAD)));

// deps: package.json 의존성 이름 → 판, goMod·jvm·gemfile: 파일 글, py: Python 의존성 이름 Set, files: git 이 아는 소스 경로,
// read(경로, 최대 바이트): 소스 파일 글(firebase 가 인증을 불러오는지 볼 때만 — 없으면 보지 않는다)
// API 경로(app/api/·pages/api/)만으로는 아니다 — 주문 API 하나를 둔 로그인 없는 쇼핑몰 화면(13 회차 shop-web)이 그 꼴이다
export const authSignal = ({ deps = {}, goMod = '', jvm = '', gemfile = '', py = new Set(), files = [], read = null }) =>
  Object.keys(deps).some((n) => JS_AUTH.test(n) || JS_AUTH_MORE.test(n)) || [...py].some((n) => PY_AUTH.test(n)) || GO_AUTH.test(goMod) || JVM_AUTH.test(jvm) || GEM_AUTH.test(gemfile)
  || files.some(authPath) || (!!deps.firebase && !!read && firebaseAuth(files, read));

// 의존성 범위: package.json 의존성 가운데 범위(^1.2·~1.2·>=1·1.x·*·latest)로 둔 것의 수.
// workspace:·file:·link:·git 주소·npm: 별칭은 판이 아니라 세지 않는다.
// 범위가 절반 넘으면(넷 이상일 때) 저장소 관례가 범위다 — 보안 지침의 「정확한 버전으로」 줄과 의존성 고정 훅을 기본에서 뺀다
// (package.json 이 모두 ^ 인 저장소에 그 줄이 들어가던 일 — 역할극 13 회차 참고, 2026-11-13)
// pnpm catalog:(판은 pnpm-workspace.yaml 에 따로)도 판이 아니다. =1.2.3 은 정확한 판이다(검토 2026-11-13)
const NOT_VERSION = /^(?:workspace:|catalog:|file:|link:|portal:|patch:|npm:|git[+:]|https?:|github:|[\w.-]+\/[\w.-]+(?:#.*)?$)/;
const RANGE = /^[\^~<>=*]|(?:^|\.)[xX*](?:\.|$)|\s-\s|\|\||^latest$|^next$/;
export const RANGE_MIN = 4;
export const RANGE_SHARE = 0.5;
export const depRanges = (pkgs) => {
  let total = 0;
  let ranged = 0;
  for (const p of pkgs) {
    for (const v of Object.values({ ...(p.dependencies || {}), ...(p.devDependencies || {}) })) {
      const s = String(v).trim().replace(/^=\s*(?=v?\d)/, '');
      if (!s || NOT_VERSION.test(s)) continue;
      total++;
      if (RANGE.test(s)) ranged++;
    }
  }
  return { total, ranged };
};
// 넷 미만이면 비율 대신: 하나라도 범위면 범위 관례, 모두 정확하면 고정(검토 2026-11-13 — 셋이 모두 ^ 인데 「정확한 버전」 줄이 들어갔다)
export const rangesWide = (r) => !!r && r.total > 0 && (r.total < RANGE_MIN ? r.ranged > 0 : r.ranged / r.total > RANGE_SHARE);

// 커밋 훅 관리 도구와 형식 도구(스택 이름 — catalog/combos.json 의 setup-pre-commit 조건이 본다).
// 앱 종류가 아니라 도구라 thin(빈 저장소) 판정과 Node.js 자리 채우기에서는 세지 않는다(detect.mjs TOOL_STACKS)
// SwiftLint(.swiftlint.yml — 역할극 16 회차): 검사 명령 make lint 가 없을 때 swiftlint lint 를 낸다(commands.mjs)
export const TOOL_STACKS = ['Prettier', 'lint-staged', 'Husky', 'Lefthook', 'simple-git-hooks', 'pre-commit', 'SwiftLint'];
const PRETTIER_FILES = ['.prettierrc', '.prettierrc.json', '.prettierrc.yaml', '.prettierrc.yml', '.prettierrc.js', '.prettierrc.cjs', '.prettierrc.mjs', 'prettier.config.js', 'prettier.config.cjs', 'prettier.config.mjs'];
const LINT_STAGED_FILES = ['.lintstagedrc', '.lintstagedrc.json', '.lintstagedrc.js', '.lintstagedrc.cjs', '.lintstagedrc.mjs', 'lint-staged.config.js', 'lint-staged.config.mjs'];
// has: 저장소 맨 위 파일·폴더가 있는지, deps: 의존성, pkg: 맨 위 package.json(설정 키 prettier·lint-staged·simple-git-hooks)
export const toolStacks = (has, deps = {}, pkg = null) => {
  const key = (k) => !!pkg && typeof pkg === 'object' && k in pkg;
  const out = [];
  if (deps.prettier || key('prettier') || PRETTIER_FILES.some(has)) out.push('Prettier');
  if (deps['lint-staged'] || key('lint-staged') || LINT_STAGED_FILES.some(has)) out.push('lint-staged');
  if (deps.husky || has('.husky')) out.push('Husky');
  if (deps.lefthook || deps['@evilmartians/lefthook'] || ['lefthook.yml', 'lefthook.yaml', '.lefthook.yml'].some(has)) out.push('Lefthook');
  if (deps['simple-git-hooks'] || key('simple-git-hooks') || has('.simple-git-hooks.json')) out.push('simple-git-hooks');
  if (has('.pre-commit-config.yaml') || has('.pre-commit-config.yml')) out.push('pre-commit');
  if (has('.swiftlint.yml') || has('.swiftlint.yaml')) out.push('SwiftLint');
  return out;
};
