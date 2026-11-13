// 스킬 목록 예산: 머리말 읽기, 지금 목록 크기(가짜 홈·플러그인), 예산 설정, 적용 계획의 skill-budget 경고와 「권장대로 줄이기」 차례,
// 카탈로그 설명 검사(외부 글이라 길이·「쓰는 때」는 보고만 한다).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDir, gitInit } from './helpers.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { skillMeta, saysWhen, parseFrontmatter, descReport } from '../lib/skill-meta.mjs';
import { currentListing, budgetFrom } from '../lib/skill-budget.mjs';
import { budgetOf, trimPlan, trimTier, entryChars, catalogChars, newSkills, DESC_CAP, DEFAULT_BUDGET } from '../../picker/budget.js';
import { plan } from '../lib/plan.mjs';
import { loadAll } from '../lib/catalog.mjs';
import { STATIC } from '../lib/static.mjs';

const all = loadAll();
let tmp;
before(() => (tmp = tmpDir('harness-budget-')));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let seq = 0;
const dir = (name) => fs.mkdirSync(path.join(tmp, `${name}${++seq}`), { recursive: true }) || path.join(tmp, `${name}${seq}`);
const write = (file, text) => (fs.mkdirSync(path.dirname(file), { recursive: true }), fs.writeFileSync(file, text));
const skill = (base, name, desc, extra = '') => write(path.join(base, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n${extra}---\n\n# ${name}\n본문\n`);

test('머리말: 한 줄·따옴표·블록 값·이어지는 줄, 설명이 없으면 본문 첫 문단', () => {
  assert.equal(skillMeta('---\nname: a\ndescription: "Say \\"hi\\". Use when greeting."\n---\n').description, 'Say "hi". Use when greeting.');
  assert.equal(skillMeta("---\nname: a\ndescription: 'it''s'\n---\n").description, "it's");
  assert.equal(skillMeta('---\r\nname: a\r\ndescription: >-\r\n  first line\r\n  second line\r\nwhen_to_use: when testing\r\n---\r\n').description, 'first line second line');
  assert.equal(skillMeta('---\nname: a\ndescription: |\n  one\n  two\n---\n').description, 'one\ntwo');
  assert.equal(skillMeta('---\nname: a\ndescription: plain\n  continued here\n---\n').description, 'plain continued here');
  assert.equal(skillMeta('---\nname: a\n---\n# Title\n\nFirst paragraph\nstill first.\n\nSecond.').description, 'First paragraph still first.');
  assert.equal(skillMeta('---\nname: a\ndisable-model-invocation: true\n---\n').hidden, true);
  assert.equal(skillMeta('no frontmatter at all', 'folder').name, 'folder');
  assert.deepEqual(parseFrontmatter('---\nbroken: "unclosed\n---\n').fields, { broken: '"unclosed' });
  assert.equal(skillMeta('---\nname: a\ndescription: x\nwhen_to_use: when the build fails\n---\n').whenToUse, 'when the build fails');
});

test('「쓰는 때」 부드러운 검사', () => {
  for (const d of ['Use when the build fails.', 'Load this skill BEFORE writing SQL', 'Use this skill any time a .pptx is involved', '기능을 끝냈을 때 쓰는 점검표', 'Applies to tasks involving Hermes']) assert.ok(saysWhen({ description: d, whenToUse: '' }), d);
  for (const d of ['Safety guardrails for destructive commands.', 'Navigation and routing for Expo Router.']) assert.ok(!saysWhen({ description: d, whenToUse: '' }), d);
  assert.ok(saysWhen({ description: 'Routing.', whenToUse: 'when routing' }));
});

test('목록 한 줄: 이름 + 설명(+ when_to_use), 설명은 1,536자에서 잘린다', () => {
  assert.equal(entryChars('abc', 'x'.repeat(10)), 13);
  assert.equal(entryChars('abc', 'x'.repeat(10), 'yyy'), 3 + 14);
  assert.equal(entryChars('abc', 'x'.repeat(5000)), 3 + DESC_CAP);
  assert.equal(entryChars('abc', 'x'.repeat(5000), '', 100), 103);
  assert.equal(catalogChars({ id: 'ab', descChars: 10 }), 12);
});

test('지금 목록: 사용자·프로젝트 스킬과 명령, 켜진 플러그인만 세고 disable-model-invocation 은 뺀다', () => {
  const home = dir('home');
  const root = dir('repo');
  const other = dir('other');
  skill(path.join(home, '.claude'), 'mine', 'm'.repeat(100));
  skill(path.join(home, '.claude'), 'quiet', 'q'.repeat(900), 'disable-model-invocation: true\n');
  write(path.join(home, '.claude', 'skills', 'not-a-skill', 'README.md'), 'no SKILL.md');
  write(path.join(home, '.claude', 'commands', 'deploy.md'), '---\ndescription: ship it\n---\nbody');
  skill(path.join(root, '.claude'), 'proj', 'p'.repeat(50));
  // 링크로 둔 스킬 폴더(이 PC 사용자 스킬의 절반) — Windows 는 정션이라 관리자 권한이 없어도 된다
  const real = dir('real');
  skill(real, 'linked', 'l'.repeat(30));
  fs.symlinkSync(path.join(real, 'skills', 'linked'), path.join(home, '.claude', 'skills', 'linked'), 'junction');
  // 플러그인 셋: 이 프로젝트에 켜짐 · 이 프로젝트에 깔렸지만 설정에서 끔 · 다른 프로젝트에만 깔림
  const plug = (id) => { const d = dir(`plug-${id}`); skill(d, `${id}-s`, 'z'.repeat(200)); write(path.join(d, 'commands', 'go.md'), '---\ndescription: go\n---\n'); return d; };
  const on = plug('on'); const off = plug('off'); const away = plug('away');
  write(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: {
    'on@m': [{ scope: 'project', projectPath: root, installPath: on }],
    'off@m': [{ scope: 'local', projectPath: root, installPath: off }],
    'away@m': [{ scope: 'project', projectPath: other, installPath: away }],
  } }));
  write(path.join(root, '.claude', 'settings.local.json'), JSON.stringify({ enabledPlugins: { 'off@m': false } }));
  const l = currentListing(root, { home, env: {}, contextTokens: 200000 });
  const want = (4 + 100) + (6 + 7) + (6 + 30) + (4 + 50) + ('on:on-s'.length + 200) + ('on:go'.length + 2);
  assert.equal(l.current, want);
  assert.equal(l.count, 6);
  assert.deepEqual(l.places.map((p) => p.where), ['user', 'project', 'plugin:on@m']);
  assert.deepEqual(l.present, ['proj']);
  assert.equal(l.budget, DEFAULT_BUDGET);
  assert.equal(l.budgetSource, 'default');
});

