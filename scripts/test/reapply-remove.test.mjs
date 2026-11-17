// 다시 적용할 때 빼기(plan.mjs): 고르지 않게 된 받은 그대로의 스킬 폴더와, 커밋 훅을 다 끈 뒤의 우리 git 훅. 백업이 사본을 남겨 되돌리기가 되살린다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { apply, undo } from '../lib/apply-run.mjs';
import { plan } from '../lib/plan.mjs';
import { env, all, baseSel, fakeInstall, SKILL_A, SKILL_B, textOf } from './remove-helpers.mjs';

let E;
before(() => { E = env(); });
after(() => E.done());
const HOOK = '.git/hooks/pre-commit';
const skillDir = (dir, id) => path.join(dir, '.claude', 'skills', id);
const go = (dir, over) => apply(dir, baseSel(over), () => {}, { install: fakeInstall });

test('고르지 않게 된 스킬: 받은 그대로면 빼고(화면 목록에도), 되돌리기가 되살린다', async () => {
  const dir = E.repo();
  await go(dir);
  const sel = baseSel({ skills: [SKILL_A] });
  const p = plan(dir, sel, all);
  const rm = p.changes.filter((c) => c.kind === 'skill-remove');
  assert.deepEqual(rm.map((c) => [c.removedSkill, c.action, c.skill]), [[SKILL_B, 'remove', undefined]], '받을 스킬(skill)로 잡히면 안 된다');
  assert.deepEqual(p.keptSkills, []);
  const r = await go(dir, { skills: [SKILL_A] });
  assert.ok(r.changed.includes(`- .claude/skills/${SKILL_B}`), r.changed.join('\n'));
  assert.ok(!fs.existsSync(skillDir(dir, SKILL_B)));
  assert.ok(fs.existsSync(path.join(skillDir(dir, SKILL_A), 'SKILL.md')));
  const u = undo(dir);
  assert.ok(u.restored.includes(`.claude/skills/${SKILL_B}`), JSON.stringify(u));
  assert.equal(textOf(dir, `.claude/skills/${SKILL_B}/ref/notes.md`), '보조 파일\n');
});

test('화면 확인 단계: 빼는 스킬·git 훅과 남긴 스킬 알림이 실제 계획과 같은 이름으로 보인다(ko·en)', async () => {
  const { outcomeItems, warningsOf, pathLines } = await import('../../picker/changes.js');
  const { fmt } = await import('../../picker/dom.js');
  const dir = E.repo();
  await go(dir);
  fs.appendFileSync(path.join(skillDir(dir, SKILL_A), 'SKILL.md'), '고침\n');
  const sel = baseSel({ skills: [], hooks: ['protect-branch'] });
  const p = plan(dir, sel, all);
  const preview = { ...p, changes: p.changes.map((c) => ({ action: c.action, kind: c.kind, skill: c.skill, removedSkill: c.removedSkill, path: path.relative(dir, c.path).split(path.sep).join('/') })) };
  const S = { skills: [{ id: SKILL_B, title: '스킬B' }, { id: SKILL_A, title: '스킬A' }] };
  for (const lang of ['ko', 'en']) {
    const s = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'picker', 'i18n', lang, 'review.json'), 'utf8'));
    const t = (k, v) => { assert.ok(s[k], `${lang} ${k}`); return fmt(s[k], v, lang); };
    const items = outcomeItems({ S, sel: { ...sel, hooks: new Set(sel.hooks) }, ui: { preview }, t });
    assert.ok(items.some(([, title, desc]) => title === t('wSkillsRemove', { n: 1 }) && desc.includes('스킬B')), JSON.stringify(items));
    assert.ok(items.some(([, title]) => title === t('wGitHookOff')));
    const warn = warningsOf({ S, ui: { preview }, t }).find(([id]) => id === 'skill-kept-edited');
    assert.ok(warn && warn[2].includes('스킬A'), JSON.stringify(warn));
  }
  assert.match(pathLines(S, preview), new RegExp(`^- \\.claude/skills/${SKILL_B}  — 스킬B$`, 'm'));
});

test('고르지 않게 된 스킬을 받은 뒤 고쳤으면 두고 알린다(skill-kept-edited · keptSkills)', async () => {
  const dir = E.repo();
  await go(dir);
  fs.appendFileSync(path.join(skillDir(dir, SKILL_B), 'SKILL.md'), '내 메모\n');
  const r = await go(dir, { skills: [SKILL_A] });
  assert.ok(r.warnings.includes('skill-kept-edited'));
  assert.deepEqual(r.keptSkills, [SKILL_B]);
  assert.ok(!r.changed.some((l) => l.includes(SKILL_B)));
  assert.match(textOf(dir, `.claude/skills/${SKILL_B}/SKILL.md`), /내 메모/);
});

test('사용자가 따로 둔 스킬(출처 표시 없음)은 고르지 않아도 건드리지 않는다', async () => {
  const dir = E.repo();
  fs.mkdirSync(skillDir(dir, 'mine'), { recursive: true });
  fs.writeFileSync(path.join(skillDir(dir, 'mine'), 'SKILL.md'), '내 스킬\n');
  await go(dir, { skills: [] });
  const p = plan(dir, baseSel({ skills: [] }), all);
  assert.ok(!p.changes.some((c) => c.kind === 'skill-remove'));
  assert.ok(fs.existsSync(path.join(skillDir(dir, 'mine'), 'SKILL.md')));
});

test('커밋 때 다시 보는 훅을 다 끄면 우리 git 훅을 빼고, 되돌리기가 되살린다 — 남의 훅은 그대로', async () => {
  const dir = E.repo();
  await go(dir, { skills: [] });
  const ours = textOf(dir, HOOK);
  assert.ok(ours);
  const r = await go(dir, { skills: [], hooks: ['protect-branch'] });
  assert.ok(r.changed.includes(`- ${HOOK}`), r.changed.join('\n'));
  assert.equal(textOf(dir, HOOK), null);
  undo(dir);
  assert.equal(textOf(dir, HOOK), ours);
  // 남의 훅이면 끄더라도 건드리지 않는다
  fs.writeFileSync(path.join(dir, HOOK), '#!/bin/sh\nnpm test\n');
  const p = plan(dir, baseSel({ skills: [], hooks: ['protect-branch'] }), all);
  assert.ok(!p.changes.some((c) => c.kind === 'git-hook-off'));
});
