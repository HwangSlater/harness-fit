// 고른 결과를 프로젝트에 적용한다. 적용 전에 바뀔 파일을 백업하고, 되돌리기를 제공한다.
// 사용:
//   node scripts/apply.mjs <프로젝트> --selection <파일>  [--dry-run]   적용(또는 바뀔 파일만 보기)
//   node scripts/apply.mjs <프로젝트> --undo                             마지막 적용 되돌리기
//   node scripts/apply.mjs <프로젝트> --retry <스킬id,…>                 받지 못한 스킬만 다시 받기
// 결과는 JSON 한 덩어리로 내보낸다(Claude 가 짧게 읽고 보고하도록).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadAll, labelsFor, PLUGIN_ROOT } from './lib/catalog.mjs';
import { installSkill } from './lib/install-skill.mjs';
import { buildClaudeMd, ruleTexts } from './lib/claude-md.mjs';
import { GITIGNORE_LINE, UNDO_COMMAND, backup, recordWritten, addEntries, latestBackup, undo } from './lib/backup.mjs';
import { cleanSelection } from './lib/picker-state.mjs';

export { buildClaudeMd, ruleTexts, UNDO_COMMAND };

const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);
const rel = (root, p) => path.relative(root, p).split(path.sep).join('/');

// 훅 설정: 고른 훅을 켜고, Git 전략에 딸린 옵션을 얹는다.
// 다시 적용할 때 사용자가 따로 넣어 둔 옵션(예: commit-msg 의 lang)은 남긴다. Git 전략이 정하는 키만 새 값으로 바꾼다.
export const buildConfig = (all, sel, previous = null) => {
  const flow = all.packs.flows.find((f) => f.id === sel.flow) || { hooks: {} };
  const owned = new Set(all.packs.flows.flatMap((f) => Object.values(f.hooks || {}).flatMap((o) => Object.keys(o))));
  const rules = {};
  for (const id of sel.hooks) {
    const kept = Object.fromEntries(Object.entries(typeof previous?.rules?.[id] === 'object' ? previous.rules[id] : {}).filter(([k]) => !owned.has(k)));
    const opts = { ...kept, ...(flow.hooks[id] || {}) };
    rules[id] = Object.keys(opts).length ? opts : true;
  }
  return { lang: sel.lang, combo: sel.combo, flow: sel.flow, rules, skills: sel.skills };
};
const readJson = (f) => {
  try {
    return JSON.parse(read(f));
  } catch {
    return null;
  }
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
  `# 적용할 때 남긴 요청 / Requests left at setup\n\n> ${date} · harness-fit. Claude 가 반영한 뒤 지워도 됩니다.\n\n${note.trim()}\n`;

// 바뀔 것 목록. kind 는 화면에서 무엇인지 설명하는 데 쓴다.
export const plan = (root, sel, all = loadAll()) => {
  const changes = [];
  const add = (p, kind, content) => changes.push({ path: p, kind, action: fs.existsSync(p) ? 'change' : 'create', content });

  const cfgPath = path.join(root, '.claude', 'harness.json');
  add(cfgPath, 'config', JSON.stringify(buildConfig(all, sel, readJson(cfgPath)), null, 2) + '\n');
  const mdPath = path.join(root, 'CLAUDE.md');
  const md = read(mdPath);
  const nextMd = buildClaudeMd(md, sel);
  if (nextMd !== md && nextMd !== undefined) add(mdPath, 'claude-md', nextMd);
  if (sel.share) {
    const stPath = path.join(root, '.claude', 'settings.json');
    const next = buildSettings(read(stPath), all.sources);
    if (next) add(stPath, 'share', next);
  }
  if (sel.note?.trim()) add(path.join(root, '.claude', 'harness-request.md'), 'request', requestFile(sel.note, new Date().toISOString().slice(0, 10)));
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

// 스킬들을 차례로 받는다. 받지 못한 것은 failed 로 돌려준다(나머지는 계속 받는다).
const installAll = async (all, items, onProgress) => {
  const failed = [];
  let done = 0;
  for (const c of items) {
    onProgress({ done, total: items.length, current: c.skill });
    const skill = all.catalog.skills.find((s) => s.id === c.skill);
    const repo = all.catalog.repos.find((r) => r.repo === skill.repo);
    try {
      await installSkill({ sources: all.sources, skill, repo, dest: c.path });
    } catch (e) {
      failed.push({ skill: c.skill, error: String(e.message || e) });
    }
    done += 1;
  }
  onProgress({ done, total: items.length, current: null });
  return failed;
};

const lineOf = (root, c) => `${c.action === 'create' ? '+' : '~'} ${rel(root, c.path)}`;

// onProgress({ done, total, current }) — 스킬을 받는 동안 화면에 진행을 보여 주려고.
export const apply = async (root, sel, onProgress = () => {}) => {
  const all = loadAll();
  const { changes, manual } = plan(root, sel, all);
  const saved = backup(root, changes);
  try {
    for (const c of changes.filter((x) => !x.skill)) {
      fs.mkdirSync(path.dirname(c.path), { recursive: true });
      fs.writeFileSync(c.path, c.content);
    }
  } catch (e) {
    // 파일을 쓰다 실패하면(읽기 전용 등) 바로 되돌린다. 반쯤 바뀐 상태에서 다시 적용하면 그 상태가 「원래」로 백업되기 때문.
    undo(root);
    throw e;
  }
  const failed = await installAll(all, changes.filter((c) => c.skill), onProgress);
  // 받지 못한 스킬은 「들어갔다」고 말하지 않는다(파일 목록·종류별 이름 모두).
  const missed = new Set(failed.map((f) => f.skill));
  const installed = changes.filter((c) => c.skill && !missed.has(c.skill)).map((c) => c.skill);
  recordWritten(saved, root, new Set(changes.filter((c) => !missed.has(c.skill)).map((c) => rel(root, c.path))));
  return {
    stamp: saved.manifest.stamp,
    changed: changes.filter((c) => !missed.has(c.skill)).map((c) => lineOf(root, c)),
    // 보고할 때 무엇이 스킬·훅·CLAUDE.md 규칙으로 들어갔는지 나눠 말하려고(SKILL.md). skills 는 실제로 받은 것만.
    labels: labelsFor(all, { ...sel, skills: installed }, sel.lang),
    manual,
    failed,
    undo: UNDO_COMMAND,
  };
};

// 받지 못했던 스킬만 다시 받는다. 새 백업을 만들지 않고 마지막 백업에 더한다(되돌리기는 여전히 처음 상태로).
export const retry = async (root, ids) => {
  const all = loadAll();
  const found = latestBackup(root);
  if (!found) return { error: 'no-backup' };
  const known = new Set(all.catalog.skills.filter((s) => s.install === 'copy').map((s) => s.id));
  const items = ids.filter((id) => known.has(id)).map((id) => ({ skill: id, path: path.join(root, '.claude', 'skills', id), action: fs.existsSync(path.join(root, '.claude', 'skills', id)) ? 'change' : 'create' }));
  // 이미 있는 폴더는 백업 목록에 없으면 덮어쓰지 않는다(사용자가 따로 둔 스킬일 수 있다).
  const listed = new Set(found.manifest.entries.map((e) => e.path));
  const safe = items.filter((c) => c.action === 'create' || listed.has(rel(root, c.path)));
  const failed = await installAll(all, safe, () => {});
  const missed = new Set(failed.map((f) => f.skill));
  const done = safe.filter((c) => !missed.has(c.skill));
  addEntries(found, root, done.filter((c) => !listed.has(rel(root, c.path))).map((c) => ({ path: rel(root, c.path), kind: 'skill', action: 'create' })));
  // 처음 적용 때 목록에 올랐지만 받지 못했던 스킬은 지문이 비어 있다. 지금 받은 것으로 채워야 그 뒤 고친 것을 되돌리기가 알아본다.
  recordWritten(found, root, new Set(done.filter((c) => listed.has(rel(root, c.path))).map((c) => rel(root, c.path))));
  return { installed: done.map((c) => c.skill), failed, skipped: items.filter((c) => !safe.includes(c)).map((c) => c.skill) };
};

export { undo };

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const root = path.resolve(args[0] || '.');
  const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
  const out = (o) => process.stdout.write(JSON.stringify(o, null, 2) + '\n');
  if (args.includes('--undo')) out(undo(root));
  else if (value('--retry')) retry(root, value('--retry').split(',').map((s) => s.trim())).then(out);
  else if (!value('--selection')) {
    out({ error: 'usage: apply.mjs <project> --selection <file> | --undo | --retry <id,…>' });
    process.exitCode = 1;
  } else {
    // 화면을 거치지 않은 선택(auto)도 화면과 같은 검사를 거친다(카탈로그에 있는 id 만, 빠진 칸은 기본값).
    const all = loadAll();
    const cfg = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'config', 'picker.json'), 'utf8'));
    const raw = JSON.parse(fs.readFileSync(value('--selection'), 'utf8'));
    const sel = cleanSelection({ all, cfg }, raw, raw.lang || 'en');
    if (args.includes('--dry-run')) {
      const { changes, manual } = plan(root, sel, all);
      out({ changes: changes.map((c) => lineOf(root, c)), manual });
    } else apply(root, sel).then(out);
  }
}