test('예산 설정: 환경 변수 > 설정 env > skillListingBudgetFraction > 기본 8,000자, skillListingMaxDescChars 는 줄마다 한도', () => {
  assert.deepEqual(budgetFrom({}, {}, 200000), { budget: 8000, budgetSource: 'default' });
  assert.deepEqual(budgetFrom({ skillListingBudgetFraction: 0.02 }, {}, 200000), { budget: 16000, budgetSource: 'fraction' });
  assert.deepEqual(budgetFrom({ skillListingBudgetFraction: 0.02, env: { SLASH_COMMAND_TOOL_CHAR_BUDGET: '12000' } }, {}, 200000), { budget: 12000, budgetSource: 'env' });
  assert.deepEqual(budgetFrom({ env: { SLASH_COMMAND_TOOL_CHAR_BUDGET: '12000' } }, { SLASH_COMMAND_TOOL_CHAR_BUDGET: '30000' }, 200000), { budget: 30000, budgetSource: 'env' });
  for (const bad of ['abc', '-5', '0', '']) assert.equal(budgetFrom({}, { SLASH_COMMAND_TOOL_CHAR_BUDGET: bad }, 200000).budgetSource, 'default', bad);
  for (const bad of [0, 2, 'x', -1]) assert.equal(budgetFrom({ skillListingBudgetFraction: bad }, {}, 200000).budgetSource, 'default', String(bad));
  const home = dir('home');
  const root = dir('repo');
  skill(path.join(home, '.claude'), 'long', 'x'.repeat(3000));
  write(path.join(home, '.claude', 'settings.json'), JSON.stringify({ skillListingMaxDescChars: 500, skillListingBudgetFraction: 0.05 }));
  const l = currentListing(root, { home, env: {}, contextTokens: 200000 });
  assert.equal(l.current, 4 + 500);
  assert.equal(l.maxDesc, 500);
  assert.deepEqual([l.budget, l.budgetSource], [40000, 'fraction']);
});

