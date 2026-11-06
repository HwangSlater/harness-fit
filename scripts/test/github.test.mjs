// GitHub 저장소 설정 시험. gh·git 은 가짜 실행기로 바꿔 넣는다(네트워크 없음, 실제 저장소를 건드리지 않음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { apply } from '../apply.mjs';
import { loadAll } from '../lib/catalog.mjs';
import { latestBackup } from '../lib/backup.mjs';
import { parseRemote, detectGithub, itemsFor, offerAll, undoWithGithub, toPutBody } from '../lib/github-settings.mjs';
import { defaultChoice, changesFor, cleanChoice, parseItemList } from '../../picker/github-plan.js';

const APPLY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'apply.mjs');
const all = loadAll();
const spec = (id) => all.packs.flows.find((f) => f.id === id).github;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'harness-gh-'));
const NEW_REPO = { allow_squash_merge: true, allow_merge_commit: true, allow_rebase_merge: true, delete_branch_on_merge: false };
const WRITES = new Set(['PATCH', 'PUT', 'DELETE', 'POST']);

// PUT 이 받은 꼴 → GET 이 돌려주는 꼴(GitHub 과 같게: 켜지 않은 리뷰 칸은 없다)
const fromPut = (b) => ({
  ...(b.required_pull_request_reviews ? { required_pull_request_reviews: { ...b.required_pull_request_reviews } } : {}),
  ...(b.required_status_checks ? { required_status_checks: { ...b.required_status_checks } } : {}),
  enforce_admins: { enabled: !!b.enforce_admins },
  allow_force_pushes: { enabled: !!b.allow_force_pushes },
  allow_deletions: { enabled: !!b.allow_deletions },
  required_linear_history: { enabled: !!b.required_linear_history },
});

// 가짜 GitHub. branches 값: null(보호 없음) · 보호 객체 · 'missing' · 'plan'
const fakeGh = ({ remote = 'git@github.com:me/app.git', gh = true, authed = true, offline = false, admin = true, repo = NEW_REPO, defaultBranch = 'main', isPrivate = false, branches = { main: null }, failPut = [], failPatch = false } = {}) => {
  const state = { remote, repo: { ...repo }, branches: structuredClone(branches) };
  const calls = [];
  const ok = (data) => ({ code: 0, stdout: data === undefined ? '' : JSON.stringify(data), stderr: '' });
  const err = (status, message) => ({ code: 1, stdout: JSON.stringify({ message }), stderr: `gh: ${message} (HTTP ${status})` });
  const run = async (cmd, args, { input } = {}) => {
    calls.push({ cmd, args, input });
    if (cmd === 'git') return state.remote ? { code: 0, stdout: `${state.remote}\n`, stderr: '' } : { code: 2, stdout: '', stderr: 'error: No such remote' };
    if (!gh) return { code: null, stdout: '', stderr: '', error: Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }) };
    if (args[0] === 'auth') return offline ? { code: 1, stdout: '', stderr: 'X Timeout trying to log in to github.com account me' } : authed ? ok() : { code: 1, stdout: '', stderr: 'You are not logged into any GitHub hosts. To log in, run: gh auth login' };
    if (offline) return { code: 1, stdout: '', stderr: 'error connecting to api.github.com' };
    const [, , method, ep] = args;
    const body = input ? JSON.parse(input) : undefined;
    if (ep === 'repos/me/app') {
      if (method === 'GET') return ok({ ...state.repo, default_branch: defaultBranch, private: isPrivate, permissions: { admin } });
      if (failPatch) return err(422, 'Validation Failed');
      Object.assign(state.repo, body);
      return ok({ ...state.repo });
    }
    if (ep.startsWith('repos/')) {
      const m = ep.match(/^repos\/me\/app\/branches\/([^/]+)\/protection$/);
      if (!m) return err(404, 'Not Found');
      const b = decodeURIComponent(m[1]);
      const cur = b in state.branches ? state.branches[b] : 'missing';
      if (cur === 'missing') return err(404, 'Branch not found');
      if (cur === 'plan') return err(403, 'Upgrade to GitHub Pro or make this repository public to enable this feature.');
      if (method === 'GET') return cur ? ok(cur) : err(404, 'Branch not protected');
      if (method === 'PUT') {
        if (failPut.includes(b)) return err(422, 'Validation Failed');
        state.branches[b] = fromPut(body);
        return ok(state.branches[b]);
      }
      if (method === 'DELETE') return (state.branches[b] = null), ok();
    }
    return err(404, 'Not Found');
  };
  const writes = () => calls.filter((c) => c.cmd === 'gh' && WRITES.has(c.args[2]));
  return { run, state, calls, writes };
};

