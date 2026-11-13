// 역할극 13(Next.js 화면, 로그인 없음)·14(Go 결제 서버, GitLab)·15(Terraform·Helm·Argo CD) 회차 판정에서 나온 추천 쪽 고칠 점(2026-11-13).
// 로그인 줄 조건, 「정확한 버전」 줄과 의존성 고정 훅, setup-pre-commit 조건, 원격 묻기 이유 줄, 인프라 지침, 저장소 명령, 점검 도구의 셸 변수.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detect } from '../detect.mjs';
import { loadAll, recommend, fitOff, remoteSay } from '../lib/catalog.mjs';
import { ruleTexts } from '../lib/claude-md.mjs';
import { detectCommands } from '../lib/commands.mjs';
import { depRanges, rangesWide, authSignal } from '../lib/signals.mjs';
import { remoteCommand } from '../../hooks/lib/remote-cmd.mjs';
import { runWords } from '../../hooks/lib/run-prefix.mjs';
import { audit, expandShellVars } from '../dev/roleplay-audit.mjs';
import { tmpDir, writeFiles, gitInit, gitIn, ruleLine } from './helpers.mjs';

const all = loadAll();
const made = [];
const repo = (files) => {
  const d = gitInit(tmpDir('harness-r13-'), { branch: 'main' });
  made.push(d);
  writeFiles(d, files);
  gitIn(d)('add', '-A');
  return d;
};
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const textsOf = (det, lang = 'ko') => ruleTexts({ ...recommend(all, det, lang), lang });
const LOGIN = (lang) => ruleLine('security', lang, 'kind:backend|auth').replace(/\s*\{\{[^}]*\}\}/g, '').trim();
const has = (text, line) => (text || '').includes(line);

// 검토 2026-11-13: session 홀로·-·_ 로 나뉜 log_in 은 로그인 단서가 아니다. auth 와 붙은 session·낙타 표기 LogIn 은 단서다
test('로그인 경로 낱말: session 홀로와 log_in_file 은 아니고, LoginForm·SignIn·useAuth·OAuth·sessionAuth 는 맞다', () => {
  const auth = (f) => authSignal({ files: [f] });
  for (const f of ['components/SessionTimer.tsx', 'app/sessions/page.tsx', 'notebooks/jupyter_session.py', 'components/ChatSession.tsx', 'hooks/useSessionStorage.ts', 'scripts/log_in_file.py', 'lib/session-store.ts']) {
    assert.ok(!auth(f), f);
  }
  for (const f of ['components/LoginForm.tsx', 'components/SignIn.tsx', 'hooks/useAuth.ts', 'components/OAuth.tsx', 'lib/session-auth.ts', 'lib/sessionAuth.ts', 'lib/authSession.ts', 'components/LogIn.tsx', 'app/login/page.tsx', 'app/sign_up/page.tsx', 'app/sign-in/page.tsx']) {
    assert.ok(auth(f), f);
  }
});

// 13 회차 shop-web 과 같은 꼴: Next.js 화면, 주문 API 는 다른 팀, 쿠키는 언어 쿠키뿐(middleware.ts)
const SHOP = {
  'package.json': { name: 'shop-web', private: true, scripts: { test: 'vitest run', e2e: 'playwright test' },
    dependencies: { next: '15.0.3', react: '19.0.0', zod: '^3.23.8', clsx: '^2.1.1' }, devDependencies: { typescript: '^5.6.3', vitest: '^2.1.4', '@playwright/test': '^1.48.2', eslint: '^9.14.0' } },
  'pnpm-lock.yaml': '',
  'app/page.tsx': 'export default function P() { return null }\n',
  'app/api/checkout/route.ts': 'export async function POST() {}\n',
  'middleware.ts': 'export function middleware() {}\n',
  'lib/payment.ts': 'import "server-only";\n',
};

