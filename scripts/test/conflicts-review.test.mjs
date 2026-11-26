// 사용자 규칙과 반대 기록 검토(2026-11-17) 고친 것: 줄 지문(hash)으로 다시 찾기, 팀 저장소의 ~/ 기록, 없어진 「내 규칙」 기록 되돌리기,
// file 칸 꼴·읽기 한도, 명령줄 값의 사용자 글 확인·최소 길이, 화면 조합 거르기, 겹치는 훅, 방향 바꾸는 글자 빼기 — 되는 쪽과 막는 쪽 모두.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pickerCfg, tmpDir, writeFiles, PLUGIN_ROOT } from './helpers.mjs';
import { loadAll, recommend } from '../lib/catalog.mjs';
import { cleanConflict, cleanConflicts, strictConflicts, resolveConflicts, withConflictHints, textStillThere, conflictLines, restoredOf, shareOf, norm, MIN_USER_TEXT } from '../lib/conflicts.mjs';
import { normFile, MAX_READ } from '../lib/conflict-files.mjs';
import { makeState } from '../lib/picker-state.mjs';
import { ruleTexts, ruleDropped } from '../lib/claude-md.mjs';
import { bulletLines, lineHash, lineByHash, TAG, PR_SLOT, prWord } from '../lib/rule-files.mjs';
import { autoSelection } from '../recommend.mjs';
import { overlapHooks } from '../overlap.mjs';
import { detect, withHints } from '../detect.mjs';
import { startSelection, fromCombo } from '../../picker/selection.js';
import { withoutMine, shareSplit, withChoice, conflictKey } from '../../picker/conflict.js';

const all = loadAll();
const tmp = () => tmpDir('hf-conf-rev-');
const USER_LINE = 'main 에 바로 커밋한다';
const flow = (lang = 'ko') => bulletLines('github-flow', lang);
// 줄 끝 표시를 떼고 {{pr}} 은 저장소 위치를 모를 때의 낱말로(CLAUDE.md 에 들어가는 꼴)
const text = (l, lang = 'ko') => l.replace(TAG, '').replace(PR_SLOT, prWord(null, lang)).slice(2);
const hookMine = { kind: 'hook', id: 'protect-branch', choice: 'mine', file: 'CLAUDE.md', userText: USER_LINE };
const base = { lang: 'ko', combo: 'team', flow: 'github-flow', skills: [], hooks: ['secrets', 'protect-branch'], rules: [], explore: [], note: '', share: false };
const noHints = { stack: [], similar: [], skip: {} };