test('깨진 파일·없는 폴더는 건너뛴다', () => {
  const home = dir('home');
  const root = dir('repo');
  write(path.join(home, '.claude', 'settings.json'), '{ broken');
  write(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), 'not json');
  write(path.join(root, '.claude', 'skills', 'empty', 'SKILL.md'), '');
  const l = currentListing(root, { home, env: {}, contextTokens: 200000 });
  assert.equal(l.budget, DEFAULT_BUDGET);
  assert.equal(l.count, 1, '빈 SKILL.md 도 이름은 목록에 든다');
  assert.equal(currentListing(path.join(tmp, 'nope'), { home: path.join(tmp, 'nohome'), env: {}, contextTokens: 200000 }).current, 0);
});

test('80% 이상이면 near, 넘으면 over', () => {
  const L = { current: 6000, budget: 8000, budgetSource: 'default', maxDesc: DESC_CAP };
  assert.equal(budgetOf(L, []).level, 'ok');
  assert.equal(budgetOf(L, [{ id: 'a', descChars: 399 }]).level, 'near'); // 6400 = 80%
  assert.equal(budgetOf(L, [{ id: 'a', descChars: 2500 }, { id: 'b', descChars: 500 }]).level, 'over'); // 6000 + (1 + 1536) + (1 + 500)
  assert.equal(budgetOf(L, [{ id: 'a', descChars: 2500 }]).added, 1 + DESC_CAP);
});

test('「권장대로 줄이기」: 겹침 → 직접 더한 것 → 조합 → 스택 맞춤 차례로, 한도 아래가 될 때까지', () => {
  const ks = [
    { id: 'combo-a', descChars: 600 }, { id: 'combo-b', descChars: 900 }, { id: 'stack-a', descChars: 900 },
    { id: 'extra-a', descChars: 300 }, { id: 'dup-1', descChars: 500 }, { id: 'dup-2', descChars: 100 },
  ];
  const ids = ks.map((k) => k.id);
  const tierOf = trimTier({ comboSkills: new Set(['combo-a', 'combo-b']), stackSkills: new Set(['stack-a']), overlaps: [['dup-1', 'dup-2']] }, ids, (id) => ks.find((k) => k.id === id).descChars);
  assert.deepEqual(ids.map(tierOf), [2, 2, 3, 1, 0, 1], '겹침 묶음은 가장 짧은 것(dup-2)을 남긴다');
  const L = { current: 2000, budget: 8000, budgetSource: 'default', maxDesc: DESC_CAP };
  // 한도 안(80% 넘어도)이면 설명이 빠지지 않으니 뺄 것이 없다
  assert.deepEqual(trimPlan({ ...L, current: 4500 }, ks, tierOf), []);
  const big = { ...L, current: 5000 }; // 5000 + 3338 = 8338
  const drop = trimPlan(big, ks, tierOf);
  assert.deepEqual(drop, ['dup-1'], '넘친 만큼만 — 겹침 하나로 한도 아래');
  assert.ok(budgetOf(big, ks.filter((k) => !drop.includes(k.id))).ratio <= 1);
  // 지금 있는 것만으로 이미 80% 이상이어도 목표는 한도(100%) — 가벼운 것부터 빼되, 100% 를 넘지 않을 때까지(검토 2026-11-11)
  const full = { ...L, current: 7000 };
  const fullDrop = trimPlan(full, ks, tierOf);
  assert.equal(fullDrop[0], 'dup-1', fullDrop.join(',')); // 겹침이 가장 먼저(되살리기로 작은 것은 다시 들어올 수 있다)
  assert.ok(budgetOf(full, ks.filter((k) => !fullDrop.includes(k.id))).ratio <= 1, fullDrop.join(','));
  assert.deepEqual(trimPlan(L, [], tierOf), []);
});

