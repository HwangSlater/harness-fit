// 프로젝트를 끝낼 때: harness-fit 이 넣은 것을 백업 없이 모두 뺀다(scripts/apply.mjs --remove).
// 되돌리기(backup.mjs undo)는 마지막 적용만, 그리고 백업 폴더가 있어야 한다 — 백업 폴더는 .gitignore 라 다른 PC·새 clone 에는 없다.
// 원칙: 우리 것임이 분명한 것만 지운다.
//  - 이름이 우리 것인 파일(.claude/harness.json · 요청 메모)과 우리 표시가 있는 것(CLAUDE.md 관리 구역, 실행 파일의 MARKER, 우리 실행기 그대로인 git 훅).
//  - 공유 파일(settings.json · .gitignore)은 우리가 더한 칸·줄만 빼고, 남은 것이 없을 때만 파일을 지운다.
//  - 받은 스킬은 받은 그대로일 때만(.harness-source.json 의 지문 — owned.mjs skillState). 고친 것은 --force 일 때만.
//  - 프로젝트 밖은 건드리지 않는다. 가는 길이나 그 자리가 연결(심볼릭 링크·정션)이면 따라가지 않고 kept 로 알린다.
//  - 남의 파일(.pre-commit-config.yaml, 사용자 훅에 이어 붙인 줄)과 플러그인 설치는 고치지 않고 manual 로 알린다.
import fs from 'node:fs';
import path from 'node:path';
import { extractBlock, setBlock, blockBroken, blockLineCount } from './claude-md.mjs';
import { readPluginJson } from './paths.mjs';
import { BACKUP_DIR, GITIGNORE_LINE, withoutLine, withoutShare } from './backup.mjs';
import { within, isLink, ownedSkills } from './owned.mjs';
import { MARKER, isOurLauncher, gitHookState, PRE_COMMIT_CONFIG, PRE_COMMIT_ENTRY, PRE_COMMIT_RUNNER } from '../../hooks/lib/git-hook.mjs';
import { readInstalledPlugins } from '../../hooks/lib/claude-home.mjs';

const posix = (p) => p.split(path.sep).join('/');
const readFile = (abs) => {
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
};
const parse = (text) => {
  try {
    return JSON.parse(String(text).replace(/^﻿/, ''));
  } catch {
    return undefined;
  }
};
const samePath = (a, b) => (process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));
const HOOK = '.git/hooks/pre-commit';
const LEGACY = `${HOOK}.legacy`;
// 사용자 훅에 이어 붙인 한 줄(plan.mjs gitHookCmd — hooks/lib/git-hook.mjs chainCommand)이 부르는 파일
const CHAINED = /harness-fit|git-pre-commit\.mjs/;
// Husky 가 훅을 두는 자리(core.hooksPath 가 가리키는 곳은 git 이 알려 준다)
const HUSKY_HOOK = '.husky/pre-commit';

// 이 PC 에 harness-fit 플러그인이 어느 범위로 깔렸나(installed_plugins.json) → 지울 명령. 못 찾으면(예: --plugin-dir) /plugin 메뉴만.
// project·local 범위만 이 저장소에 묶인다. user 범위는 모든 프로젝트에 깔린 것이라 지우면 다른 프로젝트에서도 빠진다(userScope 로 알린다).
const pluginStep = (root, id, home) => {
  const list = readInstalledPlugins(home)[id];
  const entries = Array.isArray(list) ? list.filter((p) => p && typeof p === 'object') : [];
  const scopes = [...new Set(entries.filter((p) => (p.scope === 'project' || p.scope === 'local') && typeof p.projectPath === 'string' && samePath(p.projectPath, root)).map((p) => p.scope))];
  const userScope = entries.some((p) => p.scope === 'user');
  return { kind: 'plugin', plugin: id, commands: scopes.map((s) => `claude plugin uninstall ${id} --scope ${s}`), userScope, menu: '/plugin' };
};

// 백업 목록 가운데 GitHub 저장소 설정을 바꾼 적용(지우기는 GitHub 을 건드리지 않는다 — 사용자에게 알린다)
const githubStamps = (backupAbs) => {
  let names;
  try {
    names = fs.readdirSync(backupAbs);
  } catch {
    return [];
  }
  // 목록의 github 칸은 실제로 바꾼 것이 있을 때만 생긴다(github-settings.mjs applyGithub 의 record)
  return names.sort().filter((s) => {
    const g = parse(readFile(path.join(backupAbs, s, 'manifest.json')))?.github;
    return !!g && typeof g === 'object';
  });
};

