// 브랜치 전략 훅(merge-flow · branch-age) 시험: 보호 브랜치 목록의 이름을 따르는지, 낱말 읽기, git 출력 읽기, 세션마다 한 번.
// 막음·통과 사례 대부분은 hooks/test/strict-cases/flow.mjs(실제 진입점). 여기는 두 규칙을 함께 켠 설정만 볼 수 있는 것.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { evaluate } from '../lib/evaluate.mjs';
import { flowNames, flowKind, positionalOf, oldestOf, mergesOf, DEFAULT_MAX_HOURS, DEFAULT_MAX_BEHIND } from '../rules/flow.mjs';
import { loadAll } from '../../scripts/lib/catalog.mjs';

let tmp;
let repo;
let savedConfig;
let session = 0;
const g = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
const setRules = (rules) => fs.writeFileSync(path.join(repo, '.claude', 'harness.json'), JSON.stringify({ lang: 'ko', rules }));
// 부를 때마다 다른 세션(branch-age 는 세션마다 브랜치마다 한 번만 알린다). sid 를 주면 그 세션으로.
const bash = (command, hints = [], sid = `flow-${++session}`) =>
  evaluate({ tool_name: 'Bash', cwd: repo, ...(sid === null ? {} : { session_id: sid }), tool_input: { command } }, [], [], hints);
