// 시험: node --test scripts/test/*.test.mjs  (네트워크 없이 도는 것만)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildClaudeMd, buildConfig, plan, undo } from '../apply.mjs';
import { loadAll, expandCombo, recommend } from '../lib/catalog.mjs';

const all = loadAll();
const base = { lang: 'ko', combo: 'team', skills: [], hooks: ['protect-branch', 'branch-name', 'commit-msg', 'secrets'], rules: ['lean'], flow: 'git-flow' };

test('CLAUDE.md: 사용자 글은 남기고 관리 구역만 넣고·바꾸고·지운다', () => {
  const mine = '# 내 프로젝트\n\n내 규칙.\n';
  const once = buildClaudeMd(mine, base);
  assert.ok(once.startsWith(mine.trim()));
  assert.match(once, /<!-- harness-fit:start -->[\s\S]*Git Flow[\s\S]*<!-- harness-fit:end -->/);
  assert.equal(buildClaudeMd(once, base), once, '같은 선택을 두 번 적용해도 그대로');
  const changed = buildClaudeMd(once, { ...base, flow: 'trunk' });
  assert.match(changed, /트렁크/);
  assert.doesNotMatch(changed, /Git Flow/);
  const removed = buildClaudeMd(once, { ...base, flow: 'none', rules: [] });
  assert.doesNotMatch(removed, /harness-fit:start/);
  assert.match(removed, /내 규칙/);
});

test('harness.json: Git 전략이 보호 브랜치·브랜치 이름 옵션을 정한다', () => {
  const cfg = buildConfig(all, base);
  assert.deepEqual(cfg.rules['protect-branch'].branches, ['main', 'master', 'develop']);
  assert.match(cfg.rules['branch-name'].pattern, /release/);
  assert.equal(cfg.rules.secrets, true);
  const trunk = buildConfig(all, { ...base, flow: 'trunk' });
  assert.equal(trunk.rules['protect-branch'].allowCommit, true);
});

test('추천: 팀이면 팀 협업 + GitHub Flow, 스택 스킬이 붙는다', () => {
  const det = { stack: ['Next.js', 'TypeScript'], authors: 3, team: true, host: 'github', commits: 40, hasDevelop: false };
  const r = recommend(all, det, 'ko');
  assert.equal(r.combo, 'team');
  assert.equal(r.flow, 'github-flow');
  assert.ok(r.skills.includes('react-best-practices'));
  assert.ok(r.skills.includes('setup-pre-commit'), '팀 조합에만 붙는 스킬');
  assert.ok(!expandCombo(all, 'solo', det).skills.includes('setup-pre-commit'));
});

test('조합에 적힌 스킬·훅은 모두 카탈로그에 있다', () => {
  const skills = new Set(all.catalog.skills.map((s) => s.id));
  const hooks = new Set(all.packs.hooks.map((h) => h.id));
  for (const c of all.combos.combos) {
    for (const s of c.skills) assert.ok(skills.has(s), `${c.id}: 없는 스킬 ${s}`);
    for (const h of c.hooks) assert.ok(hooks.has(h), `${c.id}: 없는 훅 ${h}`);
  }
  for (const a of all.combos.stackAddons) for (const s of a.skills) assert.ok(skills.has(s), `stackAddons: 없는 스킬 ${s}`);
});

test('미리보기는 파일을 바꾸지 않고, 되돌릴 것이 없으면 알린다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-apply-'));
  const { changes } = plan(dir, { ...base, skills: ['handoff'] }, all);
  assert.ok(changes.some((c) => c.skill === 'handoff'));
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.deepEqual(undo(dir), { error: 'no-backup' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLAUDE.md 문장은 실제로 켠 훅을 따른다', async () => {
  const { renderRule } = await import('../lib/claude-md.mjs');
  const on = renderRule('collab', 'ko', ['commit-msg']);
  const off = renderRule('collab', 'ko', []);
  assert.match(on, /훅이 막는다/);
  assert.doesNotMatch(off, /훅/);
  assert.doesNotMatch(on + off, /\{\{/);
  assert.match(renderRule('github-flow', 'ko', []), /PR 로 합친다/);
  assert.doesNotMatch(renderRule('github-flow', 'ko', []), /훅이 막는다/);
});

test('브랜치 방식이 훅을 켜고 끈다', async () => {
  const { applyFlow } = await import('../lib/catalog.mjs');
  const sel = { flow: 'github-flow', hooks: ['secrets', 'protect-branch', 'branch-name'] };
  assert.deepEqual(applyFlow(all, { ...sel }, 'none').hooks, ['secrets']);
  assert.deepEqual(applyFlow(all, { ...sel }, 'trunk').hooks.sort(), ['protect-branch', 'secrets']);
  assert.deepEqual(applyFlow(all, { flow: 'none', hooks: ['secrets'] }, 'git-flow').hooks.sort(), ['branch-name', 'protect-branch', 'secrets']);
});

test('팀원 설치 안내: 기존 설정은 두고 두 항목만 더한다', async () => {
  const { buildSettings } = await import('../apply.mjs');
  const src = all.sources;
  const out = JSON.parse(buildSettings(JSON.stringify({ permissions: { allow: ['Bash(ls)'] } }), src));
  assert.deepEqual(out.permissions, { allow: ['Bash(ls)'] });
  assert.equal(out.enabledPlugins[src.pluginId], true);
  assert.equal(out.extraKnownMarketplaces[src.marketplace].source.repo, src.pluginRepo);
  assert.match(out.extraKnownMarketplaces[src.marketplace].source.ref, /^v\d+\.\d+\.\d+$/, '팀원이 받는 버전은 태그로 고정');
  assert.equal(buildSettings('{ 깨진', src), null, '깨진 파일은 건드리지 않는다');
});

test('요청 칸과 팀 공유는 파일 목록에 들어간다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-plan-'));
  const kinds = plan(dir, { ...base, note: '커밋은 한국어로', share: true }, all).changes.map((c) => c.kind);
  assert.ok(kinds.includes('request') && kinds.includes('share') && kinds.includes('claude-md'));
  assert.ok(!plan(dir, { ...base, note: '  ', share: false }, all).changes.some((c) => c.kind === 'request' || c.kind === 'share'));
  fs.rmSync(dir, { recursive: true, force: true });
});
