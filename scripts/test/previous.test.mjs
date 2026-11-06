// 다시 열면 지난번 선택에서 시작하는지(네트워크 없이: 실제로 받는 스킬은 고르지 않는다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply, undo, buildConfig } from '../apply.mjs';
import { loadAll, PLUGIN_ROOT } from '../lib/catalog.mjs';
import { makeState, readHarnessConfig, previousOf } from '../lib/picker-state.mjs';
import { autoSelection } from '../recommend.mjs';
import { detect } from '../detect.mjs';
import { startSelection, fromRecommended } from '../../picker/selection.js';

const all = loadAll();
const cfg = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'config', 'picker.json'), 'utf8'));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'harness-prev-'));
const cfgFile = (dir) => path.join(dir, '.claude', 'harness.json');
const writeCfg = (dir, obj) => {
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(cfgFile(dir), typeof obj === 'string' ? obj : JSON.stringify(obj));
};
const stateOf = (dir) => makeState({ all, cfg, det: detect(dir), prev: readHarnessConfig(dir) }, 'ko');
const NONE = { skills: [], hooks: [], rules: [] };
// 팀 조합에서 보호 브랜치·브랜치 이름 검사를 일부러 끄고, 팀 공유도 끈 선택
const mine = { lang: 'ko', combo: 'team', flow: 'github-flow', skills: [], hooks: ['secrets', 'file-size'], rules: ['collab'], explore: [], note: '', share: false };

