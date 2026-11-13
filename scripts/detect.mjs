// 저장소를 읽어 스택·팀 규모·기존 설정을 알아낸다. 파일 몇 개만 보고 끝낸다(빠르게, 문맥에 안 넣음).
// 사용: node scripts/detect.mjs [경로]  → JSON 출력
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { detectCommands } from './lib/commands.mjs';
import { readJson } from './lib/paths.mjs';
import { readText, filesIn, packageDirs, rosPackages, isPythonDir, pythonDeps } from './lib/stack-scan.mjs';
import { CONVENTIONAL, ANY_CONVENTIONAL } from '../hooks/rules/message.mjs';
const EXTRA_TYPE_MIN = 1; // 표준 밖 타입을 저장소 꼴로 칠 최소 횟수(한 번이라도 쓰면 — 사람이 고른 타입이다)
import { suggest } from './lib/suggest.mjs';
import { paymentSignal } from './lib/payments.mjs';
import { authSignal, depRanges, rangesWide, toolStacks, TOOL_STACKS } from './lib/signals.mjs';

// 형식 훅(commit-msg·branch-name) 기본값을 정하려고 보는 기록 크기(scripts/lib/catalog.mjs fitOff)
const HISTORY_SUBJECTS = 30;
const HISTORY_BRANCHES = 200;
const BOT = /\[bot\]|dependabot|renovate|github-actions|greenkeeper/i;

