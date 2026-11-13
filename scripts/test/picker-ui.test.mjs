// 고르기 화면: 훅 묶음이 상태로 가는지(makeState hookGroups), 화면 파일·글꼴을 목록대로만 보내는지(scripts/lib/static.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickerCfg, tmpDir } from './helpers.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { loadAll, PLUGIN_ROOT } from '../lib/catalog.mjs';
import { makeState } from '../lib/picker-state.mjs';
import { detect } from '../detect.mjs';
import { STATIC, TYPES, readStatic } from '../lib/static.mjs';

const all = loadAll();
const cfg = pickerCfg;
const dir = tmpDir('harness-ui-');
const stateIn = (lang, packs = all.packs) => makeState({ all: { ...all, packs }, cfg, det: detect(dir) }, lang);

test('makeState 는 훅 묶음(hookGroups)을 그 언어 이름으로, 훅마다 group 을 보낸다', () => {
  for (const lang of ['ko', 'en']) {
    const s = stateIn(lang);
    assert.deepEqual(s.hookGroups.map((g) => g.id), all.packs.hookGroups.map((g) => g.id), '묶음 순서 그대로');
    for (const g of s.hookGroups) {
      const src = all.packs.hookGroups.find((x) => x.id === g.id);
      assert.equal(g.name, src.name[lang]);
      assert.equal(g.desc, src.desc[lang]);
    }
    for (const h of s.hooks) assert.equal(h.group, all.packs.hooks.find((x) => x.id === h.id).group, `${h.id}.group`);
  }
});

test('새 훅·새 묶음은 데이터만 더하면 상태에 실린다(화면은 이것으로 그린다)', () => {
  const packs = {
    ...all.packs,
    hookGroups: [...all.packs.hookGroups, { id: 'zz', name: { ko: '새 묶음', en: 'New group' }, desc: { ko: '설명', en: 'desc' } }],
    hooks: [...all.packs.hooks, { id: 'zz-hook', group: 'zz', name: { ko: '새 훅', en: 'New hook' }, desc: { ko: 'd', en: 'd' } }],
  };
  const s = stateIn('ko', packs);
  assert.equal(s.hookGroups.at(-1).name, '새 묶음');
  assert.equal(s.hooks.find((h) => h.id === 'zz-hook').group, 'zz');
});

test('글꼴은 바이트 그대로 font/woff2 로, 글은 utf8 로 보낸다', () => {
  const fonts = Object.keys(STATIC).filter((p) => p.endsWith('.woff2'));
  assert.equal(fonts.length, 3, '글꼴 3벌');
  for (const p of fonts) {
    const f = readStatic(p);
    assert.ok(Buffer.isBuffer(f.body), `${p}: Buffer`);
    assert.equal(f.body.subarray(0, 4).toString('latin1'), 'wOF2', `${p}: woff2 머리`);
    assert.equal(f.body.length, fs.statSync(path.join(PLUGIN_ROOT, 'picker', STATIC[p])).size, `${p}: 바이트 수 그대로`);
    assert.equal(f.type, 'font/woff2');
  }
  const html = readStatic('/');
  assert.equal(typeof html.body, 'string');
  assert.equal(html.type, TYPES['.html']);
  // 글꼴만 오래 캐시, 나머지는 no-store. 두 번째부터는 메모리에서(같은 것을 준다)
  for (const p of fonts) assert.equal(readStatic(p).cacheControl, 'public, max-age=31536000, immutable');
  for (const p of ['/', '/app.js', '/tokens.css']) assert.equal(readStatic(p).cacheControl, 'no-store', p);
  assert.equal(readStatic('/app.js'), readStatic('/app.js'));
  assert.match(readStatic('/tokens.css').body, /SpoqaHanSansNeo-Regular\.woff2/);
});

test('목록에 없는 경로는 보내지 않는다(토큰 없이 열리는 것은 목록 파일뿐)', () => {
  for (const p of ['/fonts/OFL.txt', '/fonts/../app.js', '/../package.json', '/i18n/ko.json', '/style.css', '/view.js', '/constructor', '/__proto__', '/fonts/', '/APP.JS']) {
    assert.equal(readStatic(p), null, p);
  }
});

