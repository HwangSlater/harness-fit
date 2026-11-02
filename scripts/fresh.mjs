// 카탈로그 기준일 이후의 새 저장소를 실시간으로 찾는다. 저장해 둔 카탈로그만 쓰면 최신 스킬을 놓치기 때문.
// - catalog/queries.json 의 검색어를 `stars:>=N pushed:>기준일` 조건으로 다시 돌리고, 카탈로그에 없는 저장소만 돌려준다.
// - gh 가 있으면 gh api(로그인 토큰 사용, 한도 넉넉), 없으면 공개 API(시간당 한도 작음).
// - 결과는 임시 폴더에 기본 24시간 저장해 같은 날 다시 열 때 다시 찾지 않는다.
// - 네트워크가 없거나 한도에 걸리면 빈 목록과 이유(error)를 돌려준다. 고르기를 막지 않는다.
// 사용: node scripts/fresh.mjs → JSON 출력
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

const ghApi = (query) =>
  new Promise((resolve, reject) => {
    execFile('gh', ['api', '-X', 'GET', 'search/repositories', '-f', `q=${query}`, '-f', 'per_page=30'], { timeout: 15000 }, (err, out) =>
      err ? reject(err) : resolve(JSON.parse(out)),
    );
  });

const publicApi = async (base, query) => {
  const res = await fetch(`${base}/search/repositories?per_page=30&q=${encodeURIComponent(query)}`, {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

export const fresh = async ({ force = false } = {}) => {
  const src = readJson('config/sources.json');
  const { queries, topics } = readJson('catalog/queries.json');
  const catalog = readJson('catalog/catalog.json');
  const since = catalog.checkedAt;
  const known = new Set(catalog.repos.map((r) => r.repo.toLowerCase()));

  const cacheFile = path.join(os.tmpdir(), `harness-fit-fresh-${since}.json`);
  try {
    const st = fs.statSync(cacheFile);
    if (!force && Date.now() - st.mtimeMs < src.freshCacheHours * 3600e3) return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  } catch {}

  const cond = `stars:>=${src.minStars} pushed:>${since}`;
  const all = [...queries.map((q) => `${q} ${cond}`), ...topics.map((t) => `topic:${t} ${cond}`)];
  const found = new Map();
  const collect = (data) => {
    for (const it of data.items || []) {
      if (known.has(it.full_name.toLowerCase()) || it.archived || found.has(it.full_name)) continue;
      const created = it.created_at.slice(0, 10);
      found.set(it.full_name, {
        repo: it.full_name,
        stars: it.stargazers_count,
        createdAt: created,
        pushedAt: it.pushed_at.slice(0, 10),
        isNew: created > since,
        description: (it.description || '').slice(0, 140),
        license: it.license?.spdx_id || null,
      });
    }
  };
  // gh 가 없거나 로그인이 안 됐으면 첫 실패에서 공개 API 로 바꾼다. 공개 API 도 실패하면 거기서 멈춘다.
  let search = ghApi;
  let error = null;
  for (const q of all) {
    try {
      collect(await search(q));
    } catch (e) {
      if (search !== ghApi) {
        error = String(e.message || e);
        break;
      }
      search = (qq) => publicApi(src.githubApi, qq);
      try {
        collect(await search(q));
      } catch (e2) {
        error = String(e2.message || e2);
        break;
      }
    }
  }
  const result = { since, checkedAt: new Date().toISOString().slice(0, 10), error, repos: [...found.values()].sort((a, b) => b.isNew - a.isNew || b.stars - a.stars) };
  if (!error) fs.writeFileSync(cacheFile, JSON.stringify(result));
  return result;
};

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  fresh({ force: process.argv.includes('--force') }).then((r) => process.stdout.write(JSON.stringify(r, null, 2) + '\n'));
}
