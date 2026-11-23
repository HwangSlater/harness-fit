// GitLab 요금제 알림(lib/gitlab-settings.mjs · picker/gitlab-plan.js)과 플러그인 설치 범위 알림(installed.mjs pluginScope · plan.mjs plugin-folder-only).
// glab·git 은 가짜 실행기 또는 HARNESS_FIT_GLAB 가짜 glab 으로(네트워크 없음). 설정 폴더는 임시 홈.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, writeFiles, gitInit } from './helpers.mjs';
import { parseGitlabRemote, readNamespacePlan, gitlabPlans, classifyPlan, gitlabRelevant, envFor } from '../lib/gitlab-settings.mjs';
import { reviewFlowIds } from '../../picker/gitlab-plan.js';
import { defaultRunner } from '../lib/github-settings.mjs';
import { pluginScope } from '../lib/installed.mjs';
import { plan, userScopeCommand } from '../lib/plan.mjs';
import { loadAll } from '../lib/catalog.mjs';

const all = loadAll();

test('origin 주소의 여러 꼴에서 호스트와 맨 위 그룹을 읽는다', () => {
  const cases = [
    ['git@gitlab.com:arasoft-group/sub/app.git', { host: 'gitlab.com', path: 'arasoft-group/sub/app', group: 'arasoft-group' }],
    ['https://gitlab.com/arasoft-group/app.git', { host: 'gitlab.com', path: 'arasoft-group/app', group: 'arasoft-group' }],
    ['https://gitlab.com/arasoft-group/app/', { host: 'gitlab.com', path: 'arasoft-group/app', group: 'arasoft-group' }],
    ['https://oauth2:secret@git.corp.io:8443/team/proj', { host: 'git.corp.io:8443', path: 'team/proj', group: 'team' }],
    ['ssh://git@GitLab.Corp.io:2222/team/svc/api.git', { host: 'gitlab.corp.io', path: 'team/svc/api', group: 'team' }],
    ['gitlab.corp.io:team/proj.git', { host: 'gitlab.corp.io', path: 'team/proj', group: 'team' }],
    ['https://gitlab.com:443/g/p.git', { host: 'gitlab.com', path: 'g/p', group: 'g' }],
    ['git@gitlab.com-work:g/p.git', { host: 'gitlab.com-work', path: 'g/p', group: 'g', alias: true }],
    ['git@gitlab-work:g/p.git', { host: 'gitlab-work', path: 'g/p', group: 'g', alias: true }],
    ['git@10.0.0.5:g/p.git', { host: '10.0.0.5', path: 'g/p', group: 'g' }],
  ];
  for (const [url, want] of cases) assert.deepEqual(parseGitlabRemote(url), want, url);
  for (const bad of ['', 'not a url', 'https://gitlab.com/only', 'git@gitlab.com:../x.git', 'https://gitlab.com/a b/c', 'C:/work/repo', 'https://-evil.com/g/p', 'git@.x:g/p']) assert.equal(parseGitlabRemote(bad), null, bad);
});

test('요금제 → 등급: free · 체험판(끝나는 날) · 유료 · 모름', () => {
  assert.deepEqual(classifyPlan({ plan: 'free' }), { level: 'free', plan: 'free' });
  assert.deepEqual(classifyPlan({ plan: 'ultimate_trial', trial: true, trial_ends_on: '2026-12-19' }), { level: 'trial', plan: 'ultimate_trial', trialEndsOn: '2026-12-19' });
  assert.deepEqual(classifyPlan({ plan: 'ultimate', trial: true }), { level: 'trial', plan: 'ultimate' });
  assert.equal(classifyPlan({ plan: 'premium' }).level, 'paid');
  assert.equal(classifyPlan({ plan: 'ultimate_trial_paid_customer', trial: true }).level, 'paid', '유료 고객의 상위 체험은 끝나도 유료');
  assert.equal(classifyPlan({ plan: 'opensource' }).level, 'paid');
  assert.deepEqual(classifyPlan({ name: 'g' }), { level: 'unknown', reason: 'no-plan' }, 'plan 칸이 없으면(Owner 아님·자체 설치) 모름');
  assert.equal(classifyPlan({ plan: 'free', trial_ends_on: '<b>' }).trialEndsOn, undefined, '꼴이 아닌 날짜는 버린다');
  assert.equal(classifyPlan({ plan: '<script>' }).level, 'unknown', '꼴이 아닌 이름은 버린다');
});

