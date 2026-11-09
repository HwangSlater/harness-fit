// 쉬운 설명: 스킬마다 「무엇이 달라지나」(effect)와 「알아 둘 점」(downside), 훅마다 「알아 둘 점」이 두 언어로 있고 화면 상태에 실린다.
// 알아 둘 점에서 다른 스킬·훅·옵션을 이름으로 가리키면(「…」·"…") 그 이름이 실제로 있어야 한다(이름을 바꾸면 여기서 걸린다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickerCfg, tmpDir } from './helpers.mjs';
import { loadAll, PLUGIN_ROOT } from '../lib/catalog.mjs';
import { readJson } from '../lib/paths.mjs';
import { makeState } from '../lib/picker-state.mjs';
import { detect } from '../detect.mjs';
import path from 'node:path';

const all = loadAll();
const titles = readJson(path.join(PLUGIN_ROOT, 'catalog/titles.json'));
const LANGS = ['ko', 'en'];
const filled = (o) => LANGS.every((l) => typeof o?.[l] === 'string' && o[l].trim().length > 0);

// 글 속에서 가리킬 수 있는 이름: 스킬 이름 · 훅 이름 · 훅 옵션 이름
const names = Object.fromEntries(LANGS.map((l) => [l, new Set([
  ...Object.values(titles).map((x) => x.title[l]),
  ...all.packs.hooks.map((x) => x.name[l]),
  ...all.packs.hooks.flatMap((x) => (x.options || []).map((o) => o.label[l])),
])]));
const quoted = { ko: /「([^」]+)」/g, en: /"([^"]+)"/g };
// 이름이 아닌 따옴표 말(사용자가 치는 말 등)이 생기면 여기 적는다
const NOT_NAMES = new Set([]);
const checkRefs = (where, o) => {
  for (const l of LANGS) for (const [, n] of o[l].matchAll(quoted[l])) {
    if (!NOT_NAMES.has(n)) assert.ok(names[l].has(n), `${where}.${l}: 「${n}」은 스킬·훅·옵션 이름이 아니에요`);
  }
};

test('카탈로그 스킬마다 쉬운 한 줄(effect)이 한·영 모두 있고, 알아 둘 점은 있으면 한·영 모두', () => {
  for (const s of all.catalog.skills) {
    const x = titles[s.id];
    assert.ok(filled(x?.effect), `${s.id}.effect`);
    if (x.downside === undefined) continue;
    assert.ok(filled(x.downside), `${s.id}.downside 는 한·영 모두(없으면 키를 빼요)`);
    checkRefs(`${s.id}.downside`, x.downside);
    // 자리 채우기는 {onUse}(꺼내 쓸 때 토큰)만 — 숫자는 catalog.json 한 곳에서
    for (const l of LANGS) for (const [, k] of x.downside[l].matchAll(/\{(\w+)[^}]*\}/g)) assert.equal(k, 'onUse', `${s.id}.downside.${l}`);
  }
  for (const id of Object.keys(titles)) assert.ok(all.catalog.skills.some((s) => s.id === id), `titles.json 에만 있는 스킬: ${id}`);
});

test('훅마다 알아 둘 점(downside)이 한·영 모두 있다', () => {
  for (const x of all.packs.hooks) {
    assert.ok(filled(x.downside), `${x.id}.downside`);
    checkRefs(`${x.id}.downside`, x.downside);
  }
});

test('makeState 는 그 언어의 effect·downside 를 스킬·훅에 싣는다', () => {
  const det = detect(tmpDir('harness-explain-'));
  for (const lang of LANGS) {
    const s = makeState({ all, cfg: pickerCfg, det }, lang);
    for (const k of s.skills) {
      assert.equal(k.effect, titles[k.id].effect[lang], `${k.id}.effect`);
      assert.equal(k.downside, titles[k.id].downside?.[lang] || '', `${k.id}.downside`);
    }
    for (const h of s.hooks) assert.equal(h.downside, all.packs.hooks.find((x) => x.id === h.id).downside[lang], `${h.id}.downside`);
  }
});
