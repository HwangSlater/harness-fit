// 감지 → 추천 선택(JSON). 고르기 화면 없이 바로 적용할 때(--auto)나 화면의 첫 상태로 쓴다.
// 사용: node scripts/recommend.mjs [프로젝트] [--lang ko|en] [--stack "Next.js,Supabase"] [--team]
import { pathToFileURL } from 'node:url';
import { detect, withHints } from './detect.mjs';
import { loadAll, recommend, labelsFor } from './lib/catalog.mjs';
import { parseArgs } from './lib/args.mjs';

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { lang, root, hints } = parseArgs(process.argv.slice(2));
  const det = withHints(detect(root), hints);
  const all = loadAll();
  const selection = recommend(all, det, lang);
  process.stdout.write(JSON.stringify({ detected: det, selection, labels: labelsFor(all, selection, lang) }, null, 2) + '\n');
}
