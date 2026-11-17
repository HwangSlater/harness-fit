// 지우기·다시 적용 검토(2026-11-16)에서 나온 것: CLAUDE.md 표시 찾기, 되돌리기가 사용자 폴더를 덮지 않기, 방식 겹침, 하위 폴더, 파일 모양 지키기,
// pre-commit 실행 파일 빼기, 백업 폴더 연결. 고친 쪽과 그대로 두는 쪽을 함께 본다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { apply, undo } from '../lib/apply-run.mjs';
import { plan } from '../lib/plan.mjs';
import { BACKUP_DIR } from '../lib/backup.mjs';
import { removeAll } from '../lib/remove.mjs';
import { findBlock, setBlock, extractBlock, START, END } from '../lib/claude-md.mjs';
import { preCommitSnippet } from '../../hooks/lib/git-hook.mjs';
import { env, all, baseSel, fakeInstall, SKILL_A, SKILL_B, textOf, leftOver } from './remove-helpers.mjs';
import { tmpDir } from './helpers.mjs';

let E;
before(() => { E = env(); });
after(() => E.done());
const run = (dir, opts = {}) => removeAll(dir, { home: E.home, ...opts });
const go = (dir, over) => apply(dir, baseSel(over), () => {}, { install: fakeInstall });
const EOLS = ['\n', '\r\n'];
const lines = (eol, ...ls) => ls.join(eol);
const APPLY = path.join(import.meta.dirname, '..', 'apply.mjs');
const cli = (args, cwd) => spawnSync(process.execPath, [APPLY, ...args], { encoding: 'utf8', cwd, env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(E.home, '.claude') } });
const same = (a, b) => fs.realpathSync(a).toLowerCase() === fs.realpathSync(b).toLowerCase();

// ── 1. CLAUDE.md 표시 ──

test('표시 찾기: 줄 하나가 통째로 표시일 때만, 코드 울타리 밖에서만 센다(LF·CRLF)', () => {
  for (const eol of EOLS) {
    const quoted = `예: ${START} 와 ${END} 사이는 harness-fit 이 고친다`;
    const real = lines(eol, '# 내 지침', quoted, '', `  ${START}  `, '- 넣은 줄', END, '', '# 끝', '');
    const b = findBlock(real);
    assert.deepEqual([b.start, b.end, b.bad], [3, 5, undefined], '인용한 줄은 표시가 아니고, 앞뒤 공백은 봐준다');
    assert.equal(setBlock(real, ''), lines(eol, '# 내 지침', quoted, '', '# 끝', ''), '인용한 문장은 그대로, 진짜 구역만 빠진다');
    const fenced = lines(eol, '# 예시', '```md', START, '- 예', END, '```', '~~~', START, '~~~', '');
    assert.equal(findBlock(fenced), null, '코드 울타리 안의 표시는 세지 않는다');
    assert.equal(setBlock(fenced, ''), fenced);
    for (const bad of [
      lines(eol, START, '- 하나', START, '- 둘', END, ''), // 시작이 둘
      lines(eol, START, '- 넣은 줄', '', '내 문단', '```', END, '```', '내 다른 문단', ''), // 끝이 없고, 코드 안에만 끝
      lines(eol, END, '내 글', START, ''), // 끝이 먼저
      lines(eol, '내 글', END, ''), // 끝만
    ]) {
      assert.equal(findBlock(bad).bad, true, JSON.stringify(bad));
      assert.equal(setBlock(bad, ''), bad, '짝이 안 맞으면 지우지 않는다');
      assert.equal(setBlock(bad, `${START}\n- 새\n${END}`), bad, '새로 붙이지도 않는다(다음에 시작이 둘이 된다)');
      assert.equal(extractBlock(bad), '');
    }
  }
});

test('CRLF CLAUDE.md: 구역을 빼도 빈 줄이 쌓이지 않고, 넣을 때도 CRLF 로 넣는다', () => {
  const mine = '# 내 지침\r\n배포는 금요일 금지\r\n';
  const block = `${START}\n- 넣은 줄\n${END}`;
  const once = setBlock(mine, block);
  assert.equal(once, `# 내 지침\r\n배포는 금요일 금지\r\n\r\n${START}\r\n- 넣은 줄\r\n${END}\r\n`);
  assert.ok(!/(^|[^\r])\n/.test(once), 'LF 만 있는 줄이 섞이지 않는다');
  assert.equal(setBlock(once, ''), mine, '빼면 처음 글 그대로');
  assert.equal(setBlock(once, block), once, '같은 구역은 그대로');
  // 구역 뒤에 사용자 글이 이어져도
  const middle = `# 위\r\n\r\n${START}\r\n- 줄\r\n${END}\r\n\r\n# 아래\r\n`;
  assert.equal(setBlock(middle, ''), '# 위\r\n\r\n# 아래\r\n');
  assert.equal(setBlock('# 위\n\n' + `${START}\n- 줄\n${END}\n\n# 아래\n`, ''), '# 위\n\n# 아래\n', 'LF 도 같다');
});

