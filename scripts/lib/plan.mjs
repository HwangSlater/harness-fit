// 적용 계획: 고른 것 → 바뀔 파일 목록과 내용(쓰지는 않는다). 적용(apply-run.mjs)·미리보기(picker.mjs)·--dry-run 이 같은 계획을 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadAll, catalogIds } from './catalog.mjs';
import { buildClaudeMd } from './claude-md.mjs';
import { GITIGNORE_LINE } from './backup.mjs';
import { pluginActive } from './installed.mjs';
import { currentListing, planBudget } from './skill-budget.mjs';
import { COMMIT_HOOK_IDS, gitHookState, launcherText, chainCommand, PLUGIN_DIR } from '../../hooks/lib/git-hook.mjs';
import { localDate } from '../../hooks/lib/dates.mjs';
import { readJson } from './paths.mjs';

// git 이 이 경로를 무시하는지(.gitignore 에 .claude/ 가 있으면 팀원에게 설정이 가지 않는다)
const gitIgnores = (root, rel) => spawnSync('git', ['-C', root, 'check-ignore', '-q', rel], { stdio: 'ignore' }).status === 0;
const parses = (text) => { try { JSON.parse(text); return true; } catch { return false; } };
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);

// 지침 글에 쓸 선택: 플러그인이 없으면 훅이 돌지 않으므로 「훅 꺼짐」 글로 쓴다(글도 검사도 없는 상태를 막으려고).
// 적용 계획과 화면 미리보기(picker.mjs)가 같은 기준을 쓴다.
export const mdSelection = (sel, active) => (active ? sel : { ...sel, hooks: [] });

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

// 훅 설정: 고른 훅을 켜고, Git 전략에 딸린 옵션을 얹는다.
// 다시 적용할 때 사용자가 따로 넣어 둔 옵션(예: commit-msg 의 lang)은 남긴다. Git 전략이 정하는 키만 새 값으로 바꾼다.
// 화면에서 고친 옵션(sel.hookOpts)은 둘 다보다 앞선다.
// 훅(run.mjs)은 lang·rules 만 읽는다. selection·known 은 다음에 고르기 화면을 열 때 지난번 선택에서 시작하려고 남긴다
// (켠 훅과 옵션은 rules 가 정본이라 selection 에 따로 적지 않는다 — 손으로 rules 를 고쳐도 화면이 그대로 따른다).
// 날짜는 사용자 PC 시간대로(hooks/lib/dates.mjs)
export const buildConfig = (all, sel, previous = null, date = localDate()) => {
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
//   plugin-missing  플러그인이 없어 훅이 돌지 않는다 → CLAUDE.md 는 「훅 꺼짐」 글로 쓴다(mdSelection)
//   claude-ignored  .claude/ 를 git 이 무시해 팀원에게 설정이 가지 않는다
//   settings-broken .claude/settings.json 이 깨져 팀원 공유를 적지 못했다
//   git-hook-exists   남의 pre-commit 훅이나 core.hooksPath(husky·pre-commit·lefthook)가 있어 git 훅을 넣지 않았다
//   git-hook-elsewhere 훅 폴더가 프로젝트 밖이라(git worktree·submodule) git 훅을 넣지 않았다
//   — 둘 다 커밋 검사는 Claude Code 안(PreToolUse)에서 계속 돌고, gitHookCmd 를 그 훅에 이어 붙이면 git 훅으로도 돈다.
//   skill-budget  늘 보는 스킬 목록이 예산의 80% 이상이 될 수 있다(새 스킬 설명이 먼저 빠짐) — 숫자와 줄일 스킬은 skillBudget
// listing: 지금 스킬 목록(scripts/lib/skill-budget.mjs currentListing). 고르기 화면은 한 번 읽어 둔 것을 넘긴다.
// skipped: 같은 이름의 폴더가 이미 있고 harness-fit 이 넣은 것이 아니라 건드리지 않은 스킬(retry 와 같은 규칙)
export const plan = (root, sel, all = loadAll(), { active = pluginActive(root), listing, home } = {}) => {
  const changes = [];
  const warnings = [];
  const add = (p, kind, content) => changes.push({ path: p, kind, action: fs.existsSync(p) ? 'change' : 'create', content });

  const cfgPath = path.join(root, '.claude', 'harness.json');
  add(cfgPath, 'config', JSON.stringify(buildConfig(all, sel, readJson(cfgPath)), null, 2) + '\n');
  if (!active) warnings.push('plugin-missing');
  const mdPath = path.join(root, 'CLAUDE.md');
  const md = read(mdPath);
  const nextMd = buildClaudeMd(md, mdSelection(sel, active));
  if (nextMd !== md && nextMd !== undefined) add(mdPath, 'claude-md', nextMd);
  if (sel.share) {
    const stPath = path.join(root, '.claude', 'settings.json');
    const current = read(stPath);
    const next = buildSettings(current, all.sources);
    if (next) add(stPath, 'share', next);
    else if (current && !parses(current)) warnings.push('settings-broken');
    if (gitIgnores(root, '.claude/harness.json')) warnings.push('claude-ignored');
  }
  if (sel.note?.trim()) add(path.join(root, '.claude', 'harness-request.md'), 'request', requestFile(sel.note, localDate()));
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
  // 목록 예산: 새로 생기는 스킬 폴더만 더한다(있던 폴더를 고치는 것은 이미 지금 크기에 들어 있다)
  const fresh = changes.filter((c) => c.kind === 'skill' && c.action === 'create').map((c) => c.skill);
  const skillBudget = planBudget(all, sel, fresh, listing || currentListing(root, home ? { home } : {}));
  if (skillBudget.level !== 'ok') warnings.push('skill-budget');
  return { changes, manual, warnings, skipped, skillBudget, ...(hook.warning ? { gitHookCmd: chainCommand(PLUGIN_DIR) } : {}) };
};
