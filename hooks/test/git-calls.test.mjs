// 훅이 띄우는 git 프로세스 수. git 한 번이 이 PC 에서 45~70ms 라 셸 명령마다 도는 훅에서는 그것이 거의 전부다(전체 검토 2026-11-13).
// 읽기만 하는 git 명령은 0번, 커밋·push 는 전보다 적게. 세는 법: 진입점을 GIT_TRACE=<파일> 로 돌려 git 이 남긴 줄을 센다.
// 파일로 읽은 값(저장소 맨 위·지금 브랜치·HEAD)이 git 이 내는 값과 같은지도 본다(lib/repo-files.mjs).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HOOK, runEntry, makeRepo, gitIn, ALL_RULES } from './helpers/hook-proc.mjs';
import { findRepo, headOf } from '../lib/repo-files.mjs';
import { repoRoot, repoState, git } from '../lib/core.mjs';

let tmp;
let repo;
let wt;
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-gitcalls-'));
  repo = makeRepo(path.join(tmp, 'repo'), ALL_RULES);
  gitIn(repo, 'switch', '-q', '-c', 'feature/calls');
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'export const a = 1;\n');
  gitIn(repo, 'add', 'src/a.js');
  wt = path.join(tmp, 'wt');
  gitIn(repo, 'worktree', 'add', '-q', '-b', 'feature/wt', wt, 'main');
  fs.cpSync(path.join(repo, '.claude'), path.join(wt, '.claude'), { recursive: true }); // 설정은 커밋하지 않은 파일이라 옮겨 둔다
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// 진입점 한 번 → { out, calls: [git 하위 명령 줄] }
const traced = async (entry, input) => {
  const trace = path.join(tmp, `trace-${process.hrtime.bigint()}.txt`);
  const env = { ...process.env, GIT_TRACE: trace, CLAUDE_CONFIG_DIR: path.join(tmp, 'no-claude') };
  delete env.CLAUDE_PLUGIN_ROOT;
  const r = await runEntry(HOOK(entry), JSON.stringify(input), { env });
  const text = fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8') : '';
  const calls = text.split('\n').filter((l) => /git\.c:/.test(l) && /trace: (?:built-in|exec): /.test(l)).map((l) => l.replace(/^.*?trace: (?:built-in|exec): git /, ''));
  return { out: r.stdout, calls };
};
const bash = (command, cwd = repo) => traced('run.mjs', { tool_name: 'Bash', cwd, tool_input: { command } });

test('읽기만 하는 git 명령은 git 을 한 번도 띄우지 않는다(모든 훅을 켠 저장소)', async () => {
  for (const cmd of ['git status', 'git log --oneline | head', 'git diff --stat', 'git show HEAD', 'git branch -a', 'git -C src status', 'cd src && git log -1', 'ls']) {
    const { out, calls } = await bash(cmd);
    assert.equal(out, '{}', cmd);
    assert.deepEqual(calls, [], `${cmd}: ${calls.join(' | ')}`);
  }
  const inWt = await bash('git status', wt);
  assert.deepEqual(inWt.calls, [], 'worktree(.git 이 파일)에서도');
});

test('커밋·push 는 저장소 맨 위·브랜치·HEAD 를 git 에게 묻지 않고, 같은 것을 두 번 묻지 않는다', async () => {
  const commit = await bash('git commit -m "feat: 더하기"');
  assert.equal(commit.out, '{}');
  // 전에는 9번(맨 위 1 · symbolic-ref 2 · rev-parse HEAD 2 · 커밋 계획 4). 새 파일이 있는 커밋은 무시 파일 검사(check-ignore) 한 번 더 — 2026-11-13
  assert.ok(commit.calls.length <= 5, commit.calls.join(' | '));
  assert.ok(!commit.calls.some((c) => /^(?:rev-parse --show-toplevel|symbolic-ref|rev-parse --verify --quiet HEAD)/.test(c)), commit.calls.join(' | '));
  const push = await bash('git push');
  assert.ok(push.calls.length <= 1, push.calls.join(' | '));
  const nested = await bash('bash -c "git commit -m \'feat: 더하기\'"');
  assert.ok(nested.calls.length <= 5, `bash -c 속 명령도 같은 저장소 상태를 나눠 쓴다: ${nested.calls.join(' | ')}`);
});