// 추천 값을 그대로 고른 선택(GitHub Flow, 브랜치 main)
const FLOW_DEFAULTS = { squash: true, autodelete: true, 'pr:main': true, 'approvals:main': 0, 'noforce:main': true, 'nodelete:main': true, 'admins:main': true };
const sel = (flow, github = true, githubChoice = FLOW_DEFAULTS) => ({ lang: 'ko', combo: 'team', skills: [], hooks: ['secrets'], rules: [], flow, explore: [], note: '', share: false, github, githubChoice });
const itemsOf = async (flow, o) => itemsFor(spec(flow), await detectGithub('.', [spec(flow)], { run: fakeGh(o).run }));

test('origin 주소: github.com 의 https·ssh 꼴만 저장소로 본다', () => {
  assert.equal(parseRemote('https://github.com/me/app.git'), 'me/app');
  assert.equal(parseRemote('https://token@github.com/me/app'), 'me/app');
  assert.equal(parseRemote('git@github.com:me/my.app.git'), 'me/my.app');
  assert.equal(parseRemote('ssh://git@github.com/me/app.git'), 'me/app');
  assert.equal(parseRemote('https://gitlab.com/me/app.git'), null);
  assert.equal(parseRemote('https://github.example.com/me/app.git'), null);
  assert.equal(parseRemote(''), null);
});

test('켤 수 없는 까닭: GitHub 아님 · gh 없음 · 로그인 안 함 · 오프라인 · 저장소 못 찾음 · 관리자 아님', async () => {
  const reason = async (o) => (await detectGithub('.', [spec('github-flow')], { run: fakeGh(o).run })).reason;
  assert.equal(await reason({ remote: null }), 'not-github');
  assert.equal(await reason({ remote: 'https://gitlab.com/me/app.git' }), 'not-github');
  assert.equal(await reason({ gh: false }), 'no-gh');
  assert.equal(await reason({ authed: false }), 'not-logged-in');
  assert.equal(await reason({ offline: true }), 'offline');
  assert.equal(await reason({ admin: false }), 'no-admin');
  const notFound = fakeGh();
  notFound.state.remote = 'git@github.com:me/other.git';
  assert.equal((await detectGithub('.', [spec('github-flow')], { run: notFound.run })).reason, 'not-found');
  assert.equal(all.packs.flows.find((f) => f.id === 'none').github, undefined, '정하지 않음에는 GitHub 항목이 없다');
});

test('항목과 추천 값은 packs.json 에서: GitHub Flow 는 다 켜고, Git Flow 는 PR 요구만 끄고, 트렁크는 PR 항목이 없다', async () => {
  const gh = await itemsOf('github-flow');
  assert.deepEqual(gh.map((i) => i.id), ['squash', 'autodelete', 'pr:main', 'approvals:main', 'noforce:main', 'nodelete:main', 'admins:main']);
  assert.deepEqual(defaultChoice(gh), FLOW_DEFAULTS);
  assert.deepEqual(gh.find((i) => i.id === 'approvals:main').choices, [0, 1, 2]);

  const gf = await itemsOf('git-flow', { defaultBranch: 'master', branches: { master: null } });
  assert.equal(gf.find((i) => i.id === 'pr:master').default, false, 'Git Flow 는 release·hotfix 를 로컬에서 합쳐 push 하므로 PR 요구는 기본 꺼짐');
  assert.equal(gf.find((i) => i.id === 'noforce:master').default, true);
  assert.deepEqual(gf.find((i) => i.branch === 'develop'), { id: 'branch:develop', branch: 'develop', blocked: 'missing' });
  assert.ok(!gf.some((i) => i.id === 'squash'), 'Git Flow 는 합치기 방식을 건드리지 않는다');
  assert.ok(all.packs.flows.find((f) => f.id === 'git-flow').github.notes.pullRequest.ko, 'Git Flow 의 PR 기본값 이유를 화면에 보여 줄 글이 있다');

  const tr = await itemsOf('trunk');
  assert.deepEqual(tr.map((i) => i.id), ['noforce:main', 'nodelete:main', 'admins:main']);

  // 이미 켜진 것은 already(고를 것 없음), 이미 PR 을 요구하면 승인 수 추천은 지금 수(바꾸지 않음)
  const done = await itemsOf('github-flow', { repo: { allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false, delete_branch_on_merge: true }, branches: { main: fromPut({ required_pull_request_reviews: { required_approving_review_count: 3 }, enforce_admins: true }) } });
  assert.ok(done.filter((i) => i.type === 'toggle').every((i) => i.already));
  const appr = done.find((i) => i.id === 'approvals:main');
  assert.equal(appr.default, 3);
  assert.deepEqual(appr.choices, [0, 1, 2, 3]);
  assert.deepEqual(changesFor(done, defaultChoice(done)), [], '추천대로면 아무것도 안 바뀐다');

  // 무료 계정 비공개 저장소: 브랜치는 요금제 제한으로 막히고, 합치기 방식은 고를 수 있다
  const priv = await itemsOf('github-flow', { isPrivate: true, branches: { main: 'plan' } });
  assert.deepEqual(priv.filter((i) => i.branch), [{ id: 'branch:main', branch: 'main', blocked: 'plan' }]);
});