// → { removed, trimmed?, claudeMdLines?, kept: [{ path, reason }], manual, dryRun? }
// claudeMdLines: CLAUDE.md 에서 빼는 관리 구역 줄 수(표시 줄 포함 — 미리보기에서 크기를 보이려고)
// kept 의 reason: edited · unverifiable(지문 없는 옛 스킬) · link(연결 — 따라가지 않음) · settings-broken
//   · not-ours(표시가 없거나 글이 우리 것 그대로가 아님, 스킬은 폴더 이름이 받은 id 가 아님)
//   · markers(CLAUDE.md 관리 구역 표시가 짝이 안 맞음 — 시작이 둘·끝이 없음·끝이 먼저. 어디까지가 우리 글인지 몰라 손대지 않는다)
export const removeAll = (root, { dryRun = false, force = false, home } = {}) => {
  const out = { removed: [], trimmed: [], kept: [], manual: [] };
  const ops = [];
  const keep = (rel, reason) => { if (!out.kept.some((k) => k.path === rel)) out.kept.push({ path: rel, reason }); };
  const drop = (rel, abs) => {
    out.removed.push(rel);
    ops.push(() => fs.rmSync(abs, { recursive: true, force: true }));
  };
  // 넣은 부분만 뺀 글. 남은 것이 없으면 파일을 지운다
  const rewrite = (rel, abs, text) => {
    if (!text.trim()) return drop(rel, abs);
    out.trimmed.push(rel);
    ops.push(() => fs.writeFileSync(abs, text));
  };
  // 프로젝트 안의 파일 하나 → { abs, text } · 없으면 null · 연결이면 kept(link) 로 알리고 null
  const fileAt = (rel) => {
    const at = within(root, rel);
    if (!at) {
      // 가는 길이 연결이다. 그 자리에 무엇이 있는지만 보고(읽기만) 있으면 알린다
      if (fs.existsSync(path.join(root, rel))) keep(rel, 'link');
      return null;
    }
    if (!at.st) return null;
    if (isLink(at.st)) return keep(rel, 'link'), null;
    if (!at.st.isFile()) return null;
    return { abs: at.abs, text: readFile(at.abs) };
  };

  const cfg = fileAt('.claude/harness.json');
  if (cfg) drop('.claude/harness.json', cfg.abs);
  // .gitignore 줄을 누가 넣었나(plan.mjs gitignoreOwner). 'existing' 이면 사용자 줄이라 둔다. 기록이 없으면(v0.4.1 까지 적용) 알 수 없어 뺀다
  const giOwner = cfg ? parse(cfg.text)?.gitignore : undefined;

  const md = fileAt('CLAUDE.md');
  if (md?.text && blockBroken(md.text)) keep('CLAUDE.md', 'markers');
  else if (md?.text && extractBlock(md.text)) {
    out.claudeMdLines = blockLineCount(md.text);
    rewrite('CLAUDE.md', md.abs, setBlock(md.text, ''));
  }

  const skills = ownedSkills(root);
  if (skills === null) keep('.claude/skills', 'link');
  for (const s of skills || []) {
    const rel = `.claude/skills/${s.id}`;
    if (s.state === 'clean' || (force && (s.state === 'edited' || s.state === 'unverifiable'))) drop(rel, s.abs);
    else keep(rel, s.state);
  }

  // git 훅: 우리 실행기 그대로인 것만(표시만 있거나 줄을 덧붙인 훅은 남의 것 — 지우면 팀의 커밋 검사가 멈출 수 있다)
  for (const rel of [HOOK, LEGACY]) {
    const f = fileAt(rel);
    if (!f) continue;
    if (isOurLauncher(f.text)) drop(rel, f.abs);
    else if (rel === HOOK && (f.text || '').includes(MARKER)) keep(rel, 'not-ours');
  }
  // 사용자 훅(core.hooksPath·Husky·남의 .git/hooks/pre-commit)에 이어 붙인 harness-fit 줄 — 남의 파일이라 알리기만
  const hookFiles = new Set([HUSKY_HOOK]);
  const { state, file } = gitHookState(root);
  if (file && (state === 'hooks-path' || state === 'other')) {
    const r = path.relative(root, file);
    if (r && !r.startsWith('..') && !path.isAbsolute(r)) hookFiles.add(posix(r));
  }
  for (const rel of hookFiles) {
    const f = rel === HOOK && out.removed.includes(HOOK) ? null : fileAt(rel);
    if (f?.text && !f.text.includes(MARKER) && CHAINED.test(f.text)) out.manual.push({ kind: 'git-hook-line', file: rel });
  }

  const runner = fileAt(PRE_COMMIT_RUNNER);
  if (runner) (runner.text || '').includes(MARKER) ? drop(PRE_COMMIT_RUNNER, runner.abs) : keep(PRE_COMMIT_RUNNER, 'not-ours');
  const request = fileAt('.claude/harness-request.md');
  if (request) drop('.claude/harness-request.md', request.abs);

  // 팀원 공유 칸(plan.mjs buildSettings 가 더한 두 칸)만 뺀다 — 되돌리기와 같은 함수(backup.mjs withoutShare, 적용 전 값 없음)
  const src = readPluginJson('config/sources.json');
  const st = fileAt('.claude/settings.json');
  if (st?.text) {
    const cur = parse(st.text);
    if (cur === undefined || !cur || typeof cur !== 'object' || Array.isArray(cur)) {
      if (st.text.includes(src.pluginId) || st.text.includes(src.marketplace)) keep('.claude/settings.json', 'settings-broken');
    } else {
      // 우리가 적는 값만 뺀다(enabledPlugins 는 true 일 때만 — withoutShare). 들여쓰기·BOM·CRLF 는 원래 파일 그대로
      const next = withoutShare(st.text, null);
      if (next !== null && next !== st.text) {
        rewrite('.claude/settings.json', st.abs, next);
        out.manual.push({ kind: 'teammates', file: '.claude/settings.json' });
      }
    }
  }

  // 백업 폴더: 진짜 폴더면 맨 끝에 지운다. 연결이면 남기고 — 남는 동안은 .gitignore 줄도 남긴다(빼면 백업이 커밋될 수 있다)
  const bk = within(root, BACKUP_DIR);
  // (가는 길 .claude 가 연결이어도 그 안의 백업 폴더는 남는다)
  const bkKept = bk ? isLink(bk.st) : fs.existsSync(path.join(root, BACKUP_DIR));
  if (bkKept) keep(posix(BACKUP_DIR), 'link');
  const gi = fileAt('.gitignore');
  if (!bkKept && giOwner !== 'existing' && gi?.text &&gi.text.split(/\r?\n/).some((l) => l.trim() === GITIGNORE_LINE)) rewrite('.gitignore', gi.abs, withoutLine(gi.text, GITIGNORE_LINE));

  // pre-commit 설정에 붙여 넣은 항목(id: harness-fit) — 남의 파일이라 고치지 않는다
  if (PRE_COMMIT_ENTRY.test(fileAt(PRE_COMMIT_CONFIG)?.text || '')) out.manual.push({ kind: 'pre-commit-entry', file: PRE_COMMIT_CONFIG });

  // 백업 폴더는 맨 끝에(앞의 것을 지우다 멈춰도 되돌리기가 남게)
  if (!bkKept && bk?.st?.isDirectory()) {
    const stamps = githubStamps(bk.abs);
    if (stamps.length) out.manual.push({ kind: 'github', stamps });
    drop(posix(BACKUP_DIR), bk.abs);
  }
  out.manual.push(pluginStep(root, src.pluginId, home));

  if (!dryRun) {
    for (const op of ops) op();
    // 적용하면서 생긴 빈 폴더도 치운다(안쪽부터, 연결이 아닌 진짜 폴더만)
    for (const rel of ['.claude/skills', '.claude']) {
      const at = within(root, rel);
      if (!at?.st?.isDirectory() || isLink(at.st)) continue;
      try {
        if (!fs.readdirSync(at.abs).length) fs.rmdirSync(at.abs);
      } catch {}
    }
  }
  if (!out.trimmed.length) delete out.trimmed;
  return dryRun ? { dryRun: true, ...out } : out;
};
