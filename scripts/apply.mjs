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
  const cfg = pickerConfig();
  const raw = JSON.parse(fs.readFileSync(value('--selection'), 'utf8'));
  // GitHub 저장소 설정은 명령줄 --github-settings=<항목,…> 으로 사용자가 고른 항목만(선택 파일의 github 칸은 무시 — 물어본 뒤에만 붙인다).
  // 항목 없이 --github-settings 만 주면 미리보기(--dry-run)에만 쓰이고, 적용에서는 아무것도 바꾸지 않는다(no-items).
  const ghArg = args.find((a) => a === '--github-settings' || a.startsWith('--github-settings='));
  const withGithub = !!ghArg;
  const listed = ghArg?.includes('=') ? parseItemList(ghArg.slice(ghArg.indexOf('=') + 1)) : null;
  const sel = { ...cleanSelection({ all, cfg, det: { commands: detectCommands(root).commands } }, raw, raw.lang || 'en'), github: withGithub, githubChoice: listed };
  const spec = all.packs.flows.find((f) => f.id === sel.flow)?.github;
  if (args.includes('--dry-run')) {
    const { changes, manual, warnings, gitHookCmd, skillBudget } = plan(root, sel, all);
    // --dry-run --github-settings: 읽기만 해서(GET) 무엇이 바뀔지 보여 준다. 묻기 전에 Claude 가 이것으로 목록을 만든다.
    (withGithub ? previewGithub(root, spec) : Promise.resolve(undefined)).then((github) => out({ changes: changes.map((c) => lineOf(root, c)), manual, warnings, gitHookCmd, ...(skillBudget.level !== 'ok' ? { skillBudget } : {}), ...(github ? { github } : {}) }));
  } else apply(root, sel).then(out);
}
