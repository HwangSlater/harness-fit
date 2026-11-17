// 고르기 화면의 「내 규칙과 반대라 뺐어요」 이름표: 훅 단계·지침 단계에 보이고, 누르면 내 규칙 줄과 파일을 보여 주는 작은 창이 열린다.
// 브라우저 없이 화면 부품을 그려 보려고 아주 작은 가짜 DOM 을 쓴다(글은 textContent 로만 — 부품이 innerHTML 을 쓰면 여기서 바로 깨진다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pickerCfg, tmpDir } from './helpers.mjs';
import { loadAll } from '../lib/catalog.mjs';
import { makeState } from '../lib/picker-state.mjs';
import { detect } from '../detect.mjs';

class FakeNode {
  constructor(tag) {
    this.tag = tag;
    this.attrs = {};
    this.kids = [];
    this.on = {};
    this.style = {};
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  toggleAttribute() {}
  append(...xs) { for (const x of xs) this.kids.push(typeof x === 'string' ? { text: x } : x); }
  replaceChildren(...xs) { this.kids = []; this.append(...xs); }
  addEventListener(ev, fn) { (this.on[ev] ||= []).push(fn); }
  get textContent() { return this.kids.map((k) => (k instanceof FakeNode ? k.textContent : k.text)).join(''); }
  set textContent(v) { this.kids = [{ text: String(v) }]; }
  setAttributeNS() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
  get innerHTML() { throw new Error('innerHTML 은 쓰지 않는다'); }
  set innerHTML(v) { throw new Error('innerHTML 은 쓰지 않는다'); }
}
const byId = new Map();
globalThis.Node = FakeNode;
globalThis.window = { addEventListener() {} };
globalThis.document = {
  createElement: (t) => new FakeNode(t), createElementNS: (_, t) => new FakeNode(t), addEventListener() {}, querySelector: () => null,
  getElementById: (id) => (byId.has(id) || byId.set(id, new FakeNode('div')), byId.get(id)),
};
const walk = (n, out = []) => {
  if (n instanceof FakeNode) out.push(n), n.kids.forEach((k) => walk(k, out));
  else if (Array.isArray(n)) n.forEach((k) => walk(k, out));
  return out;
};

const { hooksStep } = await import('../../picker/hooks.js');
const { rulesStep } = await import('../../picker/rules.js');
const { renderInfo } = await import('../../picker/info-dialog.js');
const { startSelection } = await import('../../picker/selection.js');
const { dupsFor, defaultsFor, matesFor } = await import('../../picker/stats.js');
const { fmt } = await import('../../picker/dom.js');

const all = loadAll();
const USER_LINE = 'main 에 바로 커밋한다';
const hookMine = { kind: 'hook', id: 'protect-branch', choice: 'mine', file: '~/.claude/CLAUDE.md', userText: USER_LINE };
const ruleMine = { kind: 'rule', id: 'github-flow', line: 1, choice: 'mine', file: 'CLAUDE.md', userText: USER_LINE };

const ctxFor = (conflicts, flow = 'github-flow') => {
  const dir = tmpDir('hf-conflict-ui-');
  const S = makeState({ all, cfg: pickerCfg, det: { ...detect(dir), conflicts, conflictsSaved: [] }, prev: null }, 'ko');
  fs.rmSync(dir, { recursive: true, force: true });
  const { sel } = startSelection(S);
  sel.flow = flow;
  const calls = [];
  const act = new Proxy({}, { get: (_, name) => (...a) => calls.push([name, ...a]) });
  const t = (k, v) => fmt(S.strings[k] ?? k, v, S.lang);
  const c = { S, sel, ui: { preview: null, open: new Set(), visited: new Set(), touched: new Set(), ruleAlt: {} }, t, act, dup: dupsFor(S, sel), defaults: defaultsFor(S, sel), mates: matesFor(S, sel) };
  return { S, sel, c, calls, t };
};
const keyed = (nodes, key) => walk(nodes).find((n) => n.attrs['data-key'] === key);

test('훅 단계: 내 규칙 쪽 훅에 「내 규칙과 반대라 뺐어요」, 누르면 그 기록의 작은 창을 연다', () => {
  const { c, calls, t } = ctxFor([hookMine]);
  const view = hooksStep(c);
  const all = walk(view).map((n) => n.textContent).join('\n');
  assert.ok(all.includes(t('conflictLabel')), '이름표 글');
  assert.ok(all.includes(t('conflictHooksTitle')), '알림 띠');
  assert.ok(all.includes(t('chipConflict')), '칩의 작은 글');
  const link = keyed(view, 'info:c:hook:protect-branch');
  assert.ok(link, '이름표 링크');
  assert.equal(link.attrs['aria-haspopup'], 'dialog');
  link.on.click[0]();
  assert.deepEqual(calls.at(-1), ['openInfo', { kind: 'conflict', id: 'hook:protect-branch' }]);
});

test('작은 창: 내 규칙 줄과 파일, harness-fit 이 켜려던 검사, harness-fit 쪽 쓰기 스위치', () => {
  const { c, calls, t } = ctxFor([hookMine]);
  c.ui.info = { kind: 'conflict', id: 'hook:protect-branch' };
  const r = renderInfo(c);
  assert.equal(r.opening, true);
  const body = document.getElementById('infoBody').textContent;
  assert.ok(body.includes(USER_LINE));
  assert.ok(body.includes(t('infoConflictFile', { file: '~/.claude/CLAUDE.md' })));
  assert.ok(body.includes(c.S.hooks.find((x) => x.id === 'protect-branch').name));
  assert.equal(document.getElementById('infoTitle').textContent, t('infoConflictTitle'));
  const sw = keyed(document.getElementById('infoFoot'), 'info-tg:hook:protect-branch');
  assert.equal(sw.attrs['aria-checked'], 'false', '내 규칙 쪽이면 꺼짐');
  sw.on.click[0]();
  assert.deepEqual(calls.at(-1), ['flipConflict', 'hook:protect-branch']);
});

test('지침 단계: 브랜치 방식 줄에 이름표, harness-fit 쪽을 고른 것은 다른 글', () => {
  const { c, t } = ctxFor([ruleMine]);
  const view = rulesStep(c);
  assert.ok(keyed(view, 'info:c:rule:github-flow:1'));
  assert.ok(walk(view).some((n) => n.textContent === t('conflictLabel')));
  const kept = ctxFor([{ ...ruleMine, choice: 'harness' }]);
  const v2 = rulesStep(kept.c);
  assert.ok(walk(v2).some((n) => n.textContent === kept.t('conflictLabelKept')));
});
