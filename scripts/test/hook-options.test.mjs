// 훅 옵션(packs.json hooks[].options) 시험: 화면이 보여 주는 옵션은 훅 코드가 실제로 읽고, 고른 값이 harness.json 에 그대로 들어간다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadAll, PLUGIN_ROOT } from '../lib/catalog.mjs';
import { buildConfig } from '../apply.mjs';
import { cleanSelection } from '../lib/picker-state.mjs';
import { validValue, cleanHookOpts, optionValue, ownedKeys, parseList } from '../../picker/hook-options.js';
import { DEFAULT_MAX_LINES } from '../../hooks/rules/files.mjs';
import { DEFAULT_MAX_SUBJECT } from '../../hooks/rules/message.mjs';
import { DEFAULT_BRANCH_PATTERN, DEFAULT_PROTECTED } from '../../hooks/rules/git.mjs';
import { DEFAULT_ANSWER_LANG, ANSWER_LANGS } from '../../hooks/lib/answer-lang.mjs';

const all = loadAll();
const cfg = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'config', 'picker.json'), 'utf8'));
const RULES = path.join(PLUGIN_ROOT, 'hooks', 'rules');
const ruleFiles = fs.readdirSync(RULES).filter((f) => f.endsWith('.mjs')).map((f) => fs.readFileSync(path.join(RULES, f), 'utf8'));
const withOptions = all.packs.hooks.filter((h) => h.options?.length);
const hook = (id) => all.packs.hooks.find((h) => h.id === id);
const opt = (id, key) => hook(id).options.find((o) => o.key === key);

test('화면이 보여 주는 옵션은 모두 그 훅 코드가 opts.<key> 로 읽는다(아무 일도 안 하는 옵션 금지)', () => {
  assert.ok(withOptions.length >= 5);
  for (const h of withOptions) {
    // 그 훅 id 를 규칙으로 등록한 모듈(id: 'x' 또는 onCommit('x', …))
    const mods = ruleFiles.filter((src) => src.includes(`id: '${h.id}'`) || src.includes(`onCommit('${h.id}'`));
    assert.ok(mods.length, `${h.id}: 규칙 모듈을 못 찾음`);
    for (const o of h.options) assert.ok(mods.some((src) => src.includes(`opts.${o.key}`)), `${h.id}.${o.key}: 훅 코드가 읽지 않는 옵션`);
  }
});

test('옵션 꼴: 이름·설명이 두 언어로, 기본값·선택지·브랜치 방식 값이 모두 꼴에 맞는다', () => {
  for (const h of withOptions) {
    for (const o of h.options) {
      const where = `${h.id}.${o.key}`;
      assert.ok(['select', 'toggle', 'list'].includes(o.type), where);
      for (const k of ['label', 'help']) assert.ok(o[k]?.ko && o[k]?.en, `${where}.${k}`);
      assert.ok(validValue(o, o.default), `${where} 기본값`);
      if (o.type === 'select') for (const c of o.choices) assert.ok(c.label?.ko && c.label?.en, `${where} 선택지 이름`);
      if (o.type === 'list') assert.ok(['branch', 'path'].includes(o.item), `${where} 목록 칸 꼴`);
    }
    for (const f of all.packs.flows) {
      for (const [k, v] of Object.entries(f.hooks?.[h.id] || {})) {
        const o = h.options.find((x) => x.key === k);
        assert.ok(o, `${f.id} 가 ${h.id}.${k} 를 정하는데 옵션 꼴에 없음`);
        assert.ok(validValue(o, v), `${f.id} 의 ${h.id}.${k} 값이 꼴에 맞지 않음`);
      }
    }
  }
});

test('옵션 기본값은 훅 코드의 기본값과 같다(화면이 「기본」이라 보여 준 값 = 실제 동작)', () => {
  assert.equal(opt('file-size', 'maxLines').default, DEFAULT_MAX_LINES);
  assert.equal(opt('commit-msg', 'maxSubject').default, DEFAULT_MAX_SUBJECT);
  assert.equal(opt('branch-name', 'pattern').default, DEFAULT_BRANCH_PATTERN);
  assert.deepEqual(opt('protect-branch', 'branches').default, DEFAULT_PROTECTED);
  assert.equal(opt('answer-lang', 'lang').default, DEFAULT_ANSWER_LANG);
  assert.deepEqual(opt('answer-lang', 'lang').choices.map((c) => c.value), ANSWER_LANGS);
  assert.equal(opt('docs-check', 'dateLine').default, true);
});

