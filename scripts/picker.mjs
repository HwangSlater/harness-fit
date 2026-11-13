// 고르기 화면을 띄운다. 브라우저에서 「적용」을 누르면 이 프로세스가 적용하고, 결과 JSON 을 출력한 뒤 끝난다.
// Claude 는 이 출력 한 덩어리만 읽으면 된다(카탈로그 전체가 문맥에 들어가지 않음).
// 보안: 127.0.0.1 에만 열고, 임의 포트, 데이터 요청은 일회용 토큰 헤더 — 다른 웹페이지가 보낸 요청은 거절한다.
// 사용: node scripts/picker.mjs [프로젝트] [--lang ko|en] [--stack "Next.js,Supabase"] [--team] [--similar …] [--skip …] [--no-open]
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { detect, withHints } from './detect.mjs';
import { withInstalled, withHookProbe } from './lib/existing.mjs';
import { parseArgs } from './lib/args.mjs';
import { fresh } from './fresh.mjs';
import { loadAll } from './lib/catalog.mjs';
import { pickerConfig } from './lib/paths.mjs';
import { makeState, cleanSelection, readHarnessConfig, readStrings } from './lib/picker-state.mjs';
import { fetchSkillText } from './lib/install-skill.mjs';
import { plan, mdSelection } from './lib/plan.mjs';
import { apply } from './lib/apply-run.mjs';
import { ruleTexts, ruleDropped } from './lib/claude-md.mjs';
import { pluginActive } from './lib/installed.mjs';
import { currentListing } from './lib/skill-budget.mjs';
import { offerAll } from './lib/github-settings.mjs';
import { readStatic } from './lib/static.mjs';
import { SHARED_KINDS } from '../picker/team.js';
import { uncommittedShared } from './lib/shared-files.mjs';

const args = process.argv.slice(2);
const { lang, root, hints } = parseArgs(args);
const token = crypto.randomBytes(16).toString('hex');

const all = loadAll();
const cfg = pickerConfig();
// prev: 지난번 적용 때 남긴 .claude/harness.json(훅 옵션의 지난번 값과 지난번 선택). 없거나 깨졌으면 null → 추천에서 시작.
// 이미 있는 훅·스킬과 겹치는 것은 기본에서 뺀다. 기존 훅 시험은 십몇 초 걸릴 수 있어(2026-11-06 이 PC 14.5초) 화면을 먼저 띄우고
// 뒤에서 마저 한다 — 그동안 화면은 「이미 있는 훅을 확인하는 중…」이고 적용을 막는다. 답은 GET /api/existing(끝날 때까지 기다렸다 상태를 준다).
const ctx = { all, cfg, prev: readHarnessConfig(root), det: withInstalled(withHints(detect(root), hints), root) };
// 지금 스킬 목록 크기(늘 보는 이름 + 설명). 미리보기마다 수백 개 파일을 다시 읽지 않게 한 번만 읽는다(이 PC 에서 플러그인 하나 406개 · 0.4초).
let listing;
const listingNow = () => (listing ||= currentListing(root, { contextTokens: cfg.contextTokens }));
// 시험 준비(임시 저장소 만들기)에 git 을 몇 번 동기로 부르므로, 주소를 내고 브라우저를 연 뒤에 시작한다(server.listen 에서 startProbe).
let startProbe;
const hookProbe = new Promise((resolve) => (startProbe = resolve)).then(() => withHookProbe(ctx.det, root)).then((det) => (ctx.det = det));
const rel = (p) => path.relative(root, p).split(path.sep).join('/');
let progress = null; // 적용하는 동안 { done, total, current }
let applying = false;
let githubOffer = null; // GET /api/github 의 답(약속)

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size <= cfg.maxBodyBytes) chunks.push(c); // 넘치면 더 쌓지 않고 끝까지 읽은 뒤 거절한다(연결을 끊으면 화면이 이유를 못 받는다)
    });
    // 깨진 JSON 이 프로세스를 죽이지 않게(결과 JSON 을 못 내면 기다리던 Claude 가 이유를 모른다).
    req.on('end', () => {
      if (size > cfg.maxBodyBytes) return reject(new Error('too large'));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('bad json'));
      }
    });
    req.on('error', reject);
  });

let idle;
const finish = (result) => {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  setTimeout(() => process.exit(0), cfg.exitDelayMs); // 응답이 브라우저에 닿을 시간
};
const touch = () => {
  clearTimeout(idle);
  idle = setTimeout(() => finish({ status: 'timeout' }), cfg.idleMinutes * 60e3);
};

const langOf = (url) => {
  const l = url.searchParams.get('lang');
  return l === 'ko' || l === 'en' ? l : lang;
};

// 길(route)은 보낼 글을 돌려준다(200). 다른 상태 번호나 보낸 뒤 할 일이 있으면 reply(code, body, after).
const REPLY = Symbol('reply');
const reply = (code, body, after) => ({ [REPLY]: true, code, body, after });

// 팀원 공유를 켰으면 팀원에게 닿게 할 일(화면 picker/team.js 와 같은 기준): 올릴 파일 · 열 때 설치 안내 · git 훅은 공유 안 됨
const teammatesOf = (sel) => {
  if (!sel.share) return null;
  const shared = [...new Set([...plan(root, sel, all, { listing: listingNow() }).changes.filter((c) => SHARED_KINDS.has(c.kind)).map((c) => rel(c.path) + (c.kind === 'skill' ? '/' : '')), ...uncommittedShared(root, sel.skills)])];
  return { commitAndPush: shared, installPromptOnOpen: `${all.sources.pluginRepo} ${all.sources.pluginRef}`, gitPreCommitShared: false, gitPreCommitHowTo: readStrings(sel.lang || lang).teamGitHookHowTo };
};