test('지우기: 짝이 안 맞는 CLAUDE.md 는 그대로 두고 kept(markers), 맞으면 빼고 줄 수를 미리 알린다', async () => {
  for (const eol of EOLS) {
    const dir = E.repo();
    await go(dir);
    const applied = textOf(dir, 'CLAUDE.md').replace(/\r?\n/g, eol);
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `# 내 글${eol}${eol}${applied}`);
    const n = extractBlock(applied).split(eol).length;
    const dry = run(dir, { dryRun: true });
    assert.equal(dry.claudeMdLines, n, '빼는 줄 수(표시 줄 포함)');
    assert.ok(dry.trimmed.includes('CLAUDE.md'));
    // 끝 표시가 없고, 뒤 코드 블록에만 끝 표시가 있다
    const broken = lines(eol, '# 내 글', START, '- 넣은 줄', '', '내 문단은 지우면 안 된다', '```', END, '```', '');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), broken);
    const r = run(dir);
    assert.deepEqual(r.kept.filter((k) => k.path === 'CLAUDE.md'), [{ path: 'CLAUDE.md', reason: 'markers' }]);
    assert.equal(r.claudeMdLines, undefined);
    assert.equal(textOf(dir, 'CLAUDE.md'), broken);
  }
});

test('지우기: 코드 예시에만 표시가 있으면 구역이 없는 것 — 손대지 않고 알리지도 않는다', () => {
  const dir = E.repo();
  const example = '# 예시\n\n```md\n' + `${START}\n- 예\n${END}\n` + '```\n';
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), example);
  const r = run(dir);
  assert.equal(textOf(dir, 'CLAUDE.md'), example);
  assert.ok(!r.removed.includes('CLAUDE.md') && !(r.trimmed || []).includes('CLAUDE.md') && !r.kept.some((k) => k.path === 'CLAUDE.md'));
});

test('적용: 짝이 안 맞으면 CLAUDE.md 를 바꾸지 않고 claude-md-markers 로 알린다 — 코드 예시만 있으면 예시는 두고 끝에 붙인다', async () => {
  for (const eol of EOLS) {
    const dir = E.repo();
    const broken = lines(eol, '# 내 글', START, '- 옛 줄', '', '내 문단', '```', END, '```', '');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), broken);
    const p = plan(dir, baseSel(), all);
    assert.ok(p.warnings.includes('claude-md-markers'));
    assert.ok(!p.changes.some((c) => c.kind === 'claude-md'));
    await go(dir);
    assert.equal(textOf(dir, 'CLAUDE.md'), broken);
    // 예시만 있는 CLAUDE.md: 예시 그대로 + 끝에 새 구역, 지우기는 새 구역만 뺀다
    const dir2 = E.repo();
    const example = lines(eol, '# 예시', '```md', START, '- 예', END, '```', '');
    fs.writeFileSync(path.join(dir2, 'CLAUDE.md'), example);
    assert.ok(!plan(dir2, baseSel(), all).warnings.includes('claude-md-markers'));
    await go(dir2);
    const after = textOf(dir2, 'CLAUDE.md');
    assert.ok(after.startsWith(example.trimEnd()), '예시는 그대로');
    assert.equal(findBlock(after).start, 7, '새 구역은 예시 뒤에');
    run(dir2);
    assert.equal(textOf(dir2, 'CLAUDE.md'), example);
  }
});

