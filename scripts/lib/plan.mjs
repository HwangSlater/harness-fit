// 적용 계획: 고른 것 → 바뀔 파일 목록과 내용(쓰지는 않는다). 적용(apply-run.mjs)·미리보기(picker.mjs)·--dry-run 이 같은 계획을 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadAll, catalogIds } from './catalog.mjs';
import { buildClaudeMd, blockBroken } from './claude-md.mjs';
import { GITIGNORE_LINE } from './backup.mjs';
import { pluginActive } from './installed.mjs';
import { currentListing, planBudget } from './skill-budget.mjs';
import { COMMIT_HOOK_IDS, MARKER, gitHookState, ownHookPath, launcherText, chainCommand, PLUGIN_DIR, PRE_COMMIT_CONFIG, PRE_COMMIT_ENTRY, PRE_COMMIT_RUNNER, preCommitSnippet, preCommitPasted, runnerText, isOurLauncher, isPreCommitFrameworkHook } from '../../hooks/lib/git-hook.mjs';
import { localDate } from '../../hooks/lib/dates.mjs';
import { readJson } from './paths.mjs';
import { ownedSkills } from './owned.mjs';
import { detect } from '../detect.mjs';
import { workspaceRepos } from './workspace.mjs';

// git 이 이 경로를 무시하는지(.gitignore 에 .claude/ 가 있으면 팀원에게 설정이 가지 않는다)
const gitIgnores = (root, rel) => spawnSync('git', ['-C', root, 'check-ignore', '-q', rel], { stdio: 'ignore' }).status === 0;
// 메모장이 붙이는 BOM 은 떼고 읽는다(깨진 파일로 보던 일)
const noBom = (text) => String(text).replace(/^\uFEFF/, '');
const parses = (text) => { try { JSON.parse(noBom(text)); return true; } catch { return false; } };
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);

// 지침 글에 쓸 선택: 플러그인이 없으면 훅이 돌지 않으므로 「훅 꺼짐」 글로 쓴다(글도 검사도 없는 상태를 막으려고).
// 적용 계획과 화면 미리보기(picker.mjs)가 같은 기준을 쓴다.
export const mdSelection = (sel, active) => (active ? sel : { ...sel, hooks: [] });

// git pre-commit 훅(커밋 때 실제 색인을 다시 보기). 커밋 때 다시 보는 쓰기 훅을 하나라도 켰고 플러그인이 있을 때만.
// 남의 훅·core.hooksPath 가 있거나 훅 폴더가 밖이면 넣지 않고 알린다(덮어쓰지 않는다). 우리 훅이 있으면 새 내용으로 다시 쓴다.
const HOOK_MODE = 0o755;
const HOOK_WARNING = { other: 'git-hook-exists', 'hooks-path': 'git-hook-exists', elsewhere: 'git-hook-elsewhere' };
export const gitHookPlan = (root, sel, active) => {
  // 커밋 때 다시 보는 훅을 다 껐으면 전에 넣은 우리 git 훅(우리 실행기 그대로인 것만 — gitHookState 'ours')을 뺀다.
  // 두면 커밋마다 플러그인을 찾아 아무것도 보지 않는 검사를 돌린다. 백업이 사본을 남겨 되돌리기가 되살린다(backup.mjs undoGitHook)
  // pre-commit 프레임워크 저장소면 그 설정이 부르는 우리 실행 파일(.claude/harness-fit-pre-commit.mjs, 표시가 있는 것만)도 뺀다 —
  // 남으면 커밋마다 계속 돈다(검토 2026-11-16). 붙여 넣은 항목(id: harness-fit)은 남의 설정이라 고치지 않고 지우라고 알린다(entryLeft)
  if (!sel.hooks.some((id) => COMMIT_HOOK_IDS.includes(id))) {
    const { state, file } = gitHookState(root);
    const runner = path.join(root, PRE_COMMIT_RUNNER);
    const off = [state === 'ours' ? file : null, (read(runner) || '').includes(MARKER) ? runner : null].filter(Boolean);
    const entryLeft = PRE_COMMIT_ENTRY.test(read(path.join(root, PRE_COMMIT_CONFIG)) || '');
    return { ...(off.length ? { off } : {}), ...(entryLeft ? { entryLeft } : {}) };
  }
  if (!active) return {};
  // pre-commit 프레임워크를 쓰면 git 훅을 넣지 않고, 설정에 붙여 넣을 항목을 손으로 할 일(manual)로 준다(hooks/lib/git-hook.mjs preCommitSnippet).
  // 지금 항목 그대로 붙여 넣었으면 붙여 넣기 단계는 다시 보이지 않는다(실행 파일은 넣는다). id: harness-fit 만 있고 글이 옛것이면
  // 단계를 보이고 「있는 항목을 바꿔 넣으세요」라고 덧붙인다(replace).
  // 전에 넣어 둔 우리 git 훅(.git/hooks/pre-commit, pre-commit 이 옮긴 .legacy)은 지운다 — pre-commit install 은 있던 훅을 .legacy 로
  // 옮겨 함께 돌리는데, Windows 에서는 #!/bin/sh 를 못 찾아(ExecutableNotFoundError) 모든 커밋이 막힌다(검토 2026-11-16).
  // 글이 우리 실행기 그대로인 것만 지운다(표시만 있는 남의 훅·줄을 덧붙인 훅은 둔다 — isOurLauncher). 백업이 사본을 남겨 되돌리기가 그대로 되살린다.
  // .legacy 는 pre-commit 의 훅이 있을 때만 지운다 — 사용자가 직접 쓴 감싸는 훅이 .legacy 를 부르면 그대로 돌아야 한다.
  const yaml = path.join(root, PRE_COMMIT_CONFIG);
  if (fs.existsSync(yaml)) {
    const { state, file } = gitHookState(root);
    const legacy = `${ownHookPath(root)}.legacy`;
    const frameworkLegacy = state === 'other' && isPreCommitFrameworkHook(read(file)) && isOurLauncher(read(legacy));
    const remove = [state === 'ours' ? file : null, frameworkLegacy ? legacy : null].filter(Boolean);
    const pasted = preCommitPasted(read(yaml));
    // 표시는 있는데 우리 실행기 그대로가 아니면(줄을 덧붙였거나 표시를 적은 남의 훅) 지우지 않고 알린다
    const lookalike = state === 'other' && (read(file) || '').includes(MARKER);
    return { preCommit: preCommitSnippet(), pasted: pasted === 'current', replace: pasted === 'outdated', remove, ...(lookalike ? { warning: 'git-hook-exists' } : {}) };
  }
  const { state, file } = gitHookState(root);
  if (HOOK_WARNING[state]) return { warning: HOOK_WARNING[state] };
  if (state !== 'none' && state !== 'ours') return {};
  const content = launcherText(PLUGIN_DIR);
  return read(file) === content ? {} : { file, content };
};