// 가짜 실행기: git 은 origin 을, glab 은 답을 돌려준다. 부른 것을 남긴다
const fake = ({ remotes = {}, glab = () => ({ code: 0, stdout: JSON.stringify({ plan: 'free' }), stderr: '' }) } = {}) => {
  const calls = [];
  const run = async (cmd, args, opts = {}) => {
    calls.push({ cmd, args, opts });
    if (cmd === 'git') {
      const url = remotes[args[1]];
      return url ? { code: 0, stdout: `${url}\n`, stderr: '' } : { code: 2, stdout: '', stderr: 'error: No such remote' };
    }
    return glab(args, opts);
  };
  return { run, calls };
};

test('glab api namespaces/<그룹> 을 호스트와 함께 짧은 시간 한도로 부르고, 못 읽은 까닭을 나눈다', async () => {
  const { run, calls } = fake();
  assert.deepEqual(await readNamespacePlan(run, 'gitlab.com', 'arasoft-group', 1234), { level: 'free', plan: 'free' });
  assert.deepEqual(calls[0].args, ['api', '--hostname', 'gitlab.com', 'namespaces/arasoft-group']);
  assert.equal(calls[0].opts.timeout, 1234);
  const reason = async (r) => (await readNamespacePlan(async () => r, 'gitlab.com', 'g')).reason;
  assert.equal(await reason({ code: null, error: Object.assign(new Error('spawn glab ENOENT'), { code: 'ENOENT' }) }), 'no-glab');
  assert.equal(await reason({ code: 1, stdout: '', stderr: 'glab: 401 Unauthorized' }), 'not-logged-in');
  assert.equal(await reason({ code: 1, stdout: '', stderr: '', timedOut: true }), 'offline');
  assert.equal(await reason({ code: 1, stdout: '', stderr: 'dial tcp: lookup gitlab.com: no such host' }), 'offline');
  assert.equal(await reason({ code: 1, stdout: '', stderr: 'glab: 404 Not Found' }), 'not-found');
  assert.equal(await reason({ code: 0, stdout: 'not json', stderr: '' }), 'error');
});

test('토큰 환경 변수는 gitlab.com·GITLAB_HOST·GL_HOST 호스트에만 넘긴다(이름은 대소문자 없이, CI_JOB_TOKEN 도)', async () => {
  const env = { Gitlab_Token: 'a', ci_job_token: 'b', OAUTH_TOKEN: 'c', PATH: 'p' };
  assert.deepEqual(Object.keys(envFor('gitlab.com', env)), ['GLAB_CHECK_UPDATE'], 'gitlab.com 은 그대로');
  const evil = envFor('evil.example', env);
  for (const k of ['Gitlab_Token', 'ci_job_token', 'OAUTH_TOKEN']) assert.ok(k in evil && evil[k] === undefined, k);
  assert.ok(!('PATH' in evil));
  assert.deepEqual(Object.keys(envFor('git.corp.io', { ...env, GITLAB_HOST: 'https://git.corp.io/' })), ['GLAB_CHECK_UPDATE'], 'GITLAB_HOST 로 정한 호스트');
  assert.deepEqual(Object.keys(envFor('git.corp.io', { ...env, gl_host: 'git.corp.io' })), ['GLAB_CHECK_UPDATE'], 'GL_HOST(대소문자 없이)');
  assert.ok('OAUTH_TOKEN' in envFor('evil.example', { ...env, GITLAB_HOST: 'git.corp.io' }));
  const { run, calls } = fake();
  await readNamespacePlan(run, 'evil.example', 'g');
  assert.equal(calls[0].opts.env.GLAB_CHECK_UPDATE, 'false', '실행기에 넘긴다');
});