test('받은 옵션 값은 꼴로 거른다: 모르는 훅·키, 선택지 밖 값, 잘못된 브랜치 이름·경로는 버린다', () => {
  const raw = {
    'file-size': { maxLines: 600, extra: 1 },
    'commit-msg': { lang: 'jp', maxSubject: '72', style: 'free' },
    'protect-branch': { branches: ['main', 'release/v1'], noDirectPush: 'yes' },
    'protected-files': { paths: ['config/prod.json', '../etc/passwd'] },
    secrets: { paths: ['x'] },
    nope: { a: 1 },
  };
  assert.deepEqual(cleanHookOpts(all.packs.hooks, raw), { 'file-size': { maxLines: 600 }, 'commit-msg': { style: 'free' }, 'protect-branch': { branches: ['main', 'release/v1'] } });
  const sel = cleanSelection({ all, cfg }, { flow: 'github-flow', hooks: ['file-size'], hookOpts: raw }, 'ko');
  assert.deepEqual(sel.hookOpts['file-size'], { maxLines: 600 });
  assert.deepEqual(parseList(opt('protect-branch', 'branches'), 'main, develop  bad name;x'), { values: ['main', 'develop', 'bad', 'name;x'].filter((x) => x !== 'name;x'), bad: ['name;x'] });
});

test('harness.json: 고른 값이 들어가고, 브랜치 방식 값보다 사용자가 고른 값이 앞선다', () => {
  const base = { lang: 'ko', combo: 'team', skills: [], rules: [], hooks: ['protect-branch', 'branch-name', 'commit-msg', 'file-size'] };
  const gf = buildConfig(all, { ...base, flow: 'github-flow', hookOpts: {} });
  assert.equal(gf.rules['protect-branch'].noDirectPush, true, 'GitHub Flow 기본값');
  const mine = buildConfig(all, { ...base, flow: 'github-flow', hookOpts: { 'protect-branch': { noDirectPush: false, branches: ['main', 'trunk'] }, 'file-size': { maxLines: 800 }, 'commit-msg': { lang: 'ko' } } });
  assert.deepEqual(mine.rules['protect-branch'], { branches: ['main', 'trunk'], noDirectPush: false });
  assert.deepEqual(mine.rules['file-size'], { maxLines: 800 });
  assert.deepEqual(mine.rules['commit-msg'], { lang: 'ko' });
  // 다시 적용: 지난번에 넣은(방식이 정하지 않는) 옵션은 남고, 화면에서 고친 것만 바뀐다
  const again = buildConfig(all, { ...base, flow: 'git-flow', hookOpts: { 'file-size': { maxLines: 300 } } }, mine);
  assert.deepEqual(again.rules['commit-msg'], { lang: 'ko' });
  assert.deepEqual(again.rules['file-size'], { maxLines: 300 });
  assert.deepEqual(again.rules['protect-branch'], { branches: ['main', 'master', 'develop'] }, '방식이 정하는 칸은 새 방식의 값');
});

test('화면에 보일 값: 고친 값 > 방식이 정하는 칸은 그 방식 값 > 지난번 값 > 기본값', () => {
  const flows = all.packs.flows;
  const owned = ownedKeys(flows, 'protect-branch');
  assert.deepEqual([...owned].sort(), ['allowCommit', 'branches', 'noDirectPush']);
  const gh = flows.find((f) => f.id === 'github-flow');
  const gf = flows.find((f) => f.id === 'git-flow');
  const v = (o, flow, prev, user) => optionValue({ id: o === 'maxLines' ? 'file-size' : 'protect-branch', opt: o === 'maxLines' ? opt('file-size', 'maxLines') : opt('protect-branch', o), flow, owned: ownedKeys(flows, o === 'maxLines' ? 'file-size' : 'protect-branch'), prev, user });
  assert.equal(v('noDirectPush', gh), true);
  assert.equal(v('noDirectPush', gf), false, 'Git Flow 는 정하지 않으니 기본값');
  assert.equal(v('noDirectPush', gf, null, { 'protect-branch': { noDirectPush: true } }), true, '사용자가 고친 값은 방식을 바꿔도 남는다');
  assert.equal(v('noDirectPush', gh, { 'protect-branch': { noDirectPush: false } }), true, '방식이 정하는 칸은 지난번 값보다 방식 값');
  assert.equal(v('maxLines', gh, { 'file-size': { maxLines: 600 } }), 600, '방식이 정하지 않는 칸은 지난번 값');
  assert.equal(v('maxLines', gh, { 'file-size': { maxLines: 12345 } }), 400, '지난번 값이 꼴에 안 맞으면 기본값');
});