test('고른 항목만 바뀐다: 끈 항목은 그대로, 승인 수는 PR 을 요구할 때만', async () => {
  const items = await itemsOf('github-flow');
  const only = (choice) => changesFor(items, cleanChoice(items, choice)).map((c) => `${c.key}:${c.from}->${c.to}`);
  assert.deepEqual(only({ autodelete: true }), ['delete_branch_on_merge:false->true']);
  assert.deepEqual(only({ squash: true }), ['allow_merge_commit:true->false', 'allow_rebase_merge:true->false']);
  assert.deepEqual(only({ 'approvals:main': 2 }), [], 'PR 요구를 켜지 않으면 승인 수는 뜻이 없다');
  assert.deepEqual(only({ 'pr:main': true, 'approvals:main': 2 }), ['pullRequest:false->true', 'approvals:0->2']);
  assert.deepEqual(only({ 'pr:main': true, 'approvals:main': 9 }), ['pullRequest:false->true'], '고를 수 없는 수는 추천 값(0)');
  assert.deepEqual(only({ 'admins:main': 'yes', bogus: true }), [], '참거짓이 아닌 값·모르는 항목은 버린다');
  assert.deepEqual(parseItemList('squash, pr:main,approvals:main=1'), { squash: true, 'pr:main': true, 'approvals:main': 1 });
});

test('적용: 파일을 쓴 뒤 고른 GitHub 항목만 바꾸고, 이전 값을 백업 목록에 남긴다. 되돌리면 이전 값으로', async () => {
  const dir = tmp();
  const g = fakeGh();
  const r = await apply(dir, sel('github-flow'), () => {}, { gh: g.run });
  assert.equal(r.github.ok, true);
  assert.equal(r.github.results.length, 7);
  assert.deepEqual(g.state.repo, { allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false, delete_branch_on_merge: true });
  assert.equal(g.state.branches.main.required_pull_request_reviews.required_approving_review_count, 0);
  assert.equal(g.state.branches.main.enforce_admins.enabled, true);
  assert.equal(g.state.branches.main.allow_force_pushes.enabled, false);
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'harness.json')), '파일은 먼저 쓴다');
  const rec = latestBackup(dir).manifest.github;
  assert.deepEqual(rec.repoPrev, { allow_merge_commit: true, allow_rebase_merge: true, delete_branch_on_merge: false });
  assert.deepEqual(rec.branches.main, { prev: null, set: ['pullRequest', 'noForcePush', 'noDelete', 'enforceAdmins'] });

  const u = await undoWithGithub(dir, { run: g.run });
  assert.deepEqual(g.state.repo, NEW_REPO);
  assert.equal(g.state.branches.main, null, '보호가 없던 브랜치는 보호를 지운다');
  assert.equal(u.github.restored.length, 7);
  assert.deepEqual(u.github.failed, []);
  assert.ok(!fs.existsSync(path.join(dir, '.claude', 'harness.json')), '파일도 되돌린다');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('항목별 선택 끝까지: 자동 삭제·강제 push 막기·승인 1개만 고르면 그것만 바뀌고, 되돌리면 그것만 돌아간다', async () => {
  const dir = tmp();
  const g = fakeGh();
  const choice = { squash: false, autodelete: true, 'pr:main': true, 'approvals:main': 1, 'noforce:main': true, 'nodelete:main': false, 'admins:main': false };
  const r = await apply(dir, sel('github-flow', true, choice), () => {}, { gh: g.run });
  assert.deepEqual(r.github.results.map((x) => x.key), ['delete_branch_on_merge', 'pullRequest', 'approvals', 'noForcePush']);
  assert.equal(g.state.repo.allow_merge_commit, true, 'squash 로만 합치기를 끄면 합치기 방식은 그대로');
  assert.equal(g.state.branches.main.required_pull_request_reviews.required_approving_review_count, 1);
  assert.equal(g.state.branches.main.enforce_admins.enabled, false, '관리자에게도 적용을 끄면 그대로');
  assert.equal(g.state.branches.main.allow_deletions.enabled, true, '브랜치 삭제 막기를 끄면 그대로');
  assert.equal(latestBackup(dir).manifest.github.branches.main.approvals, 1);
  await undoWithGithub(dir, { run: g.run });
  assert.deepEqual(g.state.repo, NEW_REPO);
  assert.equal(g.state.branches.main, null);
  // 아무것도 고르지 않았으면(선택 없음) GitHub 에 쓰지 않는다
  const dir2 = tmp();
  const g2 = fakeGh();
  const r2 = await apply(dir2, sel('github-flow', true, null), () => {}, { gh: g2.run });
  assert.equal(r2.github.reason, 'no-items');
  assert.equal(g2.writes().length, 0);
  for (const d of [dir, dir2]) fs.rmSync(d, { recursive: true, force: true });
});