test('되돌리기: 적용 뒤 CLAUDE.md 표시가 짝이 안 맞게 되면 kept 로 두고, 맞으면 구역만 뺀다', async () => {
  const dir = E.repo();
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# 원래\n');
  await go(dir, { skills: [] });
  const now = textOf(dir, 'CLAUDE.md');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `${now}${START}\n내가 복사한 줄\n`);
  const u = undo(dir);
  assert.ok(u.kept.includes('CLAUDE.md'), JSON.stringify(u));
  assert.equal(textOf(dir, 'CLAUDE.md'), `${now}${START}\n내가 복사한 줄\n`);
  // 짝이 맞으면(사용자가 구역 밖에 글을 더함) 구역만 빠진다
  const dir2 = E.repo();
  fs.writeFileSync(path.join(dir2, 'CLAUDE.md'), '# 원래\n');
  await go(dir2, { skills: [] });
  fs.appendFileSync(path.join(dir2, 'CLAUDE.md'), '\n# 더한 글\n');
  assert.ok(undo(dir2).trimmed.includes('CLAUDE.md'));
  assert.equal(textOf(dir2, 'CLAUDE.md'), '# 원래\n\n# 더한 글\n');
});

// ── 2. 되돌리기가 사용자 폴더를 덮지 않는다 ──

test('다시 적용이 뺀 스킬 자리에 사용자가 같은 이름 폴더를 만들었으면, 되돌리기는 그 폴더를 남겨 둔 뒤 되살린다', async () => {
  const dir = E.repo();
  await go(dir);
  await go(dir, { skills: [SKILL_A] });
  const b = path.join(dir, '.claude', 'skills', SKILL_B);
  assert.ok(!fs.existsSync(b));
  fs.mkdirSync(b);
  fs.writeFileSync(path.join(b, 'SKILL.md'), '내가 새로 쓴 스킬\n');
  const u = undo(dir);
  assert.ok(u.saved.includes(`.claude/skills/${SKILL_B}`), JSON.stringify(u));
  assert.equal(fs.readFileSync(path.join(dir, u.savedIn, '.claude', 'skills', SKILL_B, 'SKILL.md'), 'utf8'), '내가 새로 쓴 스킬\n');
  assert.equal(textOf(dir, `.claude/skills/${SKILL_B}/ref/notes.md`), '보조 파일\n', '받은 스킬은 되살린다');
});

// ── 3·4. 명령줄 ──

test('명령줄: --remove --undo 는 둘 다 하지 않고 conflicting-modes — 하나씩은 그대로 돈다', async () => {
  const dir = E.repo();
  await go(dir);
  const before = leftOver(dir);
  const res = cli([dir, '--remove', '--undo']);
  assert.equal(res.status, 1);
  assert.equal(JSON.parse(res.stdout).error, 'conflicting-modes');
  assert.deepEqual(leftOver(dir), before, '되돌리기도 지우기도 하지 않았다');
  // npx 진입점도 「목록만」이라 말하지 않고 같은 오류로 끝난다
  const npx = spawnSync(process.execPath, [path.join(import.meta.dirname, '..', '..', 'cli', 'harness-fit.js'), '--remove', '--undo'], { encoding: 'utf8', cwd: dir });
  assert.equal(npx.status, 1);
  assert.doesNotMatch(npx.stderr, /List only/);
  assert.equal(JSON.parse(npx.stdout).error, 'conflicting-modes');
  assert.deepEqual(leftOver(dir), before);
  const ok = cli([dir, '--undo']);
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(JSON.parse(ok.stdout).undone);
});

test('명령줄: 하위 폴더에서 불러도 저장소 맨 위를 본다 — git 저장소가 아니면 준 폴더를 쓰고 git: false', async () => {
  const dir = E.repo();
  await go(dir);
  const sub = path.join(dir, 'src', 'deep');
  fs.mkdirSync(sub, { recursive: true });
  const r = JSON.parse(cli([sub, '--remove', '--dry-run']).stdout);
  assert.ok(r.removed.includes('.claude/harness.json'), JSON.stringify(r));
  assert.ok(same(r.folder, dir));
  assert.equal(r.git, undefined);
  const u = JSON.parse(cli(['.', '--undo'], sub).stdout);
  assert.ok(u.undone, JSON.stringify(u));
  assert.ok(same(u.folder, dir));
  const plain = tmpDir('harness-nogit-');
  try {
    const n = JSON.parse(cli([plain, '--remove', '--dry-run']).stdout);
    assert.equal(n.git, false);
    assert.ok(same(n.folder, plain));
  } finally {
    fs.rmSync(plain, { recursive: true, force: true });
  }
});

// ── 5. 파일 모양 ──