test('한 저장소: GitLab 이 아니면 부르지 않고, GitLab 이면 그룹 하나를 읽는다', async () => {
  const flows = all.packs.flows;
  const gh = fake();
  assert.equal(await gitlabPlans('/r', { host: 'github' }, all.packs, { run: gh.run }), null);
  assert.equal(gh.calls.length, 0, 'GitHub 저장소에서는 git·glab 을 부르지 않는다');
  const gl = fake({ remotes: { '/r': 'git@gitlab.com:arasoft-group/app.git' }, glab: () => ({ code: 0, stdout: JSON.stringify({ plan: 'ultimate_trial', trial: true, trial_ends_on: '2026-12-19' }), stderr: '' }) });
  const out = await gitlabPlans('/r', { host: 'gitlab' }, all.packs, { run: gl.run });
  assert.deepEqual(out.groups, [{ host: 'gitlab.com', group: 'arasoft-group', repos: [], level: 'trial', plan: 'ultimate_trial', trialEndsOn: '2026-12-19' }]);
  assert.deepEqual(out.reviewFlows, reviewFlowIds(flows));
  const none = await gitlabPlans('/r', { host: 'gitlab' }, all.packs, { run: fake().run });
  assert.deepEqual(none.groups, [{ repos: [], level: 'unknown', reason: 'no-remote' }], 'origin 이 없으면(.gitlab-ci.yml 로만 안 때) 그룹 없이');
  const alias = fake({ remotes: { '/r': 'git@gitlab.com-work:arasoft-group/app.git' } });
  const a = await gitlabPlans('/r', { host: 'gitlab' }, all.packs, { run: alias.run });
  assert.deepEqual(a.groups, [{ host: 'gitlab.com-work', group: 'arasoft-group', repos: [], level: 'unknown', reason: 'ssh-alias' }]);
  assert.ok(!alias.calls.some((c) => c.cmd === 'glab'), 'ssh 별칭이면 glab 을 부르지 않는다');
});

test('작업 폴더: GitLab 저장소만, 같은 그룹은 한 번만 읽는다', async () => {
  const root = path.resolve('/ws');
  const det = { workspace: [{ name: 'api', host: 'gitlab' }, { name: 'web', host: 'gitlab' }, { name: 'docs', host: 'github' }] };
  const { run, calls } = fake({ remotes: { [path.join(root, 'api')]: 'git@gitlab.com:arasoft-group/api.git', [path.join(root, 'web')]: 'https://gitlab.com/arasoft-group/web.git' } });
  const out = await gitlabPlans(root, det, all.packs, { run });
  assert.equal(calls.filter((c) => c.cmd === 'glab').length, 1);
  assert.deepEqual(out.groups.map((g) => [g.group, g.repos, g.level]), [['arasoft-group', ['api', 'web'], 'free']]);
  assert.ok(!calls.some((c) => c.cmd === 'git' && c.args[1].endsWith('docs')), 'GitHub 저장소는 읽지 않는다');
});

test('알림은 MR 방식(github-flow·git-flow — 데이터에서) 또는 팀 조합일 때만', () => {
  const ids = reviewFlowIds(all.packs.flows);
  assert.ok(ids.includes('github-flow') && ids.includes('git-flow') && !ids.includes('trunk') && !ids.includes('none'), ids.join(','));
  const g = { reviewFlows: ids, groups: [{ level: 'free' }] };
  assert.ok(gitlabRelevant(g, { flow: 'git-flow', combo: 'solo' }));
  assert.ok(gitlabRelevant(g, { flow: 'none', combo: 'team' }));
  assert.ok(!gitlabRelevant(g, { flow: 'trunk', combo: 'solo' }));
  assert.ok(!gitlabRelevant(null, { flow: 'git-flow', combo: 'team' }));
  assert.ok(!gitlabRelevant({ reviewFlows: ids, groups: [] }, { flow: 'git-flow' }));
});

