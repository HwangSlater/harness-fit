// 지난 세션 작업 폴더 쌓임(stale-scratch): 세션 시작 때 하루 한 번, 막지 않고 알리기만 한다. 지우지 않는다(사람이 정한다).
//   Claude Code 는 세션마다 <os.tmpdir()>/claude/<프로젝트 지문>/<세션>/ 에 작업 폴더를 만들고, 세션이 끝나도 지우지 않는다.
//   윈도는 로그인 때 사용자 프로필 서비스가 Temp 를 끝까지 훑어서, 파일이 수십만 개면 로그인이 몇 분 늦어진다(docs/decisions-hooks.md).
// 크기는 재지 않는다(100만 개를 세면 몇 분 — 세션 시작을 막는다). 이름·날짜와 깊이 2까지만, 시간 한도 안에서 본다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { claudeHome } from '../lib/claude-home.mjs';
import { localDate } from '../lib/dates.mjs';

export const STALE_DAYS = 3; // 이만큼 손대지 않은 폴더를 지난 것으로 본다
export const MANY = 20; // 무거운 것이 없어도 이보다 많이 쌓이면 알린다
export const FRAMES = 500; // 한 폴더에 그림이 이만큼이면 캡처 프레임으로 본다
const SHOW_MAX = 5;
const BUDGET_MS = 400; // 세션 시작을 늦추지 않게 — 넘으면 본 데까지만 알린다
const MAX_DEPTH = 2; // 세션 폴더 → scratchpad → 그 아래 폴더(venv·프로필·프레임 폴더)
const DAY = 86400000;
const PROJECT_DIR = /^[0-9a-f]{16}$/;
const IMAGE = /\.(png|jpe?g|webp|bmp)$/i;
const KINDS = ['venv', 'node', 'browser', 'frames'];

export const scratchRoot = () => path.join(os.tmpdir(), 'claude');

const list = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};
const mtime = (p) => {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
};

// 볼 폴더: 프로젝트 지문 폴더 아래 세션 폴더들(지금 세션 빼고), 그 밖의 바로 아래 폴더(세션이 직접 만든 것)
const candidates = (root, sessionId) => {
  const out = [];
  for (const e of list(root)) {
    if (!e.isDirectory()) continue;
    const p = path.join(root, e.name);
    if (!PROJECT_DIR.test(e.name)) out.push(p);
    else for (const s of list(p)) if (s.isDirectory() && s.name !== sessionId) out.push(path.join(p, s.name));
  }
  return out;
};

// 마지막으로 손댄 때: 그 폴더와 바로 아래 폴더(scratchpad·tasks) 중 가장 늦은 것
const touchedAt = (dir) => Math.max(mtime(dir), ...list(dir).filter((e) => e.isDirectory()).map((e) => mtime(path.join(dir, e.name))));

// 깊이 2까지 무거운 것의 흔적: venv(pyvenv.cfg) · node_modules · 브라우저 프로필(Local State) · 캡처 프레임(그림 FRAMES 개)
const heavyIn = (dir, deadline) => {
  const kinds = new Set();
  const walk = (d, depth) => {
    if (Date.now() > deadline) return;
    let images = 0;
    for (const e of list(d)) {
      if (e.isFile()) {
        if (e.name === 'pyvenv.cfg') kinds.add('venv');
        else if (e.name === 'Local State') kinds.add('browser');
        else if (IMAGE.test(e.name) && ++images === FRAMES) kinds.add('frames');
      } else if (e.isDirectory()) {
        if (e.name === 'node_modules') kinds.add('node');
        else if (depth < MAX_DEPTH) walk(path.join(d, e.name), depth + 1);
      }
    }
  };
  walk(dir, 0);
  return KINDS.filter((k) => kinds.has(k));
};

// → { old: [{ dir, kinds }], partial }
export const scanScratch = (root, sessionId, now = Date.now()) => {
  const deadline = now + BUDGET_MS;
  const old = [];
  let partial = false;
  for (const dir of candidates(root, sessionId)) {
    if (Date.now() > deadline) {
      partial = true;
      break;
    }
    if (now - touchedAt(dir) < STALE_DAYS * DAY) continue;
    old.push({ dir, kinds: heavyIn(dir, deadline) });
  }
  return { old, partial: partial || Date.now() > deadline };
};

// 하루 한 번: 설정 폴더에 본 날을 적는다(Temp 자리마다 따로 — 시험·여러 Temp 가 서로 막지 않게)
const stampFile = (root) => {
  const norm = process.platform === 'win32' ? root.toLowerCase() : root;
  return path.join(claudeHome(), 'harness-fit', 'stale-scratch', `${createHash('sha256').update(norm).digest('hex').slice(0, 12)}.txt`);
};
const readStamp = (file) => {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
};
const writeStamp = (file, day) => {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, day);
  } catch {} // 적지 못하면 다음 세션에 다시 볼 뿐
};

export const staleScratch = {
  id: 'stale-scratch',
  on: 'session-start',
  check({ input, t }) {
    const root = scratchRoot();
    if (!fs.existsSync(root)) return null;
    const stamp = stampFile(root);
    const today = localDate();
    if (readStamp(stamp) === today) return null;
    const { old, partial } = scanScratch(root, typeof input.session_id === 'string' ? input.session_id : '');
    writeStamp(stamp, today);
    const heavy = old.filter((x) => x.kinds.length);
    if (!heavy.length && old.length <= MANY) return null;
    const label = (x) => x.kinds.map((k) => t(`scratch.kind.${k}`)).join(' · ');
    const shown = heavy.slice(0, SHOW_MAX).map((x) => `- ${x.dir} (${label(x)})`);
    if (heavy.length > SHOW_MAX) shown.push(t('list.more', { n: heavy.length - SHOW_MAX }));
    return t('scratch.stale', {
      root,
      days: STALE_DAYS,
      n: old.length,
      heavy: heavy.length ? t('scratch.heavy', { n: heavy.length }) : '',
      items: shown.length ? `\n${shown.join('\n')}` : '',
      partial: partial ? t('scratch.partial') : '',
      win: process.platform === 'win32' ? t('scratch.win') : '',
    });
  },
};

export default [staleScratch];
