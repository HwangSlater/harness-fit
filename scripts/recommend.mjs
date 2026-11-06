// 감지 → 추천 선택(JSON). 고르기 화면 없이 바로 적용할 때(--auto)나 화면의 첫 상태로 쓴다.
// 전에 적용한 적이 있으면(.claude/harness.json) 추천 대신 지난번 선택을 그대로 내고(previous: true),
// 그 뒤 카탈로그에 새로 생긴 것은 켜지 않고 newSince 로 알린다. --fresh 면 지난번 선택을 무시하고 새로 추천한다.
// 사용: node scripts/recommend.mjs [프로젝트] [--lang ko|en] [--stack "Next.js,Supabase"] [--team] [--similar …] [--skip …] [--fresh]
// 이미 있는 훅·스킬과 겹치는 것은 빼고 추천한다(scripts/lib/existing.mjs — 기존 훅을 시험 입력으로 돌려 보느라 몇 초 걸린다).
import { pathToFileURL } from 'node:url';
import { detect, withHints } from './detect.mjs';
import { loadAll, recommend, labelsFor } from './lib/catalog.mjs';
import { parseArgs } from './lib/args.mjs';
import { withExisting } from './lib/existing.mjs';
import { readHarnessConfig, previousOf, newSinceOf } from './lib/picker-state.mjs';
import { dupHooks } from '../picker/dup.js';

// 화면 없이 쓰는 경로라 cfg 는 비워 둔다(cleanSelection 이 cfg 를 보는 것은 요청 칸 글뿐인데, 지난번 선택에는 없다).
// 지난번 선택에도 화면과 같이 지금 감지한 겹침(covered)·이미 CLAUDE.md 에 있는 줄(skipLines)을 붙인다.
export const autoSelection = (all, det, lang, raw) => {
  const previous = previousOf({ all, cfg: {} }, raw, lang);
  if (!previous) return { previous: false, selection: recommend(all, det, lang) };
  const at = previous.at;
  const why = [lang === 'ko' ? `지난번${at ? `(${at})` : ''}에 적용한 선택을 그대로 둠` : `Kept what was applied last time${at ? ` (${at})` : ''}`];
  const flow = all.packs.flows.find((f) => f.id === previous.flow) || null;
  const covered = dupHooks(det.existing, previous.share, flow).map((x) => x.id);
  const fresh = newSinceOf(all, raw);
  const { skills, hooks, rules } = labelsFor(all, { combo: '', flow: '', ...fresh }, lang);
  return {
    previous: true,
    selection: { ...previous, lang, why, covered, skipLines: det.skipLines || {}, commands: det.commands || {} },
    newSince: { ...fresh, labels: { skills, hooks, rules } },
  };
};

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const argv = process.argv.slice(2);
  const { lang, root, hints } = parseArgs(argv);
  const det = await withExisting(withHints(detect(root), hints), root);
  const all = loadAll();
  const out = autoSelection(all, det, lang, argv.includes('--fresh') ? null : readHarnessConfig(root));
  process.stdout.write(JSON.stringify({ detected: det, ...out, labels: labelsFor(all, out.selection, lang) }, null, 2) + '\n');
}