test('settings.json: 들여쓰기·BOM·CRLF 를 지키고, 사용자가 적은 false 는 남긴다', async () => {
  const src = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'config', 'sources.json'), 'utf8'));
  for (const [indent, bom, eol] of [['    ', '﻿', '\r\n'], ['\t', '', '\n'], ['  ', '', '\r\n']]) {
    const dir = E.repo();
    fs.mkdirSync(path.join(dir, '.claude'));
    const value = { permissions: { deny: ['Bash(psql:*)'] }, enabledPlugins: { [src.pluginId]: true, other: true }, extraKnownMarketplaces: { [src.marketplace]: { source: { source: 'github', repo: 'x/y' } } } };
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), `${bom}${JSON.stringify(value, null, indent).replace(/\n/g, eol)}${eol}`);
    const r = run(dir);
    assert.ok(r.trimmed.includes('.claude/settings.json'));
    const want = { permissions: { deny: ['Bash(psql:*)'] }, enabledPlugins: { other: true } };
    assert.equal(textOf(dir, '.claude/settings.json'), `${bom}${JSON.stringify(want, null, indent).replace(/\n/g, eol)}${eol}`);
  }
  // 사용자가 끈 플러그인(false)은 우리 것이 아니다 — 그것만 있으면 손대지 않는다
  const dir = E.repo();
  fs.mkdirSync(path.join(dir, '.claude'));
  const off = `{\n  "enabledPlugins": {\n    "${src.pluginId}": false\n  }\n}\n`;
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), off);
  const r = run(dir);
  assert.equal(textOf(dir, '.claude/settings.json'), off);
  assert.ok(!(r.trimmed || []).includes('.claude/settings.json'));
  assert.ok(!r.manual.some((m) => m.kind === 'teammates'));
});

test('.gitignore: 적용 전부터 있던 줄은 남기고, harness-fit 이 넣은 줄만 뺀다(기록 없으면 뺀다)', async () => {
  for (const eol of EOLS) {
    const mine = E.repo();
    fs.writeFileSync(path.join(mine, '.gitignore'), lines(eol, 'node_modules/', '.claude/harness-backup/', ''));
    await go(mine);
    assert.equal(JSON.parse(textOf(mine, '.claude/harness.json')).gitignore, 'existing');
    await go(mine, { rules: [] });
    assert.equal(JSON.parse(textOf(mine, '.claude/harness.json')).gitignore, 'existing', '다시 적용해도 기록이 이어진다');
    run(mine);
    assert.equal(textOf(mine, '.gitignore'), lines(eol, 'node_modules/', '.claude/harness-backup/', ''));
    const ours = E.repo();
    fs.writeFileSync(path.join(ours, '.gitignore'), `node_modules/${eol}`);
    await go(ours);
    await go(ours, { rules: [] });
    assert.equal(JSON.parse(textOf(ours, '.claude/harness.json')).gitignore, 'added');
    run(ours);
    assert.equal(textOf(ours, '.gitignore'), `node_modules/${eol}`);
    // 기록이 없는 옛 적용: 알 수 없어 뺀다(예전 동작)
    const old = E.repo();
    fs.writeFileSync(path.join(old, '.gitignore'), lines(eol, 'node_modules/', '.claude/harness-backup/', ''));
    fs.mkdirSync(path.join(old, '.claude'));
    fs.writeFileSync(path.join(old, '.claude', 'harness.json'), '{"rules":{}}');
    run(old);
    assert.equal(textOf(old, '.gitignore').trim(), 'node_modules/');
  }
});

