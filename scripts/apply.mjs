// 고른 결과를 프로젝트에 적용한다. 적용 전에 바뀔 파일을 백업하고, 되돌리기를 제공한다.
// 사용:
//   node scripts/apply.mjs <프로젝트> --selection <파일>  [--dry-run]   적용(또는 바뀔 파일만 보기)
//   node scripts/apply.mjs <프로젝트> --undo                             마지막 적용 되돌리기
//   node scripts/apply.mjs <프로젝트> --retry <스킬id,…>                 받지 못한 스킬만 다시 받기
//   node scripts/apply.mjs <프로젝트> --remove [--dry-run] [--force]     프로젝트를 끝낼 때: harness-fit 이 넣은 것을 모두 빼기(백업 없이도)
// 결과는 JSON 한 덩어리로 내보낸다(Claude 가 짧게 읽고 보고하도록).
// 명령줄만 여기. 계획은 lib/plan.mjs, 적용·다시 받기는 lib/apply-run.mjs(고르기 화면 서버도 같은 것을 쓴다).
import fs from 'node:fs';
import path from 'node:path';
import { loadAll } from './lib/catalog.mjs';
import { pickerConfig } from './lib/paths.mjs';
import { plan } from './lib/plan.mjs';
import { apply, retry, lineOf } from './lib/apply-run.mjs';
import { undoWithGithub, previewGithub } from './lib/github-settings.mjs';
import { parseItemList } from '../picker/github-plan.js';
import { gitlabPlans, gitlabRelevant } from './lib/gitlab-settings.mjs';
import { cleanSelection } from './lib/picker-state.mjs';
import { detectCommands } from './lib/commands.mjs';
import { vcsOf } from './lib/vcs-format.mjs';
import { detect } from './detect.mjs';
import { removeAll } from './lib/remove.mjs';
import { repoRoot } from '../hooks/lib/core.mjs';
import { workspaceRepos } from './lib/workspace.mjs';

const args = process.argv.slice(2);
const root = path.resolve(args[0] || '.');
const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const out = (o) => process.stdout.write(JSON.stringify(o, null, 2) + '\n');
// 파일을 못 쓰거나 읽지 못하면(권한 없음·디스크 가득·잠긴 파일·깨진 선택 파일) 스택 트레이스 대신 읽을 수 있는 JSON 으로 —
// SKILL.md 가 error 칸을 읽어 사용자에게 알린다(전체 검토 2026-11-13: 쓰기 권한 없는 폴더에서 EPERM 이 그대로 터졌다)
// mode: 어느 실행에서 실패했나 — 뒷일이 다르다(SKILL.md 가 나눠 안내한다, 검토 2026-11-13).
//   apply: 쓰다 실패하면 apply-run 이 스스로 되돌리고 그 백업도 지운다 → 바뀐 것 없음. 여기서 --undo 를 하면 지난 적용까지 지워진다.
//   retry: 받은 스킬 폴더가 백업 목록에 오르기 전에 멈췄을 수 있다. undo: 반쯤 되돌렸을 수 있다(다시 돌리면 끝까지 간다).
//   remove: 반쯤 뺐을 수 있다(다시 돌리면 남은 것을 마저 뺀다 — 백업 폴더는 맨 끝에 지운다).
let mode = 'apply';
const fail = (e) => {
  if (e?.badSelection) out({ error: 'bad-selection', file: value('--selection'), detail: String(e.cause?.message || e.message).slice(0, 300) });
  // apply-partial: 파일을 쓴 뒤에 실패했거나 자동 되돌리기마저 실패해 바뀐 것이 남았다 — 이때만 --undo 가 맞다
  else out({ error: 'write-failed', mode: mode === 'apply' && e?.partial ? 'apply-partial' : mode, code: e?.code || null, path: e?.path ? path.relative(root, e.path) || '.' : null, detail: String(e?.message || e).slice(0, 300) });
  process.exitCode = 1;
};
// 선택 파일을 못 읽거나 JSON 이 깨졌으면 쓰기 실패와 나눠 알린다
const readSelection = (file) => {
  try {
    const sel = JSON.parse(fs.readFileSync(file, 'utf8'));
    // null·숫자·배열도 JSON 으로는 맞지만 선택이 아니다(검토 2026-11-13: write-failed 로 잘못 알렸다)
    if (!sel || typeof sel !== 'object' || Array.isArray(sel)) throw new Error('selection must be a JSON object');
    return sel;
  } catch (cause) {
    throw Object.assign(new Error('bad selection'), { badSelection: true, cause });
  }
};

const USAGE = 'usage: apply.mjs <project> --selection <file> | --undo | --retry <id,…> | --remove [--dry-run] [--force]';
// 되돌리기·지우기는 저장소 맨 위에서 — 하위 폴더에서 부르면 「할 것 없음」으로 끝나던 일(검토 2026-11-16).
// git 저장소가 아니면 준 폴더 그대로 쓰고, 어느 폴더를 봤는지 folder 칸으로 알린다(git: false)
// 다만 준 폴더에 harness-fit 이 적용돼 있으면(하위 패키지에 적용 — 모노레포) 그 폴더 그대로: 맨 위로 올라가면 그 적용을 못 찾았다(회귀 확인 2026-11-16)
const appliedHere = (dir) => fs.existsSync(path.join(dir, '.claude', 'harness.json')) || fs.existsSync(path.join(dir, '.claude', 'harness-backup'));
const topOf = (dir) => {
  if (appliedHere(dir)) return { root: dir, where: { folder: dir } };
  const top = repoRoot(dir);
  return top ? { root: top, where: { folder: top } } : { root: dir, where: { folder: dir, git: false } };
};

