// 고른 결과를 프로젝트에 적용한다. 적용 전에 바뀔 파일을 백업하고, 되돌리기를 제공한다.
// 사용:
//   node scripts/apply.mjs <프로젝트> --selection <파일>  [--dry-run]   적용(또는 바뀔 파일만 보기)
//   node scripts/apply.mjs <프로젝트> --undo                             마지막 적용 되돌리기
//   node scripts/apply.mjs <프로젝트> --retry <스킬id,…>                 받지 못한 스킬만 다시 받기
// 결과는 JSON 한 덩어리로 내보낸다(Claude 가 짧게 읽고 보고하도록).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadAll, labelsFor, catalogIds, PLUGIN_ROOT } from './lib/catalog.mjs';
import { installSkill } from './lib/install-skill.mjs';
import { buildClaudeMd, ruleTexts } from './lib/claude-md.mjs';
import { GITIGNORE_LINE, UNDO_COMMAND, backup, recordWritten, addEntries, latestBackup, undo, recordGithub } from './lib/backup.mjs';
import { applyGithub, undoWithGithub, previewGithub } from './lib/github-settings.mjs';
import { parseItemList } from '../picker/github-plan.js';
import { cleanSelection } from './lib/picker-state.mjs';
import { pluginActive } from './lib/installed.mjs';
import { detectCommands } from './lib/commands.mjs';
import { spawnSync } from 'node:child_process';
import { COMMIT_HOOK_IDS, gitHookState, launcherText, chainCommand, PLUGIN_DIR } from '../hooks/lib/git-hook.mjs';

// git 이 이 경로를 무시하는지(.gitignore 에 .claude/ 가 있으면 팀원에게 설정이 가지 않는다)
const gitIgnores = (root, rel) => spawnSync('git', ['-C', root, 'check-ignore', '-q', rel], { stdio: 'ignore' }).status === 0;
const parses = (text) => { try { JSON.parse(text); return true; } catch { return false; } };

export { buildClaudeMd, ruleTexts, UNDO_COMMAND };

// git pre-commit 훅(커밋 때 실제 색인을 다시 보기). 커밋 때 다시 보는 쓰기 훅을 하나라도 켰고 플러그인이 있을 때만.
// 남의 훅·core.hooksPath 가 있거나 훅 폴더가 밖이면 넣지 않고 알린다(덮어쓰지 않는다). 우리 훅이 있으면 새 내용으로 다시 쓴다.
const HOOK_MODE = 0o755;
const HOOK_WARNING = { other: 'git-hook-exists', 'hooks-path': 'git-hook-exists', elsewhere: 'git-hook-elsewhere' };
export const gitHookPlan = (root, sel, active) => {
  if (!active || !sel.hooks.some((id) => COMMIT_HOOK_IDS.includes(id))) return {};
  const { state, file } = gitHookState(root);
  if (HOOK_WARNING[state]) return { warning: HOOK_WARNING[state] };
  if (state !== 'none' && state !== 'ours') return {};
  const content = launcherText(PLUGIN_DIR);
  return read(file) === content ? {} : { file, content };
};

const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);
const rel = (root, p) => path.relative(root, p).split(path.sep).join('/');

