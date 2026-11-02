// 고른 결과를 프로젝트에 적용한다. 적용 전에 바뀔 파일을 백업하고, 되돌리기를 제공한다.
// 사용:
//   node scripts/apply.mjs <프로젝트> --selection <파일>  [--dry-run]   적용(또는 바뀔 파일만 보기)
//   node scripts/apply.mjs <프로젝트> --undo                             마지막 적용 되돌리기
// 결과는 JSON 한 덩어리로 내보낸다(Claude 가 짧게 읽고 보고하도록).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadAll } from './lib/catalog.mjs';
import { installSkill } from './lib/install-skill.mjs';
import { buildClaudeMd, ruleTexts } from './lib/claude-md.mjs';

export { buildClaudeMd, ruleTexts };

const BACKUP_DIR = path.join('.claude', 'fys-backup');
const GITIGNORE_LINE = '.claude/fys-backup/';
export const UNDO_COMMAND = '/find-your-skill:start undo';

const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);
const rel = (root, p) => path.relative(root, p).split(path.sep).join('/');

// 훅 설정: 고른 훅을 켜고, Git 전략에 딸린 옵션을 얹는다.
export const buildConfig = (all, sel) => {
  const flow = all.packs.flows.find((f) => f.id === sel.flow) || { hooks: {} };
  const rules = {};
  for (const id of sel.hooks) rules[id] = flow.hooks[id] ? { ...flow.hooks[id] } : true;
  return { lang: sel.lang, combo: sel.combo, flow: sel.flow, rules, skills: sel.skills };
};

// 팀원도 같은 플러그인을 쓰게: 프로젝트 .claude/settings.json 에 마켓과 플러그인을 적는다.
// 팀원이 이 저장소를 열면 Claude Code 가 설치를 권한다. 기존 설정은 그대로 두고 두 항목만 더한다.
// 파일이 깨져 있으면(손으로 고치다 만 경우) 건드리지 않고 null.
export const buildSettings = (current, src) => {
  let cfg = {};
  if (current) {
    try {
      cfg = JSON.parse(current);
    } catch {
      return null;
    }
  }
  const next = {
    ...cfg,
    extraKnownMarketplaces: { ...(cfg.extraKnownMarketplaces || {}), [src.marketplace]: { source: { source: 'github', repo: src.pluginRepo, ref: src.pluginRef } } },
    enabledPlugins: { ...(cfg.enabledPlugins || {}), [src.pluginId]: true },
  };
  const text = JSON.stringify(next, null, 2) + '\n';
  return text === current ? null : text;
};

// 요청 칸에 쓴 내용은 파일로도 남긴다(Claude 가 이어받지 못해도 사라지지 않게).
export const requestFile = (note, date) =>
  `# 적용할 때 남긴 요청 / Requests left at setup\n\n> ${date} · find-your-skill. Claude 가 반영한 뒤 지워도 됩니다.\n\n${note.trim()}\n`;

// 바뀔 것 목록. kind 는 화면에서 무엇인지 설명하는 데 쓴다.
export const plan = (root, sel, all = loadAll()) => {
  const changes = [];
  const add = (p, kind, content) => changes.push({ path: p, kind, action: fs.existsSync(p) ? 'change' : 'create', content });

  add(path.join(root, '.claude', 'fys.json'), 'config', JSON.stringify(buildConfig(all, sel), null, 2) + '\n');
  const mdPath = path.join(root, 'CLAUDE.md');
  const md = read(mdPath);
  const nextMd = buildClaudeMd(md, sel);
  if (nextMd !== md && nextMd !== undefined) add(mdPath, 'claude-md', nextMd);
  if (sel.share) {
    const stPath = path.join(root, '.claude', 'settings.json');
    const next = buildSettings(read(stPath), all.sources);
    if (next) add(stPath, 'share', next);
  }
  if (sel.note?.trim()) add(path.join(root, '.claude', 'fys-request.md'), 'request', requestFile(sel.note, new Date().toISOString().slice(0, 10)));
  const gi = path.join(root, '.gitignore');
  const giText = read(gi);
  if (!giText || !giText.split(/\r?\n/).includes(GITIGNORE_LINE)) add(gi, 'gitignore', `${giText ? giText.replace(/\s*$/, '\n') : ''}${GITIGNORE_LINE}\n`);

  const skills = sel.skills.map((id) => all.catalog.skills.find((s) => s.id === id)).filter(Boolean);
  for (const s of skills.filter((k) => k.install === 'copy')) {
    add(path.join(root, '.claude', 'skills', s.id), 'skill');
    changes.at(-1).skill = s.id;
  }
  const manual = skills.filter((s) => s.install === 'plugin').map((s) => {
    const repo = all.catalog.repos.find((r) => r.repo === s.repo);
    return { skill: s.id, repo: s.repo, how: repo?.install || `claude plugin marketplace add ${s.repo}` };
  });
  return { changes, manual };
};

