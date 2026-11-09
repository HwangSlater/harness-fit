// 훅 시험이 함께 쓰는 것: 진입점을 자식 프로세스로 돌리기, 모든 훅을 켠 저장소, 시간 한도 재기.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
export const HOOK = (name) => path.join(ROOT, 'hooks', name);
export const MB = 1024 * 1024;
export const STACK = /\n\s+at .+[:(]\d+|node:internal|Error:/;
export const SHELLS = ['Bash', 'PowerShell'];
export const packs = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog', 'packs.json'), 'utf8'));
export const FLOW_OPTS = packs.flows.find((f) => f.id === 'github-flow').hooks;
// 모든 훅을 켠 설정(브랜치 방식이 넣는 옵션은 GitHub Flow 값)
export const ALL_RULES = Object.fromEntries(packs.hooks.map((h) => [h.id, FLOW_OPTS[h.id] || true]));

export const gitIn = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
// main 에 README 커밋 하나 + .claude/harness.json(rules)
export const makeRepo = (dir, rules = ALL_RULES) => {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  gitIn(dir, 'config', 'user.email', 't@example.com');
  gitIn(dir, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'README.md'), 'hello\n');
  gitIn(dir, 'add', 'README.md');
  gitIn(dir, 'commit', '-q', '-m', 'chore: 시작');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'harness.json'), JSON.stringify({ lang: 'en', rules }));
  return dir;
};

// 진입점 하나를 자식 프로세스로 → { status, stdout, stderr, ms }
export const runEntry = (file, stdin, { cwd, env } = {}) =>
  new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(process.execPath, [file], { cwd, env: env || process.env });
    const out = [];
    const err = [];
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => resolve({ status: -1, stdout: '', stderr: String(e), ms: 0 }));
    child.on('close', (status) => resolve({ status, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), ms: performance.now() - t0 }));
    child.stdin.on('error', () => {}); // 자식이 입력을 다 읽기 전에 끝나도 시험이 터지지 않게
    child.stdin.end(stdin);
  });

// 한 번의 시간 한도. 사람이 느끼는 한도(훅 15초)보다 한참 짧게.
export const BUDGET_MS = Number(process.env.HARNESS_BUDGET_MS || 4000);
// 판정을 바로 부를 때(Node 띄우기가 빠진 값)의 한도. 혼자 돌면 p50 20ms, git 을 여러 번 띄우는 커밋·끝낼 때 사례가 1초 안팎인데
// npm test 전체와 함께 돌면 3초를 넘긴 적이 있어(2026-11-09) 진입점과 같은 값으로 둔다 — 길이의 제곱으로 도는 정규식(100초)은 그대로 잡힌다.
export const IN_BUDGET_MS = Number(process.env.HARNESS_INPROC_BUDGET_MS || BUDGET_MS);

// 시간 한도 재기. 시험 파일 여럿이 함께 돌면 CPU 를 나눠 써 한 번이 몇 배 느려진다(2026-11-09: 0.3초 호출이 4초를 넘김).
// 그래서 한도를 넘으면 두 번 더 재고, 잴 때마다 같은 순간의 「빈 호출」(Node 를 띄우고 설정 없이 통과) 시간을 빼서 가장 좋은 값으로 본다.
// 진짜로 느린 코드(길이의 제곱으로 도는 정규식 등)는 세 번 다 한도를 크게 넘으므로 그대로 잡힌다.
// measure(): { ms, ... } 를 돌려주는 async 함수. idle(): 같은 때의 빈 호출 ms(없으면 0).
export const timed = async (measure, { budget = BUDGET_MS, idle = null, tries = 3 } = {}) => {
  let best = await measure();
  best.net = best.ms;
  for (let i = 1; i < tries && best.net >= budget; i++) {
    const base = idle ? await idle() : 0;
    const r = await measure();
    r.net = Math.max(0, r.ms - base);
    if (r.net < best.net) best = r;
  }
  return best;
};
export const assertFast = (r, label, budget = BUDGET_MS) =>
  assert.ok(r.net < budget, `${label}: ${r.ms.toFixed(0)}ms(빈 호출을 뺀 값 ${r.net.toFixed(0)}ms, 한도 ${budget}ms)`);

// 같은 순간의 빈 호출: 설정이 없는 폴더에서 진입점을 띄워 바로 통과하는 시간
export const idleRun = (file, cwd) => async () => (await runEntry(file, '{}', { cwd })).ms;

// 진단 줄: p50·p95·최대
export const spread = (times) => {
  const s = [...times].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(0);
  return `runs=${s.length} p50=${at(0.5)}ms p95=${at(0.95)}ms max=${s.at(-1).toFixed(0)}ms`;
};