test('기본 실행기는 HARNESS_FIT_GLAB 가짜 glab 을 node 로 돌린다(받은 인자 그대로)', async () => {
  const dir = tmpDir('harness-glab-');
  const stub = path.join(dir, 'glab.mjs');
  fs.writeFileSync(stub, "process.stdout.write(JSON.stringify({ plan: 'premium', got: process.argv.slice(2) }));\n");
  const saved = process.env.HARNESS_FIT_GLAB;
  process.env.HARNESS_FIT_GLAB = stub;
  try {
    const r = await defaultRunner('glab', ['api', '--hostname', 'gitlab.com', 'namespaces/g'], { timeout: 10000, env: { GITLAB_TOKEN: undefined } });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).got, ['api', '--hostname', 'gitlab.com', 'namespaces/g']);
    assert.equal((await readNamespacePlan(defaultRunner, 'gitlab.com', 'g', 10000)).level, 'paid');
  } finally {
    if (saved === undefined) delete process.env.HARNESS_FIT_GLAB;
    else process.env.HARNESS_FIT_GLAB = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// 임시 설정 폴더(claudeHome(home) = home/.claude)
const homeWith = (installs, settings) => {
  const home = tmpDir('harness-scope-');
  if (installs) writeFiles(home, { '.claude/plugins/installed_plugins.json': { version: 2, plugins: { 'harness-fit@harness-fit': installs } } });
  if (settings) writeFiles(home, { '.claude/settings.json': settings });
  return home;
};

test('설치 범위: 프로젝트·local 로만 깔렸으면 folder, 사용자 범위·사용자 설정에서 켰으면 user, 기록이 없으면 모름', () => {
  const homes = [];
  const at = (...a) => (homes.push(homeWith(...a)), pluginScope(homes.at(-1)));
  try {
    assert.equal(at(null), null, 'installed_plugins.json 이 없으면 아무 말도 않는다(체험판 사이트의 빈 임시 홈)');
    assert.equal(at([]), null, 'harness-fit 항목이 없으면(--plugin-dir) 모름');
    assert.deepEqual(at([{ scope: 'project', projectPath: 'C:/work/arasoft' }, { scope: 'local', projectPath: 'C:/x' }]), { scope: 'folder', folders: ['C:/work/arasoft', 'C:/x'] });
    assert.deepEqual(at([{ scope: 'project', projectPath: 'C:/a' }, { scope: 'user' }]), { scope: 'user' });
    assert.deepEqual(at([{ scope: 'project', projectPath: 'C:/a' }], { enabledPlugins: { 'harness-fit@harness-fit': true } }), { scope: 'user' });
  } finally {
    for (const h of homes) fs.rmSync(h, { recursive: true, force: true });
  }
});

test('적용 계획: 플러그인이 켜져 있고 폴더 범위면 plugin-folder-only 와 사용자 범위 설치 명령을 한 번 알린다', () => {
  const dir = gitInit(tmpDir('harness-scope-repo-'), { branch: 'main' });
  const sel = { lang: 'ko', combo: 'solo', skills: [], hooks: ['secrets'], rules: [], flow: 'none', explore: [], note: '', share: false };
  try {
    const p = plan(dir, sel, all, { active: true, scope: { scope: 'folder', folders: [dir] } });
    assert.equal(p.warnings.filter((w) => w === 'plugin-folder-only').length, 1);
    assert.equal(p.userScopeCmd, 'claude plugin install harness-fit@harness-fit --scope user');
    assert.equal(p.userScopeCmd, userScopeCommand(all.sources));
    assert.deepEqual(p.pluginFolders, [dir]);
    assert.ok(!plan(dir, sel, all, { active: true, scope: { scope: 'user' } }).warnings.includes('plugin-folder-only'));
    assert.ok(!plan(dir, sel, all, { active: true, scope: null }).warnings.includes('plugin-folder-only'), '알 수 없으면 말하지 않는다');
    const off = plan(dir, sel, all, { active: false, scope: { scope: 'folder', folders: [] } });
    assert.ok(off.warnings.includes('plugin-missing') && !off.warnings.includes('plugin-folder-only') && !off.userScopeCmd, '플러그인이 없으면 plugin-missing 만');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
