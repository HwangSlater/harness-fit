// 결제·돈을 다루는 저장소인지(스택 Payments → 지침 「결제·돈 계산」, 사용자 결정 「결제 지침 새로 넣기」 2026-11-13 — 역할극 14 회차 M5·M7).
// 단서 둘 중 하나:
// 1) 결제 SDK 의존성: package.json·go.mod·Python 의존성·Gemfile·build.gradle·pom.xml·composer.json 에서 이름을 통째로 맞춘다(설명 글·주석은 보지 않는다).
//    브라우저 전용 SDK(결제창·카드 칸)는 빼고. 화면 폴더(pages·components·routes·views·screens·화면 코드의 app/)의 낱말도 세지 않는다.
// 2) 돈 도메인 코드: git 이 아는 소스 파일의 폴더·파일 이름 마디에 ledger·payment·payout·settlement·refund·chargeback 가운데 둘 이상.
//    하나만으로는 아니다 — 쇼핑몰 화면의 lib/payment.ts(결제사 승인만 부름, 역할극 13 회차)·법률 앱의 settlement 같은 보통 앱에 들지 않게.
//    checkout·billing·charge·wallet·transaction 은 보지 않는다(장바구니 화면·구독 안내·배터리 충전·DB 트랜잭션에 흔하다). 시험·예제·남의 코드 폴더는 뺀다.
import path from 'node:path';
import { readText } from './stack-scan.mjs';

// JS 패키지 이름(통째로). @stripe/* 처럼 범위가 결제사인 것은 범위째
const JS_PAY = /^(?:stripe|@stripe\/[\w.-]+|@tosspayments\/[\w.-]+|@portone\/[\w.-]+|iamport[\w.-]*|braintree|@paypal\/[\w.-]+|square|@square\/[\w.-]+|@adyen\/[\w.-]+|@paddle\/[\w.-]+|@lemonsqueezy\/[\w.-]+|@mollie\/api-client|razorpay|@checkout\.com\/[\w.-]+)$/;
// 브라우저 전용 SDK(결제창·카드 입력 칸을 띄우고 토큰만 받는다 — 금액 계산·환불·원장은 서버 몫). 쇼핑몰 화면 저장소가 흔히 갖는다(검토 2026-11-13)
const JS_BROWSER_PAY = new Set(['@stripe/stripe-js', '@stripe/react-stripe-js', '@stripe/connect-js', '@stripe/react-connect-js', '@tosspayments/payment-widget-sdk',
  '@tosspayments/tosspayments-sdk', '@tosspayments/payment-sdk', '@portone/browser-sdk', '@paypal/react-paypal-js', '@paypal/paypal-js', 'braintree-web',
  '@adyen/adyen-web', '@square/web-sdk', '@paddle/paddle-js']);