test('로그인 줄: 로그인 없는 프론트엔드에는 없고, 서버와 로그인 단서가 있는 프론트엔드에는 있다(13 회차 실패 원인)', () => {
  const shop = detect(repo(SHOP));
  assert.ok(shop.kinds.includes('web') && !shop.kinds.includes('auth'), shop.kinds.join(','));
  for (const lang of ['ko', 'en']) assert.ok(!has(textsOf(shop, lang).security, LOGIN(lang)), lang);
  // next-auth 의존성
  const na = detect(repo({ ...SHOP, 'package.json': { ...SHOP['package.json'], dependencies: { ...SHOP['package.json'].dependencies, 'next-auth': '5.0.0' } } }));
  assert.ok(na.kinds.includes('auth'), na.kinds.join(','));
  assert.ok(has(textsOf(na).security, LOGIN('ko')));
  // 의존성 없이 로그인 화면 경로만(app/(auth)/login/page.tsx)
  const page = detect(repo({ ...SHOP, 'app/(auth)/login/page.tsx': 'export default function L() { return null }\n' }));
  assert.ok(page.kinds.includes('auth'), page.kinds.join(','));
  // 시험 폴더의 auth 는 단서가 아니다
  assert.ok(!detect(repo({ ...SHOP, 'tests/auth.test.ts': '' })).kinds.includes('auth'));
  // 검토 2026-11-13: 풀스택 Next.js(jose·bcryptjs, LoginForm.tsx, app/api/orders) — 낱말 조각·토큰 라이브러리로 안다
  const withDeps = (more) => ({ ...SHOP['package.json'], dependencies: { ...SHOP['package.json'].dependencies, ...more } });
  const full = detect(repo({ ...SHOP, 'package.json': withDeps({ jose: '5.9.6', bcryptjs: '2.4.3' }), 'components/LoginForm.tsx': '', 'app/api/orders/route.ts': '' }));
  assert.ok(full.kinds.includes('auth'), full.kinds.join(','));
  assert.ok(has(textsOf(full).security, LOGIN('ko')));
  for (const f of ['components/LoginForm.tsx', 'components/SignInButton.tsx', 'hooks/useAuth.ts', 'lib/session-auth.ts', 'app/sign_up/page.tsx', 'components/OAuthCallback.tsx']) {
    assert.ok(detect(repo({ ...SHOP, [f]: '' })).kinds.includes('auth'), f);
  }
  for (const dep of ['jose', 'bcrypt', 'argon2', 'aws-amplify', '@aws-amplify/auth', '@auth/core', 'iron-session']) {
    assert.ok(detect(repo({ ...SHOP, 'package.json': withDeps({ [dep]: '1.0.0' }) })).kinds.includes('auth'), dep);
  }
  // firebase 는 인증을 불러올 때만
  const fb = (src) => detect(repo({ ...SHOP, 'package.json': withDeps({ firebase: '10.0.0' }), 'lib/firebase.ts': src })).kinds.includes('auth');
  assert.ok(fb('import { getAuth } from "firebase/auth";\n'));
  assert.ok(!fb('import { getFirestore } from "firebase/firestore";\n'));
  // 주문 API 경로·작가(Author)·권한 낱말만으로는 아니다(13 회차 shop-web 은 app/api/checkout 이 있어도 로그인이 없다)
  for (const f of ['app/api/orders/route.ts', 'pages/api/cart.ts', 'components/AuthorCard.tsx', 'lib/authorize-payment.ts']) {
    assert.ok(!detect(repo({ ...SHOP, [f]: '' })).kinds.includes('auth'), f);
  }
  // 백엔드 API 는 인증 단서 없이도 받는다
  const api = detect(repo({ 'go.mod': 'module example.com/api\n', 'main.go': 'package main\n' }));
  assert.ok(api.kinds.includes('backend') && !api.kinds.includes('auth'), api.kinds.join(','));
  assert.ok(has(textsOf(api).security, LOGIN('ko')));
  // 종류를 모르는 서버(general)도 그대로 받는다(줄이 조용히 빠지지 않게)
  assert.ok(has(textsOf({ ...api, stack: [], kinds: ['general'] }).security, LOGIN('ko')));
});