test('picker/ 의 화면 파일은 모두 목록에 있고, 목록 파일은 모두 있다(남은 파일·빠진 파일 없음)', () => {
  const listed = new Set(Object.values(STATIC));
  const onDisk = [
    ...fs.readdirSync(path.join(PLUGIN_ROOT, 'picker')).filter((f) => /\.(js|css|html)$/.test(f)),
    ...fs.readdirSync(path.join(PLUGIN_ROOT, 'picker', 'fonts')).filter((f) => f.endsWith('.woff2')).map((f) => `fonts/${f}`),
  ];
  for (const f of onDisk) assert.ok(listed.has(f), `목록에 없음: ${f}`);
  for (const f of listed) assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, 'picker', f)), `파일 없음: ${f}`);
  assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, 'picker', 'fonts', 'OFL.txt')), '글꼴 라이선스');
});

// 화면 문구는 picker/i18n/<lang>/*.json 여러 파일(구역마다). 같은 파일 이름·같은 키, 한 키는 한 파일에만.
test('화면 문구는 두 언어가 같은 파일·같은 키를 갖고, 같은 키가 두 파일에 있지 않다', () => {
  const files = (lang) => fs.readdirSync(path.join(PLUGIN_ROOT, 'picker', 'i18n', lang)).filter((f) => f.endsWith('.json')).sort();
  assert.deepEqual(files('ko'), files('en'));
  for (const f of files('ko')) {
    const keys = (lang) => Object.keys(JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'picker', 'i18n', lang, f), 'utf8'))).sort();
    assert.deepEqual(keys('ko'), keys('en'), f);
  }
  for (const lang of ['ko', 'en']) {
    const seen = new Map();
    for (const f of files(lang)) for (const k of Object.keys(JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'picker', 'i18n', lang, f), 'utf8')))) {
      assert.ok(!seen.has(k), `${lang}: ${k} 가 ${seen.get(k)} 와 ${f} 에 둘 다`);
      seen.set(k, f);
    }
    assert.equal(Object.keys(stateIn(lang).strings).length, seen.size, '화면 상태는 모든 파일을 합친다');
  }
});

test('받지 못한 스킬 알림: 한도와 다른 실패가 섞이면 「한도가 풀리면 다시」는 한도에 걸린 스킬만, 나머지는 그 까닭과 따로(독립 검토 2026-11-13)', async () => {
  const { failedText } = await import('../../picker/stats.js');
  const { fmt } = await import('../../picker/dom.js');
  const nameOf = (f) => f.skill;
  const limit = { skill: 'a', error: 'rate', reason: 'rate-limit', waitMin: 12 };
  const notFound = { skill: 'b', error: '404 Not Found' };
  const license = { skill: 'c', error: 'license unknown' };
  for (const lang of ['ko', 'en']) {
    const s = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'picker', 'i18n', lang, 'review.json'), 'utf8'));
    const t = (k, v) => { assert.ok(s[k], `${lang} ${k}`); return fmt(s[k], v, lang); };
    const mixed = failedText(t, [limit, notFound, license], nameOf);
    assert.equal(mixed.title, t('doneFailedMixed', { list: 'a, b, c' }), '제목은 한도 뒤에 다시 받는다고 하지 않는다');
    assert.ok(mixed.desc.includes(t('doneFailedLimitOf', { list: 'a', n: 12 })), mixed.desc);
    assert.ok(mixed.desc.includes(t('doneFailedOtherOf', { list: 'b', why: '404 Not Found' })) && mixed.desc.includes(t('doneFailedOtherOf', { list: 'c', why: 'license unknown' })), mixed.desc);
    // 한도만이면 예전 그대로, 다른 실패만이면 한도 말이 없다
    assert.equal(failedText(t, [limit], nameOf).title, t('doneFailedLimit', { list: 'a' }));
    const other = failedText(t, [notFound], nameOf);
    assert.equal(other.title, t('doneFailed', { list: 'b' }));
    assert.equal(other.desc, t('doneFailedWhy', { why: '404 Not Found' }));
  }
});
