// 개발용: 카탈로그 스킬마다 고정 커밋의 SKILL.md 설명을 읽어 목록 예산에 쓸 값을 catalog.json 에 적고 보고한다.
// - descChars: description(+ when_to_use) 글자 수. 화면·적용이 「새로 M자」를 셀 때 쓴다(picker/budget.js catalogChars).
// - saysWhen: 언제 쓰는지 밝히는지(부드러운 검사 — 외부 글이라 고치지 않고 보고만 한다).
// - 1,536자를 넘으면 Claude Code 가 잘라 넣는다(code.claude.com/docs/en/skills) — 보고만.
// 받은 글은 실행하지 않고 머리말만 읽는다. 외부 스킬 글은 고치지 않는다.
// 사용: node scripts/check-descriptions.mjs            (받아서 적고 보고)
//       node scripts/check-descriptions.mjs --report   (받지 않고 catalog.json 에 적힌 값으로 보고만)
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_ROOT } from './lib/catalog.mjs';
import { skillMeta, saysWhen, descReport } from './lib/skill-meta.mjs';
import { DESC_CAP } from '../picker/budget.js';

const file = path.join(PLUGIN_ROOT, 'catalog', 'catalog.json');
const sources = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'config', 'sources.json'), 'utf8'));
const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
const reportOnly = process.argv.includes('--report');
const PARALLEL = 6;

const fetchText = async (s) => {
  const repo = catalog.repos.find((r) => r.repo === s.repo);
  if (!repo?.sha) throw new Error('고정 커밋 없음');
  const res = await fetch(`${sources.rawBase}/${s.repo}/${repo.sha}/${s.path}`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
};

if (!reportOnly) {
  const failed = [];
  const queue = [...catalog.skills];
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      try {
        const m = skillMeta(await fetchText(s), s.id);
        s.descChars = (m.whenToUse ? `${m.description} ${m.whenToUse}` : m.description).length;
        s.saysWhen = saysWhen(m);
      } catch (e) {
        failed.push(`${s.id}: ${e.message}`);
      }
    }
  }));
  fs.writeFileSync(file, JSON.stringify(catalog, null, 1) + '\n');
  if (failed.length) console.log(`받지 못함 ${failed.length}: ${failed.join(', ')}`);
}
const r = descReport(catalog.skills);
console.log(`스킬 ${r.total} · 설명을 잰 것 ${r.measured} · 가운데값 ${r.median}자`);
console.log(`${DESC_CAP}자를 넘어 잘리는 것 ${r.truncated.length}${r.truncated.length ? `: ${r.truncated.join(', ')}` : ''}`);
console.log(`쓰는 때를 밝히지 않는 것 ${r.noWhen.length}${r.noWhen.length ? `: ${r.noWhen.join(', ')}` : ''}`);
console.log(`가장 긴 것: ${r.longest.join(', ')}`);