test('「정확한 버전으로」 줄과 의존성 고정 훅: package.json 이 대부분 ^ 범위면 둘 다 빠지고, 정확한 판이면 둘 다 그대로', () => {
  const ranged = { ...SHOP, 'package.json': { ...SHOP['package.json'], dependencies: { next: '^15.0.3', react: '^19.0.0', zod: '^3.23.8', clsx: '^2.1.1' } } };
  const r = detect(repo(ranged));
  assert.ok(rangesWide(r.depRanges) && !r.kinds.includes('pinned'), JSON.stringify(r.depRanges));
  const pin = ruleLine('security', 'ko', '!hook:pin-deps').replace(/\s*\{\{[^}]*\}\}/g, '').trim();
  assert.ok(!has(textsOf(r).security, pin));
  assert.equal(fitOff(all, r).hooks['pin-deps']?.key, 'fitPinRanges');
  const exact = detect(repo({ ...SHOP, 'package.json': { ...SHOP['package.json'], dependencies: { next: '15.0.3', react: '19.0.0', zod: '3.23.8' }, devDependencies: { typescript: '5.6.3' } } }));
  assert.ok(exact.kinds.includes('pinned'), exact.kinds.join(','));
  assert.ok(has(textsOf(exact).security, pin));
  assert.ok(!fitOff(all, exact).hooks['pin-deps']);
  // workspace:·file:·git 주소는 판이 아니다. 너무 적으면(넷 미만) 범위로 보지 않는다
  assert.deepEqual(depRanges([{ dependencies: { a: 'workspace:*', b: 'file:../b', c: 'github:x/y', d: '^1.0.0', e: '1.2.3' } }]), { total: 2, ranged: 1 });
  // catalog:(pnpm)도 판이 아니고, =1.2.3 은 정확한 판이다
  assert.deepEqual(depRanges([{ dependencies: { a: 'catalog:', b: 'catalog:react18', c: '=1.2.3', d: '= 2.0.0', e: '>=1.0.0' } }]), { total: 3, ranged: 1 });
  // 넷 미만: 하나라도 범위면 범위 관례, 모두 정확하면 고정(검토 2026-11-13)
  assert.equal(rangesWide({ total: 3, ranged: 3 }), true);
  assert.equal(rangesWide({ total: 2, ranged: 1 }), true);
  assert.equal(rangesWide({ total: 3, ranged: 0 }), false);
  assert.equal(rangesWide({ total: 0, ranged: 0 }), false);
  assert.equal(rangesWide({ total: 10, ranged: 5 }), false);
  // 라이브러리 패키지는 고정 훅을 빼므로 「정확한 버전」 줄도 넣지 않는다
  const lib = detect(repo({ 'package.json': { name: 'lib', main: 'index.js', dependencies: { a: '1.0.0' } }, 'index.js': '' }));
  assert.ok(lib.library && !lib.kinds.includes('pinned'), lib.kinds.join(','));
});

test('setup-pre-commit: 형식 도구 단서가 있고 커밋 훅 관리 도구가 없을 때만(13 회차: Husky 가 harness-fit 의 git 훅을 끈다)', () => {
  const team = (d) => ({ ...d, authors: 3, team: true });
  assert.ok(!recommend(all, team(detect(repo(SHOP))), 'ko').skills.includes('setup-pre-commit'), 'Prettier·lint-staged 없음');
  const pretty = detect(repo({ ...SHOP, '.prettierrc': '{}' }));
  assert.ok(pretty.stack.includes('Prettier') && !pretty.thin, pretty.stack.join(','));
  assert.ok(recommend(all, team(pretty), 'ko').skills.includes('setup-pre-commit'));
  const husky = detect(repo({ ...SHOP, '.prettierrc': '{}', '.husky/pre-commit': 'npx lint-staged\n' }));
  assert.ok(husky.stack.includes('Husky'), husky.stack.join(','));
  assert.ok(!recommend(all, team(husky), 'ko').skills.includes('setup-pre-commit'), 'Husky 가 이미 있음');
  // 도구 설정 파일만 있는 저장소는 여전히 빈 저장소다
  assert.equal(detect(repo({ '.pre-commit-config.yaml': 'repos: []\n' })).thin, true);
});