test('이미 있던 보호는 고른 칸만 바꾸고, 되돌릴 때도 그 칸만(상태 검사 등은 그대로)', async () => {
  const dir = tmp();
  const before = fromPut({ required_status_checks: { strict: true, contexts: ['ci'] }, enforce_admins: false, required_linear_history: true });
  const g = fakeGh({ branches: { main: before } });
  const r = await apply(dir, sel('github-flow'), () => {}, { gh: g.run });
  assert.deepEqual(r.github.results.filter((x) => x.scope === 'branch').map((x) => x.key), ['pullRequest', 'enforceAdmins'], '이미 막혀 있던 강제 push·삭제는 고를 것이 없다');
  assert.equal(g.state.branches.main.required_status_checks.contexts[0], 'ci');
  await undoWithGithub(dir, { run: g.run });
  assert.deepEqual(g.state.branches.main, before);
  // 이미 PR 을 요구하던 브랜치의 승인 수만 바꾸고 되돌리기
  const dir2 = tmp();
  const g2 = fakeGh({ branches: { main: fromPut({ required_pull_request_reviews: { required_approving_review_count: 2 }, enforce_admins: true }) } });
  await apply(dir2, sel('github-flow', true, { 'approvals:main': 0 }), () => {}, { gh: g2.run });
  assert.equal(g2.state.branches.main.required_pull_request_reviews.required_approving_review_count, 0);
  await undoWithGithub(dir2, { run: g2.run });
  assert.equal(g2.state.branches.main.required_pull_request_reviews.required_approving_review_count, 2);
  for (const d of [dir, dir2]) fs.rmSync(d, { recursive: true, force: true });
});

test('일부만 됐으면 「다 됐다」고 하지 않고, 된 것만 되돌리기 기록에 남긴다', async () => {
  const dir = tmp();
  const g = fakeGh({ failPut: ['main'] });
  const r = await apply(dir, sel('github-flow'), () => {}, { gh: g.run });
  assert.equal(r.github.ok, false);
  assert.ok(r.github.results.filter((x) => x.scope === 'repo').every((x) => x.ok));
  assert.ok(r.github.results.filter((x) => x.scope === 'branch').every((x) => !x.ok && x.error === 'Validation Failed'));
  assert.deepEqual(latestBackup(dir).manifest.github.branches, {});
  // 요금제 제한 브랜치를 고르면 실패로 센다
  const dir2 = tmp();
  const r2 = await apply(dir2, sel('github-flow'), () => {}, { gh: fakeGh({ isPrivate: true, branches: { main: 'plan' } }).run });
  assert.equal(r2.github.ok, false);
  assert.deepEqual(r2.github.results.find((x) => !x.ok), { scope: 'branch', branch: 'main', blocked: 'plan', ok: false, error: 'plan' });
  // 합치기 방식 바꾸기가 거절되면 그 칸들도 실패
  const dir3 = tmp();
  const r3 = await apply(dir3, sel('github-flow'), () => {}, { gh: fakeGh({ failPatch: true }).run });
  assert.ok(r3.github.results.filter((x) => x.scope === 'repo').every((x) => !x.ok));
  for (const d of [dir, dir2, dir3]) fs.rmSync(d, { recursive: true, force: true });
});

