// 적용 전 백업과 되돌리기. 원칙:
//  - 백업 목록(manifest)은 저장소에 심어 둘 수 있다. 그래서 적용이 만들 수 있는 경로만 믿고(ALLOWED),
//    git 이 추적하는 백업·미래 날짜 백업은 보지 않는다.
//  - 적용한 뒤 사용자가 고친 것은 그냥 지우지 않는다. CLAUDE.md 는 관리 구역만, .gitignore 는 넣은 줄만 빼고,
//    나머지(설정 파일·스킬 폴더)는 고친 모습을 백업 폴더에 따로 남긴 뒤 되돌린다(훅이 꺼지도록).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { extractBlock, setBlock, blockBroken } from './claude-md.mjs';
import { readPluginJson } from './paths.mjs';
import { isOurLauncher, PRE_COMMIT_CONFIG, PRE_COMMIT_ENTRY, PRE_COMMIT_RUNNER } from '../../hooks/lib/git-hook.mjs';

export const BACKUP_DIR = path.join('.claude', 'harness-backup');
export const GITIGNORE_LINE = '.claude/harness-backup/';
export const UNDO_COMMAND = '/harness-fit:setup undo';
const MANIFEST = 'manifest.json';
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/; // new Date().toISOString() 의 : . 를 - 로 바꾼 꼴
const UNDONE_SUFFIX = '.undone'; // 고친 모습을 남겨 둔 백업은 이름을 바꿔 다음 되돌리기 대상에서 뺀다
const CLOCK_SKEW_MS = 60e3; // 시계 차이 허용. 이보다 미래인 백업은 심어 둔 것으로 본다
// 적용이 만들 수 있는 경로(plan 과 같은 목록). 이 밖의 경로는 백업 목록에 있어도 건드리지 않는다.
// .git/ 안은 pre-commit 과 그 .legacy 만(커밋 때 다시 보는 git 훅, plan.mjs gitHookPlan — 사본이 우리 실행기 그대로일 때만 되살린다). .git/hooks 의 다른 훅·설정은 목록에 있어도 건드리지 않는다.
const GIT_HOOK_PATH = '.git/hooks/pre-commit';
// .claude/harness-fit-pre-commit.mjs: pre-commit 프레임워크를 쓰는 저장소에 넣는 실행 파일(hooks/lib/git-hook.mjs PRE_COMMIT_RUNNER)
// .git/hooks/pre-commit.legacy: pre-commit install 이 옮겨 둔 옛 우리 훅. pre-commit 으로 바꿀 때 적용이 지우고(plan.mjs gitHookPlan) 되돌리기는 되살리지 않고 알린다(notes)
const LEGACY_HOOK_PATH = `${GIT_HOOK_PATH}.legacy`;
const GIT_HOOK_PATHS = new Set([GIT_HOOK_PATH, LEGACY_HOOK_PATH]);
const ALLOWED = new Set(['.claude/harness.json', 'CLAUDE.md', '.claude/settings.json', '.claude/harness-request.md', '.gitignore', ...GIT_HOOK_PATHS, PRE_COMMIT_RUNNER]);
const SKILL_PATH = /^\.claude\/skills\/[\w-][\w.-]*$/; // 첫 글자가 점이면 안 된다(`.`·`..` 로 폴더 전체를 지우지 못하게)
// 작업 폴더(lib/workspace.mjs)의 저장소마다 넣는 git 훅: 바로 아래 폴더 한 단계의 .git/hooks/pre-commit 만(이름 첫 글자는 점이 아님 — `..` 로 밖에 닿지 못하게).
// 맨 위와 같이 우리 실행기 그대로일 때만 지우거나 되살린다(undoGitHook) — 심어 둔 목록으로 남의 훅을 건드리지 못한다
const CHILD_HOOK_PATH = /^[^./\\][^/\\]*\/\.git\/hooks\/pre-commit$/;
const isHookPath = (p) => GIT_HOOK_PATHS.has(p) || CHILD_HOOK_PATH.test(p);

