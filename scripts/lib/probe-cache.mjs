// 기존 훅 겹침 시험 결과 캐시(2026-11-13 — auto 추천이 시험을 기다리느라 15~45초 걸렸다).
// 자리: <설정 폴더>/harness-fit/probe-cache.json (CLAUDE_CONFIG_DIR → ~/.claude, 시험은 임시 홈).
// 열쇠는 아래를 모두 넣은 해시라 하나라도 바뀌면 다시 시험한다:
//   시험한 훅마다 scope·때·matcher·명령·args·timeout·플러그인 + 명령에 적힌 절대 경로 파일의 내용(JS 는 상대 import·require 를 따라간 파일까지),
//   catalog/probes.json 내용, 플러그인 버전, 시험 코드(probe-run.mjs·existing-hooks.mjs·이 파일), Node 버전·OS.
// 훅이 따로 읽는 설정·데이터 파일은 따라가지 못하므로 MAX_AGE_MS 가 지나면 다시 시험한다.
// 담는 것은 겹침 결과({ 훅 id: { scope, by, from } } — 스크립트 파일 이름·범위·플러그인 id)뿐. 명령 전체·경로·시험 입력은 담지 않는다(열쇠는 해시).
// 시간이 넘은 훅이 있던 시험은 담지 않는다(PC 가 바빠서 생긴 「통과」를 굳히지 않게). 깨진 파일은 빈 캐시로 본다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { claudeHome } from '../../hooks/lib/claude-home.mjs';
import { PLUGIN_ROOT, readJson } from './paths.mjs';

const FORMAT = 1;
const MAX_ENTRIES = 8; // 저장소 쪽 훅이 저장소마다 달라 열쇠가 여럿 생긴다 — 최근 것만
const MAX_AGE_MS = 7 * 86400000;
const MAX_FILES = 200; // 훅 하나가 끌어오는 파일 수 한도(따라가기가 끝없이 번지지 않게)
const MAX_HASH_BYTES = 1024 * 1024; // 이보다 큰 파일(실행 파일 등)은 내용 대신 크기·고친 시각
const SCRIPT_EXT = /\.(?:mjs|cjs|js|ts|mts|cts)$/i;
const JS_TRY = ['', '.js', '.mjs', '.cjs', '.ts', '/index.js', '/index.mjs'];
// 상대 경로 import·require(정적 import·export from·import()·require())
const JS_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'](\.{1,2}\/[^"'\n]+)["']/g;
const OWN_CODE = ['probe-run.mjs', 'existing-hooks.mjs', 'probe-cache.mjs'].map((f) => path.join(path.dirname(fileURLToPath(import.meta.url)), f));

export const probeCacheFile = (home) => path.join(claudeHome(home), 'harness-fit', 'probe-cache.json');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const statOf = async (p) => fs.promises.stat(p).catch(() => null);

// 파일 하나의 지문: 작으면 내용 해시, 크면 크기·시각. 없으면 null
const fileMark = async (p) => {
  const st = await statOf(p);
  if (!st?.isFile()) return null;
  if (st.size > MAX_HASH_BYTES) return `${st.size}:${st.mtimeMs}`;
  return sha(await fs.promises.readFile(p).catch(() => ''));
};

// 명령·args 의 낱말 중 절대 경로(따옴표를 떼고, --opt=값 은 값 쪽도). 상대 경로는 시험 자리(임시 폴더) 기준이라 결과에 닿지 않는다.
const QUOTED = /"([^"]*)"|'([^']*)'|(\S+)/g;
const pathWords = (h) => {
  const words = h.args ? [h.command, ...h.args] : [...h.command.matchAll(QUOTED)].map((m) => m[1] ?? m[2] ?? m[3]);
  return words.flatMap((w) => (w.includes('=') ? [w, w.slice(w.indexOf('=') + 1)] : [w])).filter((w) => path.isAbsolute(w));
};

// 훅 하나가 돌리는 파일들 → [[경로, 지문]] (JS 는 상대 import 를 따라간다)
const hookFiles = async (h) => {
  const seen = new Map();
  const queue = pathWords(h).map((w) => path.resolve(w));
  while (queue.length && seen.size < MAX_FILES) {
    const p = queue.shift();
    if (seen.has(p)) continue;
    const mark = await fileMark(p);
    if (mark === null) continue;
    seen.set(p, mark);
    if (!SCRIPT_EXT.test(p)) continue;
    const text = await fs.promises.readFile(p, 'utf8').catch(() => '');
    for (const m of text.matchAll(JS_IMPORT)) {
      for (const ext of JS_TRY) {
        const q = path.resolve(path.dirname(p), m[1] + ext);
        if (seen.has(q)) break;
        if ((await statOf(q))?.isFile()) { queue.push(q); break; }
      }
    }
  }
  return [...seen].sort(([a], [b]) => (a < b ? -1 : 1));
};

// 열쇠: 위 머리말의 것 모두
export const probeCacheKey = async (hooks, probes) => {
  const parts = {
    v: FORMAT,
    version: readJson(path.join(PLUGIN_ROOT, 'package.json'))?.version || '',
    code: await Promise.all(OWN_CODE.map(fileMark)),
    runtime: [process.platform, process.arch, process.version],
    probes: sha(JSON.stringify(probes)),
    hooks: await Promise.all(hooks.map(async (h) => ({
      scope: h.scope, event: h.event, matcher: h.matcher, command: h.command, args: h.args || null, timeout: h.timeout, plugin: h.plugin || null,
      files: await hookFiles(h),
    }))),
  };
  return sha(JSON.stringify(parts));
};

// 결과 꼴이 맞는가(깨졌거나 남이 고친 파일을 그대로 화면에 보내지 않게)
const validResult = (r) => !!r && typeof r === 'object' && !Array.isArray(r) && Object.values(r).every((v) =>
  v && typeof v.scope === 'string' && Array.isArray(v.by) && v.by.every((s) => typeof s === 'string')
  && Array.isArray(v.from) && v.from.every((f) => f && typeof f.label === 'string' && typeof f.scope === 'string'));

const readEntries = async (file) => {
  try {
    const j = JSON.parse(await fs.promises.readFile(file, 'utf8'));
    if (j?.v !== FORMAT || !Array.isArray(j.entries)) return [];
    return j.entries.filter((e) => e && typeof e.key === 'string' && Number.isFinite(e.at) && validResult(e.result));
  } catch {
    return []; // 없거나 깨짐 → 빈 캐시
  }
};

const fresh = (e, now) => e.at <= now + 60000 && now - e.at < MAX_AGE_MS;

// 맞는 결과(없으면 null)
export const readProbeCache = async (file, key, now = Date.now()) => {
  const hit = (await readEntries(file)).find((e) => e.key === key && fresh(e, now));
  return hit ? hit.result : null;
};

// 결과를 담는다: 같은 열쇠·오래된 것은 빼고 최근 MAX_ENTRIES 개. 임시 파일에 쓰고 이름을 바꿔 한 번에(다른 창이 같이 써도 반쯤 쓴 파일이 남지 않게).
// 캐시는 덤이라 쓰기에 실패해도 오류를 내지 않는다.
export const writeProbeCache = async (file, key, result, now = Date.now()) => {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    const keep = (await readEntries(file)).filter((e) => e.key !== key && fresh(e, now));
    const entries = [{ key, at: now, result }, ...keep].sort((a, b) => b.at - a.at).slice(0, MAX_ENTRIES);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(tmp, JSON.stringify({ v: FORMAT, entries }));
    await fs.promises.rename(tmp, file);
  } catch {
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
  }
};
