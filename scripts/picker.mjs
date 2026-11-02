// 고르기 화면을 띄운다. 브라우저에서 「적용」을 누르면 이 프로세스가 적용하고, 결과 JSON 을 출력한 뒤 끝난다.
// Claude 는 이 출력 한 덩어리만 읽으면 된다(카탈로그 전체가 문맥에 들어가지 않음).
// 보안: 127.0.0.1 에만 열고, 임의 포트, 데이터 요청은 일회용 토큰 헤더 — 다른 웹페이지가 보낸 요청은 거절한다.
// 사용: node scripts/picker.mjs [프로젝트] [--lang ko|en] [--stack "Next.js,Supabase"] [--team] [--no-open]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { detect, withHints } from './detect.mjs';
import { parseArgs } from './lib/args.mjs';
import { fresh } from './fresh.mjs';
import { loadAll, PLUGIN_ROOT } from './lib/catalog.mjs';
import { makeState, cleanSelection } from './lib/picker-state.mjs';
import { fetchSkillText } from './lib/install-skill.mjs';
import { plan, apply, ruleTexts } from './apply.mjs';

const STATIC = { '/': 'index.html', '/app.js': 'app.js', '/view.js': 'view.js', '/parts.js': 'parts.js', '/dialogs.js': 'dialogs.js', '/dom.js': 'dom.js', '/style.css': 'style.css' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const args = process.argv.slice(2);
const { lang, root, hints } = parseArgs(args);
const token = crypto.randomBytes(16).toString('hex');

const all = loadAll();
const cfg = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'config', 'picker.json'), 'utf8'));
const ctx = { all, cfg, det: withHints(detect(root), hints) };
const rel = (p) => path.relative(root, p).split(path.sep).join('/');
let progress = null; // 적용하는 동안 { done, total, current }
let applying = false;

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

const routes = {
  'GET /api/state': (url) => {
    const l = url.searchParams.get('lang');
    return makeState(ctx, l === 'ko' || l === 'en' ? l : lang);
  },
  'GET /api/fresh': () => fresh(),
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
    const { changes, manual } = plan(root, sel, all);
    return { changes: changes.map((c) => ({ action: c.action, kind: c.kind, skill: c.skill, path: rel(c.path) })), manual, ruleTexts: ruleTexts(sel) };
  },
};

const server = http.createServer(async (req, res) => {
  touch();
  const url = new URL(req.url, 'http://127.0.0.1');
  const send = (code, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  // DNS 리바인딩 막기: 다른 이름으로 들어온 요청은 거절.
  if (req.headers.host !== `127.0.0.1:${server.address().port}`) return send(403, { error: 'forbidden' });
  try {
    // 화면 파일(공개된 플러그인 파일)은 토큰 없이. 데이터·적용은 사용자 지정 헤더의 토큰이 있어야 한다
    // (다른 사이트의 스크립트는 CORS 때문에 이 헤더를 붙여 보낼 수 없다).
    if (req.method === 'GET' && STATIC[url.pathname]) {
      const f = path.join(PLUGIN_ROOT, 'picker', STATIC[url.pathname]);
      return send(200, fs.readFileSync(f, 'utf8'), TYPES[path.extname(f)]);
    }
    if (req.headers['x-harness-token'] !== token) return send(403, { error: 'forbidden' });
    const route = routes[`${req.method} ${url.pathname}`];
    if (route) return send(200, await route(url, req));
    if (req.method === 'POST' && url.pathname === '/api/apply') {
      // 적용은 한 번에 하나만(두 번 눌리면 같은 임시 폴더를 두고 다투고 결과가 두 번 나간다).
      if (applying) return send(409, { error: 'busy' });
      applying = true;
      try {
        const sel = cleanSelection(ctx, await readBody(req), lang);
        const result = await apply(root, sel, (p) => (progress = p));
        send(200, result);
        return finish({ status: 'applied', root, selection: sel, ...result });
      } finally {
        applying = false;
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/cancel') {
      send(200, { ok: true });
      return finish({ status: 'cancelled' });
    }
    send(404, { error: 'not found' });
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
});
