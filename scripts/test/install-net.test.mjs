// 스킬 받기의 네트워크 시험(네트워크 없이 fetch 를 바꿔 끼운다): 카탈로그 파일 목록이면 API 를 부르지 않음, 동시 수 한도,
// GitHub 호출 한도 알림, 목록 없는 항목의 트리 API 예비 길(토큰은 API 에만).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from './helpers.mjs';
import { installSkill } from '../lib/install-skill.mjs';
import { makeNet, makeLimiter, ghToken } from '../lib/net.mjs';
import { apply } from '../lib/apply-run.mjs';
import { loadAll } from '../lib/catalog.mjs';

const sources = { githubApi: 'https://api.test', rawBase: 'https://raw.test', downloadConcurrency: 3 };
const repo = { sha: 'abc', license: 'MIT' };
const ok = (body) => ({ ok: true, status: 200, headers: new Headers(), json: async () => body, arrayBuffer: async () => new TextEncoder().encode(String(body)).buffer });
const noToken = async () => null;
const project = () => {
  const root = tmpDir('harness-net-');
  return { root, dest: (id) => path.join(root, '.claude', 'skills', id) };
};
// fetch 를 바꿔 끼우고 부른 주소·머리글을 모은다
const withFetch = async (impl, run) => {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = (url, opts = {}) => {
    calls.push({ url: String(url), headers: opts.headers || {} });
    return impl(String(url), opts);
  };
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = real;
  }
};
const sel = { lang: 'ko', combo: 'team', hooks: [], rules: [], flow: 'github-flow', explore: [], note: '', share: false };