const routes = {
  'GET /api/state': (url) => makeState(ctx, langOf(url)),
  // 기존 훅 시험이 끝나면 그 결과를 넣은 상태(/api/state 와 같은 꼴). 끝나기 전에 부르면 끝날 때까지 기다린다.
  'GET /api/existing': async (url) => (await hookProbe, makeState(ctx, langOf(url))),
  'GET /api/fresh': () => fresh(),
  // GitHub 저장소 설정을 켤 수 있는지 + 브랜치 방식마다 바뀔 값(현재 → 새 값). gh 를 몇 번 부르므로 처음 한 번만 읽는다.
  // ?refresh=1 은 「다시 확인」(오프라인·로그인 전이었을 때).
  'GET /api/github': (url) => (url.searchParams.get('refresh') && (githubOffer = null), githubOffer ||=offerAll(root, all.packs.flows).catch(() => ({ offered: false, reason: 'error' }))),
  'GET /api/progress': () => progress || {},
  // 「원문 보기」: 카탈로그에 있는 스킬만, 고정 커밋의 SKILL.md 글.
  'GET /api/skill': async (url) => {
    const skill = all.catalog.skills.find((s) => s.id === url.searchParams.get('id'));
    if (!skill) return { error: 'not found' };
    const repo = all.catalog.repos.find((r) => r.repo === skill.repo);
    return { text: await fetchSkillText({ sources: all.sources, skill, repo, maxChars: cfg.skillPreviewChars }) };
  },
  'POST /api/preview': async (url, req) => {
    const sel = cleanSelection(ctx, await readBody(req), lang);
    const active = pluginActive(root);
    const { changes, manual, warnings, skipped, gitHookCmd, skillBudget } = plan(root, sel, all, { active, listing: listingNow() });
    // 지침 글은 적용과 같은 기준으로(plan.mjs mdSelection)
    const mdSel = mdSelection(sel, active);
    return { changes: changes.map((c) => ({ action: c.action, kind: c.kind, skill: c.skill, path: rel(c.path) })), uncommittedShared: uncommittedShared(root, sel.skills), manual, warnings, skipped, gitHookCmd, skillBudget, ruleTexts: ruleTexts(mdSel), ruleDropped: ruleDropped(mdSel) };
  },
  'POST /api/apply': async (url, req) => {
    // 적용은 한 번에 하나만(두 번 눌리면 같은 임시 폴더를 두고 다투고 결과가 두 번 나간다).
    if (applying) return reply(409, { error: 'busy' });
    applying = true;
    try {
      // 화면은 시험이 끝나기 전에 적용을 막지만, 다른 길로 들어온 요청도 시험이 끝난 뒤에 적용한다
      await hookProbe;
      const sel = cleanSelection(ctx, await readBody(req), lang);
      const teammates = teammatesOf(sel);
      const result = await apply(root, sel, (p) => (progress = p), { listing: listingNow() });
      return reply(200, result, () => finish({ status: 'applied', root, selection: sel, ...result, ...(teammates ? { teammates } : {}) }));
    } catch (e) {
      // 화면이 되돌리기를 권할지 가르도록 알린다: partial 이 아니면 apply-run 이 스스로 되돌렸다(바뀐 것 없음).
      // 그때 되돌리기를 권하면 지난 적용까지 지워진다(검토 2026-11-13 — 명령줄 SKILL.md 와 같은 기준)
      return reply(500, { error: String(e?.message || e).slice(0, 300), partial: !!e?.partial, fsCode: typeof e?.code === 'string' && /^E[A-Z]+$/.test(e.code) ? e.code : null });
    } finally {
      applying = false;
    }
  },
  'POST /api/cancel': () => reply(200, { ok: true }, () => finish({ status: 'cancelled' })),
};

const server = http.createServer(async (req, res) => {
  touch();
  const url = new URL(req.url, 'http://127.0.0.1');
  const send = (code, body, type = 'application/json; charset=utf-8', cacheControl = 'no-store') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': cacheControl, 'X-Content-Type-Options': 'nosniff' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  // DNS 리바인딩 막기: 다른 이름으로 들어온 요청은 거절.
  if (req.headers.host !== `127.0.0.1:${server.address().port}`) return send(403, { error: 'forbidden' });
  try {
    // 화면 파일(공개된 플러그인 파일)은 토큰 없이. 데이터·적용은 사용자 지정 헤더의 토큰이 있어야 한다
    // (다른 사이트의 스크립트는 CORS 때문에 이 헤더를 붙여 보낼 수 없다).
    const file = req.method === 'GET' ? readStatic(url.pathname) : null;
    if (file) return send(200, file.body, file.type, file.cacheControl);
    if (req.headers['x-harness-token'] !== token) return send(403, { error: 'forbidden' });
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) return send(404, { error: 'not found' });
    const out = await route(url, req);
    if (!out?.[REPLY]) return send(200, out);
    send(out.code, out.body);
    out.after?.();
  } catch (e) {
    send(500, { error: String(e.message || e) });
  }
});

const openBrowser = (u) => {
  const [cmd, a] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', u]] : process.platform === 'darwin' ? ['open', [u]] : ['xdg-open', [u]];
  try {
    spawn(cmd, a, { stdio: 'ignore', detached: true, windowsVerbatimArguments: process.platform === 'win32' }).unref();
  } catch {}
};

server.listen(0, '127.0.0.1', () => {
  const u = `http://127.0.0.1:${server.address().port}/?t=${token}`;
  process.stderr.write(`${u}\n`);
  if (!args.includes('--no-open')) openBrowser(u);
  touch();
  startProbe();
});
