// 감지 → 추천 선택(JSON). 고르기 화면 없이 바로 적용할 때(--auto)나 화면의 첫 상태로 쓴다.
// 전에 적용한 적이 있으면(.claude/harness.json) 추천 대신 지난번 선택을 그대로 내고(previous: true),
// 그 뒤 카탈로그에 새로 생긴 것은 켜지 않고 newSince 로 알린다. --fresh 면 지난번 선택을 무시하고 새로 추천한다.
// 사용: node scripts/recommend.mjs [프로젝트] [--lang ko|en] [--stack "Next.js,Supabase"] [--team] [--similar …] [--skip …] [--fresh] | --catalog
// 이미 있는 훅·스킬과 겹치는 것은 빼고 추천한다(scripts/lib/existing.mjs — 기존 훅을 시험 입력으로 돌려 보느라 처음엔 몇 초 걸린다.
// 훅·시험 입력·플러그인이 그대로면 담아 둔 결과를 쓴다 — scripts/lib/probe-cache.mjs).
import { pathToFileURL } from 'node:url';
import { detect, withHints } from './detect.mjs';
import { loadAll, recommend, labelsFor, catalogDigest } from './lib/catalog.mjs';
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
    selection: { ...previous, lang, why, covered, skipLines: det.skipLines || {}, commands: det.commands || {}, kinds: det.kinds || null },
    newSince: { ...fresh, labels: { skills, hooks, rules } },
  };
};

// --fresh 로 새로 추천해도 지난번 harness.json 에 사용자가 적어 둔 목록 옵션(ask-cmd commands·protected-files paths 등)은 잃지 않는다 —
// 새 추천의 목록을 지난 목록 뒤에 이어 붙인다(검토 2026-11-11: 적어 둔 python long.py 가 make train 으로 바뀌어 사라졌다). 화면은 sentOpts 가 같은 일을 한다.
// 브랜치 방식이 정하는 칸(protect-branch branches 등)은 새 방식의 값을 따른다 — 잇지 않는다
export const keepListOptions = (selection, raw, all, lang = 'en') => {
  const prev = raw?.rules;
  if (!prev || typeof prev !== 'object') return selection;
  const owned = new Set((all?.packs?.flows || []).flatMap((f) => Object.values(f.hooks || {}).flatMap((o) => Object.keys(o))));
  const opts = (selection.hookOpts ||= {});
  const kept = [];
  for (const [id, o] of Object.entries(prev)) {
    if (!o || typeof o !== 'object') continue;
    for (const [k, v] of Object.entries(o)) {
      if (!Array.isArray(v) || !v.length || owned.has(k)) continue;
      const now = opts[id]?.[k];
      opts[id] = { ...(opts[id] || {}), [k]: [...new Set([...v, ...(Array.isArray(now) ? now : [])])] };
      kept.push(...v.filter((x) => !(Array.isArray(now) && now.includes(x))));
    }
  }
  // 이어 붙인 지난 값도 이유 줄에 — 출처를 말할 수 있게, 필요 없으면 빼라고(검토 2026-11-11)
  if (kept.length) (selection.why ||= []).push(lang === 'ko' ? `지난번에 적어 둔 값은 그대로 둠(${kept.slice(0, 3).join(' · ')}${kept.length > 3 ? ' …' : ''})` : `Kept values set last time (${kept.slice(0, 3).join(' · ')}${kept.length > 3 ? ' …' : ''})`);
  return selection;
};

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const argv = process.argv.slice(2);
  const { lang, root, hints } = parseArgs(argv);
  // --catalog: 저장소는 읽지 않고 훅(막는 꼴·옵션)·스킬 요약만. 사용자가 걱정·요청을 말했을 때만 부른다(크다 — 늘 붙이지 않는다)
  if (argv.includes('--catalog')) {
    process.stdout.write(JSON.stringify(catalogDigest(loadAll(), lang)) + '\n');
    process.exit(0);
  }
  const det = await withExisting(withHints(detect(root), hints), root);
  const all = loadAll();
  const raw = readHarnessConfig(root);
  const fresh = argv.includes('--fresh');
  const out = autoSelection(all, det, lang, fresh ? null : raw);
  if (fresh) keepListOptions(out.selection, raw, all, lang);
  process.stdout.write(JSON.stringify({ detected: det, ...out, labels: labelsFor(all, out.selection, lang) }, null, 2) + '\n');
}
