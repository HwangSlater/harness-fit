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

  const kinds = Object.keys(KIND).filter((k) => KIND[k].some((s) => stack.includes(s)));
  const authors = git(root, ['shortlog', '-sne', '--since=6.months', 'HEAD']).split('\n').filter(Boolean).length;
  const remote = git(root, ['remote', 'get-url', 'origin']);
  return {
    root,
    name: pkg?.name || path.basename(root),
    stack,
    kinds: kinds.length ? kinds : ['general'],
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

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  process.stdout.write(JSON.stringify(detect(path.resolve(process.argv[2] || '.')), null, 2) + '\n');
}
