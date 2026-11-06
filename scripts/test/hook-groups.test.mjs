// 훅 묶음(packs.json hookGroups): 고르기 화면은 훅을 이 묶음으로 나눠 보여 준다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAll } from '../lib/catalog.mjs';

const { packs } = loadAll();

test('훅마다 있는 묶음에 들어 있고, 묶음 이름·설명은 두 언어로', () => {
  const ids = new Set(packs.hookGroups.map((g) => g.id));
  assert.equal(ids.size, packs.hookGroups.length, '묶음 id 겹침');
  for (const g of packs.hookGroups) for (const k of ['name', 'desc']) assert.ok(g[k]?.ko && g[k]?.en, `${g.id}.${k}`);
  for (const h of packs.hooks) assert.ok(ids.has(h.group), `${h.id}: 묶음 없음(${h.group})`);
});
