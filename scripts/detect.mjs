// 저장소를 읽어 스택·팀 규모·기존 설정을 알아낸다. 파일 몇 개만 보고 끝낸다(빠르게, 문맥에 안 넣음).
// 사용: node scripts/detect.mjs [경로]  → JSON 출력
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};
const readText = (f) => {
  try {
    return fs.readFileSync(f, 'utf8');
  } catch {
    return '';
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
const JS_STACKS = [
  ['Next.js', (d) => d.next], ['React', (d) => d.react && !d.next], ['Vue', (d) => d.vue], ['Svelte', (d) => d.svelte],
  ['Angular', (d) => d['@angular/core']], ['React Native', (d) => d['react-native']], ['Expo', (d) => d.expo],
  ['Express', (d) => d.express], ['NestJS', (d) => d['@nestjs/core']], ['Electron', (d) => d.electron],
  ['TypeScript', (d) => d.typescript], ['Prisma', (d) => d.prisma || d['@prisma/client']], ['Tailwind', (d) => d.tailwindcss],
  ['Supabase', (d) => d['@supabase/supabase-js']], ['Playwright', (d) => d['@playwright/test']], ['Vitest', (d) => d.vitest], ['Jest', (d) => d.jest],
];
const FILE_STACKS = [
  ['Python', ['pyproject.toml', 'requirements.txt', 'setup.py']], ['Go', ['go.mod']], ['Rust', ['Cargo.toml']],
  ['Java/Kotlin', ['build.gradle', 'build.gradle.kts', 'pom.xml']], ['Flutter', ['pubspec.yaml']],
  ['iOS', ['Podfile', 'project.yml', 'Package.swift']], ['Docker', ['Dockerfile', 'docker-compose.yml', 'compose.yaml']],
];
const PY_STACKS = [['Django', /django/i], ['FastAPI', /fastapi/i], ['Flask', /flask/i], ['pandas', /pandas/i], ['PyTorch', /torch/i]];

// 스택 → 카탈로그 분류. 조합 추천에 쓴다.
const KIND = { web: ['Next.js', 'React', 'Vue', 'Svelte', 'Angular'], mobile: ['React Native', 'Expo', 'Flutter', 'iOS'],
  backend: ['Express', 'NestJS', 'Django', 'FastAPI', 'Flask', 'Go', 'Rust', 'Java/Kotlin'], data: ['pandas', 'PyTorch'] };

const kindsOf = (stack) => {
  const kinds = Object.keys(KIND).filter((k) => KIND[k].some((s) => stack.includes(s)));
  return kinds.length ? kinds : ['general'];
};

// 사용자가 말로 알려 줄 수 있는 스택 이름(이 목록에 있는 것만 받는다).
export const KNOWN_STACKS = [...JS_STACKS.map(([n]) => n), ...FILE_STACKS.map(([n]) => n), ...PY_STACKS.map(([n]) => n), 'Node.js', 'GitHub Actions'];
const TEAM_HINT_AUTHORS = 2; // 「여럿이 개발」이라고 했을 때 팀으로 볼 최소 인원(조합 추천 기준과 같음)

// 저장소에서 읽은 것에 사용자가 알려 준 것(hints)을 더한다. 모르는 스택 이름은 버린다.
export const withHints = (det, hints = {}) => {
  const known = new Map(KNOWN_STACKS.map((s) => [s.toLowerCase(), s]));
  const extra = (hints.stack || []).map((s) => known.get(s.toLowerCase())).filter((s) => s && !det.stack.includes(s));
  if (!extra.length && !hints.team) return det;
  const stack = [...det.stack, ...extra];
  const authors = hints.team ? Math.max(det.authors, TEAM_HINT_AUTHORS) : det.authors;
  return { ...det, stack, kinds: kindsOf(stack), authors, team: authors > 1, hinted: { stack: extra, team: !!hints.team } };
};

export const detect = (dir) => {
  const root = git(dir, ['rev-parse', '--show-toplevel']) || dir;
  const has = (f) => fs.existsSync(path.join(root, f));
  const pkg = readJson(path.join(root, 'package.json'));
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const stack = JS_STACKS.filter(([, ok]) => ok(deps)).map(([n]) => n);
  for (const [name, files] of FILE_STACKS) if (files.some(has) && !stack.includes(name)) stack.push(name);
  if (stack.includes('Python')) {
    const py = readText(path.join(root, 'pyproject.toml')) + readText(path.join(root, 'requirements.txt'));
    for (const [n, re] of PY_STACKS) if (re.test(py)) stack.push(n);
  }
  if (!stack.length && pkg) stack.push('Node.js');
  if (has('.github/workflows')) stack.push('GitHub Actions');

  const authors = git(root, ['shortlog', '-sne', '--since=6.months', 'HEAD']).split('\n').filter(Boolean).length;
  const remote = git(root, ['remote', 'get-url', 'origin']);
  return {
    root,
    name: pkg?.name || path.basename(root),
    stack,
    kinds: kindsOf(stack),
    // 스택을 알 수 있는 파일이 하나도 없다(빈 저장소 등) → 맞춤 추천을 할 수 없다. CI 파일만 있는 것도 같다.
    thin: !stack.some((s) => s !== 'GitHub Actions'),
    isGit: !!git(root, ['rev-parse', '--git-dir']),
    commits: Number(git(root, ['rev-list', '--count', 'HEAD']) || 0),
    authors,
    team: authors > 1,
    host: /github\.com/.test(remote) ? 'github' : /gitlab/.test(remote) ? 'gitlab' : remote ? 'other' : 'none',
    defaultBranch: git(root, ['symbolic-ref', '--short', 'HEAD']) || 'main',
    hasDevelop: !!git(root, ['rev-parse', '--verify', '--quiet', 'develop']),
    hasTests: ['test', 'tests', '__tests__', 'spec'].some(has) || !!(deps.vitest || deps.jest || deps['@playwright/test']),
    existing: { claudeMd: has('CLAUDE.md'), skills: has('.claude/skills'), harness: has('.claude/harness.json') },
  };
};

// --brief: 고르기 화면을 열기 전에 Claude 가 읽는 짧은 요약(빈 저장소인지, 알려 줄 수 있는 스택 이름).
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const det = detect(path.resolve(args.find((a) => !a.startsWith('--')) || '.'));
  const brief = args.includes('--brief');
  const out = brief ? { thin: det.thin, stack: det.stack, commits: det.commits, authors: det.authors, ...(det.thin ? { knownStacks: KNOWN_STACKS } : {}) } : det;
  process.stdout.write(JSON.stringify(out, null, brief ? 0 : 2) + '\n');
}