test('버전 꼴 이름 push 는 태그·브랜치를 ref 파일로 찾는다(git 0번, 판정은 그대로)', async () => {
  gitIn(repo, 'branch', '3.12');
  gitIn(repo, 'tag', 'v2.1');
  try {
    const branch = await bash('git push origin 3.12');
    assert.doesNotMatch(branch.out, /"ask"/, '브랜치면 묻지 않는다');
    assert.deepEqual(branch.calls.filter((c) => c.startsWith('for-each-ref')), [], branch.calls.join(' | '));
    const tag = await bash('git push origin v2.1');
    assert.match(tag.out, /"ask"/, '태그면 묻는다');
    assert.deepEqual(tag.calls.filter((c) => c.startsWith('for-each-ref')), [], tag.calls.join(' | '));
  } finally {
    gitIn(repo, 'branch', '-D', '3.12');
    gitIn(repo, 'tag', '-d', 'v2.1');
  }
});

test('보호 브랜치 판정은 그대로다(파일로 읽은 브랜치 — 저장소와 worktree)', async () => {
  const onMain = await bash('git switch main && git commit -m "feat: x"');
  assert.match(onMain.out, /deny/);
  const wtMain = await bash('git checkout main && git commit -m "feat: x"', wt);
  assert.match(wtMain.out, /deny/);
  const wtFeature = await bash('git commit -m "feat: x"', wt);
  assert.equal(wtFeature.out, '{}');
});

test('파일로 읽은 맨 위·브랜치·HEAD 는 git 과 같고, 애매하면 git 에게 묻는다', () => {
  const real = (p) => fs.realpathSync.native(p);
  for (const dir of [repo, path.join(repo, 'src'), wt]) {
    const viaGit = path.resolve(git(dir, ['rev-parse', '--show-toplevel']).trim());
    assert.equal(findRepo(dir).root, real(viaGit), dir);
    assert.equal(repoRoot(dir), real(viaGit), dir);
    const branch = (git(dir, ['symbolic-ref', '--short', 'HEAD']) || '').trim();
    assert.deepEqual(headOf(findRepo(dir)), { branch, hasHead: true }, dir);
  }
  assert.equal(findRepo(path.join(tmp, 'none')), false, '없는 폴더');
  assert.equal(findRepo(path.join(repo, '.git')), undefined, '.git 안은 git 에게');
  // 같은 짧은 이름의 태그가 있으면 git 은 heads/… 로 줄인다 — 파일로는 답하지 않고 git 과 같은 값을 낸다
  gitIn(repo, 'tag', 'feature/calls');
  try {
    assert.equal(headOf(findRepo(repo)), undefined);
    assert.equal(repoState(repo).branch(), (git(repo, ['symbolic-ref', '--short', 'HEAD']) || '').trim());
  } finally {
    gitIn(repo, 'tag', '-d', 'feature/calls');
  }
  // GIT_DIR 같은 환경 변수가 있으면 파일로 찾지 않는다
  process.env.GIT_DIR = path.join(repo, '.git');
  try {
    assert.equal(findRepo(repo), undefined);
  } finally {
    delete process.env.GIT_DIR;
  }
  // 아직 커밋이 없는 브랜치
  const fresh = path.join(tmp, 'fresh');
  fs.mkdirSync(fresh);
  git(fresh, ['init', '-q', '-b', 'trunk']);
  assert.deepEqual(headOf(findRepo(fresh)), { branch: 'trunk', hasHead: false });
});

test('끝낼 때(커밋 해시·문서 검사)는 이번 턴 커밋을 한 번만 읽는다', async () => {
  const at = new Date(Date.now() - 60e3).toISOString();
  gitIn(repo, 'commit', '-q', '-m', 'feat: 턴 안의 커밋');
  const transcript = path.join(tmp, 'turn.jsonl');
  fs.writeFileSync(transcript, [
    { type: 'user', timestamp: at, message: { role: 'user', content: '커밋해 줘' } },
    { type: 'assistant', timestamp: new Date().toISOString(), message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'git commit -m "feat: 턴 안의 커밋"' } }] } },
  ].map((r) => JSON.stringify(r)).join('\n'));
  const { out, calls } = await traced('stop.mjs', { cwd: repo, transcript_path: transcript, last_assistant_message: '했어요.' });
  assert.match(out, /commit-hash/);
  assert.match(out, /feat: 턴 안의 커밋/, '커밋 제목은 reflog 에서 함께 받는다');
  assert.equal(calls.filter((c) => c.startsWith('reflog')).length, 1, calls.join(' | '));
  assert.ok(!calls.some((c) => /^(?:rev-parse|log --no-walk=unsorted --format=%H)/.test(c)), calls.join(' | '));
});