test('다시 열면 지난번에 적용한 선택이 그대로 previous 로 온다', async () => {
  const dir = tmp();
  await apply(dir, { ...mine, hookOpts: { 'file-size': { maxLines: 800 } } });
  const s = stateOf(dir);
  assert.ok(s.previous, '적용한 프로젝트는 previous 가 있다');
  assert.equal(s.previous.combo, 'team');
  assert.equal(s.previous.flow, 'github-flow');
  assert.deepEqual(s.previous.hooks.sort(), ['file-size', 'secrets']);
  assert.deepEqual(s.previous.rules, ['collab']);
  assert.equal(s.previous.share, false);
  assert.match(s.previous.at, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(s.newSince, NONE, '같은 카탈로그면 새로 생긴 것 없음');
  // 훅 옵션의 지난번 값은 그대로 prevRules 로 간다(picker/hook-options.js optionValue)
  assert.equal(s.prevRules['file-size'].maxLines, 800);
  // 훅은 harness.json 의 lang·rules 만 읽으므로 더한 키가 있어도 그대로 돈다
  const { loadConfig } = await import('../../hooks/lib/core.mjs');
  const loaded = loadConfig(dir);
  assert.ok(!loaded.broken);
  assert.deepEqual(Object.keys(loaded.rules).sort(), ['file-size', 'secrets']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('고른 스킬도 남고, 카탈로그에서 없어진 id 는 버린다', () => {
  const dir = tmp();
  const c = buildConfig(all, { ...mine, skills: ['handoff'] });
  writeCfg(dir, { ...c, rules: { ...c.rules, 'gone-hook': true, 'file-size': false }, selection: { ...c.selection, combo: 'gone', flow: 'gone', skills: ['handoff', 'gone-skill'], rules: ['collab', 'gone-rule'] } });
  const p = stateOf(dir).previous;
  assert.deepEqual(p.skills, ['handoff']);
  assert.deepEqual(p.hooks, ['secrets'], '없는 훅·꺼 둔(false) 훅은 빠진다');
  assert.deepEqual(p.rules, ['collab']);
  assert.equal(p.combo, '', '없는 조합은 비우고 화면이 추천 조합 칸을 고른다');
  assert.equal(p.flow, 'none');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('그 뒤 새로 생긴 스킬·훅·규칙은 꺼진 채로 newSince 에 나온다', () => {
  const dir = tmp();
  const c = buildConfig(all, mine);
  const skill = all.catalog.skills.find((s) => !s.overlapsHook).id;
  const hook = 'branch-name';
  const rule = 'security';
  const known = { skills: c.known.skills.filter((x) => x !== skill), hooks: c.known.hooks.filter((x) => x !== hook), rules: c.known.rules.filter((x) => x !== rule) };
  writeCfg(dir, { ...c, known });
  const s = stateOf(dir);
  assert.deepEqual(s.newSince, { skills: [skill], hooks: [hook], rules: [rule] });
  assert.ok(!s.previous.skills.includes(skill) && !s.previous.hooks.includes(hook) && !s.previous.rules.includes(rule), '새것은 꺼진 채');
  const auto = autoSelection(all, detect(dir), 'ko', readHarnessConfig(dir));
  assert.equal(auto.previous, true, 'auto 도 지난번 선택을 지킨다');
  assert.ok(!auto.selection.hooks.includes(hook));
  assert.deepEqual(auto.selection.covered, [], '겹침은 지금 감지한 것으로');
  assert.equal(auto.newSince.labels.hooks.length, 1, '새 훅은 이름으로 알린다');
  assert.equal(autoSelection(all, detect(dir), 'ko', null).previous, false, '--fresh(지난번 무시)면 새 추천');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('harness.json 이 없거나 깨졌으면 previous 없이 추천에서 시작한다', () => {
  const dir = tmp();
  assert.equal(stateOf(dir).previous, null, '없음');
  for (const bad of ['{ 깨짐', '[]', '"글"', JSON.stringify({ rules: { secrets: true } })]) {
    writeCfg(dir, bad);
    const s = stateOf(dir);
    assert.equal(s.previous, null, `previous 없음: ${bad}`);
    assert.deepEqual(s.newSince, NONE);
    assert.ok(s.recommended.combo);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('v0.2.2 이하가 쓴 harness.json 도 읽는다(규칙·공유는 조합 기본값)', () => {
  const legacy = { lang: 'ko', combo: 'team', flow: 'trunk', rules: { secrets: true, 'protect-branch': { allowCommit: true } }, skills: ['handoff'] };
  const p = previousOf({ all, cfg }, legacy, 'ko');
  assert.deepEqual(p.hooks.sort(), ['protect-branch', 'secrets']);
  assert.deepEqual(p.skills, ['handoff']);
  assert.equal(p.flow, 'trunk');
  assert.deepEqual(p.rules, all.combos.combos.find((c) => c.id === 'team').rules);
  assert.equal(p.share, true);
  assert.equal(p.at, null);
});

test('화면은 지난번 선택에서 시작하고, 추천으로 되돌릴 수 있다(picker/selection.js)', async () => {
  const dir = tmp();
  await apply(dir, mine);
  const s = stateOf(dir);
  const start = startSelection(s, null);
  assert.equal(start.sel.combo, 'team');
  assert.deepEqual([...start.sel.hooks].sort(), ['file-size', 'secrets']);
  assert.deepEqual([...start.sel.rules], ['collab']);
  assert.equal(start.sel.share, false);
  assert.equal(start.custom, true, '조합 기본값과 다르니 「직접 고침」');
  assert.ok(start.touched.has('hook:protect-branch'), '조합에서 끈 훅은 손댄 것으로(팀원 공유를 바꿔도 다시 켜지 않게)');
  const rec = fromRecommended(s, start.sel);
  assert.equal(rec.combo, s.recommended.combo);
  // 지난번 선택이 없으면 추천 그대로
  const fresh = startSelection({ ...s, previous: null }, null);
  assert.equal(fresh.custom, false);
  assert.deepEqual([...fresh.sel.hooks].sort(), [...s.recommended.hooks].sort());
  fs.rmSync(dir, { recursive: true, force: true });
});

test('너무 큰 harness.json 은 훅과 같은 한도로 읽지 않는다(추천에서 시작)', async () => {
  const { MAX_CONFIG_BYTES } = await import('../../hooks/lib/core.mjs');
  const dir = tmp();
  writeCfg(dir, JSON.stringify({ lang: 'ko', rules: { secrets: true }, pad: 'x'.repeat(MAX_CONFIG_BYTES) }));
  assert.equal(readHarnessConfig(dir), null);
  writeCfg(dir, { lang: 'ko', rules: { secrets: true } });
  assert.ok(readHarnessConfig(dir));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('다시 열어 그대로 적용해도 꺼 둔 훅은 꺼진 채이고, 되돌리기는 그 전 상태로', async () => {
  const dir = tmp();
  await apply(dir, mine);
  const first = fs.readFileSync(cfgFile(dir), 'utf8');
  const s = stateOf(dir);
  assert.ok(s.combos.find((k) => k.id === 'team').hooks.includes('protect-branch'), '조합 기본값이었다면 다시 켜졌을 훅');
  await apply(dir, { ...s.previous, lang: 'ko', explore: [], note: '' });
  const again = readHarnessConfig(dir);
  assert.ok(!('protect-branch' in again.rules) && !('branch-name' in again.rules), '끈 훅은 그대로 꺼짐');
  assert.deepEqual(again.selection.rules, ['collab']);
  const r = undo(dir);
  assert.ok(!r.error);
  assert.equal(fs.readFileSync(cfgFile(dir), 'utf8'), first, '두 번째 적용 전 harness.json 으로 돌아간다');
  fs.rmSync(dir, { recursive: true, force: true });
});