const backupAndManifest = (root, changes) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(root, BACKUP_DIR, stamp);
  fs.mkdirSync(dir, { recursive: true });
  const manifest = { stamp, created: [], backedUp: [] };
  for (const c of changes) {
    const r = path.relative(root, c.path);
    if (c.action === 'create') manifest.created.push(r);
    else {
      fs.cpSync(c.path, path.join(dir, 'files', r), { recursive: true });
      manifest.backedUp.push(r);
    }
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
};

// onProgress({ done, total, current }) — 스킬을 받는 동안 화면에 진행을 보여 주려고.
export const apply = async (root, sel, onProgress = () => {}) => {
  const all = loadAll();
  const { changes, manual } = plan(root, sel, all);
  const manifest = backupAndManifest(root, changes);
  const failed = [];
  const skills = changes.filter((c) => c.skill);
  let done = 0;
  for (const c of changes.filter((x) => !x.skill)) {
    fs.mkdirSync(path.dirname(c.path), { recursive: true });
    fs.writeFileSync(c.path, c.content);
  }
  for (const c of skills) {
    onProgress({ done, total: skills.length, current: c.skill });
    const skill = all.catalog.skills.find((s) => s.id === c.skill);
    const repo = all.catalog.repos.find((r) => r.repo === skill.repo);
    try {
      await installSkill({ sources: all.sources, skill, repo, dest: c.path });
    } catch (e) {
      failed.push({ skill: c.skill, error: String(e.message || e) });
    }
    done += 1;
  }
  onProgress({ done, total: skills.length, current: null });
  return {
    stamp: manifest.stamp,
    changed: changes.map((c) => `${c.action === 'create' ? '+' : '~'} ${rel(root, c.path)}`),
    manual,
    failed,
    undo: UNDO_COMMAND,
  };
};

export const undo = (root) => {
  const base = path.join(root, BACKUP_DIR);
  const stamps = fs.existsSync(base) ? fs.readdirSync(base).sort() : [];
  if (!stamps.length) return { error: 'no-backup' };
  const dir = path.join(base, stamps.at(-1));
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  for (const r of manifest.created) fs.rmSync(path.join(root, r), { recursive: true, force: true });
  for (const r of manifest.backedUp) {
    const target = path.join(root, r);
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(path.join(dir, 'files', r), target, { recursive: true });
  }
  fs.rmSync(dir, { recursive: true, force: true });
  // 적용하면서 생긴 빈 폴더도 치운다(안쪽부터).
  for (const d of [base, path.join(root, '.claude', 'skills'), path.join(root, '.claude')]) {
    try {
      if (!fs.readdirSync(d).length) fs.rmdirSync(d);
    } catch {}
  }
  const posix = (list) => list.map((p) => p.split(path.sep).join('/'));
  return { undone: manifest.stamp, removed: posix(manifest.created), restored: posix(manifest.backedUp) };
};

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const root = path.resolve(args[0] || '.');
  const out = (o) => process.stdout.write(JSON.stringify(o, null, 2) + '\n');
  if (args.includes('--undo')) out(undo(root));
  else {
    const sel = JSON.parse(fs.readFileSync(args[args.indexOf('--selection') + 1], 'utf8'));
    if (args.includes('--dry-run')) {
      const { changes, manual } = plan(root, sel);
      out({ changes: changes.map((c) => `${c.action === 'create' ? '+' : '~'} ${rel(root, c.path)}`), manual });
    } else apply(root, sel).then(out);
  }
}
