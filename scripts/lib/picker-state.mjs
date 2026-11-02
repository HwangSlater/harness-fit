// 고르기 화면에 보낼 상태와, 화면이 보낸 선택 검증. 두 언어 문구 중 고른 것만 보낸다.
import fs from 'node:fs';
import path from 'node:path';
import { recommend, expandCombo, PLUGIN_ROOT } from './catalog.mjs';
import { ruleTokens } from './tokens.mjs';
import { UNDO_COMMAND } from './backup.mjs';

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, rel), 'utf8'));

export const makeState = ({ all, det, cfg }, lang) => {
  const titles = readJson('catalog/titles.json');
  const L = (o) => (o ? o[lang] || o.en : '');
  const repoBy = Object.fromEntries(all.catalog.repos.map((r) => [r.repo, r]));
  const Lmap = (o) => Object.fromEntries(Object.entries(o || {}).map(([id, v]) => [id, Object.fromEntries(Object.entries(v).map(([k, x]) => [k, L(x)]))]));
  return {
    lang,
    detected: det,
    recommended: recommend(all, det, lang),
    checkedAt: all.catalog.checkedAt,
    contextTokens: cfg.contextTokens,
    noteMax: cfg.noteMaxChars,
    undoCommand: UNDO_COMMAND,
    pluginRepo: all.sources.pluginRepo,
    pluginRef: all.sources.pluginRef,
    combos: all.combos.combos.map((c) => ({ id: c.id, name: L(c.name), desc: L(c.desc), for: L(c.for), ...expandCombo(all, c.id, det) })),
    skills: all.catalog.skills.map((s) => ({
      id: s.id, repo: s.repo, stars: repoBy[s.repo]?.stars, license: repoBy[s.repo]?.license, sha: (repoBy[s.repo]?.sha || '').slice(0, 7),
      stages: s.stages, stacks: s.stacks, needs: s.needs, summary: L(s.summary), always: s.always, onUse: s.onUse, install: s.install,
      files: s.files, scripts: s.scripts || [], overlapsHook: s.overlapsHook || null,
      title: L(titles[s.id]?.title) || s.id, when: L(titles[s.id]?.when) || L(s.summary),
    })),
    hooks: all.packs.hooks.map((h) => ({ id: h.id, name: L(h.name), desc: L(h.desc), bad: L(h.example?.bad), fix: L(h.example?.fix), detail: L(h.detail) })),
    rules: all.packs.rules.map((r) => ({ id: r.id, name: L(r.name), desc: L(r.desc) })),
    flows: all.packs.flows.map((f) => ({ id: f.id, name: L(f.name), desc: L(f.desc), for: L(f.for), hooksOn: f.hooksOn, hooksOff: f.hooksOff, override: Lmap(f.override) })),
    ruleTokens: ruleTokens(PLUGIN_ROOT, lang),
    strings: readJson(`picker/i18n/${lang}.json`),
  };
};

// 화면이 보낸 선택에서 카탈로그에 있는 것만 남긴다.
export const cleanSelection = ({ all, cfg }, sel, fallbackLang) => {
  const ids = (list, known) => [...new Set((Array.isArray(list) ? list : []).filter((x) => known.has(x)))];
  return {
    lang: sel.lang === 'ko' || sel.lang === 'en' ? sel.lang : fallbackLang,
    combo: String(sel.combo || ''),
    skills: ids(sel.skills, new Set(all.catalog.skills.map((s) => s.id))),
    hooks: ids(sel.hooks, new Set(all.packs.hooks.map((h) => h.id))),
    rules: ids(sel.rules, new Set(all.packs.rules.map((r) => r.id))),
    flow: all.packs.flows.some((f) => f.id === sel.flow) ? sel.flow : 'none',
    explore: (Array.isArray(sel.explore) ? sel.explore : []).filter((r) => /^[\w.-]+\/[\w.-]+$/.test(r)).slice(0, 10),
    share: sel.share === true,
    // 사용자가 직접 쓴 수정 요청. .claude/harness-request.md 에 남기고, 적용 뒤 Claude 가 읽고 반영한다.
    note: typeof sel.note === 'string' ? sel.note.trim().slice(0, cfg.noteMaxChars) : '',
  };
};