test('원격 묻기 이유 줄: 감지된 스택의 명령을 적고, 적은 명령은 실제로 묻는다(15 회차)', () => {
  const ko = remoteSay(all, { stack: ['Terraform', 'Kubernetes', 'Helm', 'Argo CD'] }, 'ko');
  for (const w of ['terraform apply·destroy', 'kubectl delete·drain', 'helm upgrade', 'argocd app sync', 'ssh']) assert.ok(ko.includes(w), ko);
  assert.equal(remoteSay(all, { stack: [] }, 'en'), 'remote commands such as ssh');
  const r = all.combos.remoteSay;
  for (const x of [...r.stacks, r.always]) {
    for (const c of x.try) {
      const w = c.split(/\s+/);
      assert.ok(remoteCommand(w, runWords(w)), `묻지 않음: ${c}`);
    }
  }
  // 그 스택들이 실제로 ask-cmd 를 켠다
  const remoteAddon = all.combos.stackAddons.find((a) => (a.hooks || []).includes('ask-cmd') && !a.hookOpts);
  for (const x of r.stacks) assert.ok(remoteAddon.when.includes(x.stack), x.stack);
});

test('인프라: Helm·Argo CD 감지, Helm 줄은 차트가 있을 때만, 지침 조각은 짧게', () => {
  const infra = detect(repo({
    'envs/prod/main.tf': 'resource "x" "y" {}\n',
    'charts/api/Chart.yaml': 'name: api\n',
    'argocd/api-prod.yaml': 'apiVersion: argoproj.io/v1alpha1\nkind: Application\n',
    '.pre-commit-config.yaml': 'repos: []\n',
  }));
  for (const s of ['Terraform', 'Kubernetes', 'Helm', 'Argo CD', 'pre-commit']) assert.ok(infra.stack.includes(s), infra.stack.join(','));
  assert.ok(infra.kinds.includes('helm'));
  const helmLine = ruleLine('iac', 'ko', 'judge}} {{kind:helm').replace(/\s*\{\{[^}]*\}\}/g, '').trim();
  assert.ok(has(textsOf(infra).iac, helmLine));
  const tfOnly = detect(repo({ 'main.tf': 'resource "x" "y" {}\n' }));
  assert.ok(!tfOnly.kinds.includes('helm') && textsOf(tfOnly).iac && !has(textsOf(tfOnly).iac, helmLine));
  // 「gitops/」 같은 폴더의 평범한 yaml 은 Argo CD 가 아니다
  assert.ok(!detect(repo({ 'main.tf': '', 'apps/web.yaml': 'apiVersion: apps/v1\nkind: Deployment\n' })).stack.includes('Argo CD'));
  // 조각이 부풀지 않게 — 줄 수와 글자 수 한도
  for (const lang of ['ko', 'en']) {
    const text = fs.readFileSync(new URL(`../../rules/iac.${lang}.md`, import.meta.url), 'utf8');
    assert.ok(text.split('\n').filter((l) => l.startsWith('- ')).length <= 8, lang);
    assert.ok(text.length < 1500, `${lang}: ${text.length}`);
  }
});