test('스킬 폴더: 받은 id 와 이름이 다른 복사본(my-copy)은 not-ours 로 남기고, 다시 적용도 건드리지 않는다', async () => {
  const dir = E.repo();
  await go(dir);
  const skills = path.join(dir, '.claude', 'skills');
  fs.cpSync(path.join(skills, SKILL_A), path.join(skills, 'my-copy'), { recursive: true });
  // id 를 적지 않은 옛 출처 표시: SKILL.md 의 name 으로 본다
  const old = path.join(skills, 'old-copy');
  fs.cpSync(path.join(skills, SKILL_B), old, { recursive: true });
  const src = JSON.parse(fs.readFileSync(path.join(old, '.harness-source.json'), 'utf8'));
  delete src.id;
  fs.writeFileSync(path.join(old, '.harness-source.json'), JSON.stringify(src));
  const srcB = JSON.parse(fs.readFileSync(path.join(skills, SKILL_B, '.harness-source.json'), 'utf8'));
  delete srcB.id;
  fs.writeFileSync(path.join(skills, SKILL_B, '.harness-source.json'), JSON.stringify(srcB));
  const p = plan(dir, baseSel({ skills: [] }), all);
  assert.deepEqual(p.changes.filter((c) => c.kind === 'skill-remove').map((c) => c.removedSkill).sort(), [SKILL_A, SKILL_B].sort());
  assert.deepEqual(p.keptSkills, [], '남의 복사본은 알리지도 않는다');
  const r = run(dir, { force: true });
  assert.deepEqual(r.kept.filter((k) => k.path.startsWith('.claude/skills/')).sort((a, b) => a.path.localeCompare(b.path)), [
    { path: '.claude/skills/my-copy', reason: 'not-ours' },
    { path: '.claude/skills/old-copy', reason: 'not-ours' },
  ]);
  assert.ok(r.removed.includes(`.claude/skills/${SKILL_A}`) && r.removed.includes(`.claude/skills/${SKILL_B}`), 'id 가 맞는 것(옛 표시는 SKILL.md name 으로)은 지운다');
  assert.ok(fs.existsSync(path.join(skills, 'my-copy', 'SKILL.md')) && fs.existsSync(path.join(old, 'SKILL.md')));
});

// ── 6. pre-commit 프레임워크 ──

test('pre-commit 저장소에서 커밋 훅을 다 끄면 실행 파일도 빼고 항목은 손으로 지우라고 알린다 — 되돌리기가 되살린다', async () => {
  const dir = E.repo();
  const yaml = `repos:\n${preCommitSnippet()}`;
  fs.writeFileSync(path.join(dir, '.pre-commit-config.yaml'), yaml);
  await go(dir);
  const runner = textOf(dir, '.claude/harness-fit-pre-commit.mjs');
  assert.ok(runner);
  // 커밋 훅이 하나라도 켜져 있으면 그대로
  const kept = plan(dir, baseSel(), all);
  assert.ok(!kept.changes.some((c) => c.action === 'remove' && c.path.endsWith('harness-fit-pre-commit.mjs')));
  assert.ok(!kept.warnings.includes('pre-commit-entry-left'));
  const r = await go(dir, { hooks: ['protect-branch'] });
  assert.ok(r.changed.includes('- .claude/harness-fit-pre-commit.mjs'), r.changed.join('\n'));
  assert.equal(textOf(dir, '.claude/harness-fit-pre-commit.mjs'), null);
  assert.ok(r.warnings.includes('pre-commit-entry-left'));
  assert.deepEqual(r.manual.find((m) => m.kind === 'pre-commit-entry'), { kind: 'pre-commit-entry', file: '.pre-commit-config.yaml' });
  assert.equal(textOf(dir, '.pre-commit-config.yaml'), yaml, '남의 설정은 고치지 않는다');
  undo(dir);
  assert.equal(textOf(dir, '.claude/harness-fit-pre-commit.mjs'), runner);
});

// ── 7. 백업 폴더가 연결이면 .gitignore 줄도 남긴다 ──

test('백업 폴더가 정션이면 남기고 .gitignore 줄도 남긴다(빼면 백업이 커밋될 수 있다)', async () => {
  const dir = E.repo();
  await go(dir, { skills: [] });
  const outside = path.join(E.tmp, 'outside-backup');
  fs.cpSync(path.join(dir, BACKUP_DIR), outside, { recursive: true });
  fs.rmSync(path.join(dir, BACKUP_DIR), { recursive: true, force: true });
  fs.symlinkSync(outside, path.join(dir, BACKUP_DIR), process.platform === 'win32' ? 'junction' : 'dir');
  const r = run(dir);
  assert.ok(r.kept.some((k) => k.path === '.claude/harness-backup' && k.reason === 'link'));
  assert.ok(textOf(dir, '.gitignore').split(/\r?\n/).includes('.claude/harness-backup/'));
  assert.ok(fs.existsSync(outside));
});

// ── 8. 문구 ──

test('남긴 스킬 알림 문구는 연결인 폴더도 말한다(ko·en)', () => {
  for (const [lang, word] of [['ko', /링크|정션/], ['en', /link/]]) {
    const s = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'picker', 'i18n', lang, 'review.json'), 'utf8'));
    assert.match(s['warn_skill-kept-edited_d'], word, lang);
    for (const k of ['warn_claude-md-markers', 'warn_claude-md-markers_d', 'warn_pre-commit-entry-left', 'warn_pre-commit-entry-left_d']) assert.ok(s[k], `${lang} ${k}`);
  }
});
