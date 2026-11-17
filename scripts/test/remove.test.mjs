// 프로젝트를 끝낼 때 지우기(apply.mjs --remove — scripts/lib/remove.mjs): 백업 없이도 우리 것만, 사용자가 고친 것·남의 것·연결은 남기고 알린다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { apply } from '../lib/apply-run.mjs';
import { BACKUP_DIR } from '../lib/backup.mjs';
import { removeAll } from '../lib/remove.mjs';
import { MARKER, launcherText, PLUGIN_DIR, preCommitSnippet } from '../../hooks/lib/git-hook.mjs';
import { env, baseSel, fakeInstall, SKILL_A, SKILL_B, textOf, leftOver } from './remove-helpers.mjs';

let E;
before(() => { E = env(); });
after(() => E.done());
const HOOK = '.git/hooks/pre-commit';
const run = (dir, opts = {}) => removeAll(dir, { home: E.home, ...opts });
const applied = async (dir, over) => apply(dir, baseSel({ note: '테스트는 npm test', ...over }), () => {}, { install: fakeInstall });
const kinds = (r) => r.manual.map((m) => m.kind).sort();

test('적용 뒤 지우기: 넣은 것이 모두 빠지고 사용자 파일만 남는다', async () => {
  const dir = E.repo();
  fs.writeFileSync(path.join(dir, 'app.js'), '내 코드\n');
  await applied(dir);
  assert.ok(textOf(dir, HOOK), '커밋 훅이 들어갔어야 시험이 뜻이 있다');
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'skills', SKILL_A, '.harness-source.json')));
  const r = run(dir);
  assert.deepEqual(r.kept, []);
  for (const p of ['.claude/harness.json', 'CLAUDE.md', `.claude/skills/${SKILL_A}`, `.claude/skills/${SKILL_B}`, HOOK, '.claude/harness-request.md', '.claude/settings.json', '.gitignore', '.claude/harness-backup']) assert.ok(r.removed.includes(p), p);
  assert.equal(r.removed.at(-1), '.claude/harness-backup', '백업 폴더는 맨 끝에');
  assert.deepEqual(leftOver(dir), ['app.js']);
  assert.deepEqual(kinds(r), ['plugin', 'teammates']);
  const plugin = r.manual.find((m) => m.kind === 'plugin');
  assert.equal(plugin.menu, '/plugin');
  assert.deepEqual(plugin.commands, [], '설치 기록이 없으면 명령 대신 /plugin 메뉴만');
});

test('백업 폴더를 지운 뒤(다른 PC·새 clone)에도 다 빠진다', async () => {
  const dir = E.repo();
  await applied(dir);
  fs.rmSync(path.join(dir, BACKUP_DIR), { recursive: true, force: true });
  const r = run(dir);
  assert.ok(!r.removed.includes('.claude/harness-backup'));
  assert.deepEqual(r.kept, []);
  assert.deepEqual(leftOver(dir), []);
});

test('두 번 적용한 뒤에도 한 번에 다 빠진다(되돌리기는 마지막 적용만)', async () => {
  const dir = E.repo();
  await applied(dir);
  await applied(dir, { rules: [], note: '' });
  const r = run(dir);
  assert.deepEqual(r.kept, []);
  assert.deepEqual(leftOver(dir), []);
});

test('사용자가 고친 것: CLAUDE.md 구역 밖·settings.json 의 다른 칸은 남기고, 고친 스킬은 --force 일 때만 지운다', async () => {
  const dir = E.repo();
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# 내 지침\n배포는 금요일 금지\n');
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ permissions: { deny: ['Bash(psql:*)'] } }, null, 2));
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n');
  await applied(dir);
  fs.appendFileSync(path.join(dir, '.claude', 'skills', SKILL_A, 'SKILL.md'), '내가 더한 줄\n');
  const r = run(dir);
  assert.deepEqual(r.kept, [{ path: `.claude/skills/${SKILL_A}`, reason: 'edited' }]);
  assert.deepEqual(r.trimmed.sort(), ['.claude/settings.json', '.gitignore', 'CLAUDE.md']);
  assert.equal(textOf(dir, 'CLAUDE.md').trim(), '# 내 지침\n배포는 금요일 금지');
  assert.deepEqual(JSON.parse(textOf(dir, '.claude/settings.json')), { permissions: { deny: ['Bash(psql:*)'] } });
  assert.equal(textOf(dir, '.gitignore').trim(), 'node_modules/');
  assert.ok(!fs.existsSync(path.join(dir, '.claude', 'skills', SKILL_B)), '고치지 않은 스킬은 지운다');
  assert.match(textOf(dir, `.claude/skills/${SKILL_A}/SKILL.md`), /내가 더한 줄/);
  const forced = run(dir, { force: true });
  assert.deepEqual(forced.removed, [`.claude/skills/${SKILL_A}`]);
  assert.deepEqual(forced.kept, []);
  assert.ok(!fs.existsSync(path.join(dir, '.claude', 'skills')), '빈 skills 폴더도 치운다');
});