test('저장소 명령: pre-commit run -a, playwright install, 묻는 명령은 「사람이 실행」 줄에', () => {
  const infra = repo({ '.pre-commit-config.yaml': 'repos: []\n', 'Makefile': 'lint:\n\ttflint\napply-prod:\n\tterraform apply\n' });
  const c = detectCommands(infra).commands;
  assert.deepEqual(c.lint, ['make lint', 'pre-commit run -a']);
  assert.ok(!(c.tools || []).includes('make apply-prod'));
  const shop = detectCommands(repo(SHOP)).commands;
  assert.ok(shop.tools.includes('pnpm exec playwright install'), shop.tools.join(','));
  const npm = detectCommands(repo({ 'package.json': { devDependencies: { '@playwright/test': '1.48.2' } } })).commands;
  assert.deepEqual(npm.tools, ['npx playwright install']);
  // 묻는 명령은 「사람이 실행하는 명령」 줄에(ask-cmd 가 켜졌을 때만)
  const sel = { lang: 'ko', rules: ['commands'], flow: 'none', hooks: ['ask-cmd'], skills: [], commands: { lint: ['make lint'], tools: ['make apply-dev'] }, hookOpts: { 'ask-cmd': { commands: ['make apply-dev', 'make apply-prod'] } } };
  const t = ruleTexts(sel).commands;
  assert.ok(t.includes('`make apply-dev` · `make apply-prod`') && !/그 밖의 명령/.test(t), t);
  assert.ok(!/사람이 직접 실행/.test(ruleTexts({ ...sel, hooks: [] }).commands), 'ask-cmd 가 꺼지면 줄도 없다');
  assert.ok(!/Run by a person/.test(ruleTexts({ ...sel, lang: 'en', hookOpts: {} }).commands), '묻는 명령이 없으면 줄도 없다');
});

test('점검 도구: 같은 명령 안에서 변수에 담은 apply.mjs 실행을 dry-run·적용으로 읽는다(14·15 회차 오판)', () => {
  assert.equal(expandShellVars('P=".../apply.mjs"; node "$P" . --dry-run'), 'P=".../apply.mjs"; node .../apply.mjs . --dry-run');
  assert.equal(expandShellVars("S=/x/scripts && P=\"$S/apply.mjs\"; node ${P} --dry-run"), 'S=/x/scripts && P="/x/scripts/apply.mjs"; node /x/scripts/apply.mjs --dry-run');
  assert.equal(expandShellVars('echo $HOME'), 'echo $HOME', '담지 않은 변수는 그대로');
  // 값이 거듭 두 배가 되는 꼴도 길이가 묶이고 빨리 끝난다(검토 2026-11-13: 지수로 늘었다)
  let dbl = 'A0=xx';
  for (let i = 1; i <= 40; i++) dbl += `; A${i}="$A${i - 1}$A${i - 1}"`;
  const t0 = performance.now();
  const big = expandShellVars(`${dbl}; echo "$A40" "$A40" "$A40"`);
  assert.ok(big.length < dbl.length + 40000 && performance.now() - t0 < 500, `${big.length}`);
  // 긴 원래 명령은 자르지 않는다
  const long = `P=x; ${'y'.repeat(30000)} node "$P" --dry-run`;
  assert.ok(expandShellVars(long).endsWith('node x --dry-run'));
  const call = (command) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id: command, name: 'Bash', input: { command } }] } });
  const r = audit([
    { type: 'user', message: { content: '/harness-fit:setup' } },
    call('node scripts/detect.mjs . --brief'), call('node scripts/overlap.mjs .'), call('node scripts/recommend.mjs .'),
    call('P="/p/scripts/apply.mjs"; S=/tmp/s; node "$P" . --in-plugin --selection "$S/sel.json" --dry-run --github-settings; node "$P" . --in-plugin --selection "$S/sel.json" --dry-run'),
  ]);
  assert.ok(!r.missing.includes('dry-run'), r.missing.join(','));
  assert.ok(r.missing.includes('apply'));
});