// 훅 설정: 고른 훅을 켜고, Git 전략에 딸린 옵션을 얹는다.
// 다시 적용할 때 사용자가 따로 넣어 둔 옵션(예: commit-msg 의 lang)은 남긴다. Git 전략이 정하는 키만 새 값으로 바꾼다.
// 화면에서 고친 옵션(sel.hookOpts)은 둘 다보다 앞선다.
// 훅(run.mjs)은 lang·rules 만 읽는다. selection·known 은 다음에 고르기 화면을 열 때 지난번 선택에서 시작하려고 남긴다
// (켠 훅과 옵션은 rules 가 정본이라 selection 에 따로 적지 않는다 — 손으로 rules 를 고쳐도 화면이 그대로 따른다).
// 날짜는 사용자 PC 시간대로(UTC 로 적으면 한국 오전에는 전날로 보인다)
const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const buildConfig = (all, sel, previous = null, date = today()) => {
  const flow = all.packs.flows.find((f) => f.id === sel.flow) || { hooks: {} };
  const owned = new Set(all.packs.flows.flatMap((f) => Object.values(f.hooks || {}).flatMap((o) => Object.keys(o))));
  const rules = {};
  for (const id of sel.hooks) {
    const kept = Object.fromEntries(Object.entries(typeof previous?.rules?.[id] === 'object' ? previous.rules[id] : {}).filter(([k]) => !owned.has(k)));
    // 화면에서 사용자가 고른 옵션(sel.hookOpts, picker/hook-options.js 로 검사한 값)이 가장 앞선다
    const opts = { ...kept, ...(flow.hooks[id] || {}), ...(sel.hookOpts?.[id] || {}) };
    rules[id] = Object.keys(opts).length ? opts : true;
  }
  return {
    lang: sel.lang,
    rules,
    selection: { combo: sel.combo, flow: sel.flow, skills: sel.skills, rules: sel.rules, share: sel.share === true, at: date },
    known: catalogIds(all),
  };
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
  `# 적용할 때 남긴 요청 / Requests left at setup\n\n> ${date} · harness-fit. Claude 가 반영한 뒤 지워도 돼요.\n\n${note.trim()}\n`;

// 바뀔 것 목록. kind 는 화면에서 무엇인지 설명하는 데 쓴다.
// warnings: 적용은 되지만 화면이 약속한 대로 동작하지 않을 것(화면·보고에 알린다).
//   plugin-missing  플러그인이 없어 훅이 돌지 않는다 → CLAUDE.md 는 「훅 꺼짐」 글로 쓴다(글도 검사도 없는 상태를 막으려고)
//   claude-ignored  .claude/ 를 git 이 무시해 팀원에게 설정이 가지 않는다
//   settings-broken .claude/settings.json 이 깨져 팀원 공유를 적지 못했다
//   git-hook-exists   남의 pre-commit 훅이나 core.hooksPath(husky·pre-commit·lefthook)가 있어 git 훅을 넣지 않았다
//   git-hook-elsewhere 훅 폴더가 프로젝트 밖이라(git worktree·submodule) git 훅을 넣지 않았다
//   — 둘 다 커밋 검사는 Claude Code 안(PreToolUse)에서 계속 돌고, gitHookCmd 를 그 훅에 이어 붙이면 git 훅으로도 돈다.
// skipped: 같은 이름의 폴더가 이미 있고 harness-fit 이 넣은 것이 아니라 건드리지 않은 스킬(retry 와 같은 규칙)
export const plan = (root, sel, all = loadAll(), { active = pluginActive(root) } = {}) => {
  const changes = [];
  const warnings = [];
  const add = (p, kind, content) => changes.push({ path: p, kind, action: fs.existsSync(p) ? 'change' : 'create', content });

  const cfgPath = path.join(root, '.claude', 'harness.json');
  add(cfgPath, 'config', JSON.stringify(buildConfig(all, sel, readJson(cfgPath)), null, 2) + '\n');
  if (!active) warnings.push('plugin-missing');
  const mdPath = path.join(root, 'CLAUDE.md');
  const md = read(mdPath);
  const nextMd = buildClaudeMd(md, active ? sel : { ...sel, hooks: [] });
  if (nextMd !== md && nextMd !== undefined) add(mdPath, 'claude-md', nextMd);
  if (sel.share) {
    const stPath = path.join(root, '.claude', 'settings.json');
    const current = read(stPath);
    const next = buildSettings(current, all.sources);
    if (next) add(stPath, 'share', next);
    else if (current && !parses(current)) warnings.push('settings-broken');
    if (gitIgnores(root, '.claude/harness.json')) warnings.push('claude-ignored');
  }
  if (sel.note?.trim()) add(path.join(root, '.claude', 'harness-request.md'), 'request', requestFile(sel.note, new Date().toISOString().slice(0, 10)));
  const gi = path.join(root, '.gitignore');
  const giText = read(gi);
  if (!giText || !giText.split(/\r?\n/).includes(GITIGNORE_LINE)) add(gi, 'gitignore', `${giText ? giText.replace(/\s*$/, '\n') : ''}${GITIGNORE_LINE}\n`);
  const hook = gitHookPlan(root, sel, active);
  if (hook.content) {
    add(hook.file, 'git-hook', hook.content);
    changes.at(-1).mode = HOOK_MODE;
  }
  if (hook.warning) warnings.push(hook.warning);

  const skills = sel.skills.map((id) => all.catalog.skills.find((s) => s.id === id)).filter(Boolean);
  const skipped = [];
  for (const s of skills.filter((k) => k.install === 'copy')) {
    const dir = path.join(root, '.claude', 'skills', s.id);
    // 사용자가 따로 둔 같은 이름의 스킬은 덮어쓰지 않는다(harness-fit 이 넣은 폴더에는 .harness-source.json 이 있다)
    if (fs.existsSync(dir) && !fs.existsSync(path.join(dir, '.harness-source.json'))) { skipped.push(s.id); continue; }
    add(dir, 'skill');
    changes.at(-1).skill = s.id;
  }
  const manual = skills.filter((s) => s.install === 'plugin').map((s) => {
    const repo = all.catalog.repos.find((r) => r.repo === s.repo);
    return { skill: s.id, repo: s.repo, how: repo?.install || `claude plugin marketplace add ${s.repo}` };
  });
  return { changes, manual, warnings, skipped, ...(hook.warning ? { gitHookCmd: chainCommand(PLUGIN_DIR) } : {}) };
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
// gh: GitHub 설정에 쓸 실행기(시험이 가짜를 넣는다). sel.github 가 true 일 때만 GitHub 을 건드린다.
export const apply = async (root, sel, onProgress = () => {}, { gh } = {}) => {
  const all = loadAll();
  const { changes, manual, warnings, skipped, gitHookCmd } = plan(root, sel, all);
  const saved = backup(root, changes);
  try {
    for (const c of changes.filter((x) => !x.skill)) {
      fs.mkdirSync(path.dirname(c.path), { recursive: true });
      fs.writeFileSync(c.path, c.content);
      if (c.mode) fs.chmodSync(c.path, c.mode); // git 훅은 실행 권한이 있어야 돈다(Windows 밖)
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
  // GitHub 저장소 설정은 파일을 다 쓴 뒤에. 바꾼 것의 이전 값은 같은 백업 목록에 남아 --undo 가 되돌린다.
  const spec = all.packs.flows.find((f) => f.id === sel.flow)?.github;
  const github = sel.github ? await applyGithub(root, spec, { ...(gh ? { run: gh } : {}), record: (d) => recordGithub(saved, d), choice: sel.githubChoice }) : undefined;
  return {
    stamp: saved.manifest.stamp,
    changed: changes.filter((c) => !missed.has(c.skill)).map((c) => lineOf(root, c)),
    // 보고할 때 무엇이 스킬·훅·CLAUDE.md 규칙으로 들어갔는지 나눠 말하려고(SKILL.md). skills 는 실제로 받은 것만.
    labels: labelsFor(all, { ...sel, skills: installed }, sel.lang),
    manual,
    failed,
    warnings,
    skipped,
    gitHookCmd,
    undo: UNDO_COMMAND,
    ...(github ? { github } : {}),
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
  if (args.includes('--undo')) undoWithGithub(root).then(out);
  else if (value('--retry')) retry(root, value('--retry').split(',').map((s) => s.trim())).then(out);
  else if (!value('--selection')) {
    out({ error: 'usage: apply.mjs <project> --selection <file> | --undo | --retry <id,…>' });
    process.exitCode = 1;
  } else {
    // 화면을 거치지 않은 선택(auto)도 화면과 같은 검사를 거친다(카탈로그에 있는 id 만, 빠진 칸은 기본값).
    const all = loadAll();
    const cfg = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'config', 'picker.json'), 'utf8'));
    const raw = JSON.parse(fs.readFileSync(value('--selection'), 'utf8'));
    // GitHub 저장소 설정은 명령줄 --github-settings=<항목,…> 으로 사용자가 고른 항목만(선택 파일의 github 칸은 무시 — 물어본 뒤에만 붙인다).
    // 항목 없이 --github-settings 만 주면 미리보기(--dry-run)에만 쓰이고, 적용에서는 아무것도 바꾸지 않는다(no-items).
    const ghArg = args.find((a) => a === '--github-settings' || a.startsWith('--github-settings='));
    const withGithub = !!ghArg;
    const listed = ghArg?.includes('=') ? parseItemList(ghArg.slice(ghArg.indexOf('=') + 1)) : null;
    const sel = { ...cleanSelection({ all, cfg, det: { commands: detectCommands(root).commands } }, raw, raw.lang || 'en'), github: withGithub, githubChoice: listed };
    const spec = all.packs.flows.find((f) => f.id === sel.flow)?.github;
    if (args.includes('--dry-run')) {
      const { changes, manual, warnings, gitHookCmd } = plan(root, sel, all);
      // --dry-run --github-settings: 읽기만 해서(GET) 무엇이 바뀔지 보여 준다. 묻기 전에 Claude 가 이것으로 목록을 만든다.
      (withGithub ? previewGithub(root, spec) : Promise.resolve(undefined)).then((github) => out({ changes: changes.map((c) => lineOf(root, c)), manual, warnings, gitHookCmd, ...(github ? { github } : {}) }));
    } else apply(root, sel).then(out);
  }
}
