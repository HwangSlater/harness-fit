// 규칙 글과 겹침 묶음 검사(2026-11-05 사용자 지적: 검사로 막을 수 있는 걸 글로만 두면 놓친다, 같은 걸 두 번 넣으면 안 된다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadAll, expandCombo } from '../lib/catalog.mjs';
import { TAG } from '../lib/claude-md.mjs';

const all = loadAll();
const dir = new URL('../../rules/', import.meta.url);
const files = fs.readdirSync(dir).filter((f) => /\.(ko|en)\.md$/.test(f));
const bullets = (f) => fs.readFileSync(new URL(f, dir), 'utf8').split(/\r?\n/).filter((l) => l.startsWith('- '));
const hookIds = new Set(all.packs.hooks.map((h) => h.id));
const skillIds = new Set(all.catalog.skills.map((s) => s.id));
const tagOf = (l) => { const m = l.match(TAG); return m ? (m[2] ? `${m[1]}${m[2]}:${m[3]}` : 'judge') : null; };

test('규칙 줄마다 「훅 · 스킬 · 판단」 중 하나를 밝힌다', () => {
  for (const f of files) {
    for (const l of bullets(f)) {
      const m = l.match(TAG);
      assert.ok(m, `${f}: 표시 없는 줄 — 검사로 막을 수 있으면 훅으로, 아니면 {{judge}}: ${l.slice(0, 50)}`);
      for (const x of m[3]?.split('|') || []) {
        if (m[2] === 'hook') assert.ok(hookIds.has(x), `${f}: 없는 훅 ${x}`);
        if (m[2] === 'skill') assert.ok(skillIds.has(x), `${f}: 없는 스킬 ${x}`);
      }
    }
  }
});

test('「훅이 막는다」를 글로 적지 않는다(훅이 막을 때 알려 준다)', () => {
  for (const f of files) for (const l of bullets(f)) assert.doesNotMatch(l, /훅이 막|hooks? blocks?/i, `${f}: ${l.slice(0, 50)}`);
});

test('한국어·영어 규칙 글은 같은 줄을 같은 표시로 갖는다', () => {
  for (const f of files.filter((x) => x.endsWith('.ko.md'))) {
    const en = f.replace('.ko.md', '.en.md');
    assert.ok(files.includes(en), `영어 글 없음: ${en}`);
    assert.deepEqual(bullets(en).map(tagOf), bullets(f).map(tagOf), `${f} ↔ ${en}`);
  }
});

// 한 스킬이 여러 묶음에 들어갈 수 있다(find-bugs 는 변경분 리뷰이면서 보안 리뷰다)
test('겹침 묶음: 스킬은 카탈로그에 있고, 같은 묶음이 두 번 있지 않다', () => {
  const { groups } = JSON.parse(fs.readFileSync(new URL('../../catalog/overlaps.json', import.meta.url), 'utf8'));
  const keys = new Set();
  for (const g of groups) {
    assert.ok(g.skills.length >= 2, `${g.id}: 둘 이상이어야 묶음`);
    for (const s of g.skills) assert.ok(skillIds.has(s), `${g.id}: 없는 스킬 ${s}`);
    const key = [...g.skills].sort().join(',');
    assert.ok(!keys.has(key), `${g.id}: 같은 묶음이 또 있음`);
    keys.add(key);
  }
});

test('조합 기본값에는 같은 일을 하는 스킬이 둘 들어가지 않는다(스택 스킬까지 펼쳐서)', () => {
  const { groups } = JSON.parse(fs.readFileSync(new URL('../../catalog/overlaps.json', import.meta.url), 'utf8'));
  // 스택은 detect 가 실제로 함께 내는 모양으로: 하나씩, 그리고 흔한 묶음(RN 앱 = React Native + Expo, 웹 + TS + 파이썬 등)
  const stacks = [...new Set(all.combos.stackAddons.flatMap((a) => a.when))];
  const sets = [...stacks.map((s) => [s]), ['React Native', 'Expo', 'TypeScript'], ['Next.js', 'TypeScript', 'Supabase', 'GitHub Actions'], ['React', 'TypeScript', 'Python']];
  for (const c of all.combos.combos) {
    for (const stack of sets) {
      const sel = expandCombo(all, c.id, { stack, existing: {} });
      for (const g of groups) {
        const both = g.skills.filter((s) => sel.skills.includes(s));
        assert.ok(both.length <= 1, `${c.id} [${stack}]: ${g.id} 묶음에서 ${both.join(', ')} 둘 다`);
      }
    }
  }
});