const stampDir = () => path.join(process.env.CLAUDE_CONFIG_DIR, 'harness-fit', 'branch-age');

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-flow-'));
  repo = path.join(tmp, 'repo');
  // 세션마다 한 번 표시는 시험 폴더에 적는다(이 PC 의 ~/.claude 에 남지 않게)
  savedConfig = process.env.CLAUDE_CONFIG_DIR;
  // 전체 시험이 CPU 를 다 쓸 때 알림 훅의 git 한도(1.5초)를 넘어 조용히 넘어가지 않게(flow.mjs noticeGitMs)
  process.env.HARNESS_FIT_NOTICE_GIT_MS = '30000';
  process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'config');
  execFileSync('git', ['init', '-q', '-b', 'production', repo]);
  g('config', 'user.email', 't@example.com');
  g('config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'README.md'), 'hi\n');
  g('add', 'README.md');
  g('commit', '-q', '-m', 'chore: 시작', '--date', '2020-01-01T00:00:00Z');
  fs.mkdirSync(path.join(repo, '.claude'));
});
after(() => {
  if (savedConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = savedConfig;
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('이름은 보호 브랜치 목록을 따른다(배포 꼴은 배포, 나머지는 통합 — staging 같은 환경 이름만 모름)', () => {
  assert.deepEqual(flowNames({}), { prod: ['main', 'master'], dev: ['develop'] });
  assert.deepEqual(flowNames({ 'protect-branch': true }), { prod: ['main', 'master'], dev: ['develop'] });
  assert.deepEqual(flowNames({ 'protect-branch': { branches: ['production', 'dev', 'staging'] } }), { prod: ['production'], dev: ['dev'] });
  assert.deepEqual(flowNames({ 'protect-branch': { branches: ['main', 'master', 'develop'] } }), { prod: ['main', 'master'], dev: ['develop'] });
  assert.deepEqual(flowNames({ 'protect-branch': { branches: ['main', 'integration', 'qa'] } }), { prod: ['main'], dev: ['integration'] }, 'develop 꼴이 아닌 통합 브랜치');
  assert.deepEqual(flowNames({ 'protect-branch': { branches: ['main'] } }), { prod: ['main'], dev: [] }, '목록에 없으면 기본 develop 을 넣지 않는다');
  assert.deepEqual(flowNames({ 'protect-branch': { branches: ['main', 'release/1.0', 'develop'] } }), { prod: ['main'], dev: ['develop'] }, '/ 가 든 이름은 통합 브랜치가 아니다');
  assert.deepEqual(flowNames({ 'protect-branch': { branches: 'main' } }), { prod: ['main', 'master'], dev: ['develop'] }, '꼴이 틀린 옵션');
  const names = flowNames({});
  assert.equal(flowKind('feature/a', names), 'feature');
  assert.equal(flowKind('feature/', names), null, '이름 없는 접두어');
  assert.equal(flowKind('features/a', names), null);
  assert.equal(flowKind('', names), null);
});

test('윈도는 대소문자 없이, POSIX 는 대소문자까지 견준다', () => {
  const names = flowNames({});
  assert.equal(flowKind('FEATURE/a', names, true), 'feature');
  assert.equal(flowKind('Develop', names, true), 'develop');
  assert.equal(flowKind('MAIN', names, true), 'main');
  assert.equal(flowKind('Hotfix/x', names, true), 'hotfix');
  assert.equal(flowKind('FEATURE/a', names, false), null);
  assert.equal(flowKind('Develop', names, false), null);
  assert.equal(flowKind('MAIN', names, false), null);
  assert.equal(flowKind('feature/a', names, false), 'feature');
});

test('대문자 이름을 이 PC 의 파일 시스템대로 다룬다(윈도는 막고 POSIX 는 통과)', () => {
  setRules({ 'merge-flow': true, 'protect-branch': { branches: ['production', 'develop'] } });
  const got = bash('git merge FEATURE/login');
  if (process.platform === 'win32') assert.equal(got.length, 1);
  else assert.deepEqual(got, []);
});

test('보호 브랜치에 production·dev 를 적었으면 그 이름으로 막고 main 은 모르는 이름이 된다', () => {
  setRules({ 'merge-flow': true, 'protect-branch': { branches: ['production', 'dev'] } });
  const [msg] = bash('git merge feature/login');
  assert.match(msg, /production/);
  assert.match(msg, /`dev`/, '갈 길도 적은 이름으로');
  assert.equal(bash('git merge dev').length, 1, 'dev 를 배포 브랜치에');
  assert.deepEqual(bash('git switch main && git merge feature/login'), [], 'main 은 목록에 없어 모름');
  assert.deepEqual(bash('git switch develop && git merge feature/login'), []);
  setRules({ 'merge-flow': true });
  assert.deepEqual(bash('git merge feature/login'), [], '기본 이름이면 production 은 모름');
});

test('통합 브랜치 이름이 develop 꼴이 아니어도(integration) 목록의 이름으로 막고 알린다', () => {
  setRules({ 'merge-flow': true, 'protect-branch': { branches: ['production', 'integration', 'staging'] } });
  const [msg] = bash('git merge feature/login');
  assert.match(msg, /`integration`/);
  assert.doesNotMatch(msg, /develop/, '적지 않은 develop 은 글에 없다');
  assert.equal(bash('git merge integration').length, 1, '통합 브랜치를 배포 브랜치에 바로');
  assert.deepEqual(bash('git merge staging'), [], '환경 브랜치는 모르는 이름');
  assert.deepEqual(bash('git merge develop'), [], '목록에 없는 develop 은 모르는 이름');
  assert.deepEqual(bash('git switch integration && git merge feature/login'), [], 'feature 를 통합 브랜치에');
  setRules({ 'merge-flow': true, 'protect-branch': { branches: ['production'] } });
  const [none] = bash('git merge feature/login');
  assert.match(none, /통합 브랜치에 합치고/, '통합 브랜치를 적지 않았으면 이름 없이');
  assert.doesNotMatch(none, /develop/);
});

test('막는 글은 이름 끝소리에 따라 틀리는 조사를 이름 바로 뒤에 붙이지 않는다', () => {
  const ko = JSON.parse(fs.readFileSync(new URL('../messages/ko.json', import.meta.url), 'utf8'));
  const bad = /\{[a-z]+\}`?\s?(?:을|를|이|가|은|는|으로|로|와|과)(?![가-힣])/;
  for (const [k, v] of Object.entries(ko)) if (/^(?:mergeFlow|branchAge)\./.test(k)) assert.doesNotMatch(v, bad, k);
});

test('낱말 읽기: 값을 받는 옵션·묶음·-- 뒤, pull 의 refspec', () => {
  const L = new Set(['-m', '--message', '-s']);
  assert.deepEqual(positionalOf(['-m', 'feature/x', 'release/1'], L, 'ms'), ['release/1']);
  assert.deepEqual(positionalOf(['-mfeature/x', 'release/1'], L, 'ms'), ['release/1']);
  assert.deepEqual(positionalOf(['-qs', 'ours', 'a'], L, 'ms'), ['a']);
  assert.deepEqual(positionalOf(['--no-ff', '--', '-weird'], L, 'ms'), ['-weird']);
  assert.deepEqual(positionalOf(['-'], L, 'ms'), ['-']);
  assert.deepEqual(mergesOf('git pull origin +feature/a:feature/a', 'bash')[0].sources, ['feature/a']);
  assert.deepEqual(mergesOf('git pull --depth 3 origin develop', 'bash')[0].sources, ['develop']);
  assert.deepEqual(mergesOf('git pull origin', 'bash'), []);
});

test('git log --format=%at 출력 읽기: 가장 이른 작성 시각(차례가 섞여도)', () => {
  assert.equal(oldestOf('1700000300\n1700000100\n1700000200\n'), 1700000100);
  assert.equal(oldestOf(''), null);
  assert.equal(oldestOf('abc\n0\n'), null, '깨진 줄은 셈하지 않는다');
});

test('branch-age 는 보호 브랜치 목록의 트렁크와 견주고, 알림만 한다(막지 않음)', () => {
  setRules({ 'branch-age': true, 'protect-branch': { branches: ['production'] } });
  g('switch', '-q', '-c', 'feature/slow');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  g('add', 'a.txt');
  g('commit', '-q', '-m', 'feat: a', '--date', new Date(Date.now() - 5 * 86400000).toISOString());
  try {
    const hints = [];
    assert.deepEqual(bash('git commit -m "feat: b"', hints), [], '막지 않는다');
    assert.equal(hints.length, 1);
    assert.match(hints[0], /feature\/slow/);
    assert.match(hints[0], /5일/);
    assert.match(hints[0], /production/);
    const none = [];
    setRules({ 'branch-age': true });
    bash('git commit -m "feat: b"', none);
    assert.deepEqual(none, [], '트렁크 main 이 없으면(기본 이름) 조용히');
    setRules({ 'branch-age': { hours: 200 }, 'protect-branch': { branches: ['production'] } });
    bash('git commit -m "feat: b"', none);
    assert.deepEqual(none, [], '정한 시간 안쪽');
  } finally {
    g('switch', '-q', 'production');
  }
});

test('branch-age 는 세션마다 브랜치마다 한 번만 알린다(세션 id 가 없으면 날짜로), 표시를 못 적어도 알린다', () => {
  setRules({ 'branch-age': true, 'protect-branch': { branches: ['production'] } });
  g('switch', '-q', '-c', 'feature/once');
  fs.writeFileSync(path.join(repo, 'once.txt'), 'a\n');
  g('add', 'once.txt');
  g('commit', '-q', '-m', 'feat: once', '--date', new Date(Date.now() - 3 * 86400000).toISOString());
  try {
    const shown = (sid) => {
      const hints = [];
      bash('git commit -m "feat: b"', hints, sid);
      return hints.length;
    };
    assert.equal(shown('s-a'), 1, '세션 a 처음');
    assert.equal(shown('s-a'), 0, '세션 a 두 번째 커밋');
    const hints = [];
    bash('git push', hints, 's-a');
    assert.deepEqual(hints, [], '같은 세션의 push');
    assert.equal(shown('s-b'), 1, '다른 세션은 다시');
    assert.equal(shown(null), 1, '세션 id 없음 — 오늘 처음');
    assert.equal(shown(null), 0, '세션 id 없음 — 같은 날 두 번째');
    const files = fs.readdirSync(stampDir());
    assert.ok(files.length >= 1 && files.every((f) => /^[0-9a-f]{12}\.txt$/.test(f)), files.join(','));
    // 다른 브랜치는 따로 센다
    g('switch', '-q', '-c', 'feature/once-2');
    assert.equal(shown('s-a'), 1, '같은 세션이라도 다른 브랜치');
    // 설정 폴더가 파일이라 표시를 못 적으면: 터지지 않고 알리기만(다음에 또 알린다)
    const keep = process.env.CLAUDE_CONFIG_DIR;
    const blocker = path.join(tmp, 'not-a-dir');
    fs.writeFileSync(blocker, 'x');
    process.env.CLAUDE_CONFIG_DIR = blocker;
    try {
      assert.equal(shown('s-c'), 1);
      assert.equal(shown('s-c'), 1, '적지 못했으니 다시 알린다');
    } finally {
      process.env.CLAUDE_CONFIG_DIR = keep;
    }
  } finally {
    g('switch', '-q', 'production');
  }
});

test('branch-age 옵션 기본값은 화면 기본값과 같다', () => {
  const h = loadAll().packs.hooks.find((x) => x.id === 'branch-age');
  assert.equal(h.options.find((o) => o.key === 'hours').default, DEFAULT_MAX_HOURS);
  assert.equal(h.options.find((o) => o.key === 'commits').default, DEFAULT_MAX_BEHIND);
});