test('지문이 없는 옛 스킬과 파일을 더한 스킬은 받은 그대로로 보지 않는다', async () => {
  const dir = E.repo();
  await applied(dir);
  const a = path.join(dir, '.claude', 'skills', SKILL_A);
  const src = JSON.parse(fs.readFileSync(path.join(a, '.harness-source.json'), 'utf8'));
  delete src.files;
  fs.writeFileSync(path.join(a, '.harness-source.json'), JSON.stringify(src));
  fs.writeFileSync(path.join(dir, '.claude', 'skills', SKILL_B, 'mine.md'), '내 파일\n');
  const r = run(dir);
  const byPath = Object.fromEntries(r.kept.map((k) => [k.path, k.reason]));
  assert.deepEqual(byPath, { [`.claude/skills/${SKILL_A}`]: 'unverifiable', [`.claude/skills/${SKILL_B}`]: 'edited' });
});

test('남의 git 훅은 두고, 표시만 있는 훅은 not-ours, 사용자 훅에 이어 붙인 줄은 손으로 할 일로', async () => {
  const dir = E.repo();
  fs.mkdirSync(path.join(dir, '.git', 'hooks'), { recursive: true });
  const foreign = `#!/bin/sh\nnpm run lint\nif [ -f '/x/hooks/git-pre-commit.mjs' ]; then node '/x/hooks/git-pre-commit.mjs' || exit 1; fi\n`;
  fs.writeFileSync(path.join(dir, HOOK), foreign);
  await applied(dir);
  let r = run(dir);
  assert.equal(textOf(dir, HOOK), foreign);
  assert.ok(!r.removed.includes(HOOK));
  assert.deepEqual(r.manual.find((m) => m.kind === 'git-hook-line'), { kind: 'git-hook-line', file: HOOK });
  // 우리 실행기에 줄을 덧붙인 훅
  const edited = `${launcherText(PLUGIN_DIR)}echo 내 줄\n`;
  fs.writeFileSync(path.join(dir, HOOK), edited);
  r = run(dir);
  assert.deepEqual(r.kept, [{ path: HOOK, reason: 'not-ours' }]);
  assert.equal(textOf(dir, HOOK), edited);
  assert.ok(edited.includes(MARKER));
});

test('pre-commit 프레임워크 저장소: 실행 파일은 빼고, 붙여 넣은 항목은 손으로 지우라고 알린다(설정은 고치지 않는다)', async () => {
  const dir = E.repo();
  const yaml = `repos:\n${preCommitSnippet()}`;
  fs.writeFileSync(path.join(dir, '.pre-commit-config.yaml'), yaml);
  await applied(dir);
  assert.ok(textOf(dir, '.claude/harness-fit-pre-commit.mjs'));
  const r = run(dir);
  assert.ok(r.removed.includes('.claude/harness-fit-pre-commit.mjs'));
  assert.ok(r.manual.some((m) => m.kind === 'pre-commit-entry' && m.file === '.pre-commit-config.yaml'));
  assert.equal(textOf(dir, '.pre-commit-config.yaml'), yaml);
  assert.deepEqual(leftOver(dir), ['.pre-commit-config.yaml']);
});