// Go 모듈 경로
const GO_PAY = /^\s*(?:require\s+)?(?:github\.com\/(?:stripe\/stripe-go|adyen\/adyen-go-api-library|braintree-go\/braintree-go|plutov\/paypal|square\/square-go-sdk|razorpay\/razorpay-go|mollie\/mollie-api-go)|go\.portone\.io)\S*\s/m;
// Python 의존성 이름(정규화된 이름 — stack-scan.mjs pythonDeps)
const PY_PAY = /^(?:stripe|dj-stripe|adyen|braintree|paypalrestsdk|paypal-server-sdk|paypal-checkout-serverside-sdk|squareup|iamport-rest-client|portone-server-sdk|razorpay|mollie-api-python|django-payments)$/;
// Gemfile 의 gem 이름
const GEM_PAY = /^\s*gem\s+["'](?:stripe|braintree|adyen-ruby-api-library|paypal-server-sdk|paypal-checkout-sdk|square\.rb|razorpay|mollie-api-ruby)["']/m;
// JVM 좌표(com.squareup 는 okhttp·retrofit 도 같은 그룹이라 square SDK 꼴만)
const JVM_PAY = /com\.stripe[:'"\s]|stripe-java|com\.adyen\b|com\.braintreepayments|com\.paypal\.sdk|paypal-server-sdk|com\.squareup:square:|<artifactId>square<\/artifactId>|com\.razorpay|io\.portone|tosspayments/;
// composer.json require 이름(PHP)
const PHP_PAY = /^(?:stripe\/stripe-php|adyen\/php-api-library|braintree\/braintree_php|paypal\/[\w.-]+|square\/square|razorpay\/razorpay|mollie\/mollie-api-php)$/;

// 돈 도메인 낱말(단수로 맞춘다)
const MONEY = new Set(['ledger', 'payment', 'payout', 'settlement', 'refund', 'chargeback']);
const MONEY_MIN = 2;
const SIDE = /(?:^|\/)(?:tests?|__tests__|spec|specs|e2e|mocks?|__mocks__|fixtures?|__fixtures__|testdata|examples?|docs?|vendor|third_party|node_modules|stories|__stories__|\.storybook)\/|\.stories\.[\w]+$/i;
// 화면 폴더(pages·components·routes·views·screens, 화면 코드의 app/)의 낱말은 세지 않는다 — app/refund-policy/page.tsx·components/PaymentForm.tsx 는
// 안내·입력 화면이다(검토 2026-11-13: 13 회차 shop-web 에 환불 안내 화면 하나만 더해도 Payments 가 됐다).
// app/ 은 화면 코드 확장자일 때만 — Rails·Laravel 의 app/models/payment.rb·app/Models/Refund.php 는 서버 코드다
const UI_DIR = /(?:^|\/)(?:pages|components|routes|views|screens)\//i;
const UI_APP = /(?:^|\/)app\/.*\.(?:[cm]?[jt]sx?|vue|svelte|astro|mdx?|css|scss|html)$/i;
const singular = (w) => (w.endsWith('s') ? w.slice(0, -1) : w);
// 경로의 폴더 이름과 파일 이름(확장자 뺀) 마디 — db/ledger.sql.go → db·ledger·sql·go, internal/payment/handler.go → internal·payment·handler
const words = (p) => p.toLowerCase().split('/').flatMap((part) => part.split(/[-_.]/)).map(singular);

const composerDeps = (root) => {
  try {
    const j = JSON.parse(readText(path.join(root, 'composer.json')) || '{}');
    return Object.keys({ ...(j.require || {}), ...(j['require-dev'] || {}) });
  } catch {
    return [];
  }
};

// deps: package.json 의존성(합친 것), goMod·jvm: 파일 글, py: Python 의존성 이름 Set, files: git 이 아는 소스 파일
// → 단서 이름(없으면 null): 'sdk:<이름>' 또는 'domain:<낱말·낱말>'
export const paymentSignal = (root, { deps = {}, goMod = '', jvm = '', py = new Set(), files = [] }) => {
  const js = Object.keys(deps).find((d) => JS_PAY.test(d) && !JS_BROWSER_PAY.has(d));
  if (js) return `sdk:${js}`;
  const go = GO_PAY.exec(goMod);
  if (go) return `sdk:${go[0].trim().replace(/^require\s+/, '').split(/\s/)[0]}`;
  const pyName = [...py].find((d) => PY_PAY.test(d));
  if (pyName) return `sdk:${pyName}`;
  const gem = GEM_PAY.exec(readText(path.join(root, 'Gemfile')));
  if (gem) return `sdk:${gem[0].trim().replace(/^gem\s+/, '').replace(/["']/g, '')}`;
  const jvmHit = JVM_PAY.exec(jvm);
  if (jvmHit) return `sdk:${jvmHit[0].replace(/[:'"\s<>/]|artifactId/g, '')}`;
  const php = composerDeps(root).find((d) => PHP_PAY.test(d));
  if (php) return `sdk:${php}`;
  const seen = new Set();
  for (const f of files) {
    if (SIDE.test(f) || UI_DIR.test(f) || UI_APP.test(f)) continue;
    for (const w of words(f)) if (MONEY.has(w)) seen.add(w);
    if (seen.size >= MONEY_MIN) return `domain:${[...seen].join('·')}`;
  }
  return null;
};
