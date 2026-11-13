// 훅 옵션(packs.json hooks[].options) 시험: 화면이 보여 주는 옵션은 훅 코드가 실제로 읽고, 고른 값이 harness.json 에 그대로 들어간다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickerCfg } from './helpers.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { loadAll, PLUGIN_ROOT } from '../lib/catalog.mjs';
import { buildConfig } from '../lib/plan.mjs';
import { cleanSelection } from '../lib/picker-state.mjs';
import { validValue, cleanHookOpts, optionValue, ownedKeys, parseList } from '../../picker/hook-options.js';
import { DEFAULT_MAX_LINES } from '../../hooks/rules/files.mjs';
import { DEFAULT_MAX_SUBJECT } from '../../hooks/rules/message.mjs';
import { DEFAULT_BRANCH_PATTERN, DEFAULT_PROTECTED } from '../../hooks/rules/git.mjs';
import { DEFAULT_ANSWER_LANG, ANSWER_LANGS } from '../../hooks/lib/answer-lang.mjs';

const all = loadAll();
const cfg = pickerCfg;
const RULES = path.join(PLUGIN_ROOT, 'hooks', 'rules');
// 쓰기·커밋 검사가 같이 쓰는 판정(hooks/lib/messages.mjs)은 그것을 가져오는 규칙 모듈의 코드로 친다
const SHARED = fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'lib', 'messages.mjs'), 'utf8');
const ruleFiles = fs.readdirSync(RULES).filter((f) => f.endsWith('.mjs')).map((f) => fs.readFileSync(path.join(RULES, f), 'utf8'))
  .map((src) => (src.includes("from '../lib/messages.mjs'") ? `${src}\n${SHARED}` : src));
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
      if (o.type === 'list') assert.ok(['branch', 'path', 'command', 'word'].includes(o.item), `${where} 목록 칸 꼴`);
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
  // 목록은 항목마다 거른다(../etc/passwd 만 빠지고 config/prod.json 은 남는다), 경로의 \ 는 / 로, 한글 경로도 받는다
  assert.deepEqual(cleanHookOpts(all.packs.hooks, raw), { 'file-size': { maxLines: 600 }, 'commit-msg': { style: 'free' }, 'protect-branch': { branches: ['main', 'release/v1'] }, 'protected-files': { paths: ['config/prod.json'] } });
  // 글롭 * · ** 는 받고(2026-11-12), * 와 / 만으로 된 꼴(모든 파일)은 버린다
  assert.deepEqual(cleanHookOpts(all.packs.hooks, { 'protected-files': { paths: ['config\\관절한계.yaml', '*.hdf5', 'data/', 'infra/**/*.tfvars', '**', '*', '*/'] } }), { 'protected-files': { paths: ['config/관절한계.yaml', '*.hdf5', 'data/', 'infra/**/*.tfvars'] } });
  // 거의 모든 파일에 맞는 글롭(글자 하나뿐)은 버리고, 앞이 / 인 맨 위 기준 경로는 받는다(검토 2026-11-12)
  const kept = ['.hdf5', 'config/prod.json', 'data/raw/', 'kubeconfig*', '*.tfstate.*', '*.tfstate', '/kubeconfig*', '/secrets.yml', '/data/', '설정/값.yaml', 'x'];
  assert.deepEqual(cleanHookOpts(all.packs.hooks, { 'protected-files': { paths: [...kept, '*-*', '*_*', '**/*e*', '*.*', '//x', '/', '/*'] } }), { 'protected-files': { paths: kept } });
  const sel = cleanSelection({ all, cfg }, { flow: 'github-flow', hooks: ['file-size'], hookOpts: raw }, 'ko');
  assert.deepEqual(sel.hookOpts['file-size'], { maxLines: 600 });
  // 브랜치는 쉼표·줄바꿈으로만 나눈다 — 빈칸이 든 글은 통째로 빨간 값(2026-11-12)
  assert.deepEqual(parseList(opt('protect-branch', 'branches'), 'main, develop\nbad name;x'), { values: ['main', 'develop'], bad: ['bad name;x'] });
  // 명령·경로 목록은 쉼표·줄바꿈으로만 나눈다(띄어쓰기가 든 항목 — 검토 2026-11-11)
  assert.deepEqual(parseList(opt('ask-cmd', 'commands'), 'ros2 launch, ros2 topic pub\npython scripts/train.py').values, ['ros2 launch', 'ros2 topic pub', 'python scripts/train.py']);
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