// 작업 폴더(lib/workspace.mjs): 맨 위는 git 저장소가 아니라 git 훅은 저장소마다 넣는다 — 맨 위 .git 에는 절대 쓰지 않는다(gitHookState 가 no-git).
// 저장소마다 gitHookPlan 과 같은 판단: 비었거나 우리 훅이면 넣고, 남의 훅·core.hooksPath·바깥 훅 폴더면 넣지 않고 알린다.
// pre-commit 프레임워크 저장소는 그 저장소 안에 실행 파일(.claude/harness-fit-pre-commit.mjs)을 만들어야 해서 하지 않고 이어 붙일 한 줄로 알린다
// (작업 폴더의 설정은 맨 위에 있는데 실행 파일만 저장소에 들어가 그 저장소 팀원 모두의 커밋에 섞인다). 커밋 훅을 다 껐으면 우리 훅만 뺀다.
// → { changes, warnings, repos: [{ name, gitHook: install | current | off | none | git-hook-exists | git-hook-elsewhere | pre-commit }] }
export const workspaceHookPlan = (root, repos, sel, active) => {
  const out = { changes: [], warnings: [], repos: [] };
  for (const name of repos) {
    const dir = path.join(root, name);
    const h = gitHookPlan(dir, sel, active);
    let state = 'none';
    if (h.content) {
      out.changes.push({ path: h.file, kind: 'git-hook', action: fs.existsSync(h.file) ? 'change' : 'create', content: h.content, mode: HOOK_MODE });
      state = 'install';
    } else if (h.preCommit) state = 'pre-commit';
    else if (h.warning) state = h.warning;
    else if (sel.hooks.some((id) => COMMIT_HOOK_IDS.includes(id)) && active) state = 'current';
    const own = ownHookPath(dir);
    for (const f of (h.off || []).filter((x) => path.resolve(x) === path.resolve(own))) {
      out.changes.push({ path: f, kind: 'git-hook-off', action: 'remove', content: null });
      state = 'off';
    }
    if (state === 'pre-commit') out.warnings.push('git-hook-exists');
    else if (Object.values(HOOK_WARNING).includes(state)) out.warnings.push(state);
    out.repos.push({ name, gitHook: state });
  }
  out.warnings = [...new Set(out.warnings)];
  return out;
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
    // conflicts: 사용자 규칙과 반대인 것마다 고른 쪽(lib/conflicts.mjs) — 다음 적용 때 다시 묻지 않고 그대로 따른다. 팀 저장소면 이 파일이 커밋돼 팀원 모두에게 같다
    selection: { combo: sel.combo, flow: sel.flow, skills: sel.skills, rules: sel.rules, share: sel.share === true, at: date, ...(sel.conflicts?.length ? { conflicts: sel.conflicts } : {}) },
    known: catalogIds(all),
  };
};

