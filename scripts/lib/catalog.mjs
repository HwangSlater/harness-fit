// 카탈로그·훅/규칙 묶음·조합을 읽고, 감지 결과로 추천 선택을 만든다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, rel), 'utf8'));

export const loadAll = () => ({
  catalog: readJson('catalog/catalog.json'),
  packs: readJson('catalog/packs.json'),
  combos: readJson('catalog/combos.json'),
  sources: readJson('config/sources.json'),
});

const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

// 조건 문자열: "authors>1", "commits<3", "default"
const holds = (cond, det) => {
  if (cond === 'default') return true;
  const m = cond.match(/^(\w+)([<>]=?|==)(\d+)$/);
  if (!m) return false;
  const v = Number(det[m[1]] ?? 0);
  const n = Number(m[3]);
  return { '>': v > n, '<': v < n, '>=': v >= n, '<=': v <= n, '==': v === n }[m[2]];
};

// 조합 하나를 감지 결과에 맞춰 실제 선택으로 펼친다(스택 스킬 더하기).
export const expandCombo = (all, comboId, det) => {
  const combo = all.combos.combos.find((c) => c.id === comboId);
  if (!combo) throw new Error(`없는 조합: ${comboId}`);
  const skills = [...combo.skills];
  const added = [];
  const addons = []; // 화면에 「Next.js → React 성능 규칙」처럼 이유를 보여 주려고 남긴다
  if (combo.stackAddons) {
    for (const a of all.combos.stackAddons) {
      if (a.onlyIf && !a.onlyIf.includes(comboId)) continue;
      const stacks = a.when.filter((s) => det.stack.includes(s));
      if (!stacks.length) continue;
      const fresh = a.skills.filter((id) => !skills.includes(id));
      for (const id of fresh) skills.push(id), added.push(id);
      if (fresh.length) addons.push({ stacks, skills: fresh });
    }
  }
  const known = new Set(all.catalog.skills.map((s) => s.id));
  return { combo: comboId, skills: skills.filter((s) => known.has(s)), stackSkills: added, addons, hooks: [...combo.hooks], rules: [...combo.rules], flow: combo.flow };
};

// 감지 결과 → 추천 조합과 이유(사용자에게 보이는 한 줄들).
export const recommend = (all, det, lang) => {
  const rule = all.combos.recommend.find((r) => holds(r.if, det));
  const why = [fill(rule.why[lang] || rule.why.en, det)];
  const sel = expandCombo(all, rule.combo, det);
  if (sel.stackSkills.length) why.push(`${det.stack.join(' · ')} → ${sel.stackSkills.join(', ')}`);
  if (det.team && det.host === 'github') applyFlow(all, sel, 'github-flow');
  if (det.hasDevelop) {
    applyFlow(all, sel, 'git-flow');
    why.push(lang === 'ko' ? 'develop 브랜치가 있음 → Git Flow' : 'develop branch found → Git Flow');
  }
  return { ...sel, lang, why };
};

// 사용자에게 보여 줄 이름(id 대신). 터미널 보고에서 스킬·훅·규칙을 나눠 보여 주려고 종류별로 묶는다.
export const labelsFor = (all, sel, lang) => {
  const name = (list, id) => list.find((x) => x.id === id)?.name[lang] || id;
  const titles = readJson('catalog/titles.json');
  return {
    combo: name(all.combos.combos, sel.combo),
    flow: name(all.packs.flows, sel.flow),
    skills: sel.skills.map((id) => titles[id]?.title?.[lang] || id),
    hooks: sel.hooks.map((id) => name(all.packs.hooks, id)),
    rules: sel.rules.map((id) => name(all.packs.rules, id)),
  };
};

// 브랜치 방식을 바꾸면 거기에 딸린 훅도 켜고 끈다(정하지 않음 → 보호 브랜치·이름 규칙 끔 등).
// 화면(picker/app.js)도 같은 packs.json 의 hooksOn/hooksOff 로 똑같이 한다.
export const applyFlow = (all, sel, flowId) => {
  const flow = all.packs.flows.find((f) => f.id === flowId);
  if (!flow) return sel;
  sel.flow = flowId;
  sel.hooks = [...new Set([...sel.hooks.filter((h) => !flow.hooksOff.includes(h)), ...flow.hooksOn])];
  return sel;
};