test('되돌리기: 그 뒤 누가 바꾼 칸은 두고, 다른 저장소면 건드리지 않고, 심어 둔 기록의 모르는 칸은 버린다', async () => {
  const dir = tmp();
  const g = fakeGh();
  await apply(dir, sel('github-flow'), () => {}, { gh: g.run });
  g.state.repo.allow_merge_commit = true; // 적용 뒤 누군가 GitHub 에서 다시 켬
  const u = await undoWithGithub(dir, { run: g.run });
  assert.deepEqual(u.github.edited, [{ scope: 'repo', key: 'allow_merge_commit' }]);
  assert.equal(g.state.repo.allow_rebase_merge, true);

  const dir2 = tmp();
  const g2 = fakeGh();
  await apply(dir2, sel('github-flow'), () => {}, { gh: g2.run });
  g2.state.remote = 'git@github.com:someone/else.git';
  const before = g2.writes().length;
  const u2 = await undoWithGithub(dir2, { run: g2.run });
  assert.equal(u2.github.error, 'repo-mismatch');
  assert.equal(g2.writes().length, before, '다른 저장소에는 쓰지 않는다');

  const dir3 = tmp();
  const g3 = fakeGh();
  await apply(dir3, sel('none'), () => {}, { gh: g3.run });
  const found = latestBackup(dir3);
  const m = path.join(found.dir, 'manifest.json');
  fs.writeFileSync(m, JSON.stringify({ ...found.manifest, github: { repo: 'me/app', repoSet: { private: false, has_wiki: true }, repoPrev: { private: true }, branches: { '../x': { set: ['pullRequest'] }, main: { set: ['admin', 'approvals'], approvals: 99 } } } }));
  const u3 = await undoWithGithub(dir3, { run: g3.run });
  assert.deepEqual(u3.github.restored, []);
  assert.equal(g3.writes().length, 0, '모르는 칸·이상한 브랜치 이름·범위 밖 승인 수는 버린다');
  for (const d of [dir, dir2, dir3]) fs.rmSync(d, { recursive: true, force: true });
});

test('켜지 않았으면 gh 를 부르지 않는다', async () => {
  const dir = tmp();
  const r = await apply(dir, sel('github-flow', false), () => {}, { gh: async () => assert.fail('gh 를 불렀다') });
  assert.equal(r.github, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('auto: 선택 파일의 github 칸은 무시하고, --github-settings=<항목> 으로 고른 것만. 항목 없는 플래그는 미리보기 전용', () => {
  const dir = tmp();
  const file = path.join(dir, 'sel.json');
  fs.writeFileSync(file, JSON.stringify(sel('github-flow', true)));
  const runCli = (...extra) => JSON.parse(spawnSync(process.execPath, [APPLY, dir, '--selection', file, ...extra], { encoding: 'utf8' }).stdout);
  assert.equal(runCli('--dry-run').github, undefined);
  // 이 임시 폴더는 git 저장소가 아니라 gh 를 부르기 전에 「GitHub 아님」으로 끝난다(네트워크 없음)
  assert.equal(runCli('--dry-run', '--github-settings').github.reason, 'not-github');
  assert.equal(runCli().github, undefined);
  fs.rmSync(path.join(dir, '.claude'), { recursive: true, force: true });
  assert.equal(runCli('--github-settings').github.reason, 'no-items', '항목을 고르지 않으면 바꾸지 않는다');
  fs.rmSync(path.join(dir, '.claude'), { recursive: true, force: true });
  assert.equal(runCli('--github-settings=squash,pr:main').github.reason, 'not-github');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('보호 PUT 꼴: GET 의 사람·팀 객체를 이름 목록으로, 리뷰 수는 0~6 으로', () => {
  const b = toPutBody({ required_pull_request_reviews: { required_approving_review_count: 99, dismissal_restrictions: { users: [{ login: 'kim' }], teams: [{ slug: 'core' }], apps: [] } }, restrictions: { users: [{ login: 'lee' }], teams: [], apps: [] }, allow_force_pushes: { enabled: true } });
  assert.equal(b.required_pull_request_reviews.required_approving_review_count, 6);
  assert.deepEqual(b.required_pull_request_reviews.dismissal_restrictions, { users: ['kim'], teams: ['core'], apps: [] });
  assert.deepEqual(b.restrictions, { users: ['lee'], teams: [], apps: [] });
  assert.equal(b.allow_force_pushes, true);
  assert.equal(b.required_status_checks, null);
});

test('고르기 화면: 승인 수 offerAll 도 같은 항목(서버·화면이 같은 계산)', async () => {
  const o = await offerAll('.', all.packs.flows, { run: fakeGh().run });
  assert.deepEqual(o.flows['github-flow'].map((i) => i.id), (await itemsOf('github-flow')).map((i) => i.id));
});
