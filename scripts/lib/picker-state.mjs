// 고르기 화면에 보낼 상태와, 화면이 보낸 선택 검증. 두 언어 문구 중 고른 것만 보낸다.
import fs from 'node:fs';
import path from 'node:path';
import { recommend, expandCombo, catalogIds, PLUGIN_ROOT } from './catalog.mjs';
import { ruleTokens, estimateTokens } from './tokens.mjs';
import { renderRule, ruleHookTags } from './claude-md.mjs';
import { UNDO_COMMAND } from './backup.mjs';
import { cleanHookOpts } from '../../picker/hook-options.js';
import { CONFIG_FILE, MAX_CONFIG_BYTES } from '../../hooks/lib/core.mjs';

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, rel), 'utf8'));
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const NO_NEW = Object.freeze({ skills: [], hooks: [], rules: [] });

// 화면 문구: picker/i18n/<lang>/*.json 을 이름 순으로 합친다(화면 구역마다 파일 하나 — 같은 키가 두 파일에 있지 않은지는 시험이 본다).
export const readStrings = (lang) => {
  const dir = path.join(PLUGIN_ROOT, 'picker', 'i18n', lang);
  return Object.assign({}, ...fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))));
};

// 프로젝트의 .claude/harness.json. 없거나 깨졌거나 너무 크면(훅과 같은 한도) null(지난번 선택 없이 추천에서 시작한다).
export const readHarnessConfig = (root) => {
  try {
    const file = path.join(root, CONFIG_FILE);
    if (fs.statSync(file).size > MAX_CONFIG_BYTES) return null;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    return isObj(raw) ? raw : null;
  } catch {
    return null;
  }
};

// harness.json → 지난번에 적용한 선택(카탈로그에서 없어진 id 는 cleanSelection 이 버린다). 켠 훅은 rules 가 정본.
// v0.2.2 이하가 쓴 파일(selection 없음)은 맨 위 combo·flow·skills 를 읽고, 적어 두지 않았던 CLAUDE.md 규칙·팀 공유는 그 조합의 기본값으로 채운다.
export const previousOf = ({ all, cfg }, raw, lang) => {
  if (!isObj(raw)) return null;
  const legacy = !isObj(raw.selection);
  const src = legacy ? raw : raw.selection;
  const combo = all.combos.combos.find((c) => c.id === src.combo);
  if (legacy && !combo) return null; // 무엇을 골랐는지 알 수 없다
  const rules = isObj(raw.rules) ? raw.rules : {};
  const sel = cleanSelection({ all, cfg }, {
    combo: src.combo, flow: src.flow, skills: src.skills,
    hooks: Object.keys(rules).filter((id) => rules[id]),
    rules: legacy ? combo.rules : src.rules,
    share: legacy ? !!combo.share : src.share,
  }, lang);
  const at = !legacy && /^\d{4}-\d{2}-\d{2}$/.test(src.at) ? src.at : null;
  return { combo: sel.combo, flow: sel.flow, skills: sel.skills, hooks: sel.hooks, rules: sel.rules, share: sel.share, at };
};

// 지난번 적용 뒤 카탈로그에 새로 생긴 스킬·훅·규칙 id. 적용 때 남긴 목록(known)이 없으면 알 수 없으므로 비운다.
// 훅과 같은 일을 하는 스킬은 고를 목록에 안 나오므로 뺀다(picker/stats.js listable 과 같은 기준).
export const newSinceOf = (all, raw) => {
  const known = isObj(raw?.known) ? raw.known : {};
  const now = catalogIds(all);
  const hookIds = new Set(now.hooks);
  const listable = new Set(all.catalog.skills.filter((s) => !(s.overlapsHook && hookIds.has(s.overlapsHook))).map((s) => s.id));
  const fresh = (kind, keep = () => true) => (Array.isArray(known[kind]) ? now[kind].filter((id) => !known[kind].includes(id) && keep(id)) : []);
  return { skills: fresh('skills', (id) => listable.has(id)), hooks: fresh('hooks'), rules: fresh('rules') };
};

