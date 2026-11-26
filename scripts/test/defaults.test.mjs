// 조합 기본값(2026-11-09 사용자 결정): 개인 습관 훅은 기본에서 빼고, 형식 훅은 저장소 기록이 그 꼴일 때만,
// 의존성 고정은 꼼꼼하게 조합에서만(라이브러리 패키지는 뺌), prefer-gh 는 알리기만. 버전 세 곳이 같은지도 본다.
// 감지(스택 읽기) 시험은 detect-stacks.test.mjs — 한 파일이 시험 전체에서 가장 오래 걸려 나눴다(2026-11-19)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadAll, expandCombo, recommend, applyFlow, fitOff, commitLang, PLUGIN_ROOT } from '../lib/catalog.mjs';
import { makeState } from '../lib/picker-state.mjs';
import { detect } from '../detect.mjs';
import { tmpDir, writeFiles, historyRepo, gitQuiet as git } from './helpers.mjs';

const all = loadAll();
const cfg = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'config', 'picker.json'), 'utf8'));
const tmp = () => tmpDir('harness-defaults-');
const repo = ({ subjects = [], branches = [], pkg = null } = {}) => {
  const dir = historyRepo({ subjects, branches, prefix: 'harness-defaults-' });
  if (pkg) writeFiles(dir, { 'package.json': pkg });
  return dir;
};
const off = (dir) => fitOff(all, detect(dir));
const LOOSE = ['로그인 고침', 'update readme', 'wip', '버튼 색', 'Merge fix', 'tweak'];
const CONV = ['feat: 로그인', 'fix(api): 빈 응답', 'docs: 설치', 'chore: 정리', 'refactor!: 이름', 'test: 장바구니'];
const put = (dir, rel, text) => writeFiles(dir, { [rel]: text });

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
    assert.ok(r.why.some((w) => w.includes('커밋 기록이 이 형식이 아니라')), r.why.join(' / '));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('형식 훅: conventional 기록·빈 저장소·커밋이 아주 적은 저장소는 켠다', () => {
  const dirs = [repo({ subjects: [...CONV, 'oops'] }), repo(), repo({ subjects: LOOSE.slice(0, 3) })];
  try {
    for (const dir of dirs) {
      const det = detect(dir);
      assert.deepEqual(Object.keys(fitOff(all, det).hooks).filter((id) => id === 'commit-msg'), [], dir);
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
    // 감지는 폴더가 그대로인 동안 한 번만(시험 시간 — 감지 한 번에 git 을 열 번 넘게 띄운다)
    const detLoose = detect(loose);
    const f = fitOff(all, detLoose);
    assert.deepEqual(f.flows['github-flow']['branch-name'].vars, { n: 4, k: 1 });
    assert.ok(f.flows['git-flow']['branch-name']);
    const sel = expandCombo(all, 'team', detLoose);
    assert.ok(!sel.hooks.includes('branch-name') && sel.fitDropped.includes('branch-name'));
    assert.ok(!applyFlow(all, { ...sel, hooks: [] }, 'git-flow').hooks.includes('branch-name'), '브랜치 전략을 바꿔도 켜지 않는다');
    const S = makeState({ all, cfg, det: detLoose }, 'ko');
    const gh = S.flows.find((x) => x.id === 'github-flow');
    assert.ok(!gh.hooksOn.includes('branch-name') && gh.fitDropped.includes('branch-name'), '화면 브랜치 전략도 같은 데이터');
    // github-flow 꼴(fix/·feat/)은 맞지만 git-flow 꼴(feature/·release/…)에는 1개만 맞는다
    const detGood = detect(good);
    const g = fitOff(all, detGood);
    assert.ok(!g.flows['github-flow'] && g.flows['git-flow']);
    assert.ok(expandCombo(all, 'team', detGood).hooks.includes('branch-name'));
  } finally {
    for (const d of [loose, good]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('의존성 고정: 라이브러리 패키지(main·exports·types, private 아님)면 꼼꼼하게 조합에서도 뺀다', () => {
  const lib = repo({ pkg: { name: 'lib', main: 'index.js' } });
  const app = repo({ pkg: { name: 'app', main: 'index.js', private: true } });
  const plain = repo({ pkg: { name: 'svc', scripts: { start: 'node .' } } });
  try {
    const det = new Map([lib, app, plain].map((d) => [d, detect(d)]));
    assert.ok(det.get(lib).library && !det.get(app).library && !det.get(plain).library);
    assert.ok(!expandCombo(all, 'strict', det.get(lib)).hooks.includes('pin-deps'));
    assert.equal(fitOff(all, det.get(lib)).hooks['pin-deps'].key, 'fitPinDeps');
    for (const d of [app, plain]) assert.ok(expandCombo(all, 'strict', det.get(d)).hooks.includes('pin-deps'), d);
    assert.ok(!expandCombo(all, 'team', det.get(plain)).hooks.includes('pin-deps'));
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

test('볼 파일이 없는 훅은 기본에서 뺀다: JS 없으면 unsafe-html, 워크플로 파일 없으면 gha-inject(빈 폴더도)', () => {
  const py = repo({ subjects: CONV });
  const web = repo({ subjects: CONV, pkg: { name: 'w', private: true, dependencies: { react: '18.0.0' } } });
  try {
    fs.mkdirSync(path.join(py, '.github', 'workflows'), { recursive: true }); // 빈 폴더는 GitHub Actions 가 아니다
    const detPy = detect(py);
    const f = fitOff(all, detPy);
    assert.ok(f.hooks['unsafe-html'] && f.hooks['gha-inject'], JSON.stringify(f.hooks));
    assert.ok(!expandCombo(all, 'team', detPy).hooks.includes('unsafe-html'));
    fs.mkdirSync(path.join(web, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(web, '.github', 'workflows', 'ci.yml'), 'on: push\n');
    const w = off(web);
    assert.ok(!w.hooks['unsafe-html'] && !w.hooks['gha-inject'], JSON.stringify(w.hooks));
  } finally {
    for (const d of [py, web]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('커밋 기록 언어: 한 언어가 70% 넘으면 커밋 메시지 언어 검사를 그 언어로, 적거나 섞이면 정하지 않는다', () => {
  assert.equal(commitLang({ subjects: 6, korean: 6, english: 0 }), 'ko');
  assert.equal(commitLang({ subjects: 6, korean: 0, english: 5 }), 'en');
  assert.equal(commitLang({ subjects: 6, korean: 3, english: 3 }), null);
  assert.equal(commitLang({ subjects: 3, korean: 3, english: 0 }), null, '기록이 적으면');
  const ko = repo({ subjects: CONV });
  try {
    const sel = expandCombo(all, 'team', detect(ko));
    assert.deepEqual(sel.hookOpts['commit-msg'], { lang: 'ko' });
  } finally {
    fs.rmSync(ko, { recursive: true, force: true });
  }
});

test('--catalog 요약: 훅마다 막는 꼴(blocks)·옵션, 스킬마다 이름·쓰는 때 — 세션이 카탈로그 파일을 직접 읽지 않게', async () => {
  const { catalogDigest } = await import('../lib/catalog.mjs');
  for (const lang of ['ko', 'en']) {
    const d = catalogDigest(all, lang);
    assert.equal(d.hooks.length, all.packs.hooks.length);
    for (const h of d.hooks) assert.ok(h.name && h.desc && h.blocks, `${lang} ${h.id}`);
    const pf = d.hooks.find((h) => h.id === 'protected-files');
    assert.deepEqual(pf.options.map((o) => o.key), ['paths', 'askRead']);
    assert.ok(d.hooks.find((h) => h.id === 'commit-msg').options.find((o) => o.key === 'lang').choices.includes('ko'));
    assert.equal(d.skills.length, all.catalog.skills.length);
    assert.ok(d.skills.every((s) => s.id && s.title));
  }
});

test('검토 반영: 화면도 커밋 기록 언어를 기본으로 쓰고(사용자가 고친 것이 앞섬), package.json 없는 정적 사이트도 JS·HTML 로 보고, 봇 커밋은 세지 않는다', async () => {
  const { fromCombo } = await import('../../picker/selection.js');
  const k = { id: 'team', flow: 'github-flow', skills: [], hooks: ['commit-msg'], rules: [], hookOpts: { 'commit-msg': { lang: 'ko' } } };
  const { sentOpts } = await import('../../picker/hook-options.js');
  const sent = (x, prev = {}) => sentOpts(x.baseOpts, prev, x.hookOpts);
  assert.deepEqual(sent(fromCombo(k, null)), { 'commit-msg': { lang: 'ko' } });
  assert.deepEqual(sent(fromCombo(k, { hookOpts: { 'commit-msg': { lang: 'any', style: 'free' } } })), { 'commit-msg': { lang: 'any', style: 'free' } });
  // 지난번 harness.json 에 적어 둔 값은 조합 값이 덮지 않는다(ROS 기본 명령 목록이 사용자 목록을 지우던 일 — 검토 2026-11-11)
  const ros = { ...k, hookOpts: { 'ask-cmd': { commands: ['ros2 launch'] } } };
  assert.deepEqual(sent(fromCombo(ros, null), { 'ask-cmd': { commands: ['python scripts/train.py'], remote: false } }), {});
  assert.deepEqual(fromCombo(ros, null).hookOpts, {}, '조합 값은 사용자가 고친 것으로 치지 않는다');
  const site = repo({ subjects: CONV });
  try {
    put(site, 'index.html', '<!doctype html>\n');
    const det = detect(site);
    assert.equal(det.js, true, '정적 사이트');
    assert.ok(!fitOff(all, det).hooks['unsafe-html']);
    // 봇 커밋 6개 + 사람 영어 제목·한국어 본문: en 으로 정하지 않는다
    for (let i = 0; i < 6; i++) git(site, '-c', 'user.name=dependabot[bot]', '-c', 'user.email=bot@x', 'commit', '-q', '--allow-empty', '-m', `chore(deps): bump x ${i}`);
    for (let i = 0; i < 5; i++) git(site, 'commit', '-q', '--allow-empty', '-m', `fix: login ${i}`, '-m', '로그인 오류 고침');
    const h = detect(site).history;
    assert.equal(h.messages, 11, '봇 6개를 뺀 수(CONV 6 + 사람 5)');
    assert.equal(commitLang({ ...h }), null, JSON.stringify(h));
  } finally {
    fs.rmSync(site, { recursive: true, force: true });
  }
});