test('「권장대로 줄이기」: 하는 일이 덜 중요한 것(git·ci·plan)부터 — 끝내기 전 확인(test)은 늦게(역할극 5 회차)', () => {
  const ks = [
    { id: 'verification-before-completion', descChars: 225, stages: ['test', 'review'] },
    { id: 'gha-security-review', descChars: 363, stages: ['security', 'ci'] },
    { id: 'grilling', descChars: 152, stages: ['plan'] },
    { id: 'handoff', descChars: 86, stages: ['git', 'meta'] },
  ];
  const ids = ks.map((k) => k.id);
  const by = (id) => ks.find((k) => k.id === id);
  const tierOf = trimTier({ comboSkills: new Set(['verification-before-completion', 'grilling', 'handoff']), stackSkills: new Set(['gha-security-review']), stagesOf: (id) => by(id).stages }, ids, (id) => by(id).descChars);
  const L = { current: 7000, budget: 8000, budgetSource: 'default', maxDesc: DESC_CAP };
  const order = trimPlan({ ...L, current: 2000, budget: 2500 }, ks, tierOf); // 2000 + 919 = 2919 > 2500
  // 빼는 차례(중요도): handoff < grilling < 끝내기 전 확인(조합) < gha(스택 맞춤 — 조합 스킬을 다 뺀 뒤에야). 빼는 결과는 되살리기로 달라지므로 차례 값으로 본다
  assert.ok(tierOf('handoff') <= tierOf('grilling') && tierOf('grilling') < tierOf('verification-before-completion') && tierOf('verification-before-completion') < tierOf('gha-security-review'));
  assert.ok(order.length > 0);
  assert.ok(!order.includes('gha-security-review'), order.join(','));
});

test('「권장대로 줄이기」: 스택에 맞춘 스킬은 일반 작업 스킬보다 늦게, 목표는 한도 그대로(역할극 14 회차: 778자 넘었는데 5개를 빼라고 했다)', () => {
  // 14 회차 숫자: 지금 6,313자 + 새 2,465자 = 8,778자 / 8,000자
  const ks = [
    { id: 'brainstorming', descChars: 480, stages: ['plan'] }, { id: 'writing-plans', descChars: 300, stages: ['plan'] },
    { id: 'receiving-code-review', descChars: 420, stages: ['review'] }, { id: 'finishing-a-development-branch', descChars: 250, stages: ['git'] },
    { id: 'supabase-postgres', descChars: 330, stages: ['impl'] }, { id: 'gha-security-review', descChars: 363, stages: ['security', 'ci'] },
  ];
  const by = (id) => ks.find((k) => k.id === id);
  const fill = 2465 - ks.reduce((a, k) => a + catalogChars(k), 0);
  ks[0].descChars += fill; // 합계를 2,465자로 맞춘다
  const tierOf = trimTier({ comboSkills: new Set(ks.slice(0, 4).map((k) => k.id)), stackSkills: new Set(['supabase-postgres', 'gha-security-review']), stagesOf: (id) => by(id).stages }, ks.map((k) => k.id), (id) => by(id).descChars);
  const L = { current: 6313, budget: 8000, budgetSource: 'default', maxDesc: DESC_CAP };
  assert.equal(budgetOf(L, ks).total, 8778);
  const drop = trimPlan(L, ks, tierOf);
  assert.ok(!drop.includes('supabase-postgres') && !drop.includes('gha-security-review'), drop.join(','));
  const after = budgetOf(L, ks.filter((k) => !drop.includes(k.id))).total;
  assert.ok(after <= 8000, `${after}`);
  // 뺀 것 하나를 다시 넣으면 한도를 넘는다(필요한 만큼만 뺐다)
  for (const id of drop) assert.ok(after + catalogChars(by(id)) > 8000, id);
  assert.ok(drop.length <= 2, drop.join(','));
});

test('80% 선 바로 아래(6,313/6,400자)에서 새 스킬을 다 빼라고 하지 않는다(역할극 8 회차 다시)', () => {
  const ks = Array.from({ length: 11 }, (_, i) => ({ id: `s${i}`, descChars: 240, stages: [i < 3 ? 'git' : 'test'] }));
  const tierOf = trimTier({ comboSkills: new Set(ks.map((k) => k.id)), stackSkills: new Set(), stagesOf: (id) => ks.find((k) => k.id === id).stages }, ks.map((k) => k.id), () => 240);
  const drop = trimPlan({ current: 6313, budget: 8000, budgetSource: 'default', maxDesc: DESC_CAP }, ks, tierOf);
  assert.ok(drop.length > 0 && drop.length < ks.length, drop.join(','));
});