// prev: 지금 .claude/harness.json(readHarnessConfig 결과, picker.mjs 가 한 번 읽어 둔다).
// 그 rules 는 화면이 옵션의 지난번 값을 보여 주는 데(prevRules), selection 은 지난번 선택에서 시작하는 데 쓴다.
export const makeState = ({ all, det, cfg, prev = null }, lang) => {
  // 이 저장소 명령(commands)은 찾은 명령이 없으면 고를 목록·조합 기본값에서 뺀다(넣을 글이 없다)
  const cmds = det.commands || {};
  const hasCmds = Object.keys(cmds).length > 0;
  const keepRule = (id) => id !== 'commands' || hasCmds;
  const tokens = ruleTokens(PLUGIN_ROOT, lang);
  // 언어·도구별 훅(combos.json stackAddons): 그 스택이 이 저장소에 있을 때만 「차단하는 것만」이 켠다
  const stackOf = (id) => {
    const adds = (all.combos.stackAddons || []).filter((a) => a.hooks?.includes(id));
    return adds.length ? { stackOnly: true, stackMatch: adds.some((a) => a.when.some((s) => det.stack?.includes(s))) } : {};
  };
  tokens.commands = hasCmds ? estimateTokens(renderRule('commands', lang, [], [], [], cmds)) : 0;
  const titles = readJson('catalog/titles.json');
  const L = (o) => (o ? o[lang] || o.en : '');
  const repoBy = Object.fromEntries(all.catalog.repos.map((r) => [r.repo, r]));
  const Lmap = (o) => Object.fromEntries(Object.entries(o || {}).map(([id, v]) => [id, Object.fromEntries(Object.entries(v).map(([k, x]) => [k, L(x)]))]));
  const previous = previousOf({ all, cfg }, prev, lang);
  return {
    lang,
    detected: det,
    recommended: recommend(all, det, lang),
    // 이 프로젝트에 전에 적용한 적이 있으면 화면은 추천 대신 이것에서 시작한다.
    previous,
    newSince: previous ? newSinceOf(all, prev) : NO_NEW,
    checkedAt: all.catalog.checkedAt,
    contextTokens: cfg.contextTokens,
    noteMax: cfg.noteMaxChars,
    undoCommand: UNDO_COMMAND,
    pluginRepo: all.sources.pluginRepo,
    pluginRef: all.sources.pluginRef,
    combos: all.combos.combos.map((c) => { const k = expandCombo(all, c.id, det); return { id: c.id, name: L(c.name), desc: L(c.desc), for: L(c.for), ...k, rules: k.rules.filter(keepRule) }; }),
    skills: all.catalog.skills.map((s) => ({
      id: s.id, repo: s.repo, stars: repoBy[s.repo]?.stars, license: repoBy[s.repo]?.license, sha: (repoBy[s.repo]?.sha || '').slice(0, 7),
      stages: s.stages, stacks: s.stacks, needs: s.needs, summary: L(s.summary), always: s.always, onUse: s.onUse, install: s.install,
      files: s.files, scripts: s.scripts || [], overlapsHook: s.overlapsHook || null,
      title: L(titles[s.id]?.title) || s.id, when: L(titles[s.id]?.when) || L(s.summary),
    })),
    // 훅 묶음(화면은 이 순서로 묶어 보여 주고, 훅이 하나도 없는 묶음은 숨긴다). 묶음에 없는 group 은 화면이 「그 밖」으로 모은다.
    hookGroups: (all.packs.hookGroups || []).map((g) => ({ id: g.id, name: L(g.name), desc: L(g.desc) })),
    hooks: all.packs.hooks.map((h) => ({ id: h.id, group: h.group || null, kind: h.kind, ...stackOf(h.id), name: L(h.name), desc: L(h.desc), bad: L(h.example?.bad), fix: L(h.example?.fix), detail: L(h.detail),
      options: (h.options || []).map((o) => ({ ...o, label: L(o.label), help: L(o.help), choices: o.choices?.map((c) => ({ value: c.value, label: L(c.label) })) })) })),
    prevRules: isObj(prev?.rules) ? prev.rules : {},
    rules: all.packs.rules.filter((r) => keepRule(r.id)).map((r) => ({ id: r.id, name: L(r.name), desc: L(r.desc) })),
    // 지침마다 「켜면 그 줄을 대신 맡는 훅」(rules/*.md 의 {{!hook:id}}) — 화면 「줄을 대신 맡는 훅」 칩
    ruleHooks: ruleHookTags(lang),
    flows: all.packs.flows.map((f) => ({ id: f.id, name: L(f.name), desc: L(f.desc), for: L(f.for), hooksOn: f.hooksOn, hooksOff: f.hooksOff, override: Lmap(f.override), hooks: f.hooks || {}, githubNotes: Object.fromEntries(Object.entries(f.github?.notes || {}).map(([k, v]) => [k, L(v)])) })),
    ruleTokens: tokens,
    overlaps: readJson('catalog/overlaps.json').groups.map((g) => g.skills), // 하는 일이 같은 스킬 묶음(화면이 「비슷한 스킬이 이미 들어 있어요」를 보여 준다)
    strings: readStrings(lang),
  };
};

