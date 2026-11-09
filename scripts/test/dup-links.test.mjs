// 고르기 화면 겹침 이름표의 링크가 쓰는 데이터(2026-11-09): 이미 있는 스킬(found)·기존 훅(from)·시험 한 줄(probes.json said)·같은 묶음 스킬 id(matesFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dupSkills, dupHooks } from '../../picker/dup.js';
import { matesFor } from '../../picker/stats.js';
import { readPluginJson } from '../lib/paths.mjs';

test('probes.json 의 훅마다 화면에 보일 시험 한 줄(said)이 두 언어로 있다', () => {
  const probes = readPluginJson('catalog/probes.json');
  for (const [id, p] of Object.entries(probes).filter(([k]) => !k.startsWith('_'))) {
    for (const lang of ['ko', 'en']) assert.ok(typeof p.said?.[lang] === 'string' && p.said[lang].length > 10, `${id}.said.${lang}`);
  }
});

test('dupSkills: 같은 이름·비슷한 스킬마다 그 이미 있는 스킬(이름·설명·자리·플러그인)을 found 로 준다', () => {
  const existing = {
    skillList: [
      { id: 'plan-x', name: 'plan-x', description: '계획을 캐물어요', scope: 'user', plugin: null },
      { id: 'tdd', name: 'tdd', description: '', scope: 'project', plugin: 'tools@market' },
    ],
    similar: [{ id: 'grill', to: 'plan-x' }, { id: 'other', to: 'gone-skill' }],
  };
  const got = new Map(dupSkills(existing, new Set(['tdd', 'grill', 'other']), false).map((d) => [d.id, d]));
  assert.deepEqual(got.get('tdd').found, [{ name: 'tdd', description: '', scope: 'project', plugin: 'tools@market' }]);
  assert.equal(got.get('tdd').same, true);
  assert.deepEqual(got.get('grill').found, [{ name: 'plan-x', description: '계획을 캐물어요', scope: 'user', plugin: null }]);
  assert.equal(got.get('grill').same, false);
  // 목록에서 못 찾은 비슷한 스킬은 이름만(어디 있는지는 모름)
  assert.deepEqual(got.get('other').found, [{ name: 'gone-skill', description: '', scope: null, plugin: null }]);
  // 팀원 공유를 켜면 이 PC 에만 있는 것은 겹침이 아니다
  assert.deepEqual(dupSkills(existing, new Set(['tdd', 'grill']), true).map((d) => d.id), ['tdd']);
});

test('dupHooks: 기존 훅 결과의 from 을 그대로, 예전 결과(from 없음)는 빈 목록', () => {
  const from = [{ label: 'guard.mjs', scope: 'user', plugin: null }];
  assert.deepEqual(dupHooks({ hooks: { secrets: { scope: 'user', by: ['guard.mjs'], from } } }, false)[0].from, from);
  assert.deepEqual(dupHooks({ hooks: { secrets: { scope: 'user', by: ['guard.mjs'] } } }, false)[0].from, []);
});

test('matesFor: 넣지 않은 스킬마다 같은 묶음에서 이미 넣은 스킬 id(여러 묶음이면 모두)', () => {
  const S = { skills: ['a', 'b', 'c', 'd'].map((id) => ({ id, title: id.toUpperCase() })), overlaps: [['a', 'b'], ['a', 'c', 'd']] };
  const got = matesFor(S, { skills: new Set(['b', 'c']) });
  assert.deepEqual(got.get('a'), ['b', 'c']);
  assert.deepEqual(got.get('d'), ['c']);
  assert.equal(got.has('b'), false);
});
