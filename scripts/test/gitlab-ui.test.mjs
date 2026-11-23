// GitLab 요금제 상자(picker/gitlab.js)를 가짜 DOM 으로 그려 본다: 제목·끝나는 날 모르는 체험판·self-merge 훅 줄·「다시 확인」.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walk } from './fake-dom.mjs';
import { readStrings } from '../lib/picker-state.mjs';
import { loadAll } from '../lib/catalog.mjs';
import { gitlabPlans } from '../lib/gitlab-settings.mjs';

const { gitlabBox } = await import('../../picker/gitlab.js');
const { fmt } = await import('../../picker/dom.js');
const { planName, SELF_MERGE_HOOK } = await import('../../picker/gitlab-plan.js');

const all = loadAll();
const FLOWS = ['github-flow', 'git-flow'];
// 카탈로그에 self-merge 가 생겼을 때의 이름(가짜 카탈로그 — 이 시험은 이름을 데이터에서 가져오는지만 본다)
const HOOK_NAME = '가짜 병합 훅 이름';
const render = (gitlab, { hooks = [], sel = { flow: 'git-flow', combo: 'team' }, done } = {}) => {
  const strings = readStrings('ko');
  const t = (k, v) => fmt(strings[k] ?? k, v, 'ko');
  const calls = [];
  const act = new Proxy({}, { get: (_, name) => (...a) => calls.push(name) });
  const node = gitlabBox({ S: { hooks }, sel, ui: { github: { offered: false, reason: 'not-github', gitlab }, done }, t, act });
  return { node, text: node ? node.textContent : '', t, calls };
};
const group = (x) => ({ reviewFlows: FLOWS, groups: [{ host: 'gitlab.com', group: 'arasoft-group', repos: [], ...x }] });

test('끝나는 날을 모르는 체험판은 따로 쓴 제목(날짜 자리가 비지 않게)', () => {
  const { text, t } = render(group({ level: 'trial', plan: 'ultimate_trial' }));
  assert.ok(text.includes(t('glHead_trial_nodate', { group: 'arasoft-group', plan: 'Ultimate' })), text);
  assert.ok(!text.includes(' 에 끝나요'), '빈 날짜로 「 에 끝나요」를 쓰지 않는다');
  const dated = render(group({ level: 'trial', plan: 'ultimate_trial', trialEndsOn: '2026-12-19' })).text;
  assert.ok(dated.includes('2026-12-19 에 끝나요'), dated);
});

test('Claude 쪽 줄은 카탈로그에 self-merge 가 있을 때만, 이름은 카탈로그에서', () => {
  const g = { ...group({ level: 'free', plan: 'free' }), claudeHook: SELF_MERGE_HOOK };
  const withHook = render(g, { hooks: [{ id: SELF_MERGE_HOOK, name: HOOK_NAME }] });
  assert.ok(withHook.text.includes(HOOK_NAME), withHook.text);
  assert.equal(walk(withHook.node).filter((n) => n.tag === 'li').length, 3);
  const without = render(group({ level: 'free', plan: 'free' }));
  assert.equal(walk(without.node).filter((n) => n.tag === 'li').length, 2, '훅이 없으면 사람 쪽·CI 두 줄만');
  assert.ok(!without.text.includes('Claude 쪽'), without.text);
});

test('유료 그룹은 다른 제목, 대신 지킬 길 없음', () => {
  const { text, t } = render(group({ level: 'paid', plan: 'opensource' }));
  assert.ok(text.includes(t('glTitlePaid')) && !text.includes(t('glTitle')), text);
  assert.ok(text.includes('Open Source Program'));
  assert.ok(!text.includes(t('glInstead')));
});

test('다시 읽으면 바뀔 수 있는 까닭이면 「다시 확인」(GitHub 상자와 같은 동작), 끝 화면에서는 없음', () => {
  const r = render(group({ level: 'unknown', reason: 'not-logged-in' }));
  const b = walk(r.node).find((n) => n.attrs['data-key'] === 'glRetry');
  assert.ok(b, '단추');
  b.on.click[0]({});
  assert.deepEqual(r.calls, ['retryGithub']);
  assert.ok(!walk(render(group({ level: 'unknown', reason: 'no-plan' })).node).some((n) => n.attrs['data-key'] === 'glRetry'), 'Owner 아님은 다시 읽어도 같다');
  assert.ok(!walk(render(group({ level: 'unknown', reason: 'offline' }), { done: { ok: 1 } }).node).some((n) => n.attrs['data-key'] === 'glRetry'));
});

test('MR 방식도 팀 조합도 아니면 그리지 않는다', () => {
  assert.equal(render(group({ level: 'free' }), { sel: { flow: 'trunk', combo: 'solo' } }).node, null);
});

test('요금제 이름 다듬기', () => {
  assert.equal(planName('ultimate_trial'), 'Ultimate');
  assert.equal(planName('premium'), 'Premium');
  assert.equal(planName('opensource'), 'Open Source Program');
  assert.equal(planName('ultimate_trial_paid_customer'), 'Ultimate');
});

test('서버: 카탈로그에 self-merge 가 있을 때만 claudeHook 을 싣는다', async () => {
  const run = async (cmd) => (cmd === 'git' ? { code: 0, stdout: 'git@gitlab.com:g/p.git\n' } : { code: 0, stdout: '{"plan":"free"}' });
  const fakePacks = { ...all.packs, hooks: [...all.packs.hooks.filter((h) => h.id !== SELF_MERGE_HOOK), { id: SELF_MERGE_HOOK, name: { ko: HOOK_NAME, en: 'x' } }] };
  assert.equal((await gitlabPlans('/r', { host: 'gitlab' }, fakePacks, { run })).claudeHook, SELF_MERGE_HOOK);
  const without = { ...all.packs, hooks: all.packs.hooks.filter((h) => h.id !== SELF_MERGE_HOOK) };
  assert.equal((await gitlabPlans('/r', { host: 'gitlab' }, without, { run })).claudeHook, undefined);
});
