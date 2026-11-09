// 조합 기본값(2026-11-09 사용자 결정): 개인 습관 훅은 기본에서 빼고, 형식 훅은 저장소 기록이 그 꼴일 때만,
// 의존성 고정은 꼼꼼하게 조합에서만(라이브러리 패키지는 뺌), prefer-gh 는 알리기만. 버전 세 곳이 같은지도 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadAll, expandCombo, recommend, applyFlow, fitOff, PLUGIN_ROOT } from '../lib/catalog.mjs';
import { makeState } from '../lib/picker-state.mjs';
import { detect } from '../detect.mjs';

const all = loadAll();
const cfg = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'config', 'picker.json'), 'utf8'));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'harness-defaults-'));
// 사용자 PC 의 전역 git 훅이 시험 커밋에 끼지 않게 hooksPath 를 빈 폴더로 돌린다
const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', `core.hooksPath=${path.join(dir, '.nohooks')}`, ...args], { stdio: 'ignore' });
const repo = ({ subjects = [], branches = [], pkg = null } = {}) => {
  const dir = tmp();
  git(dir, 'init', '-q', '-b', 'main');
  if (pkg) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  for (const s of subjects) git(dir, 'commit', '-q', '--allow-empty', '-m', s);
  for (const b of branches) git(dir, 'branch', b);
  return dir;
};
const off = (dir) => fitOff(all, detect(dir));
const LOOSE = ['로그인 고침', 'update readme', 'wip', '버튼 색', 'Merge fix', 'tweak'];
const CONV = ['feat: 로그인', 'fix(api): 빈 응답', 'docs: 설치', 'chore: 정리', 'refactor!: 이름', 'test: 장바구니'];

test('개인 습관·엄격한 훅은 어느 조합도 기본으로 켜지 않지만 고를 수는 있다', () => {
  for (const id of ['commit-hash', 'work-checklist', 'docs-check']) {
    assert.ok(all.packs.hooks.some((h) => h.id === id), `${id} 는 훅 목록에 남는다`);
    for (const c of all.combos.combos) assert.ok(!c.hooks.includes(id), `${c.id}: ${id}`);
  }
  const pin = all.combos.combos.filter((c) => c.hooks.includes('pin-deps')).map((c) => c.id);
  assert.deepEqual(pin, ['strict']);
});

test('형식 훅: 커밋 기록이 conventional 꼴이 아니면 commit-msg 를 기본에서 뺀다', () => {
  const dir = repo({ subjects: LOOSE });
  try {
    const det = detect(dir);
    const f = fitOff(all, det);
    assert.deepEqual(f.hooks['commit-msg'], { key: 'fitCommitMsg', vars: { n: 6, k: 0 } });
    const sel = expandCombo(all, 'team', det);
    assert.ok(!sel.hooks.includes('commit-msg') && sel.fitDropped.includes('commit-msg'));
    const r = recommend(all, { ...det, authors: 2, team: true, existing: {} }, 'ko');
    assert.ok(r.why.some((w) => w.includes('커밋 기록이 이 꼴이 아니라')), r.why.join(' / '));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('형식 훅: conventional 기록·빈 저장소·커밋이 아주 적은 저장소는 켠다', () => {
  const dirs = [repo({ subjects: [...CONV, 'oops'] }), repo(), repo({ subjects: LOOSE.slice(0, 3) })];
  try {
    for (const dir of dirs) {
      const det = detect(dir);
      assert.deepEqual(fitOff(all, det).hooks, {}, dir);
      assert.ok(expandCombo(all, 'team', det).hooks.includes('commit-msg'), dir);
    }
  } finally {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('형식 훅: 브랜치 이름이 브랜치 전략 꼴이 아니면 branch-name 을 켜지 않는다(전략마다 따로)', () => {
  const loose = repo({ subjects: CONV.slice(0, 1), branches: ['wip', 'kim-test', 'new-ui', 'feature/a'] });
  const good = repo({ subjects: CONV.slice(0, 1), branches: ['feature/a', 'fix/b', 'feat/c'] });
  try {
    const f = off(loose);
    assert.deepEqual(f.flows['github-flow']['branch-name'].vars, { n: 4, k: 1 });
    assert.ok(f.flows['git-flow']['branch-name']);
    const sel = expandCombo(all, 'team', detect(loose));
    assert.ok(!sel.hooks.includes('branch-name') && sel.fitDropped.includes('branch-name'));
    assert.ok(!applyFlow(all, { ...sel, hooks: [] }, 'git-flow').hooks.includes('branch-name'), '브랜치 전략을 바꿔도 켜지 않는다');
    const S = makeState({ all, cfg, det: detect(loose) }, 'ko');
    const gh = S.flows.find((x) => x.id === 'github-flow');
    assert.ok(!gh.hooksOn.includes('branch-name') && gh.fitDropped.includes('branch-name'), '화면 브랜치 전략도 같은 데이터');
    // github-flow 꼴(fix/·feat/)은 맞지만 git-flow 꼴(feature/·release/…)에는 1개만 맞는다
    const g = off(good);
    assert.ok(!g.flows['github-flow'] && g.flows['git-flow']);
    assert.ok(expandCombo(all, 'team', detect(good)).hooks.includes('branch-name'));
  } finally {
    for (const d of [loose, good]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('의존성 고정: 라이브러리 패키지(main·exports·types, private 아님)면 꼼꼼하게 조합에서도 뺀다', () => {
  const lib = repo({ pkg: { name: 'lib', main: 'index.js' } });
  const app = repo({ pkg: { name: 'app', main: 'index.js', private: true } });
  const plain = repo({ pkg: { name: 'svc', scripts: { start: 'node .' } } });
  try {
    assert.ok(detect(lib).library && !detect(app).library && !detect(plain).library);
    assert.ok(!expandCombo(all, 'strict', detect(lib)).hooks.includes('pin-deps'));
    assert.equal(off(lib).hooks['pin-deps'].key, 'fitPinDeps');
    for (const d of [app, plain]) assert.ok(expandCombo(all, 'strict', detect(d)).hooks.includes('pin-deps'), d);
    assert.ok(!expandCombo(all, 'team', detect(plain)).hooks.includes('pin-deps'));
  } finally {
    for (const d of [lib, app, plain]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('prefer-gh: 실제 진입점이 막지 않고 Claude 문맥에 한 줄을 더한다', () => {
  const dir = tmp();
  try {
    fs.mkdirSync(path.join(dir, '.claude'));
    fs.writeFileSync(path.join(dir, '.claude', 'harness.json'), JSON.stringify({ lang: 'ko', rules: { 'prefer-gh': true } }));
    const run = (url) => JSON.parse(execFileSync(process.execPath, [path.join(PLUGIN_ROOT, 'hooks', 'run.mjs')], {
      input: JSON.stringify({ tool_name: 'WebFetch', cwd: dir, tool_input: { url, prompt: 'x' } }), encoding: 'utf8' }) || '{}');
    const out = run('https://github.com/owner/repo');
    assert.equal(out.hookSpecificOutput.permissionDecision, undefined, '막지 않는다');
    assert.match(out.hookSpecificOutput.additionalContext, /gh/);
    assert.deepEqual(run('https://docs.github.com/en'), {});
    assert.equal(all.packs.hooks.find((h) => h.id === 'prefer-gh').kind, 'notice');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('버전: plugin.json · package.json · config/sources.json pluginRef 가 같다', () => {
  const read = (rel) => JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, rel), 'utf8'));
  const v = read('package.json').version;
  assert.equal(read('.claude-plugin/plugin.json').version, v);
  assert.equal(all.sources.pluginRef, `v${v}`);
});