test('--dry-run 은 아무것도 바꾸지 않고, 실제로 지울 때와 같은 목록을 낸다', async () => {
  const dir = E.repo();
  await applied(dir);
  fs.appendFileSync(path.join(dir, '.claude', 'skills', SKILL_B, 'SKILL.md'), '고침\n');
  const before = leftOver(dir);
  const dry = run(dir, { dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.deepEqual(leftOver(dir), before);
  const { dryRun, ...rest } = dry;
  assert.deepEqual(run(dir), rest);
});

test('명령줄: apply.mjs --remove --dry-run 이 JSON 을 내고 아무것도 지우지 않는다', async () => {
  const dir = E.repo();
  await applied(dir);
  const script = path.join(import.meta.dirname, '..', 'apply.mjs');
  const res = spawnSync(process.execPath, [script, dir, '--remove', '--dry-run'], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(E.home, '.claude') } });
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.dryRun, true);
  assert.ok(out.removed.includes('.claude/harness.json'));
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'harness.json')));
});

test('설치 기록에 이 저장소(project)·사용자 범위가 있으면 지울 명령과 범위를 알려 준다', () => {
  const dir = E.repo();
  const home = path.join(E.tmp, 'home-installed');
  fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
  const plugins = { 'harness-fit@harness-fit': [{ scope: 'project', projectPath: dir, installPath: '/p' }, { scope: 'user', installPath: '/u' }] };
  fs.writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins }));
  const step = removeAll(dir, { home, dryRun: true }).manual.find((m) => m.kind === 'plugin');
  assert.deepEqual(step.commands, ['claude plugin uninstall harness-fit@harness-fit --scope project']);
  assert.equal(step.userScope, true);
});

// 연결 만들기: 폴더는 정션(Windows 에서 관리자 권한 없이 된다), 다른 곳은 심볼릭 링크
const link = (target, at) => fs.symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');

test('밖을 가리키는 스킬 폴더 연결은 따라가지 않는다 — 밖은 그대로, 연결은 kept(link)', async () => {
  const dir = E.repo();
  await applied(dir);
  const outside = path.join(E.tmp, 'outside-skill');
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'SKILL.md'), '밖의 스킬\n');
  fs.writeFileSync(path.join(outside, '.harness-source.json'), JSON.stringify({ files: { 'SKILL.md': 'x' } }));
  link(outside, path.join(dir, '.claude', 'skills', 'evil'));
  const r = run(dir);
  assert.deepEqual(r.kept, [{ path: '.claude/skills/evil', reason: 'link' }]);
  assert.equal(fs.readFileSync(path.join(outside, 'SKILL.md'), 'utf8'), '밖의 스킬\n');
  assert.ok(fs.lstatSync(path.join(dir, '.claude', 'skills', 'evil')).isSymbolicLink(), '연결도 그대로 둔다');
  // --force 여도 연결은 따라가지 않는다
  run(dir, { force: true });
  assert.ok(fs.existsSync(path.join(outside, 'SKILL.md')));
});

test('.claude 자체가 밖을 가리키는 연결이면 그 안은 하나도 지우지 않는다', async () => {
  const dir = E.repo();
  const outside = path.join(E.tmp, 'outside-claude');
  fs.mkdirSync(path.join(outside, 'skills', 'a'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'harness.json'), '{}');
  fs.writeFileSync(path.join(outside, 'skills', 'a', '.harness-source.json'), JSON.stringify({ files: {} }));
  link(outside, path.join(dir, '.claude'));
  const r = run(dir);
  assert.deepEqual(r.removed, []);
  assert.ok(r.kept.some((k) => k.path === '.claude/harness.json' && k.reason === 'link'));
  assert.ok(r.kept.some((k) => k.path === '.claude/skills' && k.reason === 'link'));
  assert.ok(fs.existsSync(path.join(outside, 'harness.json')));
  assert.ok(fs.existsSync(path.join(outside, 'skills', 'a', '.harness-source.json')));
});

test('스킬 폴더 안에 밖을 가리키는 연결이 있으면 지우지 않는다(--force 여도)', async () => {
  const dir = E.repo();
  await applied(dir);
  const outside = path.join(E.tmp, 'outside-inner');
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'keep.txt'), '밖\n');
  link(outside, path.join(dir, '.claude', 'skills', SKILL_A, 'ref', 'out'));
  const r = run(dir, { force: true });
  assert.ok(r.kept.some((k) => k.path === `.claude/skills/${SKILL_A}` && k.reason === 'link'));
  assert.ok(fs.existsSync(path.join(outside, 'keep.txt')));
});