const posix = (p) => p.split(path.sep).join('/');
export const hashOf = (text) => crypto.createHash('sha256').update(text).digest('hex');
const readText = (f) => (fs.existsSync(f) && fs.statSync(f).isFile() ? fs.readFileSync(f, 'utf8') : null);

// 폴더 지문: 안의 파일 경로와 내용을 차례로 섞는다(스킬 폴더를 사용자가 고쳤는지 보려고).
const hashDir = (dir) => {
  const h = crypto.createHash('sha256');
  const walk = (d, rel) => {
    for (const name of fs.readdirSync(d).sort()) {
      const abs = path.join(d, name);
      if (fs.statSync(abs).isDirectory()) walk(abs, `${rel}${name}/`);
      else h.update(`${rel}${name}\0`).update(fs.readFileSync(abs)).update('\0');
    }
  };
  walk(dir, '');
  return h.digest('hex');
};
const fingerprint = (abs) => {
  if (!fs.existsSync(abs)) return null;
  return fs.statSync(abs).isDirectory() ? hashDir(abs) : hashOf(fs.readFileSync(abs, 'utf8'));
};

// 프로젝트 안의, 적용이 만들 수 있는 경로만. 연결(심볼릭 링크)로 밖을 가리키면 거절한다.
const resolveAllowed = (root, rel) => {
  const p = posix(rel);
  if (!ALLOWED.has(p) && !SKILL_PATH.test(p) && !CHILD_HOOK_PATH.test(p)) return null;
  const abs = path.resolve(root, p);
  try {
    const realRoot = fs.realpathSync(root);
    const parent = fs.realpathSync(path.dirname(abs));
    if (parent !== realRoot && !parent.startsWith(realRoot + path.sep)) return null;
    if (fs.existsSync(abs) && fs.lstatSync(abs).isSymbolicLink()) return null;
  } catch {
    return null;
  }
  return abs;
};