// 최근 merge 아닌 커밋 제목 중 conventional 꼴 수, 로컬·원격 브랜치 이름(원격 이름 앞붙이는 뗌, HEAD 는 뺌)
const historyOf = (root) => {
  const subjects = git(root, ['log', '-n', String(HISTORY_SUBJECTS), '--no-merges', '--format=%s']).split('\n').filter(Boolean);
  const refs = git(root, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']).split('\n').filter(Boolean);
  const names = refs.map((r) => (r.startsWith('refs/heads/') ? r.slice('refs/heads/'.length) : r.replace(/^refs\/remotes\/[^/]+\//, '')));
  const branches = [...new Set(names.filter((n) => n && n !== 'HEAD'))].slice(0, HISTORY_BRANCHES);
  // 메시지 언어(커밋 메시지 언어 검사 기본값 — catalog.mjs commitLang). 봇(dependabot·renovate 등) 커밋은 세지 않는다.
  // 한국어는 제목에 한글이 있으면, 영어는 제목·본문 어디에도 한글이 없을 때만 센다 — commit-msg 의 en 은 본문의 한글도 막아서(검토 2026-11-11).
  const msgs = git(root, ['log', '-n', String(HISTORY_SUBJECTS), '--no-merges', '--format=%an%x1f%ae%x1f%s%x1f%b%x1e']).split('\x1e').map((x) => x.trim()).filter(Boolean)
    .map((x) => x.split('\x1f')).filter(([name, mail]) => !BOT.test(`${name} ${mail}`));
  const korean = msgs.filter(([, , s]) => /[가-힣]/.test(s)).length;
  const english = msgs.filter(([, , s, b = '']) => !/[가-힣]/.test(s + b) && /[A-Za-z]{3,}/.test(s)).length;
  // 표준 밖 타입이라도 저장소가 쓰면(bench:·deps:) 그 저장소의 꼴로 본다 — 커밋 형식 훅의 types 기본값(catalog.mjs)
  const counts = {};
  for (const s of subjects) {
    const type = ANY_CONVENTIONAL.exec(s)?.[1];
    if (type && !CONVENTIONAL.test(s)) counts[type] = (counts[type] || 0) + 1;
  }
  // 표준 타입(feat·fix…)이 기록의 절반 넘을 때만 — Go 식 「runtime: …」「http: …」 는 타입이 아니라 패키지 이름표다(검토 2026-11-11).
  // 많이 쓴 것부터 다섯까지
  const standard = subjects.filter((s) => CONVENTIONAL.test(s)).length;
  const extraTypes = standard * 2 > subjects.length ? Object.keys(counts).filter((k) => counts[k] >= EXTRA_TYPE_MIN).sort((a, b) => counts[b] - counts[a]).slice(0, 5) : [];
  const conventional = subjects.filter((s) => CONVENTIONAL.test(s) || extraTypes.includes(ANY_CONVENTIONAL.exec(s)?.[1])).length;
  return { subjects: subjects.length, conventional, extraTypes, messages: msgs.length, korean, english, branches };
};

// 라이브러리 패키지: 남이 가져다 쓰는 입구(main·exports·types)가 있고 private 가 아님 → 의존성을 범위로 두는 게 맞다
const LIBRARY_KEYS = ['main', 'exports', 'types', 'typings'];
const isLibrary = (pkg) => !!pkg && pkg.private !== true && LIBRARY_KEYS.some((k) => k in pkg);

// unsafe-html 이 보는 파일(hooks/lib/unsafe-html.mjs TARGET 과 같은 확장자)이 저장소에 하나라도 있는지. git 이 아는 파일(무시 목록 빼고)만 본다.
const WEB_GLOBS = ['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts', 'vue', 'svelte', 'astro', 'html', 'htm', 'jinja', 'jinja2', 'j2', 'njk'].map((e) => `*.${e}`);
// 화면을 그리는 파일(HTML·서버 템플릿·컴포넌트). 있으면 kinds 에 html — 보안 지침의 「HTML 이스케이프」 줄이 이것을 본다
// (JSON 만 내는 FastAPI 에도 그 줄이 들어가던 일 — 역할극 7 회차, 2026-11-11)
const HTML_GLOBS = ['html', 'htm', 'jinja', 'jinja2', 'j2', 'hbs', 'handlebars', 'ejs', 'erb', 'twig', 'liquid', 'njk', 'mustache', 'vue', 'svelte', 'astro', 'jsx', 'tsx', 'cshtml', 'razor', 'jsp', 'php'].map((e) => `*.${e}`);
// git 저장소가 아니면 거짓 — package.json 으로만 본다(아닌 폴더에서 늘 참이던 일 — 검토 2026-11-11)
const hasFiles = (root, globs) => trackedFiles(root, globs).length > 0;
// git 이 아는 파일 가운데 글롭에 맞는 것(git 저장소가 아니면 빈 목록)
const trackedFiles = (root, globs) => {
  try {
    return execFileSync('git', ['-C', root, 'ls-files', '-co', '--exclude-standard', '--', ...globs, ':(exclude).claude/**'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean);
  } catch {
    return [];
  }
};
const SOURCE_EXTS = ['py', 'go', 'rb', 'php', 'cs', 'fs', 'swift', 'kt', 'java', 'scala', 'rs', 'ex', 'exs', 'erl', 'lua', 'dart', 'c', 'cc', 'cpp', 'h', 'hpp', 'm', 'mm', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'vue', 'svelte', 'bats', 'clj', 'hs', 'ml', 'zig', 'r', 'jl'];
const SOURCE_GLOBS = SOURCE_EXTS.map((e) => `*.${e}`);
const SOURCE_FILE = new RegExp(`\\.(?:${SOURCE_EXTS.join('|')})$`);
// 인프라 코드 파일(Terraform·OpenTofu·Helm 차트·kustomize·Ansible 설정)
const INFRA_GLOBS = ['*.tf', '*.tofu', '*/Chart.yaml', '*/kustomization.yaml', '*/kustomization.yml', '*/ansible.cfg'];
// 소스·인프라·Info.plist·Xcode 프로젝트를 git ls-files 한 번으로 — Swift 를 세려고 따로 부르니 파일 2만 개 저장소에서 감지가 35% 느려졌다(독립 검토 2026-11-13).
// Xcode 프로젝트는 폴더라 그 안의 고정 파일로 찾는다(깊이 상관없이 — KMP 의 iosApp/iosApp.xcodeproj, 검토 2026-11-13)
const XCODE_FILES = ['*.xcodeproj/project.pbxproj', '*.xcworkspace/contents.xcworkspacedata'];
const LOOKUP_GLOBS = [...SOURCE_GLOBS, ...INFRA_GLOBS, '*Info.plist', ...XCODE_FILES];
const XCODE_FILE = /\.(?:xcodeproj\/project\.pbxproj|xcworkspace\/contents\.xcworkspacedata)$/;
// Argo CD: 이 폴더들의 yaml 앞부분만 본다(폴더마다 파일 몇 개까지)
const ARGO_DIRS = ['argocd', 'argo-cd', 'argo', 'gitops', 'deploy/argocd', 'apps'];
const ARGO_API = /^\s*apiVersion:\s*["']?argoproj\.io\//m;
const ARGO_FILES = 20;
const ARGO_HEAD = 4096;
const hasAppCode = (root, stack, hasPackage, tracked) => {
  if (hasPackage || !stack.some((s) => KIND.infra.includes(s))) return true;
  if (stack.some((s) => CODE_STACKS.has(s))) return true;
  // git 저장소가 아니면 파일을 셀 수 없으니 빼지 않는다. .github/·docs/ 의 작은 스크립트는 앱 코드가 아니다(검토 2026-11-12)
  if (!fs.existsSync(path.join(root, '.git'))) return true;
  return tracked.some((p) => SOURCE_FILE.test(p) && !SIDE_PATH.test(p) && !/^(?:\.github|docs?)\//.test(p));
};
// 언어 무리(같은 언어의 확장자는 하나로 센다 — js·ts·tsx 는 JS, c·h·cpp 는 C, Objective-C 는 Swift 와 같은 Apple 네이티브)
const LANG_OF = { mjs: 'js', cjs: 'js', ts: 'js', tsx: 'js', jsx: 'js', vue: 'js', svelte: 'js', cc: 'c', cpp: 'c', h: 'c', hpp: 'c', m: 'swift', mm: 'swift', exs: 'ex' };
// Swift 가 이 저장소의 주 언어인지(가장 많은 언어 무리가 Swift·Objective-C)
const swiftIsMain = (files) => {
  const counts = {};
  for (const p of files) { const e = p.slice(p.lastIndexOf('.') + 1); const g = LANG_OF[e] || e; counts[g] = (counts[g] || 0) + 1; }
  return Object.entries(counts).every(([g, n]) => g === 'swift' || n < (counts.swift || 0));
};
const SIDE_PATH =/(?:^|\/)(?:vendor|third_party|testdata|test-fixtures|fixtures|examples?|node_modules)\//;
const workflowFiles = (root) => {
  try {
    return fs.readdirSync(path.join(root, '.github', 'workflows')).some((f) => /\.ya?ml$/i.test(f));
  } catch {
    return false;
  }
};
const git = (cwd, args) => {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

// [표시 이름, 판정] — 판정은 (deps, has) → boolean
// React 는 RN·Expo 앱이 아닐 때만(RN 앱에도 react 가 있어 웹용 React 스킬이 같이 들어가던 일 — 2026-11-05)
const JS_STACKS = [
  ['Next.js', (d) => d.next], ['React', (d) => d.react && !d.next && !d['react-native'] && !d.expo], ['Vue', (d) => d.vue], ['Svelte', (d) => d.svelte],
  ['Angular', (d) => d['@angular/core']], ['React Native', (d) => d['react-native']], ['Expo', (d) => d.expo],
  ['Express', (d) => d.express], ['NestJS', (d) => d['@nestjs/core']], ['Electron', (d) => d.electron],
  ['TypeScript', (d) => d.typescript], ['Prisma', (d) => d.prisma || d['@prisma/client']], ['Tailwind', (d) => d.tailwindcss],
  ['Supabase', (d) => d['@supabase/supabase-js']], ['Playwright', (d) => d['@playwright/test']], ['Vitest', (d) => d.vitest], ['Jest', (d) => d.jest],
  // LLM·도구 연결·DB(역할극 4·5·6 회차 — 못 읽어 맞춤 추천이 비었다, 2026-11-11)
  ['Claude API', (d) => d['@anthropic-ai/sdk'] || d['@anthropic-ai/claude-agent-sdk']], ['MCP', (d) => d['@modelcontextprotocol/sdk']],
  ['PostgreSQL', (d) => d.pg || d.postgres || d['@neondatabase/serverless'] || d['@vercel/postgres']], ['Slack', (d) => d['@slack/bolt'] || d['@slack/web-api']],
];
const FILE_STACKS = [
  ['Go', ['go.mod']], ['Rust', ['Cargo.toml']],
  ['Java/Kotlin', ['build.gradle', 'build.gradle.kts', 'pom.xml']], ['Flutter', ['pubspec.yaml']],
  // Package.swift 만으로는 iOS 가 아니다(Vapor 서버·SPM 라이브러리 — 아래 iOS 판정이 .iOS( 플랫폼을 본다, 검토 2026-11-13)
  ['iOS', ['Podfile']], ['Docker', ['Dockerfile', 'docker-compose.yml', 'compose.yaml']],
  // 배포 플랫폼(운영 배포 명령을 묻게 — 역할극 13 회차: vercel --prod 가 처음 추천에 없었다, 2026-11-12)
  ['Vercel', ['vercel.json', '.vercel/project.json']], ['Netlify', ['netlify.toml']], ['Firebase', ['firebase.json']], ['Fly.io', ['fly.toml']],
  // 앱 배포 도구(iOS·Android 출시 레인 — 역할극 16 회차, 2026-11-13). 레인 이름으로 묻는 명령을 채운다(scripts/lib/suggest.mjs)
  ['Fastlane', ['fastlane/Fastfile', '.fastlane/Fastfile']],
];
// iOS 는 앱이라는 단서가 있을 때만: Podfile, Xcode 프로젝트(git 이 아는 것은 깊이 상관없이), .xcode-version, .iOS( 플랫폼을 적은 Package.swift,
// Info.plist 와 Swift 소스 셋 이상(SPM 만 쓰는 xcodeproj 앱이 빈 저장소로 보여 빈 저장소 질문을 하던 일 — 역할극 16 회차, 2026-11-13).
// Package.swift 만·Swift 소스만으로는 아니다 — Vapor 서버·SPM 라이브러리·명령줄 도구가 iOS 지침과 xcrun·agvtool 묻기를 받았다(검토 2026-11-13). 그때는 스택 Swift.
// RN·Expo·Flutter·Capacitor 의 ios/ 껍데기는 그 스택이 따로 있어 보지 않는다
const XCODE_DIR = /\.(?:xcodeproj|xcworkspace)$/;
const SPM_IOS = /\.iOS\s*\(/;
const SWIFT_MIN = 3; // Swift 로 볼 최소 소스 수(다른 언어 저장소의 도구 스크립트 한두 개는 아님)
const SWIFT_SIDE = /(?:^|\/)(?:Pods|Carthage|\.build|DerivedData)\//;
const SHELL_STACKS = ['React Native', 'Expo', 'Flutter'];
const SHELL_DEPS = ['@capacitor/core', '@capacitor/ios', 'cordova', 'cordova-ios'];
// 흔한 이름이라 맨 위에서만 보는 것(하위 폴더의 project.yml 로 웹 모노레포가 iOS 가 되던 일 — 검토 2026-11-11)
const TOP_ONLY = [['iOS', ['project.yml']]];
// Python 의존성 이름(정규화: 소문자, _ → -)으로 판정한다. 이름 하나를 통째로 맞춘다(scripts/lib/stack-scan.mjs pythonDeps).
const PY_STACKS = [
  ['Django', /^(?:django|djangorestframework)$/], ['FastAPI', /^fastapi$/], ['Flask', /^flask$/], ['pandas', /^pandas$/], ['PyTorch', /^(?:torch|torchvision|pytorch-lightning|lightning)$/],
  ['SQLAlchemy', /^(?:sqlalchemy|flask-sqlalchemy|sqlmodel)$/], ['PostgreSQL', /^(?:psycopg|psycopg2|psycopg2-binary|psycopg-binary|psycopg-pool|asyncpg|pgvector)$/], ['Claude API', /^(?:anthropic|claude-agent-sdk|claude-code-sdk)$/],
  ['MCP', /^(?:mcp|fastmcp)$/], ['Slack', /^slack-(?:bolt|sdk)$/], ['MuJoCo', /^mujoco$/], ['wandb', /^wandb$/], ['Hydra', /^hydra-core$/], ['scikit-learn', /^(?:scikit-learn|sklearn)$/],
  // 역할극 7·9 회차에서 못 읽은 것(2026-11-11)
  ['Django REST Framework', /^djangorestframework$/], ['Celery', /^celery$/], ['Redis', /^(?:redis|django-redis|aioredis)$/], ['XGBoost', /^(?:xgboost|lightgbm|catboost)$/],
  ['Optuna', /^optuna$/], ['MLflow', /^mlflow(?:-skinny)?$/], ['AWS', /^(?:boto3|aiobotocore|awscli)$/], ['Alembic', /^alembic$/],
  ['PySpark', /^pyspark$/], ['Airflow', /^apache-airflow(?:-providers-[\w-]+)?$/], ['Kafka', /^(?:confluent-kafka|kafka-python|aiokafka)$/], ['dbt', /^dbt-(?:core|postgres|redshift|snowflake|bigquery|databricks|duckdb)$/],
];
// JVM 빌드 파일(build.gradle·pom.xml) 글에서 찾는 것(역할극 8 회차 — Java/Kotlin 만 읽어 Spring·Flyway·Kafka 맞춤이 비었다)
const JVM_STACKS = [
  ['Spring Boot', /org\.springframework\.boot/], ['Flyway', /flyway/i], ['Kafka', /spring-kafka|kafka-clients/], ['Redis', /spring-boot-starter-data-redis|jedis|lettuce-core|redisson/],
  ['Testcontainers', /testcontainers/],
];
// go.mod 의 모듈(역할극 14 회차: goose 마이그레이션·pgx 를 몰라 migration-edit·Postgres 맞춤이 빠졌다, 2026-11-12)
const GO_STACKS = [
  ['SQL migrations', /github\.com\/(?:pressly\/goose|golang-migrate\/migrate)/],
  ['PostgreSQL', /github\.com\/(?:jackc\/pgx|lib\/pq)\b/], ['Redis', /github\.com\/(?:(?:redis|go-redis)\/go-redis|go-redis\/redis\b|redis\/rueidis|gomodule\/redigo)/],
];
// 파일·폴더로만 아는 것: ROS 2(package.xml 의 ament 빌드), C/C++(CMake, 또는 Makefile 과 C 소스), Jupyter 노트북
const EXTRA_STACKS = ['ROS 2', 'Payments', 'C/C++', 'Jupyter', 'Terraform', 'Kubernetes', 'Helm', 'Argo CD', 'Ansible', ...TOOL_STACKS, 'Gradle', 'Maven', 'uv', 'Rails', 'dbt', 'SQL migrations', 'Swift', ...JVM_STACKS.map(([n]) => n)];

// 스택 → 카탈로그 분류. 조합 추천에 쓴다.
const KIND = { web: ['Next.js', 'React', 'Vue', 'Svelte', 'Angular'], mobile: ['React Native', 'Expo', 'Flutter', 'iOS'],
  backend: ['Express', 'NestJS', 'Django', 'FastAPI', 'Flask', 'Go', 'Rust', 'Java/Kotlin', 'Spring Boot', 'Rails'], data: ['pandas', 'PyTorch', 'scikit-learn', 'Jupyter', 'XGBoost', 'PySpark', 'Airflow', 'dbt'],
  robotics: ['ROS 2', 'MuJoCo'], infra: ['Terraform', 'Kubernetes', 'Helm', 'Argo CD', 'Ansible'] };

// 인프라는 앱의 종류가 아니다 — 앱 종류(web·mobile·backend·data·robotics)가 하나도 없으면 general 을 함께 둔다
// (k8s 폴더만 있는 Fastify 서비스에서 보안의 웹·서버 줄이 빠지던 회귀 — 네 번째 검토)
const APP_KINDS = ['web', 'mobile', 'backend', 'data', 'robotics'];
// 앱 코드가 있다고 볼 스택(언어 + 앱 종류 스택) — detect().code
const CODE_STACKS = new Set(['Python', 'C/C++', 'Node.js', 'TypeScript', 'Gradle', 'Maven', 'Swift', ...APP_KINDS.flatMap((k) => KIND[k])]);
// 저장소 단서 종류(지침 줄의 {{kind:…}} — rule-files.mjs kindFits): html·js 그 파일이 있음, auth 로그인 단서(lib/signals.mjs authSignal),
// pinned 의존성을 범위로 두지 않는 JS 저장소(라이브러리도 아님), helm Helm 차트가 있음. 사용자가 알려 준 스택으로 다시 셀 때도 그대로 둔다(withHints)
const SIGNAL_KINDS = ['html', 'js', 'auth', 'pinned'];
// 앱 코드가 없으면(code: false — 인프라만) general 도 두지 않는다: 모르는 앱이 아니라 앱이 없는 것이다(로그인 검사 줄이 인프라 저장소에 — 역할극 15 회차, 2026-11-13)
const kindsOf = (stack, signals = [], code = true) => {
  const kinds = [...Object.keys(KIND).filter((k) => KIND[k].some((s) => stack.includes(s))), ...SIGNAL_KINDS.filter((k) => signals.includes(k)), ...(stack.includes('Helm') ? ['helm'] : [])];
  const out = kinds.some((k) => APP_KINDS.includes(k)) || code === false ? kinds : ['general', ...kinds];
  // 로그인 단서는 서버 쪽 코드가 있을 수 있는 저장소에서만(웹·서버·모르는 앱) — iOS 앱의 LoginView.swift 로 「서버에서 검사」 줄이 들어가지 않게(역할극 16 회차)
  return out.some((k) => ['web', 'backend', 'general'].includes(k)) ? out : out.filter((k) => k !== 'auth');
};

// 사용자가 말로 알려 줄 수 있는 스택 이름(이 목록에 있는 것만 받는다).
export const KNOWN_STACKS = [...new Set([...JS_STACKS.map(([n]) => n), ...FILE_STACKS.map(([n]) => n), 'Python', ...PY_STACKS.map(([n]) => n), ...EXTRA_STACKS, 'Node.js', 'GitHub Actions'])];
const TEAM_HINT_AUTHORS = 2; // 「여럿이 개발」이라고 했을 때 팀으로 볼 최소 인원(조합 추천 기준과 같음)

// 저장소에서 읽은 것에 사용자가 알려 준 것(hints)을 더한다. 모르는 스택 이름은 버린다.
export const withHints = (det, hints = {}) => {
  const known = new Map(KNOWN_STACKS.map((s) => [s.toLowerCase(), s]));
  const extra = (hints.stack || []).map((s) => known.get(s.toLowerCase())).filter((s) => s && !det.stack.includes(s));
  const similar = hints.similar || [];
  const skip = hints.skip || {};
  const more = similar.length || Object.keys(skip).length ? { existing: { ...det.existing, similar }, skipLines: skip } : {};
  if (!extra.length && !hints.team) return Object.keys(more).length ? { ...det, ...more } : det;
  const stack = [...det.stack, ...extra];
  const authors = hints.team ? Math.max(det.authors, TEAM_HINT_AUTHORS) : det.authors;
  return { ...det, ...more, stack, kinds: kindsOf(stack, [...(det.kinds || []), ...(det.js ? ['js'] : [])], det.code), authors, team: authors > 1, hinted: { stack: extra, team: !!hints.team } };
};

// 저장소 위치. origin 이 없으면 저장소 안 단서로(.gitlab-ci.yml·.gitlab/·go.mod 의 module gitlab.…) — GitLab 팀에 GitHub 흐름·gh 훅이
// 들어가던 일(역할극 14 회차, 2026-11-12). 단서가 없으면 none(GitHub 라고 짐작하지 않는다)
const hostOf = (root, remote, goMod) => {
  if (remote) return /github\.com/.test(remote) ? 'github' : /gitlab/.test(remote) ? 'gitlab' : 'other';
  if (['.gitlab-ci.yml', '.gitlab'].some((f) => fs.existsSync(path.join(root, f))) || /^module\s+gitlab\./m.test(goMod)) return 'gitlab';
  return 'none';
};
export const detect = (dir) => {
  const root = git(dir, ['rev-parse', '--show-toplevel']) || dir;
  const has = (f) => fs.existsSync(path.join(root, f));
  // 맨 위와 한 단계 아래 패키지 폴더(ROS 2 colcon 의 src/<패키지>, 모노레포의 packages/·apps/·workspaces — 역할극 2 회차: 맨 위만 봐서 ROS·C++·Python 을 다 놓쳤다)
  const pkg = readJson(path.join(root, 'package.json'));
  const dirs = packageDirs(root, pkg);
  const hasIn = (f) => dirs.some((d) => fs.existsSync(path.join(root, d, f)));
  const pkgs = dirs.map((d) => (d === '.' ? pkg : readJson(path.join(root, d, 'package.json')))).filter(Boolean);
  const depsOf = (p) => ({ ...(p.dependencies || {}), ...(p.devDependencies || {}) });
  const deps = Object.assign({}, ...pkgs.map(depsOf));
  // 패키지마다 따로 판정해 합친다 — 합친 의존성으로 보면 apps/mobile 의 react-native 때문에 apps/web 의 React 가 사라졌다(검토 2026-11-11)
  const stack = JS_STACKS.filter(([, ok]) => pkgs.some((p) => ok(depsOf(p)))).map(([n]) => n);
  const add = (n) => !stack.includes(n) && stack.push(n);
  for (const [name, files] of FILE_STACKS) if (files.some(hasIn)) add(name);
  for (const [name, files] of TOP_ONLY) if (files.some(has)) add(name);
  // JVM: 빌드 도구와 빌드 파일 속 의존성
  const jvm = dirs.flatMap((d) => ['build.gradle', 'build.gradle.kts', 'pom.xml'].map((f) => readText(path.join(root, d, f)))).join('\n');
  if (dirs.some((d) => ['build.gradle', 'build.gradle.kts'].some((f) => fs.existsSync(path.join(root, d, f))))) add('Gradle');
  if (dirs.some((d) => fs.existsSync(path.join(root, d, 'pom.xml')))) add('Maven');
  for (const [n, re] of JVM_STACKS) if (re.test(jvm)) add(n);
  const goMod = dirs.map((d) => readText(path.join(root, d, 'go.mod'))).join('\n');
  for (const [n, re] of GO_STACKS) if (re.test(goMod)) add(n);
  // 번호 붙은 SQL·Go 마이그레이션 파일(goose·golang-migrate·dbmate 를 CLI 로만 쓰는 저장소 — go.mod 에 없다)
  if (dirs.some((d) => ['migrations', 'db/migrations'].some((m) => filesIn(root, path.join(d, m)).some((x) => /^\d+_[^/]+\.(?:sql|go)$/.test(x))))) add('SQL migrations');
  if (has('uv.lock')) add('uv');
  // Rails: Gemfile 의 gem "rails"(migration-edit 이 db/migrate 를 본다)
  const gemfile = readText(path.join(root, 'Gemfile'));
  if (/^\s*gem\s+["']rails["']/m.test(gemfile)) add('Rails');
  if (has('alembic.ini')) add('Alembic');
  const ros = rosPackages(root);
  const pyDirs = [...new Set([...dirs, ...ros])].filter((d) => isPythonDir(root, d));
  const pyNames = pyDirs.length ? pythonDeps(root, pyDirs) : new Set();
  if (pyDirs.length) {
    add('Python');
    for (const [n, re] of PY_STACKS) if ([...pyNames].some((x) => re.test(x))) add(n);
  }
  if (ros.length) add('ROS 2');
  // C/C++: 맨 위 CMake·meson, ROS 2 패키지의 CMake, 맨 위 Makefile 과 맨 위·src 의 C 소스(하위 폴더에 묻힌 CMake 는 보지 않는다 — vendored 코드)
  const cSrc = (d) => filesIn(root, d).some((f) => /\.(?:c|cc|cpp|cxx|h|hpp)$/i.test(f));
  if (has('CMakeLists.txt') || has('meson.build') || ros.some((d) => fs.existsSync(path.join(root, d, 'CMakeLists.txt'))) || (has('Makefile') && (cSrc('.') || cSrc('src')))) add('C/C++');
  if (['.', 'notebooks', ...dirs].some((d) => filesIn(root, d).some((f) => f.endsWith('.ipynb')))) add('Jupyter');
  // git 이 아는 소스·인프라 파일(한 번만 부른다). vendor·testdata·examples 안의 것은 남의 것·시험 재료라 뺀다
  const tracked = trackedFiles(root, LOOKUP_GLOBS);
  const own = tracked.filter((p) => !SIDE_PATH.test(p));
  // iOS: 앱 단서(Xcode 프로젝트·.xcode-version·.iOS( 를 적은 Package.swift)면 바로, Info.plist 는 Swift 소스 셋 이상과 함께일 때.
  // Swift 소스만으로는 iOS 가 아니라 스택 Swift(주 언어가 Swift 이고 다른 주 언어 스택이 없을 때 — React + tools/mac-helper/*.swift,
  // Go 서버 + clients/swift/ 는 아님, 독립 검토 2026-11-13). 받아 온 코드(Pods·Carthage·.build·vendor) 안의 Xcode 프로젝트는 보지 않는다
  const swiftSide = (p) => SWIFT_SIDE.test(p);
  const src = own.filter((p) => SOURCE_FILE.test(p) && !swiftSide(p));
  const swiftN = src.filter((p) => p.endsWith('.swift')).length;
  const spm = dirs.map((d) => readText(path.join(root, d, 'Package.swift')));
  if (!SHELL_STACKS.some((s) => stack.includes(s)) && !SHELL_DEPS.some((d) => deps[d])) {
    const xcode = own.some((p) => XCODE_FILE.test(p) && !swiftSide(p)) || dirs.some((d) => filesIn(root, d).some((f) => XCODE_DIR.test(f)));
    const plist = swiftN >= SWIFT_MIN && own.some((p) => /(?:^|\/)Info\.plist$/.test(p) && !swiftSide(p));
    if (xcode || has('.xcode-version') || spm.some((t) => SPM_IOS.test(t)) || plist) add('iOS');
  }
  // Swift 저장소(서버·라이브러리·명령줄 도구): Package.swift 가 있거나 Swift 가 주 언어. 빈 저장소 질문을 받지 않게 스택으로 둔다
  const otherMain = pkgs.length > 0 || stack.some((s) => CODE_STACKS.has(s));
  if (!stack.includes('iOS') && !stack.includes('Flutter') && (spm.some(Boolean) || (swiftN >= SWIFT_MIN && !otherMain && swiftIsMain(src)))) add('Swift');
  // 인프라 코드: Terraform(.tf·OpenTofu .tofu), Kubernetes(Helm 차트·kustomize·k8s 폴더), Ansible(ansible.cfg·playbooks).
  // git 이 아는 파일이면 깊이와 상관없이(envs/prod/main.tf·modules/vpc·deploy/base/kustomization.yaml·ansible/ansible.cfg — 역할극 14·15 회차:
  // 맨 위와 흔한 폴더만 봐서 Terraform·Ansible 을 놓쳤다, 2026-11-12). git 저장소가 아니면 예전처럼 맨 위와 흔한 폴더만
  const infraHas = (re) => own.some((p) => re.test(p));
  if (infraHas(/\.(?:tf|tofu)$/) || ['.', 'infra', 'terraform', 'iac', 'deploy'].some((d) => filesIn(root, d).some((f) => /\.(?:tf|tofu)$/.test(f)))) add('Terraform');
  if (has('Chart.yaml') || has('kustomization.yaml') || has('k8s') || has('kubernetes') || infraHas(/\/(?:Chart\.yaml|kustomization\.ya?ml)$/)) add('Kubernetes');
  // playbooks/ 폴더 이름만으로는 아니다(장애 대응 문서 폴더가 흔하다) — yml 이 있을 때만
  if (has('ansible.cfg') || infraHas(/\/ansible\.cfg$/) || ['playbooks', 'ansible/playbooks'].some((d) => filesIn(root, d).some((f) => /\.ya?ml$/i.test(f)))) add('Ansible');
  // Helm 차트(지침 「helm lint·template 을 환경마다」 — {{kind:helm}}), Argo CD 앱 정의(흔한 폴더의 yaml 에 apiVersion argoproj.io — 역할극 15 회차, 2026-11-13)
  if (has('Chart.yaml') || infraHas(/(?:^|\/)Chart\.yaml$/)) add('Helm');
  const argoYaml = (d) => filesIn(root, d).filter((f) => /\.ya?ml$/i.test(f)).slice(0, ARGO_FILES).some((f) => ARGO_API.test(readText(path.join(root, d, f), ARGO_HEAD)));
  if (ARGO_DIRS.some(argoYaml)) add('Argo CD');
  // 결제·돈 계산(지침 「결제·돈 계산」 — scripts/lib/payments.mjs): 결제 SDK 의존성, 또는 소스 경로에 돈 도메인 낱말 둘 이상(ledger·payment·settlement…)
  if (paymentSignal(root, { deps, goMod, jvm, py: pyNames, files: src })) add('Payments');
  // Postgres: Prisma provider 나 compose 의 postgres 이미지로도 안다(이미지 이름 끝이 postgres·postgresql·pgvector·postgis 일 때만 — postgres-exporter 는 아님)
  if (dirs.some((d) => /provider\s*=\s*"postgres(?:ql)?"/.test(readText(path.join(root, d, 'prisma', 'schema.prisma'))))) add('PostgreSQL');
  const compose = dirs.flatMap((d) => ['docker-compose.yml', 'docker-compose.yaml', 'compose.yaml', 'compose.yml'].map((f) => readText(path.join(root, d, f)))).join('\n');
  // compose 이미지만으로는, 앱이 그 DB 의 표를 직접 만드는 저장소(ORM·마이그레이션 도구가 있을 때)만 — 로컬 시험용 postgres 를 띄우는
  // 데이터 파이프라인(dbt 의 로컬 대상, 웨어하우스는 Redshift)에 Postgres 표 설계 스킬이 붙던 일(역할극 10 회차, 2026-11-11)
  const OWNS_SCHEMA = ['SQLAlchemy', 'Django', 'Prisma', 'Alembic', 'Flyway', 'Rails', 'Spring Boot', 'Express', 'NestJS', 'FastAPI', 'Flask', 'SQL migrations'];
  if (/^\s*image:\s*["']?(?:[\w.-]+\/)*(?:postgres|postgresql|pgvector|postgis)(?::[\w.-]+)?["']?\s*$/im.test(compose) && OWNS_SCHEMA.some((s) => stack.includes(s))) add('PostgreSQL');
  // 데이터 엔지니어링 도구(역할극 10 회차): dbt 프로젝트 파일
  if (has('dbt_project.yml') || dirs.some((d) => fs.existsSync(path.join(root, d, 'dbt_project.yml')))) add('dbt');
  if (!stack.length && pkg) stack.push('Node.js');
  // 워크플로 파일이 있어야 GitHub Actions(빈 폴더만으로 잡던 일 — 역할극 6 회차, 2026-11-11)
  if (workflowFiles(root)) stack.push('GitHub Actions');
  // 형식 도구·커밋 훅 관리 도구(setup-pre-commit 추천 조건 — catalog/combos.json). 앱 스택 뒤에 둔다
  for (const n of toolStacks(has, deps, pkg)) add(n);
  const ranges = depRanges(pkgs);

  const authors = git(root, ['shortlog', '-sne', '--since=6.months', 'HEAD']).split('\n').filter(Boolean).length;
  const remote = git(root, ['remote', 'get-url', 'origin']);
  // 지킬 경로를 먼저 — README·CI 명령 가운데 결과를 그리로 쓰는 것을 빼려고(doc-commands.mjs)
  const sug = suggest(root);
  const cmds = detectCommands(root, { protect: sug.protect });
  // Ansible 저장소의 .j2 는 설정 파일 틀이다(sshd_config.j2 로 웹 저장소처럼 보이던 일 — 역할극 15 회차, 2026-11-12)
  const notTemplates = stack.includes('Ansible') ? [':(exclude)*.j2'] : [];
  const jsRepo = pkgs.length > 0 || hasFiles(root, [...WEB_GLOBS, ...notTemplates]);
  const code = hasAppCode(root, stack, pkgs.length > 0, tracked);
  const signals = [
    ...(hasFiles(root, [...HTML_GLOBS, ...notTemplates]) ? ['html'] : []), ...(jsRepo ? ['js'] : []),
    ...(authSignal({ deps, goMod, jvm, gemfile, py: pyNames, files: src, read: (p, max) => readText(path.join(root, p), max) }) ? ['auth'] : []),
    // 「의존성은 정확한 버전으로」 줄: JS 저장소이고 라이브러리가 아니며 의존성을 대부분 범위로 두지 않을 때
    ...(jsRepo && !isLibrary(pkg) && !rangesWide(ranges) ? ['pinned'] : []),
  ];
  return {
    root,
    name: pkg?.name || path.basename(root),
    stack,
    kinds: kindsOf(stack, signals, code),
    // package.json 의존성 판 꼴(범위 수) — 의존성 고정 훅 기본값(scripts/lib/catalog.mjs fitOff)
    depRanges: ranges,
    // JS·TS 코드가 있을 수 있는 저장소(package.json) — 없으면 unsafe-html 이 볼 파일이 없다(catalog.mjs fitOff)
    // package.json 이 없어도 JS·TS·HTML 파일이 있으면(정적 사이트·Django 템플릿·루트 없는 모노레포 — 검토 2026-11-11)
    js: jsRepo,
    // 앱 코드가 있는지. 인프라 코드만 있는 저장소에 시험 먼저 쓰기(TDD) 스킬이 들어가던 일(역할극 15 회차, 2026-11-12).
    // 거짓은 인프라 스택이 있고 소스 파일이 하나도 없을 때만 — 스택 이름만으로 정하니 PHP·Elixir·.NET 저장소, Terraform 저장소의 lambda/*.py 까지
    // 「앱 코드 없음」이 됐다(검토 2026-11-12). 운영 셸 스크립트(.sh)는 앱 코드로 보지 않는다(bats 시험은 본다)
    code,
    // 스택을 알 수 있는 파일이 하나도 없다(빈 저장소 등) → 맞춤 추천을 할 수 없다. CI 파일만 있는 것도 같다.
    thin: !stack.some((s) => s !== 'GitHub Actions' && !TOOL_STACKS.includes(s)),
    isGit: !!git(root, ['rev-parse', '--git-dir']),
    commits: Number(git(root, ['rev-list', '--count', 'HEAD']) || 0),
    authors,
    team: authors > 1,
    host: hostOf(root, remote, goMod),
    defaultBranch: git(root, ['symbolic-ref', '--short', 'HEAD']) || 'main',
    hasDevelop: !!git(root, ['rev-parse', '--verify', '--quiet', 'develop']),
    // Xcode 시험 대상 폴더(<앱 이름>Tests/·<앱 이름>UITests/)도 — GgumiTests/ 를 못 봤다(역할극 16 회차, 2026-11-13)
    hasTests: ['test', 'tests', '__tests__', 'spec', 'src/test'].some(has) || filesIn(root, '.').some((f) => /^[\w-]+Tests$/.test(f)) || !!(deps.vitest || deps.jest || deps['@playwright/test']),
    // 이 저장소의 시험·검사·빌드 명령(CLAUDE.md 지침 「이 저장소 명령」). listed: 사용자 CLAUDE.md 에 이미 있어 뺀 것
    commands: cmds.commands,
    // 저장소 단서로 미리 채울 훅 옵션(긴 학습·배포 명령, .gitignore 의 원본 데이터·비밀 파일 — scripts/lib/suggest.mjs)
    suggest: sug,
    commandsListed: cmds.listed,
    // 형식 훅을 기본으로 켤지(저장소가 이미 그 꼴을 따르는지), 의존성 고정 훅을 기본에서 뺄지
    history: historyOf(root),
    library: isLibrary(pkg),
    existing: { claudeMd: has('CLAUDE.md'), skills: has('.claude/skills'), harness: has('.claude/harness.json') },
  };
};

// --brief: 고르기 화면을 열기 전에 Claude 가 읽는 짧은 요약(빈 저장소인지, 알려 줄 수 있는 스택 이름).
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const det = detect(path.resolve(args.find((a) => !a.startsWith('--')) || '.'));
  const brief = args.includes('--brief');
  // offer: 보호할지 물을 커밋된 결과·논문 경로(고르기 화면 흐름에서도 setup 스킬이 같은 질문을 하게 — scripts/lib/record-folders.mjs)
  const offer = det.suggest.offer ? { offer: Object.fromEntries(det.suggest.offer.map((v) => [v, det.suggest.why[v]])) } : {};
  const out = brief ? { thin: det.thin, stack: det.stack, commits: det.commits, authors: det.authors, ...offer, ...(det.thin ? { knownStacks: KNOWN_STACKS } : {}) } : det;
  process.stdout.write(JSON.stringify(out, null, brief ? 0 : 2) + '\n');
}