// 화면이 보낸 선택에서 카탈로그에 있는 것만 남긴다.
// det.commands: 서버가 저장소에서 읽은 명령(화면이 보낸 값은 받지 않는다 — CLAUDE.md 에 들어갈 글이라).
export const cleanSelection = ({ all, cfg, det }, sel, fallbackLang) => {
  const ids = (list, known) => [...new Set((Array.isArray(list) ? list : []).filter((x) => known.has(x)))];
  return {
    lang: sel.lang === 'ko' || sel.lang === 'en' ? sel.lang : fallbackLang,
    combo: all.combos.combos.some((c) => c.id === sel.combo) ? sel.combo : '',
    skills: ids(sel.skills, new Set(all.catalog.skills.map((s) => s.id))),
    hooks: ids(sel.hooks, new Set(all.packs.hooks.map((h) => h.id))),
    // 이미 있는 훅이 같은 일을 해서 끈 것(규칙 글을 「켜짐」 기준으로 만들려고)
    covered: ids(sel.covered, new Set(all.packs.hooks.map((h) => h.id))),
    rules: ids(sel.rules, new Set(all.packs.rules.map((r) => r.id))),
    flow: all.packs.flows.some((f) => f.id === sel.flow) ? sel.flow : 'none',
    commands: det?.commands || {},
    explore: (Array.isArray(sel.explore) ? sel.explore : []).filter((r) => /^[\w.-]+\/[\w.-]+$/.test(r)).slice(0, 10),
    share: sel.share === true,
    // GitHub 저장소 설정도 바꿀지(화면의 스위치를 켰을 때만 true. 기본 꺼짐 — scripts/lib/github-settings.mjs)
    github: sel.github === true,
    // 화면에서 고른 GitHub 항목({ 항목 id: true·false·승인 수 }). 적용할 때 GitHub 에서 다시 읽은 항목으로 한 번 더 거른다(github-plan.js cleanChoice).
    githubChoice: Object.fromEntries(Object.entries(sel.githubChoice && typeof sel.githubChoice === 'object' ? sel.githubChoice : {})
      .filter(([k, v]) => /^[a-z]+(:[\w./-]+)?$/.test(k) && (typeof v === 'boolean' || (Number.isInteger(v) && v >= 0 && v <= 6))).slice(0, 40)),
    // 훅 옵션({ 훅 id: { key: 값 } }) — packs.json 의 옵션 꼴에 맞는 값만
    hookOpts: cleanHookOpts(all.packs.hooks, sel.hookOpts),
    // 사용자가 직접 쓴 수정 요청. .claude/harness-request.md 에 남기고, 적용 뒤 Claude 가 읽고 반영한다.
    note: typeof sel.note === 'string' ? sel.note.trim().slice(0, cfg.noteMaxChars) : '',
    // 이미 CLAUDE.md 에 있어 넣지 않을 규칙 줄(아는 규칙·브랜치 방식 id 와 양의 정수만)
    skipLines: Object.fromEntries(Object.entries(sel.skipLines && typeof sel.skipLines === 'object' ? sel.skipLines : {})
      .filter(([id]) => all.packs.rules.some((r) => r.id === id) || all.packs.flows.some((f) => f.id === id))
      .map(([id, v]) => [id, (Array.isArray(v) ? v : []).filter((n) => Number.isInteger(n) && n > 0)])),
  };
};