const writeManifest = (dir, manifest) => {
  const tmp = path.join(dir, `${MANIFEST}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2));
  fs.renameSync(tmp, path.join(dir, MANIFEST)); // 반쯤 쓴 목록이 남지 않게
};

// 적용 직전: 바뀔 파일을 복사해 두고 목록을 쓴다. 목록은 백업이 다 끝난 뒤에만 생긴다.
export const backup = (root, changes) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(root, BACKUP_DIR, stamp);
  fs.mkdirSync(dir, { recursive: true });
  const entries = changes.map((c) => {
    const rel = path.relative(root, c.path);
    if (c.action !== 'create') fs.cpSync(c.path, path.join(dir, 'files', rel), { recursive: true });
    return { path: posix(rel), kind: c.kind, action: c.action };
  });
  const manifest = { version: 2, stamp, entries };
  writeManifest(dir, manifest);
  return { dir, manifest };
};

// 쓴 뒤: 지문을 남긴다(파일은 쓴 내용, 스킬 폴더는 받은 폴더). 되돌릴 때 「그 뒤 고쳤는지」를 이것으로 안다.
export const recordWritten = ({ dir, manifest }, root, paths) => {
  for (const e of manifest.entries) if (paths.has(e.path)) e.hash = fingerprint(path.join(root, e.path));
  writeManifest(dir, manifest);
};

// 받지 못했던 스킬을 나중에 받으면 같은 백업에 더한다(되돌리기가 처음 상태로 가게).
export const addEntries = ({ dir, manifest }, root, entries) => {
  for (const e of entries) manifest.entries.push({ ...e, hash: fingerprint(path.join(root, e.path)) });
  writeManifest(dir, manifest);
};

// GitHub 저장소 설정을 바꿨으면 이전 값을 같은 목록에 남긴다(되돌리기가 읽는다 — scripts/lib/github-settings.mjs).
export const recordGithub = ({ dir, manifest }, github) => {
  manifest.github = github;
  writeManifest(dir, manifest);
};

const tracked = (root, rel) => {
  try {
    return !!execFileSync('git', ['-C', root, 'ls-files', '--', rel], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return false;
  }
};

// 가장 최근의 믿을 만한 백업: 이름 꼴이 맞고, 미래가 아니고, 목록이 읽히고, git 이 추적하지 않는 것.
export const latestBackup = (root) => {
  const base = path.join(root, BACKUP_DIR);
  if (!fs.existsSync(base)) return null;
  const now = Date.now() + CLOCK_SKEW_MS;
  const stampTime = (s) => Date.parse(s.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z'));
  const stamps = fs.readdirSync(base).filter((s) => STAMP.test(s) && stampTime(s) <= now).sort().reverse();
  for (const s of stamps) {
    const dir = path.join(base, s);
    if (tracked(root, posix(path.join(BACKUP_DIR, s)))) continue;
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8'));
    } catch {
      continue; // 목록이 없거나 깨졌으면 다음 것
    }
    // 0.2.x 까지의 목록(created/backedUp)도 읽는다. 지문이 없으니 그대로 지우고 되살린다.
    const entries = raw.entries || [...(raw.created || []).map((p) => ({ path: posix(p), action: 'create' })), ...(raw.backedUp || []).map((p) => ({ path: posix(p), action: 'change' }))];
    return { dir, manifest: { ...raw, entries } };
  }
  return null;
};

const EOL = (text) => (text.includes('\r\n') ? '\r\n' : '\n');
export const withoutLine = (text, line) => text.split(/\r?\n/).filter((l) => l.trim() !== line).join(EOL(text)); // 줄바꿈 모양은 그대로
const writeOrRemove = (abs, text) => (text.trim() ? fs.writeFileSync(abs, text) : fs.rmSync(abs, { force: true }));

// settings.json 에서 harness-fit 이 더한 마켓·플러그인 칸만 뺀 글(plan.mjs buildSettings 와 짝). 읽을 수 없으면 null — 그때는 고친 사본을 남기고 되돌린다.
const parseOr = (text) => {
  try {
    return text ? JSON.parse(text.replace(/^﻿/, '')) : {};
  } catch {
    return null;
  }
};
// 마켓·플러그인 이름은 플러그인 폴더의 config/sources.json 에서(지금 폴더 기준으로 읽으면 사용자 프로젝트에서 못 찾아
// 아무것도 빼지 않고 「trimmed」 라고 하던 일 — 검토 2026-11-11). 적용 전에 있던 칸은 그 값으로 되살린다(꺼 두었던 플러그인이 켜진 채 남지 않게).
// 플러그인 칸은 우리가 적는 값(true)일 때만 뺀다 — 사용자가 적은 "harness-fit@harness-fit": false(끄기)는 남의 설정이다(검토 2026-11-16)
const OURS = { extraKnownMarketplaces: () => true, enabledPlugins: (v) => v === true };
// 원래 파일 모양 그대로 다시 쓴다: 들여쓰기(처음 들여 쓴 줄의 것)·BOM·CRLF·끝 줄바꿈 — 고친 칸 말고 파일 전체가 diff 에 뜨지 않게
export const sameShape = (original, value) => {
  const text = String(original).replace(/^﻿/, '');
  // 한 줄로 쓴 파일은 한 줄로, 못 알아내면 두 칸
  const indent = text.trim() && !text.trim().includes('\n') ? '' : text.match(/^[{[][^\n]*\n([ \t]+)\S/m)?.[1] || '  ';
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const body = JSON.stringify(value, null, indent).replace(/\n/g, eol);
  return `${original.startsWith('﻿') ? '﻿' : ''}${body}${/\r?\n\s*$/.test(original) || !original.trim() ? eol : ''}`;
};
export const withoutShare = (now, before) => {
  const cur = parseOr(now);
  const old = parseOr(before);
  if (!cur || typeof cur !== 'object' || old === null) return null;
  const src = readPluginJson('config/sources.json');
  for (const [key, id] of [['extraKnownMarketplaces', src.marketplace], ['enabledPlugins', src.pluginId]]) {
    if (!id) continue;
    if (old[key] && typeof old[key] === 'object' && id in old[key]) {
      cur[key] = { ...(cur[key] && typeof cur[key] === 'object' ? cur[key] : {}), [id]: old[key][id] };
      continue;
    }
    if (!cur[key] || typeof cur[key] !== 'object' || !(id in cur[key]) || !OURS[key](cur[key][id])) continue;
    delete cur[key][id];
    if (!Object.keys(cur[key]).length) delete cur[key];
  }
  return Object.keys(cur).length ? sameShape(now || '', cur) : '';
};

// 한 항목 되돌리기 → 'removed' | 'restored' | 'trimmed'(넣은 부분만 뺌) | 'saved'(고친 모습을 남기고 되돌림) | 'gone' | 'skipped'(믿을 수 없는 경로)
// git 훅: 지금 글이 우리 실행기 그대로일 때만 지우거나 바꾼다(isOurLauncher — 표시만 있는 남의 훅·줄을 덧붙인 훅은 둔다).
// 아니면 'kept' — 적용 뒤 팀원이 pre-commit install·Husky 등으로 바꾼 훅이다. 지우면 팀의 커밋 검사가 소리 없이 멈춘다
// (역할극 15 회차, 2026-11-13). 'skipped'(믿을 수 없는 백업)와 나눠 「남겨 뒀어요」로 알린다.
// 되살릴 때는 백업 사본 글을 그대로 쓴다(다시 만들면 원래 적어 둔 경로가 바뀌었다 — 검토 2026-11-16). 적용은 우리 실행기 그대로인 것만
// 바꾸거나 지우므로, 사본이 우리 실행기가 아니면 심어 둔 것으로 보고 쓰지 않는다(다음 커밋 때 그 코드가 돌지 않게).
// .legacy 는 되살리지 않는다 — pre-commit 의 훅이 그것을 부르는데 Windows 에서는 /bin/sh 를 못 찾아 모든 커밋이 막힌다. 'legacy-not-restored' 로 알린다
const undoGitHook = (abs, e, dir) => {
  const now = readText(abs);
  if (now !== null && !isOurLauncher(now)) return 'kept';
  if (e.action === 'create') {
    if (now === null) return 'gone';
    fs.rmSync(abs, { force: true });
    return 'removed';
  }
  const original = readText(path.join(dir, 'files', e.path));
  if (!isOurLauncher(original)) return 'skipped';
  if (posix(e.path) === LEGACY_HOOK_PATH) return 'legacy-not-restored';
  if (now !== original) fs.writeFileSync(abs, original);
  fs.chmodSync(abs, 0o755);
  return 'restored';
};

const undoEntry = (root, dir, e, savedDir) => {
  const abs = resolveAllowed(root, e.path);
  if (!abs) return 'skipped';
  if (isHookPath(posix(e.path))) return undoGitHook(abs, e, dir);
  const original = e.action === 'create' ? null : path.join(dir, 'files', e.path);
  if (!fs.existsSync(abs) && !original) return 'gone';
  // 적용이 지운 것(action remove — 고르지 않게 된 스킬 폴더·우리 git 훅·실행 파일)은 지문이 없다(지운 뒤라). 그 자리에 지금 무엇이 있으면
  // 그 사이 사용자가 만든 것이다 — 덮어쓰지 않고 고친 모습처럼 따로 남긴 뒤 되살린다(검토 2026-11-16: 같은 이름 폴더가 사라졌다)
  const edited = fs.existsSync(abs) && (e.action === 'remove' || (!!e.hash && fingerprint(abs) !== e.hash));
  let result = original ? 'restored' : 'removed';
  if (edited) {
    const now = readText(abs);
    const before = original ? readText(original) : null;
    // 관리 구역 표시가 짝이 안 맞으면 어디까지가 우리 글인지 몰라 두고 알린다(kept — 사용자가 구역을 손으로 뺀다)
    if (e.kind === 'claude-md' && blockBroken(now)) return 'kept';
    if (e.kind === 'claude-md') {
      writeOrRemove(abs, setBlock(now, extractBlock(before)));
      return 'trimmed';
    }
    if (e.kind === 'gitignore' && !(before || '').split(/\r?\n/).some((l) => l.trim() === GITIGNORE_LINE)) {
      writeOrRemove(abs, withoutLine(now, GITIGNORE_LINE));
      return 'trimmed';
    }
    // 팀원 공유 설정(settings.json): 적용 뒤 사용자가 고쳤으면(훅을 더하는 등) 우리가 더한 두 칸만 뺀다 — 통째로 되돌려
    // 사용자가 더한 훅까지 사라지던 일(역할극 2 회차, 2026-11-11). 원래부터 있던 칸은 그대로 둔다.
    if (e.kind === 'share') {
      const trimmed = withoutShare(now, before);
      if (trimmed !== null) {
        writeOrRemove(abs, trimmed);
        return 'trimmed';
      }
    }
    // 고친 모습을 남겨 두고 되돌린다(설정 파일이 남아 있으면 훅이 계속 켜져 있으므로).
    fs.cpSync(abs, path.join(savedDir, e.path), { recursive: true });
    result = 'saved';
  }
  // 이미 원래와 같으면(쓰다 실패해 바뀌지 않은 파일 등) 손대지 않는다. 읽기 전용 파일도 그대로 둘 수 있다.
  if (result === 'restored' && fingerprint(abs) === fingerprint(original)) return result;
  fs.rmSync(abs, { recursive: true, force: true });
  if (original && fs.existsSync(original)) fs.cpSync(original, abs, { recursive: true });
  return result;
};

export const undo = (root) => {
  const found = latestBackup(root);
  if (!found) return { error: 'no-backup' };
  const { dir, manifest } = found;
  const savedDir = path.join(dir, 'edited');
  const out = { undone: manifest.stamp, removed: [], restored: [], trimmed: [], saved: [], skipped: [], kept: [], notes: [] };
  for (const e of manifest.entries) {
    const r = undoEntry(root, dir, e, savedDir);
    if (r === 'legacy-not-restored') out.notes.push({ path: e.path, reason: r });
    else if (out[r]) out[r].push(e.path);
  }
  // pre-commit 프레임워크는 있던 훅(우리 실행기)을 pre-commit.legacy 로 옮겨 함께 돌린다 — 지우지 않고 알린다
  // (설정 파일이 사라지면 그 실행기는 아무것도 막지 않는다)
  if (out.kept.includes(GIT_HOOK_PATH) && !out.restored.includes(LEGACY_HOOK_PATH) && isOurLauncher(readText(path.join(root, LEGACY_HOOK_PATH)))) out.kept.push(LEGACY_HOOK_PATH);
  // 사용자가 붙여 넣은 pre-commit 항목(id: harness-fit)은 남의 설정이라 고치지 않는다. 불러오기 글은 실행 파일이 없으면 알리고 통과하지만(git-hook.mjs PRE_COMMIT_LOADER)
  // 쓸모가 없어졌으니 지워도 된다고 알린다
  if (manifest.entries.some((e) => posix(e.path) === PRE_COMMIT_RUNNER) && PRE_COMMIT_ENTRY.test(readText(path.join(root, PRE_COMMIT_CONFIG)) || '')) out.kept.push(PRE_COMMIT_CONFIG);
  if (!out.kept.length) delete out.kept;
  if (out.saved.length) {
    // 고친 모습을 남겼으면 백업 폴더를 지우지 않고 이름만 바꾼다(다음 되돌리기 대상에서는 빠진다).
    const keep = `${dir}${UNDONE_SUFFIX}`;
    fs.renameSync(dir, keep);
    out.savedIn = posix(path.relative(root, path.join(keep, 'edited')));
  } else fs.rmSync(dir, { recursive: true, force: true });
  // 적용하면서 생긴 빈 폴더도 치운다(안쪽부터).
  for (const d of [path.join(root, BACKUP_DIR), path.join(root, '.claude', 'skills'), path.join(root, '.claude')]) {
    try {
      if (!fs.readdirSync(d).length) fs.rmdirSync(d);
    } catch {}
  }
  for (const k of ['trimmed', 'saved', 'skipped', 'notes']) if (!out[k].length) delete out[k];
  return out;
};