test('받지 않는 까닭을 항목마다 구분한다(화면 역할 평가 2026-11-12: 다 「셸 기호」로 안내했다)', async () => {
  const { badWhy } = await import('../../picker/hook-options.js');
  const opt = { type: 'list', item: 'path' };
  assert.equal(badWhy(opt, '*.tfstate.*'), null);
  assert.equal(badWhy(opt, '*-*'), 'broad');
  assert.equal(badWhy(opt, '*'), 'broad');
  assert.equal(badWhy(opt, 'a'.repeat(201)), 'long');
  assert.equal(badWhy(opt, '../x'), 'path');
  assert.equal(badWhy(opt, 'x;rm'), 'path');
  for (const l of ['ko', 'en']) {
    const s = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'picker', 'i18n', l, 'main.json'), 'utf8'));
    for (const k of ['broad', 'long', 'full', 'path', 'command', 'branch', 'word']) assert.ok(s[`optBadWhy_${k}`], `${l} optBadWhy_${k}`);
  }
});

test('목록 칸 나누기: 경로·명령의 역슬래시는 / 로, 브랜치는 빈칸에서 나누지 않는다(화면 역할 평가 2026-11-12)', async () => {
  const { parseList } = await import('../../picker/hook-options.js');
  const bs = String.fromCharCode(92);
  assert.deepEqual(parseList({ item: 'path' }, `config${bs}prod.json`), { values: ['config/prod.json'], bad: [] });
  assert.deepEqual(parseList({ item: 'branch' }, 'main, release/2026 11'), { values: ['main'], bad: ['release/2026 11'] });
  assert.deepEqual(parseList({ item: 'word' }, 'bench deps'), { values: ['bench', 'deps'], bad: [] });
});

test('목록 칸 나누기는 한도로 자르지 않는다 — 넘는 값은 화면이 빨간 칩으로 보인다(다시 검토 2026-11-12)', async () => {
  const { parseList, LIST_MAX } = await import('../../picker/hook-options.js');
  const text = Array.from({ length: LIST_MAX + 5 }, (_, i) => `c${i}`).join('\n');
  assert.equal(parseList({ item: 'command' }, text).values.length, LIST_MAX + 5);
});

test('「+ 넣기」 제안: 가득 찬 칸에는 내지 않고, 든 값(끝 / 만 다른 것)·빨간 칩 값은 빼고, 값 하나를 쉼표로 나누지 않고 넣는다(독립 검토 2026-11-13)', async () => {
  const { offerChoices, placeOne, LIST_MAX } = await import('../../picker/hook-options.js');
  const opt = { type: 'list', item: 'path' };
  assert.deepEqual(offerChoices(['bench-results', 'paper/', 'figs/', 'figs/'], ['bench-results/'], ['paper']), ['figs/']);
  assert.deepEqual(offerChoices(['figs/'], []), ['figs/'], '빈 칸이면 그대로');
  const full = Array.from({ length: LIST_MAX }, (_, i) => `d${i}/`);
  assert.deepEqual(offerChoices(['figs/'], full), [], '가득 차면 단추를 감춘다');
  assert.deepEqual(placeOne(opt, 'figs/', ['a/'], ['figs/']), { values: ['a/', 'figs/'], bad: [] }, '넣으면 빨간 목록에서도 뺀다');
  assert.deepEqual(placeOne(opt, 'my,dir', ['a/'], []), { values: ['a/'], bad: ['my,dir'] }, '쉼표가 든 값은 둘로 갈리지 않고 하나로(꼴은 badWhy 로)');
  assert.deepEqual(placeOne(opt, 'bench-results', ['bench-results/'], []), { values: ['bench-results/'], bad: [] }, '끝 / 만 다르면 이미 든 값');
  assert.deepEqual(placeOne(opt, 'x/', full, []).values, full, '가득 찬 칸에는 넣지 않는다');
});
