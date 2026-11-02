// 감지 → 추천 선택(JSON). 고르기 화면 없이 바로 적용할 때(--auto)나 화면의 첫 상태로 쓴다.
// 사용: node scripts/recommend.mjs [프로젝트] [--lang ko|en]
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { detect } from './detect.mjs';
import { loadAll, recommend } from './lib/catalog.mjs';

export const pickLang = (arg) => {
  if (arg === 'ko' || arg === 'en') return arg;
  const sys = process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale || '';
  return /^ko/i.test(sys) ? 'ko' : 'en';
};

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const li = args.indexOf('--lang');
  const lang = pickLang(li >= 0 ? args[li + 1] : null);
  const dir = path.resolve(args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--lang') || '.');
  const det = detect(dir);
  const all = loadAll();
  const selection = recommend(all, det, lang);
  // 사용자에게 보여 줄 이름(id 대신)
  const name = (list, id) => list.find((x) => x.id === id)?.name[lang] || id;
  const labels = {
    combo: name(all.combos.combos, selection.combo),
    flow: name(all.packs.flows, selection.flow),
    hooks: selection.hooks.map((id) => name(all.packs.hooks, id)),
    rules: selection.rules.map((id) => name(all.packs.rules, id)),
  };
  process.stdout.write(JSON.stringify({ detected: det, selection, labels }, null, 2) + '\n');
}