test('새로 들어가는 스킬: 복사 설치 + 프로젝트에 같은 폴더가 없는 것만', () => {
  const ks = [{ id: 'a', install: 'copy' }, { id: 'b', install: 'plugin' }, { id: 'c', install: 'copy' }];
  assert.deepEqual(newSkills(ks, new Set(['a', 'b', 'c', 'zz']), ['c']).map((k) => k.id), ['a']);
});

test('적용 계획: 스킬이 많은 홈이면 skill-budget 경고와 숫자, 지금 폴더를 고치는 스킬은 새로 세지 않는다', () => {
  const home = dir('home');
  const root = dir('repo');
  gitInit(root);
  for (let i = 0; i < 40; i++) skill(path.join(home, '.claude'), `fake-${i}`, 'd'.repeat(150));
  const copy = all.catalog.skills.filter((k) => k.install === 'copy').slice(0, 4).map((k) => k.id);
  const sel = { lang: 'ko', combo: 'solo', skills: copy, hooks: [], rules: [], flow: 'none', explore: [], note: '', share: false };
  const p = plan(root, sel, all, { active: true, home });
  assert.ok(p.warnings.includes('skill-budget'), p.warnings.join(','));
  const b = p.skillBudget;
  assert.equal(b.current, 10 * (6 + 150) + 30 * (7 + 150), '이름(fake-0~9 는 6자, 10~39 는 7자) + 설명 150자');
  const want = copy.map((id) => catalogChars(all.catalog.skills.find((k) => k.id === id))).reduce((a, x) => a + x, 0);
  assert.equal(b.added, want);
  assert.equal(b.total, b.current + b.added);
  assert.equal(b.budget, 8000);
  assert.ok(['near', 'over'].includes(b.level));
  assert.ok(Array.isArray(b.trim) && b.trim.every((id) => copy.includes(id)));
  // 전에 harness-fit 이 넣은 폴더가 있으면 그 자리에서 고치는 것이라 새로 세지 않는다
  write(path.join(root, '.claude', 'skills', copy[0], 'SKILL.md'), '---\nname: x\ndescription: y\n---\n');
  write(path.join(root, '.claude', 'skills', copy[0], '.harness-source.json'), '{}');
  const again = plan(root, sel, all, { active: true, home });
  assert.equal(again.skillBudget.added, want - catalogChars(all.catalog.skills.find((k) => k.id === copy[0])));
  // 스킬이 적으면 경고가 없다
  const quiet = plan(root, sel, all, { active: true, home: dir('emptyhome') });
  assert.ok(!quiet.warnings.includes('skill-budget'));
  assert.equal(quiet.skillBudget.level, 'ok');
});

test('카탈로그 설명: 모든 스킬에 잰 값이 있다(1,536자 넘김·「쓰는 때」는 외부 글이라 보고만)', (t) => {
  for (const k of all.catalog.skills) {
    assert.ok(Number.isInteger(k.descChars) && k.descChars > 0, `${k.id}: descChars — node scripts/dev/check-descriptions.mjs`);
    assert.equal(typeof k.saysWhen, 'boolean', `${k.id}: saysWhen`);
  }
  const r = descReport(all.catalog.skills);
  t.diagnostic(`1,536자 넘김 ${r.truncated.length}${r.truncated.length ? `: ${r.truncated.join(', ')}` : ''}`);
  t.diagnostic(`쓰는 때를 밝히지 않음 ${r.noWhen.length}: ${r.noWhen.join(', ')}`);
  t.diagnostic(`가장 긴 것: ${r.longest.join(', ')}`);
});

test('화면 파일 목록에 예산 화면 파일이 있다', () => {
  assert.ok(STATIC['/budget.js'] && STATIC['/budget-view.js']);
});

test('줄이기 차례표(STAGE_KEEP)에 카탈로그의 stage 가 모두 있다', async () => {
  const { STAGE_KEEP } = await import('../../picker/budget.js');
  const all = loadAll();
  const stages = new Set(all.catalog.skills.flatMap((s) => s.stages || []));
  for (const s of stages) assert.ok(s in STAGE_KEEP, `STAGE_KEEP 에 없음: ${s}`);
});