test('규칙 기록은 줄 지문으로 다시 찾는다: 번호가 밀려도 그 줄을 빼고, 못 찾으면 버린다(gone) · 옛 기록은 읽을 때 지문을 만든다', () => {
  // 1·4번 줄은 늘 들어가는 줄({{judge}})
  const [l1, , , l2] = flow();
  // 저장한 뒤 플러그인 업데이트로 앞에 줄이 끼어든 것과 같다: 지문은 4번 줄인데 적힌 번호는 1
  const moved = { kind: 'rule', id: 'github-flow', line: 1, lang: 'ko', hash: lineHash(l2), choice: 'mine', file: 'CLAUDE.md', userText: USER_LINE };
  const c = cleanConflict(all, moved, [], { lang: 'ko' });
  assert.equal(c.line, 4, '지금 번호로 고친다(표시·짝 이름용)');
  const sel = { ...base, conflicts: [moved] };
  const out = ruleTexts(sel)['github-flow'];
  assert.ok(out.includes(text(l1)), '엉뚱한 줄(1번)은 빼지 않는다');
  assert.ok(!out.includes(text(l2)), '고른 줄(4번)은 뺀다');
  assert.equal(ruleDropped(sel)['github-flow'].find((d) => d.by === 'conflict').line, 4);
  // 영어 화면에서도 같은 줄(두 언어 줄 차례가 같다)
  assert.ok(!ruleTexts({ ...sel, lang: 'en' })['github-flow'].includes(text(flow('en')[3], 'en')));
  assert.equal(conflictLines([c], 'en')[conflictKey(c)], text(flow('en')[3], 'en'), '창의 「harness-fit 이 넣으려던 것」도 지문으로 찾은 줄');
  // 지문이 없어진 줄(바뀌었거나 지워짐): 버리고 다시 묻게 한다. 그 줄은 돌아온다
  const lost = { ...moved, hash: 'ffffffffffff' };
  const why = [];
  assert.equal(cleanConflict(all, lost, why, { lang: 'ko' }), null);
  assert.ok(why[0].startsWith('gone:'));
  const dir = tmp();
  writeFiles(dir, { 'CLAUDE.md': `- ${USER_LINE}\n` });
  const r = resolveConflicts(all, dir, { selection: { conflicts: [lost] } }, [], { lang: 'ko' });
  assert.deepEqual(r.conflicts, []);
  assert.equal(r.gone.length, 1);
  assert.deepEqual(restoredOf(r.gone), [{ kind: 'rule', id: 'github-flow', line: 1 }]);
  assert.ok(ruleTexts({ ...base, conflicts: [lost] })['github-flow'].includes(text(l2)), '못 찾은 기록은 줄을 빼지 않는다');
  // 옛 기록(지문 없음): 적힌 번호의 지금 줄로 지문을 만든다 — 명령줄 값도 같다
  const old = cleanConflict(all, { ...moved, hash: undefined, lang: undefined }, [], { lang: 'ko' });
  assert.equal(old.hash, lineHash(l1));
  assert.equal(old.lang, 'ko');
  assert.equal(lineByHash('github-flow', 'ko', old.hash), 1);
  // 틀린 꼴의 지문은 오류
  assert.equal(strictConflicts(all, { list: [{ ...moved, hash: 'xyz' }] }).error, 'bad-entry');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('팀 저장소: ~/ 파일 기록은 명령줄이면 오류, 지난 기록이면 버리고 그 「내 규칙」 훅은 추천대로 다시 켠다 · 혼자 쓰면 그대로', () => {
  const dir = tmp();
  const home = tmp();
  writeFiles(home, { '.claude/CLAUDE.md': `- ${USER_LINE}\n` });
  const global = { ...hookMine, file: '~/.claude/CLAUDE.md' };
  const team = withHints(detect(dir), { ...noHints, team: true });
  assert.equal(shareOf(team, null), true);
  const bad = withConflictHints(team, all, dir, null, { list: [global] }, { home, lang: 'ko' });
  assert.equal(bad.error, 'bad-entry');
  assert.ok(bad.why[0].startsWith('team-global:'));
  // 혼자 쓰는 저장소는 받는다
  const solo = detect(dir);
  assert.deepEqual(withConflictHints(solo, all, dir, null, { list: [global] }, { home, lang: 'ko' }).conflicts, [global]);
  // 전에 팀으로 적용한 저장소(share: true)에 남은 ~/ 기록: 버리고, 꺼져 있던 훅은 추천대로 다시 켠다
  const rec = recommend(all, team, 'ko');
  assert.ok(rec.hooks.includes('protect-branch'));
  const raw = { rules: Object.fromEntries(rec.hooks.filter((id) => id !== 'protect-branch').map((id) => [id, {}])), selection: { combo: rec.combo, flow: rec.flow, skills: [], rules: rec.rules, share: true, conflicts: [global] } };
  const det = withConflictHints(team, all, dir, raw, { list: [] }, { home, lang: 'ko' });
  assert.deepEqual(det.conflicts, []);
  assert.equal(det.conflictsGone.length, 1);
  const auto = autoSelection(all, det, 'ko', raw);
  assert.ok(auto.selection.hooks.includes('protect-branch'), '이름표 없이 꺼진 채 남지 않는다');
  assert.ok(auto.selection.why.some((w) => w.includes('protect-branch')), '이유 줄에 알린다');
  // 화면도 지난번 선택에서 시작할 때 다시 켠다
  const S = makeState({ all, cfg: pickerCfg, det, prev: raw }, 'ko');
  assert.ok(S.previous.hooks.includes('protect-branch'));
  // 사용자 글이 그대로인 프로젝트 기록이면 계속 꺼진 채(되돌리지 않는 쪽)
  writeFiles(dir, { 'CLAUDE.md': `- ${USER_LINE}
` });
  const keptRaw = { ...raw, selection: { ...raw.selection, conflicts: [hookMine] } };
  const kept = withConflictHints(team, all, dir, keptRaw, { list: [] }, { home, lang: 'ko' });
  assert.equal(kept.conflicts.length, 1);
  assert.ok(!autoSelection(all, kept, 'ko', keptRaw).selection.hooks.includes('protect-branch'));
  // 화면이 보낸 선택: 팀원 공유면 ~/ 기록을 받지 않는다
  assert.deepEqual(cleanConflicts(all, [global], { share: true }), []);
  assert.deepEqual(cleanConflicts(all, [global], { share: false }), [global]);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

test('overlap.mjs: 없어진 「내 규칙」 기록은 restored 로 알린다', () => {
  const dir = tmp();
  writeFiles(dir, { 'CLAUDE.md': '# 나\n- 다른 규칙만 남았다\n', '.claude/harness.json': { selection: { combo: 'solo', flow: 'none', skills: [], rules: [], share: false, conflicts: [hookMine] } } });
  const out = JSON.parse(execFileSync(process.execPath, [path.join(PLUGIN_ROOT, 'scripts', 'overlap.mjs'), dir, '--lang', 'ko'], { encoding: 'utf8' }));
  assert.equal(out.knownConflicts, undefined);
  assert.equal(out.goneConflicts.length, 1);
  assert.deepEqual(out.restored, [{ kind: 'hook', id: 'protect-branch' }]);
  // 글이 그대로면 restored 가 없다
  writeFiles(dir, { 'CLAUDE.md': `- ${USER_LINE}\n` });
  const again = JSON.parse(execFileSync(process.execPath, [path.join(PLUGIN_ROOT, 'scripts', 'overlap.mjs'), dir, '--lang', 'ko'], { encoding: 'utf8' }));
  assert.equal(again.restored, undefined);
  assert.equal(again.knownConflicts.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('file 칸: 네 꼴만 받고(대소문자·\\·./ 맞춤) 나머지·장치 이름은 거절한다', () => {
  const ok = {
    'CLAUDE.md': 'CLAUDE.md', './CLAUDE.md': 'CLAUDE.md', 'claude.md': 'CLAUDE.md', 'CLAUDE.MD': 'CLAUDE.md',
    '.claude/rules/git.md': '.claude/rules/git.md', '.Claude\\Rules\\a\\b.md': '.claude/rules/a/b.md',
    '~/.claude/CLAUDE.md': '~/.claude/CLAUDE.md', '~\\.claude\\claude.md': '~/.claude/CLAUDE.md', '~/.claude/rules/x/y.md': '~/.claude/rules/x/y.md',
  };
  for (const [a, b] of Object.entries(ok)) assert.equal(normFile(a), b, a);
  for (const bad of ['docs/private.md', 'node_modules/x/README.md', '~/.claude/projects/p/memory/MEMORY.md', '~/.claude/rules/../projects/p/memory/MEMORY.md',
    '../outside.md', 'C:/Windows/x.md', '//server/share/x.md', '\\\\server\\share\\x.md', '.ssh/id_rsa', 'docs/../CLAUDE.md', '/etc/x.md', // lint:allow abs-path 거절을 시험하는 입력
    '.claude/rules/CON.md', '.claude/rules/aux.md', '.claude/rules/x.md:secret', '.claude/rules/x.md.', '.claude/rules/x.txt', '.claude/rules', '~/CLAUDE.md', '~user/.claude/CLAUDE.md', '', 'x'.repeat(300)]) {
    assert.equal(normFile(bad), null, bad);
  }
  const why = [];
  assert.equal(cleanConflict(all, { ...hookMine, file: 'docs/private.md' }, why), null);
  assert.deepEqual(why, ['file']);
});

test('file 칸 읽기: 관리 구역은 대소문자 상관없이 빼고, 한도 뒤 글·밖을 가리키는 링크는 없는 것으로 본다', () => {
  const dir = tmp();
  const home = tmp();
  writeFiles(dir, { 'CLAUDE.md': `내 글\n<!-- harness-fit:start -->\n- ${USER_LINE}\n<!-- harness-fit:end -->\n`, 'docs/private.md': USER_LINE });
  for (const f of ['CLAUDE.md', 'claude.md', 'CLAUDE.MD', './CLAUDE.md']) assert.equal(textStillThere(dir, { file: f, userText: USER_LINE }, home), false, f);
  assert.equal(textStillThere(dir, { file: 'docs/private.md', userText: USER_LINE }, home), null, '받지 않는 꼴은 읽지 않는다');
  writeFiles(dir, { '.claude/rules/big.md': `${'가'.repeat(MAX_READ)}\n${USER_LINE}\n`, '.claude/rules/small.md': `- ${USER_LINE}\n` });
  assert.equal(textStillThere(dir, { file: '.claude/rules/big.md', userText: USER_LINE }, home), false, '읽기 한도 뒤');
  assert.equal(textStillThere(dir, { file: '.claude/rules/small.md', userText: USER_LINE }, home), true);
  // 밖을 가리키는 링크(만들 수 있을 때만 — Windows 는 권한이 없으면 못 만든다)
  const outside = path.join(home, 'secret.md');
  fs.writeFileSync(outside, USER_LINE);
  let linked = true;
  try { fs.symlinkSync(outside, path.join(dir, '.claude', 'rules', 'link.md')); } catch { linked = false; }
  if (linked) assert.equal(textStillThere(dir, { file: '.claude/rules/link.md', userText: USER_LINE }, home), false);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

test('명령줄 값: 사용자 글이 지금 그 파일에 없거나 너무 짧으면 오류 · 공백·CRLF 가 달라도 있으면 받는다', () => {
  const dir = tmp();
  writeFiles(dir, { 'CLAUDE.md': `# 내 규칙\r\n-   main 에   바로\r\n  커밋한다\r\n` });
  const run = (list) => withConflictHints(detect(dir), all, dir, null, { list }, { lang: 'ko' });
  assert.deepEqual(run([hookMine]).conflicts, [hookMine], '줄바꿈·여러 칸은 맞춰 견준다');
  const missing = run([{ ...hookMine, userText: '기능 브랜치에서 작업한다' }]);
  assert.equal(missing.error, 'bad-entry');
  assert.deepEqual(missing.why, ['not-in-file:CLAUDE.md']);
  assert.equal(run([{ ...hookMine, file: '.claude/rules/none.md' }]).error, 'bad-entry', '없는 파일');
  const short = run([{ ...hookMine, userText: 'main' }]);
  assert.deepEqual(short.why, ['userText']);
  assert.ok('main'.length < MIN_USER_TEXT);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('사용자 글의 방향 바꾸는 글자(bidi)·C1 제어 문자는 빼고 보이고 내보낸다', () => {
  const dir = tmp();
  const tricky = `main \u202e에 바로\u2066 커밋\u0085한다\u200f`;
  writeFiles(dir, { 'CLAUDE.md': `- ${tricky}\n` });
  const [c] = withConflictHints(detect(dir), all, dir, null, { list: [{ ...hookMine, userText: tricky }] }, { lang: 'ko' }).conflicts;
  assert.equal(c.userText, 'main 에 바로 커밋 한다');
  assert.ok(!/[\u0080-\u009f\u202a-\u202e\u2066-\u2069]/.test(c.userText));
  assert.equal(norm('a\u009fb'), 'a b');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('화면: 조합·추천은 지금 고른 쪽으로 거른다 — harness-fit 쪽으로 바꾸면 조합을 다시 골라도 켜진다', () => {
  const dir = tmp();
  const det = { ...withHints(detect(dir), { ...noHints, team: true }), conflicts: [hookMine], conflictsSaved: [] };
  const S = makeState({ all, cfg: pickerCfg, det, prev: null }, 'ko');
  const team = S.combos.find((k) => k.id === 'team');
  assert.ok(team.hooks.includes('protect-branch'), '서버는 거르지 않고 보낸다');
  const { sel, custom } = startSelection(S);
  assert.ok(!sel.hooks.has('protect-branch'), '처음에는 꺼짐');
  assert.equal(custom, false, '「내 규칙」 훅을 뺀 것을 직접 고침으로 치지 않는다');
  assert.ok(!fromCombo(team, sel).hooks.has('protect-branch'), '조합을 다시 골라도 꺼짐');
  const flipped = { ...sel, conflicts: withChoice(sel.conflicts, conflictKey(hookMine), 'harness') };
  assert.ok(fromCombo(team, flipped).hooks.has('protect-branch'), 'harness-fit 쪽이면 조합이 다시 켠다');
  assert.deepEqual(withoutMine(team, []), team);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('화면 팀원 공유: 켜면 ~/ 기록을 빼 두고 그 훅을 다시 켤 후보로, 끄면 되살린다', () => {
  const g = { ...hookMine, file: '~/.claude/CLAUDE.md' };
  const p = { ...hookMine, id: 'git-add-all' };
  const on = shareSplit([g, p], [], true);
  assert.deepEqual(on.list, [p]);
  assert.deepEqual(on.aside, [g]);
  assert.deepEqual(on.back, ['protect-branch']);
  const off = shareSplit(on.list, on.aside, false);
  assert.deepEqual(off.list, [p, g]);
  assert.deepEqual(off.off, ['protect-branch']);
  assert.deepEqual(shareSplit([p], [], true).back, [], '프로젝트 기록은 그대로');
});

test('overlap 훅 목록: 이미 있는 훅이 같은 일을 하면 빼고, 다른 브랜치 방식으로만 켜지는 훅은 flows 를 붙인다', () => {
  const dir = tmp();
  const det = withHints(detect(dir), noHints);
  const bare = overlapHooks(all, det, null, 'ko');
  const pb = bare.find((h) => h.id === 'protect-branch');
  assert.ok(pb && pb.flows.includes('github-flow'), '혼자 쓰는 조합(브랜치 방식 없음)에도 다른 방식의 훅을 싣는다');
  assert.ok(bare.find((h) => h.id === 'secrets') && !bare.find((h) => h.id === 'secrets').flows, '지금 켜질 훅은 flows 없음');
  const covered = overlapHooks(all, { ...det, existing: { hooks: { secrets: { scope: 'project', by: ['x'] }, 'protect-branch': { scope: 'project', by: ['x'] } } } }, null, 'ko');
  assert.ok(!covered.some((h) => h.id === 'secrets'), '이미 있는 훅과 겹치면 묻지 않는다');
  assert.ok(covered.some((h) => h.id === 'protect-branch'), 'Git Flow·Trunk 는 옵션이 달라 겹친다고 보지 않는다(dup.js PROBE_FLOW)');
  assert.ok(!covered.find((h) => h.id === 'protect-branch').flows.includes('github-flow'));
  fs.rmSync(dir, { recursive: true, force: true });
});
