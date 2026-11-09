// git pre-commit 훅 시험이 함께 쓰는 저장소·실행 도우미(git-hook.test.mjs · stress/git-hook-big.test.mjs).
// 저장소는 처음 한 번 만든 바탕(main 에 README 커밋 하나)을 복사해 쓴다 — 사례마다 git init·커밋을 되풀이하지 않게.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { launcherText, COMMIT_HOOK_IDS } from '../../lib/git-hook.mjs';
import { ROOT } from './hook-proc.mjs';

export const SCRIPT = path.join(ROOT, 'hooks', 'git-pre-commit.mjs');
export const STACK = /\n\s+at .+[:(]\d+|Error:|node:internal/;
export const FOUND = /harness-fit: Found in the changes to be committed/;

export const commitRepos = (tmp) => {
  let seq = 0;
  // 시험 밖 설정(이 PC 에 깔린 harness-fit)과 떼어 놓은 환경
  const env = (extra = {}) => {
    const e = { ...process.env, CLAUDE_CONFIG_DIR: path.join(tmp, 'no-claude-config'), ...extra };
    delete e.CLAUDE_PLUGIN_ROOT;
    return e;
  };
  // PATH 만 바꾼 환경(Windows 는 이름이 Path 라 대소문자를 가리지 않고 지운다)
  const withPath = (value) => {
    const e = env();
    for (const k of Object.keys(e)) if (k.toLowerCase() === 'path') delete e[k];
    e.PATH = value;
    return e;
  };
  const gitIn = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: env() });
  const base = path.join(tmp, 'base');
  const init = (dir) => {
    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
    gitIn(dir, 'config', 'user.email', 't@example.com');
    gitIn(dir, 'config', 'user.name', 't');
    gitIn(dir, 'config', 'core.autocrlf', 'false');
  };
  init(base);
  fs.writeFileSync(path.join(base, 'README.md'), 'hello\n');
  gitIn(base, 'add', 'README.md');
  gitIn(base, 'commit', '-q', '-m', 'chore: 시작');
  // 새 저장소: 바탕 복사 + harness.json(rules) + 우리 훅(recorded 경로)
  const repo = ({ rules = Object.fromEntries(COMMIT_HOOK_IDS.map((id) => [id, true])), recorded = ROOT, hook = true, name } = {}) => {
    const dir = path.join(tmp, name || `r${++seq}`);
    fs.cpSync(base, dir, { recursive: true });
    fs.mkdirSync(path.join(dir, '.claude'));
    if (rules !== null) fs.writeFileSync(path.join(dir, '.claude', 'harness.json'), typeof rules === 'string' ? rules : JSON.stringify({ lang: 'en', rules }));
    if (hook) {
      fs.mkdirSync(path.join(dir, '.git', 'hooks'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.git', 'hooks', 'pre-commit'), launcherText(recorded));
      fs.chmodSync(path.join(dir, '.git', 'hooks', 'pre-commit'), 0o755);
    }
    return dir;
  };
  // HEAD 없는 빈 저장소
  const emptyRepo = () => {
    const dir = path.join(tmp, `empty${++seq}`);
    init(dir);
    return dir;
  };
  const put = (dir, rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  const times = []; // 훅 한 번(진짜 커밋 또는 본체 직접)에 걸린 ms
  const timedSpawn = (cmd, args, opts) => {
    const t0 = performance.now();
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 60000, ...opts });
    times.push(performance.now() - t0);
    return r;
  };
  // 진짜 git commit(실행기 → 플러그인 찾기 → 본체)
  const commit = (dir, ...args) => timedSpawn('git', ['-C', dir, 'commit', '-q', '-m', 'feat: x', ...args], { env: env() });
  // 본체를 바로: git 이 훅을 돌리는 것과 같이 저장소 맨 위에서, 지금 색인(stage 한 것)을 본다
  const preCommit = (dir, opts = {}) => timedSpawn(process.execPath, [SCRIPT], { cwd: dir, env: env(), ...opts });
  return { env, withPath, gitIn, repo, emptyRepo, put, commit, preCommit, times, next: () => ++seq };
};
