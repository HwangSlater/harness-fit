// 고르기 화면 파일(picker/). 목록에 적힌 파일만 토큰 없이 보낸다 — 공개된 플러그인 파일이고, 목록 밖 경로는 읽지 않는다.
// 글꼴(woff2)은 글자가 아니라 바이트로 읽는다(utf8 로 읽으면 깨진다).
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_ROOT } from './paths.mjs';

const FILES = [
  'index.html', 'tokens.css', 'components.css', 'layout.css', 'options.css',
  'app.js', 'api.js', 'dom.js', 'parts.js', 'frame.js', 'panel.js', 'steps.js', 'flow-art.js', 'skills.js', 'hooks.js', 'browse.js', 'rules.js', 'review.js', 'changes.js',
  'options.js', 'opt-list.js', 'option-table.js', 'menu-select.js', 'press.js', 'apply-flow.js', 'github.js', 'github-plan.js', 'hook-options.js', 'dup.js', 'selection.js', 'stats.js', 'team.js', 'budget.js', 'budget-view.js', 'review-notes.js', 'rule-dialog.js', 'info-dialog.js', 'combo-panel.js',
  'fonts/SpoqaHanSansNeo-Regular.woff2', 'fonts/SpoqaHanSansNeo-Medium.woff2', 'fonts/SpoqaHanSansNeo-Bold.woff2',
];
export const STATIC = Object.freeze(Object.fromEntries([['/', 'index.html'], ...FILES.map((f) => [`/${f}`, f])]));
export const TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2',
});
const BINARY = new Set(['.woff2']);
// 글꼴은 바뀌지 않으므로 브라우저가 오래 들고 있게 한다. 화면 파일은 플러그인을 고치면 바로 보여야 하니 그대로 no-store.
const FONT_CACHE = 'public, max-age=31536000, immutable';
const NO_STORE = 'no-store';
const cache = new Map(); // 한 번 읽은 파일(이 프로세스는 화면 하나를 띄우는 동안만 산다)

// 주소 → { body, type, cacheControl } · 목록에 없으면 null
export const readStatic = (pathname) => {
  const rel = Object.hasOwn(STATIC, pathname) ? STATIC[pathname] : null;
  if (!rel) return null;
  if (!cache.has(rel)) {
    const ext = path.extname(rel);
    const file = path.join(PLUGIN_ROOT, 'picker', rel);
    const binary = BINARY.has(ext);
    cache.set(rel, Object.freeze({ body: binary ? fs.readFileSync(file) : fs.readFileSync(file, 'utf8'), type: TYPES[ext], cacheControl: binary ? FONT_CACHE : NO_STORE }));
  }
  return cache.get(rel);
};
