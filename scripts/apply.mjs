// 고른 결과를 프로젝트에 적용한다. 적용 전에 바뀔 파일을 백업하고, 되돌리기를 제공한다.
// 사용:
//   node scripts/apply.mjs <프로젝트> --selection <파일>  [--dry-run]   적용(또는 바뀔 파일만 보기)
//   node scripts/apply.mjs <프로젝트> --undo                             마지막 적용 되돌리기
//   node scripts/apply.mjs <프로젝트> --retry <스킬id,…>                 받지 못한 스킬만 다시 받기
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
import { cleanSelection } from './lib/picker-state.mjs';
import { detectCommands } from './lib/commands.mjs';
import { detect } from './detect.mjs';

const args = process.argv.slice(2);
const root = path.resolve(args[0] || '.');
const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const out = (o) => process.stdout.write(JSON.stringify(o, null, 2) + '\n');
// 파일을 못 쓰거나 읽지 못하면(권한 없음·디스크 가득·잠긴 파일·깨진 선택 파일) 스택 트레이스 대신 읽을 수 있는 JSON 으로 —
// SKILL.md 가 error 칸을 읽어 사용자에게 알린다(전체 검토 2026-11-13: 쓰기 권한 없는 폴더에서 EPERM 이 그대로 터졌다)
// mode: 어느 실행에서 실패했나 — 뒷일이 다르다(SKILL.md 가 나눠 안내한다, 검토 2026-11-13).
//   apply: 쓰다 실패하면 apply-run 이 스스로 되돌리고 그 백업도 지운다 → 바뀐 것 없음. 여기서 --undo 를 하면 지난 적용까지 지워진다.
//   retry: 받은 스킬 폴더가 백업 목록에 오르기 전에 멈췄을 수 있다. undo: 반쯤 되돌렸을 수 있다(다시 돌리면 끝까지 간다).
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

const main = async () => {
  if (args.includes('--undo')) return (mode = 'undo'), out(await undoWithGithub(root));
  if (value('--retry')) return (mode = 'retry'), out(await retry(root, value('--retry').split(',').map((s) => s.trim()), { lang: value('--lang') === 'en' ? 'en' : 'ko' }));
  if (!value('--selection')) {
    out({ error: 'usage: apply.mjs <project> --selection <file> | --undo | --retry <id,…>' });
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
  const kinds = Array.isArray(raw.kinds) && raw.kinds.every((k) => typeof k === 'string' && /^[a-z]+$/.test(k)) ? raw.kinds : detect(root).kinds;
  const sel = { ...cleanSelection({ all, cfg, det: { commands: detectCommands(root).commands, kinds } }, raw, raw.lang || 'en'), github: withGithub, githubChoice: listed };
  const spec = all.packs.flows.find((f) => f.id === sel.flow)?.github;
  if (args.includes('--dry-run')) {
    const { changes, manual, warnings, gitHookCmd, skillBudget } = plan(root, sel, all);
    // --dry-run --github-settings: 읽기만 해서(GET) 무엇이 바뀔지 보여 준다. 묻기 전에 Claude 가 이것으로 목록을 만든다.
    const github = withGithub ? await previewGithub(root, spec) : undefined;
    return out({ changes: changes.map((c) => lineOf(root, c)), manual, warnings, gitHookCmd, ...(skillBudget.level !== 'ok' ? { skillBudget } : {}), ...(github ? { github } : {}) });
  }
  return out(await apply(root, sel));
};
main().catch(fail);
