// 사용자 규칙과 반대인 것(scripts/lib/conflicts.mjs): --conflicts 받기·검사, 고른 쪽 남기기(selection.conflicts),
// 다음 실행의 knownConflicts, 내 규칙 쪽이면 훅을 끄고 줄을 빼기, 사용자 글이 바뀌거나 없어지면 기록 버리기, 화면 이름표.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pickerCfg, tmpDir, writeFiles, PLUGIN_ROOT } from './helpers.mjs';
import { loadAll } from '../lib/catalog.mjs';
import { parseArgs } from '../lib/args.mjs';
import { parseConflictsArg, strictConflicts, cleanConflicts, liveConflicts, resolveConflicts, withConflictHints, MAX_USER_TEXT, MAX_CONFLICTS } from '../lib/conflicts.mjs';
import { cleanSelection, makeState, readHarnessConfig } from '../lib/picker-state.mjs';
import { buildConfig } from '../lib/plan.mjs';
import { ruleTexts, ruleDropped } from '../lib/claude-md.mjs';
import { ruleFileLines, TAG, bulletLines, lineHash } from '../lib/rule-files.mjs';
import { apply, undo } from '../lib/apply-run.mjs';
import { removeAll } from '../lib/remove.mjs';
import { autoSelection } from '../recommend.mjs';
import { detect } from '../detect.mjs';
import { startSelection } from '../../picker/selection.js';
import { followHook, withChoice, conflictKey } from '../../picker/conflict.js';

const all = loadAll();
const tmp = () => tmpDir('hf-conflicts-');
const USER_LINE = 'main 에 바로 커밋한다';
const hookMine = { kind: 'hook', id: 'protect-branch', choice: 'mine', file: 'CLAUDE.md', userText: USER_LINE };
// GitHub Flow 1번 줄(늘 들어가는 줄 — 「main 은 늘 배포할 수 있게」)
const ruleMine = { kind: 'rule', id: 'github-flow', line: 1, choice: 'mine', file: 'CLAUDE.md', userText: USER_LINE };
// 적용·검사를 거친 규칙 기록: 그 줄의 지문(hash)과 언어가 붙는다
const hashed = (c, lang = 'ko') => ({ ...c, lang, hash: lineHash(bulletLines(c.id, lang)[c.line - 1]) });
const ruleRec = hashed(ruleMine);
const flowLine = (n, lang = 'ko') => ruleFileLines('github-flow', lang).filter((l) => /^- /.test(l))[n - 1].replace(TAG, '').slice(2);
const base = { lang: 'ko', combo: 'team', flow: 'github-flow', skills: [], hooks: ['secrets', 'protect-branch'], rules: [], explore: [], note: '', share: false };