// .gitignore 의 백업 폴더 줄을 누가 넣었나 → { gitignore: 'added' | 'existing' } — 지우기(remove.mjs)가 우리가 넣은 줄만 빼려고 harness.json 에 남긴다
// (harness.json 은 커밋되므로 다른 PC·새 clone 에서도 안다). 이번에 넣으면 added, 이미 있으면 지난 기록 그대로,
// 처음 적용인데 이미 있으면 사용자 줄(existing). 지난 harness.json 에 기록이 없으면(v0.4.1 까지) 모른다 — 적지 않는다.
const GI_OWNERS = new Set(['added', 'existing']);
export const gitignoreOwner = (has, previous) => {
  if (!has) return { gitignore: 'added' };
  if (!previous) return { gitignore: 'existing' };
  return GI_OWNERS.has(previous.gitignore) ? { gitignore: previous.gitignore } : {};
};

// 팀원도 같은 플러그인을 쓰게: 프로젝트 .claude/settings.json 에 마켓과 플러그인을 적는다.
// 팀원이 이 저장소를 열면 Claude Code 가 설치를 권한다. 기존 설정은 그대로 두고 두 항목만 더한다.
// 파일이 깨져 있으면(손으로 고치다 만 경우) 건드리지 않고 null.
export const buildSettings = (current, src) => {
  let cfg = {};
  if (current) {
    try {
      cfg = JSON.parse(noBom(current));
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
//   skill-kept-edited  고르지 않게 된 harness-fit 스킬인데 받은 뒤 고쳤거나 받은 그대로인지 알 수 없어 빼지 않았다 — 이름은 keptSkills
// listing: 지금 스킬 목록(scripts/lib/skill-budget.mjs currentListing). 고르기 화면은 한 번 읽어 둔 것을 넘긴다.
// skipped: 같은 이름의 폴더가 이미 있고 harness-fit 이 넣은 것이 아니라 건드리지 않은 스킬(retry 와 같은 규칙)
export const plan = (root, sel, all = loadAll(), { active = pluginActive(root), listing, home } = {}) => {
  const changes = [];
  const warnings = [];
  const add = (p, kind, content) => changes.push({ path: p, kind, action: fs.existsSync(p) ? 'change' : 'create', content });

  const cfgPath = path.join(root, '.claude', 'harness.json');
  const gi = path.join(root, '.gitignore');
  const giText = read(gi);
  const giHas = !!giText && giText.split(/\r?\n/).includes(GITIGNORE_LINE);
  const prevCfg = readJson(cfgPath);
  // 작업 폴더면 설정에 저장소 이름을 적는다 — 훅(hooks/lib/core.mjs loadConfig)이 저장소 안 cwd 에서도 이 설정을 찾는 표시
  const repos = workspaceRepos(root);
  add(cfgPath, 'config', JSON.stringify({ ...buildConfig(all, sel, prevCfg), ...gitignoreOwner(giHas, fs.existsSync(cfgPath) ? prevCfg || {} : null), ...(repos ? { workspace: repos } : {}) }, null, 2) + '\n');
  if (!active) warnings.push('plugin-missing');
  const mdPath = path.join(root, 'CLAUDE.md');
  const md = read(mdPath);
  // 관리 구역 표시가 짝이 안 맞으면(시작이 둘·끝이 없음 등) CLAUDE.md 는 건드리지 않고 알린다(setBlock 이 그대로 돌려준다)
  if (blockBroken(md)) warnings.push('claude-md-markers');
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
  // 줄바꿈은 파일 것(CRLF 도)을 따른다 — 지우기가 우리 줄을 빼면 처음 글 그대로가 되게
  const giEol = giText?.includes('\r\n') ? '\r\n' : '\n';
  if (!giHas) add(gi, 'gitignore', `${giText ? giText.replace(/\s*$/, giEol) : ''}${GITIGNORE_LINE}${giEol}`);
  const hook = gitHookPlan(root, sel, active);
  if (hook.content) {
    add(hook.file, 'git-hook', hook.content);
    changes.at(-1).mode = HOOK_MODE;
  }
  if (hook.warning) warnings.push(hook.warning);
  // pre-commit 설정이 부를 실행 파일(팀이 같이 쓰도록 저장소 안에 — 경로를 적지 않고 돌 때 플러그인을 찾는다)
  if (hook.preCommit) {
    const runner = path.join(root, PRE_COMMIT_RUNNER);
    const text = runnerText();
    if (read(runner) !== text) add(runner, 'pre-commit-runner', text);
    // 지우는 것도 바꿀 목록에 넣는다(백업이 사본을 남기고 되돌리기가 다시 만든다 — scripts/lib/backup.mjs undoGitHook)
    for (const f of hook.remove) changes.push({ path: f, kind: 'git-hook-remove', action: 'remove', content: null });
  }
  for (const f of hook.off || []) changes.push({ path: f, kind: 'git-hook-off', action: 'remove', content: null });
  if (hook.entryLeft) warnings.push('pre-commit-entry-left');
  const ws = repos ? workspaceHookPlan(root, repos, sel, active) : null;
  if (ws) {
    changes.push(...ws.changes);
    for (const w of ws.warnings) if (!warnings.includes(w)) warnings.push(w);
  }

  const skills = sel.skills.map((id) => all.catalog.skills.find((s) => s.id === id)).filter(Boolean);
  const skipped = [];
  for (const s of skills.filter((k) => k.install === 'copy')) {
    const dir = path.join(root, '.claude', 'skills', s.id);
    // 사용자가 따로 둔 같은 이름의 스킬은 덮어쓰지 않는다(harness-fit 이 넣은 폴더에는 .harness-source.json 이 있다)
    if (fs.existsSync(dir) && !fs.existsSync(path.join(dir, '.harness-source.json'))) { skipped.push(s.id); continue; }
    add(dir, 'skill');
    changes.at(-1).skill = s.id;
  }
  // 다시 적용: harness-fit 이 받은 스킬(.harness-source.json)인데 이번에 고르지 않았으면 뺀다 — 받은 그대로일 때만(owned.mjs skillState).
  // 백업이 폴더 사본을 남겨 되돌리기가 되살린다. 받을 스킬로 오해하지 않게 skill 이 아니라 removedSkill 에 id 를 둔다(apply-run 이 skill 로 받을 것을 고른다).
  // 고친 폴더(지문 없는 옛 폴더·연결 포함)는 두고 알린다(skill-kept-edited · keptSkills). 폴더 이름이 받은 스킬 id 와 다르면(not-ours) 건드리지 않는다.
  const chosen = new Set(sel.skills);
  const keptSkills = [];
  for (const s of ownedSkills(root, chosen) || []) {
    if (s.state === 'clean') changes.push({ path: s.abs, kind: 'skill-remove', action: 'remove', content: null, removedSkill: s.id });
    else if (s.state !== 'not-ours') keptSkills.push(s.id); // 받은 스킬을 다른 이름으로 복사한 사용자 폴더는 우리 것이 아니다(알리지도 않는다)
  }
  if (keptSkills.length) warnings.push('skill-kept-edited');
  const manual = skills.filter((s) => s.install === 'plugin').map((s) => {
    const repo = all.catalog.repos.find((r) => r.repo === s.repo);
    return { skill: s.id, repo: s.repo, how: repo?.install || `claude plugin marketplace add ${s.repo}` };
  });
  // 스킬이 아닌 손으로 할 일은 kind 로 가른다(화면은 이름 대신 할 일과 붙여 넣을 글을 보여 준다 — picker/changes.js manualName)
  if (hook.entryLeft) manual.push({ kind: 'pre-commit-entry', file: PRE_COMMIT_CONFIG });
  if (hook.preCommit && !hook.pasted) manual.push({ kind: 'pre-commit', file: PRE_COMMIT_CONFIG, how: hook.preCommit, ...(hook.replace ? { replace: true } : {}) });
  // 목록 예산: 새로 생기는 스킬 폴더만 더한다(있던 폴더를 고치는 것은 이미 지금 크기에 들어 있다)
  const fresh = changes.filter((c) => c.kind === 'skill' && c.action === 'create').map((c) => c.skill);
  const skillBudget = planBudget(all, sel, fresh, listing || currentListing(root, home ? { home } : {}), () => (Array.isArray(sel.stack) ? sel.stack : detect(root).stack));
  if (skillBudget.level !== 'ok') warnings.push('skill-budget');
  // workspace: 저장소마다 git 훅을 어떻게 했는지(작업 폴더일 때만 — 보고에 저장소 이름과 함께)
  return { changes, manual, warnings, skipped, keptSkills, skillBudget, ...(hook.warning || ws?.warnings.length ? { gitHookCmd: chainCommand(PLUGIN_DIR) } : {}), ...(ws ? { workspace: ws.repos } : {}) };
};