test('카탈로그에 파일 목록이 있으면 GitHub API 를 부르지 않고 raw 파일만 받는다', async () => {
  const { root, dest } = project();
  const skill = { id: 'sk', repo: 'o/r', path: 'skills/sk/SKILL.md', fileList: [{ path: 'SKILL.md', size: 5 }, { path: 'ref/a.md', size: 5 }] };
  await withFetch(async (url) => ok(`글 ${url}`), async (calls) => {
    await installSkill({ sources, skill, repo, dest: dest('sk'), net: makeNet(sources, { token: noToken }) });
    assert.deepEqual(calls.map((c) => c.url).sort(), ['https://raw.test/o/r/abc/skills/sk/SKILL.md', 'https://raw.test/o/r/abc/skills/sk/ref/a.md']);
    assert.ok(calls.every((c) => !c.headers.Authorization), 'raw 파일 받기에는 토큰을 붙이지 않는다');
  });
  assert.ok(fs.existsSync(path.join(dest('sk'), 'ref', 'a.md')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('카탈로그 파일 목록의 경로도 스킬 폴더 밖으로 나가지 못한다', async () => {
  const { root, dest } = project();
  const skill = { id: 'sk', repo: 'o/r', path: 'skills/sk/SKILL.md', fileList: [{ path: '../../evil.md', size: 1 }] };
  await withFetch(async () => ok('x'), async (calls) => {
    await assert.rejects(installSkill({ sources, skill, repo, dest: dest('sk'), net: makeNet(sources, { token: noToken }) }), /잘못된 경로/);
    assert.equal(calls.length, 0);
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('목록이 없는 항목은 트리 API 로 받고(예비 길), gh 토큰은 API 호출에만 붙인다', async () => {
  const { root, dest } = project();
  const token = 't'.repeat(40);
  const tree = { tree: [{ type: 'blob', path: 'skills/sk/SKILL.md', size: 3 }] };
  await withFetch(async (url) => ok(url.includes('/git/trees/') ? tree : '본문'), async (calls) => {
    await installSkill({ sources, skill: { id: 'sk', repo: 'o/fallback', path: 'skills/sk/SKILL.md' }, repo, dest: dest('sk'), net: makeNet(sources, { token: async () => token }) });
    const api = calls.filter((c) => c.url.startsWith(sources.githubApi));
    const raw = calls.filter((c) => c.url.startsWith(sources.rawBase));
    assert.equal(api.length, 1);
    assert.equal(api[0].headers.Authorization, `Bearer ${token}`);
    assert.equal(raw.length, 1);
    assert.equal(raw[0].headers.Authorization, undefined);
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('gh 토큰: 로그인돼 있지 않거나 이상한 출력이면 쓰지 않는다', async () => {
  assert.equal(await ghToken(async () => ({ code: 1, stdout: '' })), null);
  assert.equal(await ghToken(async () => ({ code: 0, stdout: 'gho_abc\r\nX-Evil: 1' })), null, '머리글을 깨는 값은 버린다');
  assert.equal(await ghToken(async () => { throw new Error('gh 없음'); }), null);
  assert.equal(await ghToken(async () => ({ code: 0, stdout: `${'g'.repeat(40)}\n` })), 'g'.repeat(40));
});

test('동시에 받는 수는 한도를 넘지 않는다(여러 스킬이 한도를 나눠 쓴다)', async () => {
  const { root, dest } = project();
  let now = 0;
  let peak = 0;
  const net = makeNet(sources, { token: noToken });
  const skills = ['a', 'b', 'c'].map((id) => ({ id: `sk-${id}`, repo: 'o/r', path: `skills/${id}/SKILL.md`, fileList: ['SKILL.md', 'x.md', 'y.md', 'z.md'].map((p) => ({ path: p, size: 1 })) }));
  await withFetch(async () => {
    now += 1;
    peak = Math.max(peak, now);
    await new Promise((r) => setTimeout(r, 5));
    now -= 1;
    return ok('x');
  }, async (calls) => {
    await Promise.all(skills.map((skill) => installSkill({ sources, skill, repo, dest: dest(skill.id), net })));
    assert.equal(calls.length, 12);
  });
  assert.equal(peak, sources.downloadConcurrency, `한도 ${sources.downloadConcurrency} 까지 함께, 넘지 않게 (최대 ${peak})`);
  fs.rmSync(root, { recursive: true, force: true });
});

test('makeLimiter: 실패한 일도 자리를 비운다', async () => {
  const limit = makeLimiter(1);
  await assert.rejects(limit(async () => { throw new Error('x'); }));
  assert.equal(await limit(async () => 7), 7);
});

const limited = (status, headers) => ({ ok: false, status, headers: new Headers(headers) });

test('GitHub 호출 한도(403 + 남은 횟수 0)는 몇 분 뒤인지 알리고, 같은 곳을 다시 부르지 않는다', async () => {
  const { root, dest } = project();
  const reset = Math.floor(Date.now() / 1000) + 600;
  const net = makeNet(sources, { token: noToken });
  await withFetch(async () => limited(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) }), async (calls) => {
    const skill = (id) => ({ id, repo: 'o/big', path: `skills/${id}/SKILL.md` });
    const e = await installSkill({ sources, skill: skill('a'), repo, dest: dest('a'), net }).catch((x) => x);
    assert.match(e.message, /^GitHub 호출 한도 — 약 1[01]분 뒤 다시$/);
    assert.equal(e.reason, 'rate-limit');
    assert.ok(e.waitMin >= 10 && e.waitMin <= 11);
    assert.ok(Date.parse(e.retryAt) > Date.now());
    await assert.rejects(installSkill({ sources, skill: skill('b'), repo: { sha: 'other' }, dest: dest('b'), net }), /호출 한도/);
    assert.equal(calls.length, 1, '한도에 걸린 뒤로는 API 를 더 부르지 않는다');
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('429·retry-after 는 영어로도, 한도가 아닌 403 은 보통 오류로', async () => {
  const { root, dest } = project();
  const skill = { id: 'sk', repo: 'o/r', path: 'skills/sk/SKILL.md', fileList: [{ path: 'SKILL.md', size: 1 }] };
  await withFetch(async () => limited(429, { 'retry-after': '90' }), async () => {
    const e = await installSkill({ sources, skill, repo, dest: dest('sk'), net: makeNet(sources, { token: noToken, lang: 'en' }) }).catch((x) => x);
    assert.equal(e.message, 'GitHub rate limit — try again in about 2 min');
  });
  await withFetch(async () => limited(403, {}), async () => {
    const e = await installSkill({ sources, skill, repo, dest: dest('sk'), net: makeNet(sources, { token: noToken }) }).catch((x) => x);
    assert.match(e.message, /^HTTP 403 /);
    assert.equal(e.reason, undefined);
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('적용: 카탈로그 스킬은 API 없이 함께 받고, 한도에 걸리면 failed 에 까닭(reason·waitMin)을 남긴다', async () => {
  const all = loadAll();
  const ids = ['brainstorming', 'systematic-debugging', 'writing-plans'];
  for (const id of ids) assert.ok(all.catalog.skills.find((s) => s.id === id)?.fileList?.length, `${id} 는 카탈로그에 파일 목록이 있다`);
  const max = all.sources.downloadConcurrency;
  let now = 0;
  let peak = 0;
  const dir = tmpDir('harness-net-apply-');
  await withFetch(async () => {
    now += 1;
    peak = Math.max(peak, now);
    await new Promise((r) => setTimeout(r, 3));
    now -= 1;
    return ok('---\nname: x\n---\n');
  }, async (calls) => {
    const r = await apply(dir, { ...sel, skills: ids });
    assert.deepEqual(r.failed, []);
    assert.ok(!calls.some((c) => c.url.startsWith(all.sources.githubApi)), 'GitHub API 를 부르지 않는다');
  });
  assert.ok(peak > 1 && peak <= max, `함께 받되 한도(${max}) 안에서 (최대 ${peak})`);
  fs.rmSync(dir, { recursive: true, force: true });

  const dir2 = tmpDir('harness-net-apply-');
  await withFetch(async () => limited(429, { 'retry-after': '300' }), async () => {
    const r = await apply(dir2, { ...sel, skills: ids });
    assert.deepEqual(r.failed.map((f) => f.skill), ids, '고른 차례대로');
    assert.ok(r.failed.every((f) => f.reason === 'rate-limit' && f.waitMin === 5 && f.error === 'GitHub 호출 한도 — 약 5분 뒤 다시'));
  });
  fs.rmSync(dir2, { recursive: true, force: true });
});
