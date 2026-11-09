// 적용하기: 계획(plan.mjs)대로 백업 → 파일 쓰기 → 스킬 받기 → (고르면) GitHub 설정. 받지 못한 스킬만 다시 받기(retry).
// 명령줄(scripts/apply.mjs)과 고르기 화면 서버(scripts/picker.mjs)가 함께 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { loadAll, labelsFor } from './catalog.mjs';
import { installSkill } from './install-skill.mjs';
import { UNDO_COMMAND, backup, recordWritten, addEntries, latestBackup, undo, recordGithub } from './backup.mjs';
import { applyGithub } from './github-settings.mjs';
import { plan } from './plan.mjs';

export { undo, UNDO_COMMAND };

const rel = (root, p) => path.relative(root, p).split(path.sep).join('/');

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

// 바뀐 파일 한 줄(결과 JSON·--dry-run): + 새로 만듦, ~ 고침
export const lineOf = (root, c) => `${c.action === 'create' ? '+' : '~'} ${rel(root, c.path)}`;

// onProgress({ done, total, current }) — 스킬을 받는 동안 화면에 진행을 보여 주려고.
// gh: GitHub 설정에 쓸 실행기(시험이 가짜를 넣는다). sel.github 가 true 일 때만 GitHub 을 건드린다.
export const apply = async (root, sel, onProgress = () => {}, { gh, listing } = {}) => {
  const all = loadAll();
  const { changes, manual, warnings, skipped, gitHookCmd, skillBudget } = plan(root, sel, all, { listing });
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
    // 끝난 뒤 안내: 받은 스킬을 부르는 명령(이름 = 카탈로그 id — install-skill.mjs setSkillName)
    skillCommands: installed.map((id) => `/${id}`),
    manual,
    failed,
    warnings,
    skipped,
    gitHookCmd,
    ...(skillBudget.level !== 'ok' ? { skillBudget } : {}),
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