const main = async () => {
  // 실행 방식은 하나만. 둘을 주면(--remove --undo 등) 앞의 것만 몰래 돌던 일 — 명령줄은 「목록만」이라 해 놓고 되돌리기를 했다(검토 2026-11-16)
  const modes = ['--undo', '--remove', '--retry', '--selection'].filter((m) => args.includes(m));
  if (modes.length > 1) {
    out({ error: 'conflicting-modes', modes, usage: USAGE });
    process.exitCode = 1;
    return;
  }
  if (args.includes('--undo')) {
    mode = 'undo';
    const t = topOf(root);
    return out({ ...(await undoWithGithub(t.root)), ...t.where });
  }
  // --force: 받은 뒤 고친 스킬 폴더도 지운다(사용자가 그렇게 하라고 한 뒤에만 — SKILL.md)
  if (args.includes('--remove')) {
    mode = 'remove';
    const t = topOf(root);
    return out({ ...removeAll(t.root, { dryRun: args.includes('--dry-run'), force: args.includes('--force') }), ...t.where });
  }
  if (value('--retry')) return (mode = 'retry'), out(await retry(root, value('--retry').split(',').map((s) => s.trim()), { lang: value('--lang') === 'en' ? 'en' : 'ko' }));
  if (!value('--selection')) {
    out({ error: USAGE });
    process.exitCode = 1;
    return;
  }
  // 화면을 거치지 않은 선택(auto)도 화면과 같은 검사를 거친다(카탈로그에 있는 id 만, 빠진 칸은 기본값).
  const all = loadAll();
  const cfg = pickerConfig();
  const raw = readSelection(value('--selection'));
  // GitHub 저장소 설정은 명령줄 --github-settings=<항목,…> 으로 사용자가 고른 항목만(선택 파일의 github 칸은 무시 — 물어본 뒤에만 붙인다).
  // 항목 없이 --github-settings 만 주면 미리보기(--dry-run)에만 쓰이고, 적용에서는 아무것도 바꾸지 않는다(no-items).
  const ghArg = args.find((a) => a === '--github-settings' || a.startsWith('--github-settings='));
  const withGithub = !!ghArg;
  const listed = ghArg?.includes('=') ? parseItemList(ghArg.slice(ghArg.indexOf('=') + 1)) : null;
  // 저장소 종류: recommend 가 선택 파일에 남긴 것(--stack 힌트 반영)을 쓰고, 없으면(옛 파일·손으로 만든 파일) 다시 읽는다
  // 작업 폴더(lib/workspace.mjs)는 맨 위가 저장소가 아니라 명령·형식을 저장소마다 읽어 합친 감지 결과에서 가져온다(맨 위에서 읽으면 비었다)
  const ws = workspaceRepos(root) ? detect(root) : null;
  const kinds = Array.isArray(raw.kinds) && raw.kinds.every((k) => typeof k === 'string' && /^[a-z]+$/.test(k)) ? raw.kinds : (ws || detect(root)).kinds;
  // 커밋·PR 형식(CLAUDE.md 「커밋·PR 형식」 줄)도 선택 파일 값이 아니라 저장소에서 다시 읽는다 — 명령과 같은 까닭
  const sel = { ...cleanSelection({ all, cfg, det: { commands: ws ? ws.commands : detectCommands(root).commands, kinds, vcs: ws ? ws.vcs : vcsOf(root) } }, raw, raw.lang || 'en'), github: withGithub, githubChoice: listed };
  const spec = all.packs.flows.find((f) => f.id === sel.flow)?.github;
  if (args.includes('--dry-run')) {
    const { changes, manual, warnings, keptSkills, gitHookCmd, skillBudget, workspace, pluginFolders, userScopeCmd } = plan(root, sel, all);
    // --dry-run --github-settings: 읽기만 해서(GET) 무엇이 바뀔지 보여 준다. 묻기 전에 Claude 가 이것으로 목록을 만든다.
    const github = withGithub ? await previewGithub(root, spec) : undefined;
    // GitLab 이면 같은 때(--github-settings) 요금제를 읽어 서버에서 강제할 수 없는 것을 알린다(읽기만 — lib/gitlab-settings.mjs). 못 읽어도 미리보기는 그대로
    const gl = withGithub ? await gitlabPlans(root, ws || detect(root), all.packs).catch(() => null) : null;
    const gitlab = gitlabRelevant(gl, sel) ? gl : null;
    return out({ changes: changes.map((c) => lineOf(root, c)), manual, warnings, ...(keptSkills.length ? { keptSkills } : {}), gitHookCmd, ...(skillBudget.level !== 'ok' ? { skillBudget } : {}), ...(workspace ? { workspace } : {}), ...(userScopeCmd ? { pluginFolders, userScopeCmd } : {}), ...(github ? { github } : {}), ...(gitlab ? { gitlab } : {}) });
  }
  return out(await apply(root, sel));
};
main().catch(fail);
