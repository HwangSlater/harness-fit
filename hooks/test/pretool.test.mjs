// PreToolUse 규칙 모듈 표(hooks/lib/pretool.mjs RULE_MODULES)가 실제 규칙 모듈과 같은지, 켠 id 만으로 불러도 판정이 같은지.
// 표가 틀리면 진입점(run.mjs)이 켠 규칙의 모듈을 안 불러 검사가 조용히 빠진다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RULE_MODULES, loadRules, kindOf } from '../lib/pretool.mjs';
import { ruleOpts, runRules } from '../lib/dispatch.mjs';

const RULES_DIR = new URL('../rules/', import.meta.url);
const KINDS = ['shell', 'write', 'fetch'];

test('표의 ids 는 그 모듈이 그 종류로 내는 규칙 id 와 같다', async () => {
  for (const m of RULE_MODULES) {
    const mod = await m.load();
    const rules = (Array.isArray(mod) ? mod : mod.default).filter((r) => r.on === m.on);
    assert.deepEqual([...new Set(rules.map((r) => r.id))].sort(), [...m.ids].sort(), `${m.on}: ${m.ids.join(', ')}`);
  }
});

test('hooks/rules 의 도구 호출 규칙은 모두 표에 있다', async () => {
  const inTable = new Set((await Promise.all(KINDS.map((on) => loadRules(on)))).flat());
  for (const f of fs.readdirSync(RULES_DIR).filter((n) => n.endsWith('.mjs'))) {
    const mod = await import(new URL(f, RULES_DIR));
    for (const r of Object.values(mod).flat().filter((x) => x && typeof x === 'object' && typeof x.check === 'function' && KINDS.includes(x.on))) {
      assert.ok(inTable.has(r), `${f}: ${r.id}(${r.on}) 가 RULE_MODULES 에 없다`);
    }
  }
});

test('켠 id 만으로 부른 규칙은 모두 부른 것에서 켠 것만 고른 것과 같다(차례도)', async () => {
  for (const on of KINDS) {
    const all = await loadRules(on);
    for (const id of new Set(all.map((r) => r.id))) {
      const cfg = { rules: { [id]: true } };
      const some = await loadRules(on, cfg);
      assert.deepEqual(some.filter((r) => cfg.rules[r.id]), all.filter((r) => r.id === id), `${on} · ${id}`);
    }
    assert.deepEqual(await loadRules(on, { rules: {} }), [], `${on}: 켠 것이 없으면 모듈을 부르지 않는다`);
  }
});

test('kindOf: 셸·쓰기·웹 말고는 null', () => {
  assert.deepEqual(['Bash', 'PowerShell', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'Read', 'bash', ''].map(kindOf), ['shell', 'shell', 'write', 'write', 'write', 'fetch', null, null, null]);
});

test('dispatch: 옵션 모양, 켠 것만, 터진 규칙은 모으고 나머지는 돈다', () => {
  assert.deepEqual([true, false, null, 5, 'x', [], [1]].map(ruleOpts), [{}, {}, {}, {}, {}, {}, {}]);
  const o = { a: 1 };
  assert.equal(ruleOpts(o), o);
  const rules = [{ id: 'a' }, { id: 'boom' }, { id: 'off' }, { id: 'b' }, { id: 'boom' }];
  const cfg = { rules: { a: true, boom: { x: 1 }, off: false, b: { y: 2 } } };
  const errors = [];
  const seen = [];
  const out = runRules(rules, cfg, (r, opts) => {
    seen.push([r.id, opts]);
    if (r.id === 'boom') throw new Error('x');
    return r.id === 'a' ? 'msg-a' : null;
  }, { errors });
  assert.deepEqual(out, ['msg-a']);
  assert.deepEqual(errors, ['boom'], '같은 id 는 한 번만');
  assert.deepEqual(seen.map(([id]) => id), ['a', 'boom', 'b', 'boom']);
  assert.deepEqual(seen[2][1], { y: 2 });
});