// 역할극 16 회차(iOS, fastlane) 판정에서 나온 추천 쪽 고칠 점(2026-11-13)
test('16 회차: fastlane test·SwiftLint·Xcode 시험 폴더·Appfile 보호, 출시 명령은 「사람이 직접 실행」 줄에, iOS 앱의 로그인 화면으로는 서버 검사 줄이 없다', () => {
  const ios = repo({
    'Gemfile': 'source "https://rubygems.org"\ngem "fastlane"\n',
    'fastlane/Fastfile': 'lane :test do\n  scan\nend\nlane :beta do\n  upload_to_testflight\nend\n',
    'fastlane/Appfile': 'app_identifier("x")\n', 'fastlane/Matchfile': 'readonly(true)\n',
    'Podfile': '', '.swiftlint.yml': 'disabled_rules: []\n',
    'Ggumi/Features/Auth/LoginView.swift': 'import SwiftUI\n', 'GgumiTests/AppTests.swift': 'import XCTest\n',
  });
  const d = detect(ios);
  assert.ok(d.stack.includes('SwiftLint') && d.hasTests, `${d.stack} ${d.hasTests}`);
  assert.ok(!d.kinds.includes('auth'), d.kinds.join(','));
  for (const p of ['fastlane/Appfile', 'fastlane/Matchfile']) assert.ok(d.suggest.protect.includes(p), d.suggest.protect.join(','));
  assert.equal(d.suggest.why['fastlane/Appfile'].k, 'fastlane-config');
  assert.deepEqual(d.commands.test, ['bundle exec fastlane test']);
  assert.deepEqual(d.commands.lint, ['swiftlint lint'], 'make lint 가 없으면 swiftlint');
  const sel = { ...recommend(all, { ...d, authors: 3, team: true }, 'ko'), lang: 'ko' };
  const t = ruleTexts(sel).commands;
  assert.ok(/사람이 직접 실행하는 명령: .*`fastlane beta`/.test(t), t);
  assert.ok(/검사: `swiftlint lint` — 코드를 고쳤으면 끝내기 전에/.test(t), t);
  // Makefile 의 lint 가 있으면 그것을
  assert.deepEqual(detectCommands(repo({ '.swiftlint.yml': '', 'Makefile': 'lint:\n\t./scripts/lint.sh\n' })).commands.lint, ['make lint']);
});

test('16 회차: 줄이기는 넘친 262자만큼만, CI 저장소의 gha-security-review·PR 팀의 pr-writer 는 맨 나중에', async () => {
  const { planBudget } = await import('../lib/skill-budget.mjs');
  const { catalogChars } = await import('../../picker/budget.js');
  const fresh = ['brainstorming', 'writing-plans', 'systematic-debugging', 'receiving-code-review', 'finishing-a-development-branch', 'pr-writer', 'gha-security-review'];
  const ks = fresh.map((id) => all.catalog.skills.find((k) => k.id === id));
  assert.ok(ks.every(Boolean));
  const added = ks.reduce((a, k) => a + catalogChars(k), 0);
  const listing = { current: 8262 - added, budget: 8000, budgetSource: 'default', maxDesc: 1536 };
  const ci = () => ['Next.js', 'GitHub Actions'];
  const b = planBudget(all, { combo: 'team', flow: 'github-flow' }, fresh, listing, ci);
  assert.equal(b.total, 8262);
  assert.ok(!b.trim.includes('pr-writer') && !b.trim.includes('gha-security-review'), b.trim.join(','));
  assert.ok(b.trimTotal <= 8000 && b.trim.length <= 2, `${b.trim} ${b.trimTotal}`);
  // PR 을 쓰지 않는 방식이면 pr-writer 는 보통 조합 스킬 차례(많이 넘치면 빠질 수 있다)
  const none = planBudget(all, { combo: 'team', flow: 'none' }, fresh, { ...listing, current: listing.current + 600 }, ci);
  assert.ok(none.trim.includes('pr-writer') && !none.trim.includes('gha-security-review'), none.trim.join(','));
  // 저장소에 GitHub Actions 가 없으면 gha-security-review 는 저장소 맞춤이 아니다 — 보통 스킬 차례로 먼저 빠질 수 있다(검토 2026-11-13)
  const noCi = planBudget(all, { combo: 'team', flow: 'github-flow' }, fresh, { ...listing, current: listing.current + 600 }, () => ['Next.js']);
  const ciMore = planBudget(all, { combo: 'team', flow: 'github-flow' }, fresh, { ...listing, current: listing.current + 600 }, ci);
  assert.ok(noCi.trim.includes('gha-security-review'), noCi.trim.join(','));
  assert.ok(!ciMore.trim.includes('gha-security-review'), ciMore.trim.join(','));
});
