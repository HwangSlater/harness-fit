// 이미 있는 것과 겹치면 기본에서 빼는지(2026-11-05 사용자 요청 「중복으로 적용하게 하면 안 된다」).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDir, gitInit } from './helpers.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { loadAll, expandCombo, recommend, applyFlow } from '../lib/catalog.mjs';
import { renderRule, ruleTexts } from '../lib/claude-md.mjs';
import { parseArgs } from '../lib/args.mjs';
import { listSkills } from '../lib/installed.mjs';
import { withHints } from '../detect.mjs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ownClaudeMd } from '../overlap.mjs';

// 다시 적용할 때 지난번에 넣은 관리 구역까지 견주면 규칙 줄이 모두 「이미 있음」으로 빠진다. 사용자가 쓴 글만 견준다.
test('겹침 견주기: 프로젝트 CLAUDE.md 는 harness-fit 관리 구역을 뺀 사용자 글만 준다', () => {
  const root = tmpDir('harness-own-');
  try {
    const md = (s) => fs.writeFileSync(path.join(root, 'CLAUDE.md'), s);
    assert.equal(ownClaudeMd(root), undefined, 'CLAUDE.md 가 없으면 줄 것이 없다');
    md('# 내 규칙\n- 테스트는 npm test\n');
    assert.equal(ownClaudeMd(root), undefined, '관리 구역이 없으면 대화에 든 글이 곧 사용자 글(다시 보내지 않음)');
    md('# 내 규칙\r\n- 테스트는 npm test\r\n\r\n<!-- harness-fit:start -->\r\n- 커밋 메시지는 한국어로\r\n<!-- harness-fit:end -->\r\n\r\n- 내 줄 끝\r\n');
    const own = ownClaudeMd(root);
    assert.ok(own.includes('테스트는 npm test') && own.includes('내 줄 끝'), own);
    assert.ok(!own.includes('커밋 메시지는 한국어로') && !own.includes('harness-fit:'), '관리 구역 안 글은 빠진다');
    md('<!-- harness-fit:end -->\n- 내 글\n<!-- harness-fit:start -->\n');
    assert.equal(ownClaudeMd(root), undefined, '짝이 안 맞는 표시는 구역으로 보지 않는다');
    // 실제 명령 출력: 구역만 있으면 사용자 글은 비어 있다(지난번에 넣은 줄을 「이미 있음」으로 보지 않게)
    md('<!-- harness-fit:start -->\n- 넣은 줄\n<!-- harness-fit:end -->\n');
    const script = fileURLToPath(new URL('../overlap.mjs', import.meta.url));
    const out = JSON.parse(execFileSync(process.execPath, [script, root, '--lang', 'ko'], { encoding: 'utf8' }));
    assert.equal(out.projectClaudeMd, '');
    assert.ok(Object.keys(out.rules).length > 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const all = loadAll();
const det = (existing = {}, extra = {}) => ({ stack: [], kinds: [], authors: 1, commits: 10, team: false, existing, ...extra });
const userHook = { 'git-add-all': { scope: 'user', by: ['guard-git.mjs'] }, 'protect-branch': { scope: 'user', by: ['guard-git.mjs'] } };
const projectHook = { secrets: { scope: 'project', by: ['team-guard.mjs'] } };

test('이 PC 에만 있는 훅과 겹치면 빼고, 팀원 공유 조합이면 남긴다', () => {
  const solo = expandCombo(all, 'solo', det({ hooks: { ...userHook, ...projectHook } }));
  assert.ok(!solo.hooks.includes('secrets'), '저장소에 있는 훅과 겹치면 뺀다');
  assert.deepEqual(solo.covered.sort(), ['git-add-all', 'protect-branch', 'secrets'], '조합에 없던 훅도 겹침으로 적어 둔다(브랜치 방식·규칙 글용)');
  assert.deepEqual(solo.already.hooks.map((x) => x.id), ['secrets'], '화면 안내는 조합에서 뺀 것만');
  const team = expandCombo(all, 'team', det({ hooks: { ...userHook, ...projectHook } }));
  assert.equal(team.share, true);
  assert.ok(team.hooks.includes('git-add-all') && team.hooks.includes('protect-branch'), '팀원에게는 전역 훅이 없으니 남긴다');
  assert.ok(!team.hooks.includes('secrets'), '저장소에 있는 훅은 팀원도 받으니 뺀다');
  assert.ok(team.base.hooks.includes('git-add-all'), '화면이 다시 계산하도록 원래 목록을 남긴다');
});

test('스택 스킬: RN 앱에 웹용 React 스킬을 넣지 않고, 파이썬이 있으면 pre-commit 을 두 번 세우지 않는다', async () => {
  const { detect } = await import('../detect.mjs');
  const dir = tmpDir('harness-rn-');
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0', 'react-native': '0.80.0', expo: '54.0.0' } }));
    const d = detect(dir);
    assert.ok(d.stack.includes('React Native') && !d.stack.includes('React'), d.stack.join(','));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0', vue: '3.5.0', svelte: '5.0.0' } }));
    assert.deepEqual(detect(dir).stack.filter((s) => ['React', 'Vue', 'Svelte'].includes(s)), ['React', 'Vue', 'Svelte'], '같은 줄의 다른 스택 감지가 사라지지 않게');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const ts = expandCombo(all, 'team', det({}, { stack: ['TypeScript'] }));
  assert.ok(ts.skills.includes('setup-pre-commit'));
  const both = expandCombo(all, 'team', det({}, { stack: ['TypeScript', 'Python'] }));
  assert.ok(!both.skills.includes('setup-pre-commit') && both.skills.includes('modern-python'));
});

test('적용: 플러그인이 없으면 알리고 규칙을 글로 쓰고, 사용자가 둔 같은 이름 스킬은 건드리지 않고, .claude/ 를 git 이 무시하면 알린다', async () => {
  const { plan } = await import('../lib/plan.mjs');
  const root = tmpDir('harness-plan-');
  try {
    gitInit(root);
    fs.writeFileSync(path.join(root, '.gitignore'), '.claude/\n');
    fs.mkdirSync(path.join(root, '.claude', 'skills', 'grilling'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'skills', 'grilling', 'SKILL.md'), '---\nname: grilling\n---\n내가 쓴 것');
    const sel = { lang: 'ko', combo: 'team', skills: ['grilling'], hooks: ['pin-deps'], rules: ['security'], flow: 'none', share: true, note: '', explore: [], covered: [], skipLines: {} };
    const off = plan(root, sel, all, { active: false });
    assert.ok(off.warnings.includes('plugin-missing') && off.warnings.includes('claude-ignored'), off.warnings.join(','));
    assert.deepEqual(off.skipped, ['grilling']);
    assert.ok(!off.changes.some((c) => c.skill === 'grilling'), '사용자 폴더를 덮어쓰지 않는다');
    const md = off.changes.find((c) => c.kind === 'claude-md').content;
    assert.match(md, /정확한 버전으로 넣는다/, '훅이 돌지 않으니 의존성 줄은 글로 남긴다');
    const on = plan(root, sel, all, { active: true });
    assert.ok(!on.warnings.includes('plugin-missing'));
    assert.doesNotMatch(on.changes.find((c) => c.kind === 'claude-md').content, /정확한 버전으로 넣는다/);
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), '{ 깨진');
    assert.ok(plan(root, sel, all, { active: true }).warnings.includes('settings-broken'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('브랜치 방식이 켜는 훅이라도 이미 있는 훅과 겹치면 다시 켜지 않는다', () => {
  const sel = expandCombo(all, 'solo', det({ hooks: { 'protect-branch': { scope: 'project', by: ['x.mjs'] } } }));
  applyFlow(all, sel, 'github-flow');
  assert.ok(!sel.hooks.includes('protect-branch'));
  assert.ok(sel.hooks.includes('branch-name'));
});

test('같은 이름의 스킬, Claude 가 짚은 비슷한 스킬은 빼고 이유를 남긴다', () => {
  const skillList = [{ id: 'handoff', name: 'handoff', scope: 'project' }, { id: 'my-tdd', name: 'my-tdd', scope: 'user' }];
  const d = det({ skillList, similar: [{ id: 'tdd-lite', to: 'my-tdd' }] });
  const r = recommend(all, d, 'ko');
  assert.equal(r.combo, 'solo');
  assert.ok(!r.skills.includes('handoff') && !r.skills.includes('tdd-lite'));
  assert.ok(r.why.some((w) => /my-tdd/.test(w)), r.why.join(' / '));
  assert.ok(r.why.every((w) => !/→ 「?tdd-lite」? 뺌/.test(w)), '이유에는 id 대신 쉬운 이름');
});

test('규칙 글: 이미 있는 훅이 막는 것은 「켜짐」 줄로, 이미 CLAUDE.md 에 있는 줄은 뺀다', () => {
  const sel = { lang: 'ko', flow: 'none', rules: ['security'], hooks: [], covered: ['pin-deps'], skipLines: {} };
  assert.doesNotMatch(ruleTexts(sel).security, /정확한 버전으로 넣는다/, '기존 훅이 막는 일은 글로 또 적지 않는다');
  assert.match(ruleTexts({ ...sel, covered: [] }).security, /정확한 버전으로 넣는다/, '막는 훅이 없으면 글로 남긴다');
  // 줄 번호는 파일 순서: 훅을 켜고 꺼도 같은 줄을 가리킨다
  const lines = fs.readFileSync(new URL('../../rules/security.ko.md', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => l.startsWith('- '));
  const last = lines.length;
  for (const hooks of [[], ['secrets', 'danger-cmd']]) {
    const text = renderRule('security', 'ko', hooks, [last]);
    assert.ok(!text.includes(lines[last - 1].slice(2, 20)), `마지막 줄이 빠져야: ${hooks}`);
  }
  assert.equal(renderRule('security', 'ko', [], lines.map((_, i) => i + 1)), '', '모든 줄이 빠지면 규칙째 뺀다');
});

test('인자: --similar·--skip 을 읽고, 이상한 값은 버린다', () => {
  const { hints } = parseArgs(['.', '--similar', 'code-simplification=refactor-check, bad', '--skip', 'structure:3,security:7,bad id:2,lean:0,collab:x']);
  assert.deepEqual(hints.similar, [{ id: 'code-simplification', to: 'refactor-check' }]);
  assert.deepEqual(hints.skip, { structure: [3], security: [7] });
  const d = withHints(det(), hints);
  assert.deepEqual(d.skipLines, { structure: [3], security: [7] });
  assert.equal(expandCombo(all, 'solo', d).skipLines.structure[0], 3, '선택에 실려 적용까지 간다');
});

test('이미 있는 스킬 목록: harness-fit 이 넣은 스킬은 「이미 있음」이 아니다', () => {
  const root = tmpDir('harness-skills-');
  const home = tmpDir('harness-home-');
  try {
    const mk = (base, name, extra) => {
      const d = path.join(base, '.claude', 'skills', name); fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'SKILL.md'), `---\nname: ${name}\ndescription: "${name} 설명"\n---\n본문`);
      if (extra) fs.writeFileSync(path.join(d, '.harness-source.json'), '{}');
    };
    mk(root, 'mine'); mk(root, 'from-harness', true); mk(home, 'global-one');
    const got = listSkills(root, home).map((s) => `${s.scope}:${s.name}:${s.description}`).sort();
    assert.deepEqual(got, ['project:mine:mine 설명', 'user:global-one:global-one 설명']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true });
  }
});