test('--conflicts: JSON 글·파일 경로를 받고, 깨진 글·너무 많은·너무 큰 값은 이유와 함께 거절', () => {
  const ok = parseConflictsArg(JSON.stringify([hookMine]));
  assert.deepEqual(ok.list, [hookMine]);
  const dir = tmp();
  const f = path.join(dir, 'c.json');
  fs.writeFileSync(f, '﻿' + JSON.stringify([ruleMine]));
  assert.deepEqual(parseConflictsArg(f).list, [ruleMine], '파일(BOM 포함)도 읽는다');
  assert.equal(parseConflictsArg('[{').error, 'bad-json');
  assert.equal(parseConflictsArg('{"a":1}').error, 'unreadable', '[ 로 시작하지 않으면 파일 경로로 본다');
  assert.equal(parseConflictsArg(JSON.stringify({})).error, 'unreadable');
  assert.equal(parseConflictsArg(path.join(dir, 'none.json')).error, 'unreadable');
  assert.equal(parseConflictsArg(JSON.stringify(Array(MAX_CONFLICTS + 1).fill(hookMine))).error, 'too-many');
  assert.equal(parseConflictsArg(`[${'"x",'.repeat(9000)}"x"]`).error, 'too-large');
  assert.deepEqual(parseConflictsArg(null).list, [], '없으면 빈 목록');
  // 명령줄: JSON 값이 프로젝트 경로로 잘못 읽히지 않는다
  const a = parseArgs([dir, '--conflicts', JSON.stringify([hookMine]), '--lang', 'ko']);
  assert.equal(a.root, path.resolve(dir));
  assert.deepEqual(a.hints.conflicts.list, [hookMine]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('검사는 엄격하게: 모르는 id·없는 줄 번호·틀린 고른 쪽·빈 글은 오류, 글은 줄이고 공백을 모은다', () => {
  assert.deepEqual(strictConflicts(all, { list: [hookMine, ruleMine] }, { lang: 'ko' }).list, [hookMine, ruleRec]);
  for (const bad of [
    { ...hookMine, id: 'no-such-hook' },
    { ...hookMine, kind: 'skill' },
    { ...ruleMine, line: 0 },
    { ...ruleMine, line: 99 },
    { ...ruleMine, line: '1' },
    { ...ruleMine, id: 'no-such-rule' },
    { ...hookMine, choice: 'both' },
    { ...hookMine, userText: '   ' },
    { ...hookMine, file: '' },
    'protect-branch',
  ]) assert.equal(strictConflicts(all, { list: [bad] }).error, 'bad-entry', JSON.stringify(bad));
  assert.equal(strictConflicts(all, { error: 'bad-json' }).error, 'bad-json');
  const [long] = strictConflicts(all, { list: [{ ...hookMine, userText: `  a\r\n  b\t${'x'.repeat(500)}`, extra: 1 }] }).list;
  assert.equal(long.userText.length, MAX_USER_TEXT);
  assert.ok(long.userText.startsWith('a b x'), 'CRLF·탭·여러 칸은 한 칸으로');
  assert.equal(long.extra, undefined, '모르는 칸은 버린다');
  // 화면·harness.json 쪽은 조용히 뺀다. 같은 짝은 뒤의 것이 이긴다
  assert.deepEqual(cleanConflicts(all, [{ ...hookMine, id: 'x' }, hookMine, { ...hookMine, choice: 'harness' }]), [{ ...hookMine, choice: 'harness' }]);
});

test('내 규칙 쪽: 훅은 꺼지고 줄은 「내 규칙과 반대」로 빠진다. harness-fit 쪽이면 둘 다 남는다', () => {
  const mine = cleanSelection({ all, cfg: pickerCfg }, { ...base, conflicts: [hookMine, ruleMine] }, 'ko');
  assert.ok(!mine.hooks.includes('protect-branch'), '선택 파일에 훅이 남아 있어도 켜지 않는다');
  assert.ok(mine.hooks.includes('secrets'));
  assert.ok(!ruleTexts(mine)['github-flow'].includes(flowLine(1)));
  const drop = ruleDropped(mine)['github-flow'].find((d) => d.by === 'conflict');
  assert.equal(drop.text, `- ${flowLine(1)}`);
  assert.equal(drop.line, 1);
  const theirs = cleanSelection({ all, cfg: pickerCfg }, { ...base, conflicts: [{ ...hookMine, choice: 'harness' }, { ...ruleMine, choice: 'harness' }] }, 'ko');
  assert.ok(theirs.hooks.includes('protect-branch'));
  assert.ok(ruleTexts(theirs)['github-flow'].includes(flowLine(1)));
  assert.ok(!(ruleDropped(theirs)['github-flow'] || []).some((d) => d.by === 'conflict'));
});

test('적용하면 selection.conflicts 에 남고, 다음 실행은 knownConflicts 로 돌려준다(다시 묻지 않음) · 다시 적용해도 그대로', async () => {
  const dir = tmp();
  writeFiles(dir, { 'CLAUDE.md': `# 내 규칙\r\n- ${USER_LINE}\r\n` });
  const sel = cleanSelection({ all, cfg: pickerCfg }, { ...base, conflicts: [hookMine, ruleMine] }, 'ko');
  await apply(dir, sel);
  const raw = readHarnessConfig(dir);
  assert.deepEqual(raw.selection.conflicts, [hookMine, ruleRec]);
  assert.equal(raw.rules['protect-branch'], undefined, '훅 설정에도 켜지지 않는다');
  const md = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  assert.ok(md.includes(USER_LINE), '사용자 글은 그대로');
  assert.ok(!md.includes(flowLine(1)), '반대인 줄은 넣지 않았다');
  // overlap.mjs: 사용자 글이 그대로면 knownConflicts
  const out = JSON.parse(execFileSync(process.execPath, [path.join(PLUGIN_ROOT, 'scripts', 'overlap.mjs'), dir, '--lang', 'ko'], { encoding: 'utf8' }));
  assert.deepEqual(out.knownConflicts, [hookMine, ruleRec]);
  assert.equal(out.goneConflicts, undefined);
  assert.ok(out.hooks.some((x) => x.id === 'secrets' && x.enforces && x.blocks), '켜질 훅마다 하는 일 한 줄');
  // 다음 실행(명령줄 값 없이): 지난 기록이 그대로 붙고 훅은 꺼진 채
  const det = withConflictHints(detect(dir), all, dir, raw, parseConflictsArg(null));
  assert.deepEqual(det.conflicts, [hookMine, ruleRec]);
  assert.deepEqual(det.conflictsSaved.sort(), ['hook:protect-branch', 'rule:github-flow:1']);
  const auto = autoSelection(all, det, 'ko', raw);
  assert.equal(auto.previous, true);
  assert.ok(!auto.selection.hooks.includes('protect-branch'));
  assert.deepEqual(auto.selection.conflicts, [hookMine, ruleRec]);
  // 다시 적용(지난번 선택 그대로) — 고른 쪽이 남는다
  await apply(dir, cleanSelection({ all, cfg: pickerCfg }, { ...auto.selection, hooks: [...auto.selection.hooks, 'protect-branch'] }, 'ko'));
  const again = readHarnessConfig(dir);
  assert.deepEqual(again.selection.conflicts, [hookMine, ruleRec]);
  assert.equal(again.rules['protect-branch'], undefined);
  assert.ok(!fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8').includes(flowLine(1)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('사용자 글이 바뀌거나 없어지면 그 기록은 버리고 다시 묻게 한다(goneConflicts) · 관리 구역 안 글은 사용자 글이 아니다', () => {
  const dir = tmp();
  const home = tmp();
  const userHook = { ...hookMine, file: '~/.claude/CLAUDE.md' };
  const ruleFile = { ...ruleMine, file: '.claude/rules/git.md' };
  writeFiles(home, { '.claude/CLAUDE.md': `- ${USER_LINE}\n` });
  writeFiles(dir, { '.claude/rules/git.md': `- ${USER_LINE}\n` });
  const both = [userHook, ruleFile];
  assert.deepEqual(liveConflicts(dir, both, home), { live: both, gone: [] });
  // 글을 고침 → 그 기록만 버린다
  writeFiles(home, { '.claude/CLAUDE.md': '- 기능 브랜치에서 작업한다\n' });
  assert.deepEqual(liveConflicts(dir, both, home), { live: [ruleFile], gone: [userHook] });
  // 파일을 지움
  fs.rmSync(path.join(dir, '.claude', 'rules', 'git.md'));
  assert.deepEqual(liveConflicts(dir, both, home).gone, both);
  const raw = { selection: { conflicts: both } };
  const r = resolveConflicts(all, dir, raw, [], { home });
  assert.deepEqual(r.conflicts, [], '없어진 기록은 다음 선택에 붙지 않는다');
  assert.equal(r.gone.length, 2);
  // 다시 물어 고른 것(이번 값)은 그대로 들어간다
  const fresh = { ...userHook, userText: '기능 브랜치에서 작업한다', choice: 'harness' };
  assert.deepEqual(resolveConflicts(all, dir, raw, [fresh], { home }).conflicts, [fresh]);
  // 프로젝트 CLAUDE.md 의 harness-fit 관리 구역 안에만 있는 글은 없는 것으로 본다
  writeFiles(dir, { 'CLAUDE.md': `# 나\r\n<!-- harness-fit:start -->\r\n- ${USER_LINE}\r\n<!-- harness-fit:end -->\r\n` });
  assert.deepEqual(liveConflicts(dir, [hookMine], home).gone, [hookMine]);
  // 받지 않는 꼴의 파일 이름(홈 밖 절대 경로 등)은 확인할 수 없어 버린다(영영 남는 기록이 되지 않게)
  assert.equal(liveConflicts(dir, [{ ...hookMine, file: '/etc/x.md' }, { ...hookMine, file: '../x.md' }], home).gone.length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

test('명령줄 recommend.mjs: 틀린 --conflicts 는 bad-conflicts 로 멈추고, 맞으면 선택에 붙인다', () => {
  const dir = tmp();
  writeFiles(dir, { 'CLAUDE.md': `- ${USER_LINE}\n`, 'package.json': '{"name":"x"}' });
  const run = (v) => {
    try {
      return { code: 0, out: JSON.parse(execFileSync(process.execPath, [path.join(PLUGIN_ROOT, 'scripts', 'recommend.mjs'), dir, '--lang', 'ko', '--conflicts', v], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) };
    } catch (e) {
      return { code: e.status, out: JSON.parse(e.stdout) };
    }
  };
  const bad = run(JSON.stringify([{ ...hookMine, id: 'nope' }]));
  assert.equal(bad.code, 1);
  assert.equal(bad.out.error, 'bad-conflicts');
  assert.equal(bad.out.reason, 'bad-entry');
  const good = run(JSON.stringify([hookMine]));
  assert.equal(good.code, 0);
  assert.deepEqual(good.out.selection.conflicts, [hookMine]);
  assert.ok(!good.out.selection.hooks.includes('protect-branch'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('화면 상태: 내 규칙 쪽 훅은 추천·조합·지난번 어디서 시작해도 꺼지고, 켜면 harness-fit 쪽으로 바뀐다', () => {
  const dir = tmp();
  const det = { ...detect(dir), conflicts: [hookMine, ruleMine], conflictsSaved: [] };
  const S = makeState({ all, cfg: pickerCfg, det, prev: null }, 'ko');
  assert.equal(S.conflictText['rule:github-flow:1'], flowLine(1));
  const { sel } = startSelection(S);
  assert.deepEqual(sel.conflicts, [hookMine, ruleMine], '처음 선택은 서버가 준 기록에서');
  assert.ok(!sel.hooks.has('protect-branch'));
  // 훅을 켜면 harness, 끄면 mine · 작은 창 스위치는 그 짝만 바꾼다
  assert.equal(followHook(sel.conflicts, 'protect-branch', true)[0].choice, 'harness');
  assert.equal(followHook(sel.conflicts, 'protect-branch', false)[0].choice, 'mine');
  const flipped = withChoice(sel.conflicts, conflictKey(ruleMine), 'harness');
  assert.deepEqual(flipped.map((k) => k.choice), ['mine', 'harness']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('되돌리기·지우기는 기록과 상관없이 그대로 돈다', async () => {
  const dir = tmp();
  writeFiles(dir, { 'CLAUDE.md': `- ${USER_LINE}\n` });
  await apply(dir, cleanSelection({ all, cfg: pickerCfg }, { ...base, conflicts: [hookMine, ruleMine] }, 'ko'));
  const u = undo(dir);
  assert.ok(!fs.existsSync(path.join(dir, '.claude', 'harness.json')), '되돌리면 harness.json 도 없어진다');
  assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), `- ${USER_LINE}\n`, u.restored);
  await apply(dir, cleanSelection({ all, cfg: pickerCfg }, { ...base, conflicts: [hookMine] }, 'ko'));
  const r = removeAll(dir, { home: tmp() });
  assert.ok(r.removed.some((p) => p.includes('harness.json')));
  assert.ok(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8').includes(USER_LINE), '사용자 글은 남는다');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildConfig: 기록이 없으면 selection 에 conflicts 칸을 만들지 않는다', () => {
  assert.equal(buildConfig(all, { ...base, conflicts: [] }).selection.conflicts, undefined);
  assert.deepEqual(buildConfig(all, { ...base, conflicts: [hookMine] }).selection.conflicts, [hookMine]);
});
