// 카탈로그·훅/규칙 묶음·조합을 읽고, 감지 결과로 추천 선택을 만든다.
import { withoutDups, dupHooks, dupSkills, PROBE_FLOW } from '../../picker/dup.js';
import { fmt } from '../../picker/dom.js';
import { ruleTexts } from './claude-md.mjs';
import { PLUGIN_ROOT, readPluginJson as readJson } from './paths.mjs';

// PLUGIN_ROOT 는 paths.mjs 로 옮겼다(예전 가져오기를 위해 여기서도 내보낸다)
export { PLUGIN_ROOT };

export const loadAll = () => ({
  catalog: readJson('catalog/catalog.json'),
  packs: readJson('catalog/packs.json'),
  combos: readJson('catalog/combos.json'),
  sources: readJson('config/sources.json'),
});

// 조건 문자열: "authors>1", "commits<3", "default"
const holds = (cond, det) => {
  if (cond === 'default') return true;
  const m = cond.match(/^(\w+)([<>]=?|==)(\d+)$/);
  if (!m) return false;
  const v = Number(det[m[1]] ?? 0);
  const n = Number(m[3]);
  return { '>': v > n, '<': v < n, '>=': v >= n, '<=': v <= n, '==': v === n }[m[2]];
};

// 형식 훅은 저장소가 이미 그 꼴을 따를 때만 기본으로 켠다(안 따르는 저장소에 켜면 첫 커밋부터 막힌다 — 2026-11-09 사용자 결정).
// 최근 커밋·브랜치가 FIT_MIN 개보다 적으면 새 저장소로 보고 켠다(지킬 기록이 없다). 의존성 고정은 라이브러리 패키지에서 뺀다.
const FIT_SHARE = 0.7;
const FIT_MIN_SUBJECTS = 5;
const FIT_MIN_BRANCHES = 3;
const BASE_BRANCHES = ['main', 'master', 'develop'];
// → { hooks: { 훅 id: { key, vars } }, flows: { 브랜치 전략 id: { 훅 id: { key, vars } } } } — key 는 화면 문구(picker/i18n main.json)
export const fitOff = (all, det) => {
  const h = det.history || {};
  const hooks = {};
  if ((h.subjects || 0) >= FIT_MIN_SUBJECTS && h.conventional / h.subjects < FIT_SHARE) hooks['commit-msg'] = { key: 'fitCommitMsg', vars: { n: h.subjects, k: h.conventional } };
  if (det.library) hooks['pin-deps'] = { key: 'fitPinDeps', vars: {} };
  const names = (h.branches || []).filter((n) => !BASE_BRANCHES.includes(n) && n !== det.defaultBranch);
  const flows = {};
  for (const f of all.packs.flows) {
    const pattern = f.hooks?.['branch-name']?.pattern;
    if (!pattern || names.length < FIT_MIN_BRANCHES) continue;
    const re = new RegExp(pattern);
    const k = names.filter((n) => re.test(n)).length;
    if (k / names.length < FIT_SHARE) flows[f.id] = { 'branch-name': { key: 'fitBranchName', vars: { n: names.length, k } } };
  }
  return { hooks, flows };
};
const fitIds = (fit, flowId) => new Set([...Object.keys(fit?.hooks || {}), ...Object.keys(fit?.flows?.[flowId] || {})]);

// 조합 하나를 감지 결과에 맞춰 실제 선택으로 펼친다(스택 스킬·언어별 훅 더하기).
export const expandCombo = (all, comboId, det) => {
  const combo = all.combos.combos.find((c) => c.id === comboId);
  if (!combo) throw new Error(`없는 조합: ${comboId}`);
  const skills = [...combo.skills];
  const hooks = [...combo.hooks];
  const added = [];
  const addons = []; // 화면에 「Next.js → React 성능 규칙」처럼 이유를 보여 주려고 남긴다
  if (combo.stackAddons) {
    for (const a of all.combos.stackAddons) {
      if (a.onlyIf && !a.onlyIf.includes(comboId)) continue;
      // unless: 그 스택이 함께 있으면 넣지 않는다(파이썬 스킬이 pre-commit 을 따로 세워 두 번 깔리던 일 — 2026-11-05)
      if (a.unless?.some((s) => det.stack.includes(s))) continue;
      const stacks = a.when.filter((s) => det.stack.includes(s));
      if (!stacks.length) continue;
      // 언어별 훅(swift-unsafe 등)은 그 언어를 쓰는 저장소에서만 기본으로 켠다
      for (const id of a.hooks || []) if (!hooks.includes(id)) hooks.push(id);
      const fresh = a.skills.filter((id) => !skills.includes(id));
      for (const id of fresh) skills.push(id), added.push(id);
      if (fresh.length) addons.push({ stacks, skills: fresh });
    }
  }
  const known = new Set(all.catalog.skills.map((s) => s.id));
  // share: 팀원도 같은 플러그인을 쓰게 안내할지(팀·꼼꼼 조합 기본). 화면과 auto 가 같은 값을 쓴다.
  const share = !!combo.share;
  // base: 겹침을 빼기 전 조합 그대로(화면이 팀원 공유를 바꿀 때 다시 계산하려고 남긴다)
  // 조합의 브랜치 방식이 켜고 끄는 훅도 여기서 맞춘다(pr-merge 처럼 브랜치 방식으로만 들어가는 훅 — 화면 defaultsFor 와 같은 범위)
  const flowObj = all.packs.flows.find((f) => f.id === combo.flow) || null;
  const flowHooks = [...hooks.filter((h) => !(flowObj?.hooksOff || []).includes(h)), ...(flowObj?.hooksOn || [])];
  // fitDropped: 이 저장소 기록과 맞지 않아 기본에서 뺀 형식 훅(화면 훅 단계가 이유를 한 줄로 보여 준다)
  const fit = fitOff(all, det);
  const unfit = fitIds(fit, combo.flow);
  const fitDropped = [...new Set(flowHooks)].filter((h) => unfit.has(h));
  const base = { skills: skills.filter((s) => known.has(s)), hooks: [...new Set(flowHooks)].filter((h) => !unfit.has(h)) };
  const kept = withoutDups(base, det.existing, known, share, flowObj);
  const already = { hooks: dupHooks(det.existing, share, flowObj).filter((x) => base.hooks.includes(x.id)), skills: dupSkills(det.existing, known, share).filter((x) => base.skills.includes(x.id)) };
  // covered: 같은 일을 하는 기존 훅이 있는 훅 전부 — 조합에 없던 훅도(브랜치 방식이 켜려 할 때 막고, 규칙 글을 「켜짐」 기준으로 만들려고)
  const covered = dupHooks(det.existing, share, flowObj).map((x) => x.id);
  return { combo: comboId, ...kept, base, already, covered, fit, fitDropped, stackSkills: added.filter((id) => kept.skills.includes(id)), addons, rules: [...combo.rules], flow: combo.flow, share, skipLines: det.skipLines || {}, commands: det.commands || {} };
};

// 감지 결과 → 추천 조합과 이유(사용자에게 보이는 한 줄들).
export const recommend = (all, det, lang) => {
  const rule = all.combos.recommend.find((r) => holds(r.if, det));
  // 인원을 사용자가 알려 줬으면 커밋 기록에서 읽은 것처럼 쓰지 않는다.
  const why = [det.hinted?.team ? (lang === 'ko' ? '여럿이 개발한다고 알려 주심' : 'You said several people will work on it') : fmt(rule.why[lang] || rule.why.en, det, lang)];
  const sel = expandCombo(all, rule.combo, det);
  if (sel.stackSkills.length) why.push(`${det.stack.join(' · ')} → ${sel.stackSkills.join(', ')}`);
  // 이미 있는 것과 겹쳐 뺀 것(auto 에서도 사용자가 알 수 있게)
  const titles = readJson('catalog/titles.json');
  const nameOf = (x, kind) => (kind === 'hook' ? all.packs.hooks.find((h) => h.id === x.id)?.name[lang] : titles[x.id]?.title?.[lang]) || x.id;
  for (const [kind, list] of [['hook', sel.already.hooks], ['skill', sel.already.skills]]) {
    for (const x of list) why.push(lang === 'ko' ? `이미 있음(${x.by.join(', ')}) → 「${nameOf(x, kind)}」 뺌` : `Already covered by ${x.by.join(', ')} → left out "${nameOf(x, kind)}"`);
  }
  if (det.team && det.host === 'github') applyFlow(all, sel, 'github-flow');
  if (det.hasDevelop) {
    applyFlow(all, sel, 'git-flow');
    why.push(lang === 'ko' ? 'develop 브랜치가 있음 → Git Flow' : 'develop branch found → Git Flow');
  }
  // 저장소 기록과 맞지 않아 기본에서 뺀 형식 훅(auto 보고에도 같은 한 줄 — 화면 훅 단계와 같은 문구)
  const strings = readJson(`picker/i18n/${lang === 'ko' ? 'ko' : 'en'}/main.json`);
  const flowOn = all.packs.flows.find((f) => f.id === sel.flow)?.hooksOn || [];
  const wanted = new Set([...all.combos.combos.find((c) => c.id === sel.combo).hooks, ...flowOn]);
  for (const [id, v] of Object.entries({ ...sel.fit.hooks, ...(sel.fit.flows[sel.flow] || {}) })) {
    if (wanted.has(id)) why.push(`${nameOf({ id }, 'hook')}: ${fmt(strings[v.key], v.vars, lang)}`);
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
    // 이미 CLAUDE.md 에 있어 줄이 다 빠진 규칙은 「들어갔다」고 하지 않는다
    rules: sel.lang ? Object.keys(ruleTexts(sel)).filter((id) => sel.rules.includes(id)).map((id) => name(all.packs.rules, id)) : sel.rules.map((id) => name(all.packs.rules, id)),
  };
};

// 지금 카탈로그에 있는 스킬·훅·규칙 id. 적용할 때 harness.json 에 남겨, 다음에 열 때 그 뒤로 새로 생긴 것을 가려낸다.
export const catalogIds = (all) => ({
  skills: all.catalog.skills.map((s) => s.id),
  hooks: all.packs.hooks.map((h) => h.id),
  rules: all.packs.rules.map((r) => r.id),
});

// 브랜치 방식을 바꾸면 거기에 딸린 훅도 켜고 끈다(정하지 않음 → 보호 브랜치·이름 규칙 끔 등).
// 화면(picker/app.js)도 같은 packs.json 의 hooksOn/hooksOff 로 똑같이 한다.
export const applyFlow = (all, sel, flowId) => {
  const flow = all.packs.flows.find((f) => f.id === flowId);
  if (!flow) return sel;
  sel.flow = flowId;
  // 이미 있는 훅이 같은 일을 하면 브랜치 방식이 켜려는 훅이라도 다시 켜지 않는다
  // 시험 입력은 GitHub Flow 옵션 기준이라, 다른 방식이 옵션을 넣는 훅은 겹침에서 뺀다(picker/dup.js PROBE_FLOW)
  if (flowId !== PROBE_FLOW) sel.covered = (sel.covered || []).filter((h) => !(h in (flow.hooks || {})));
  const dup = new Set(sel.covered || []);
  // 이 저장소 기록과 맞지 않는 형식 훅(fitOff)도 브랜치 전략이 켜지 않는다
  const unfit = fitIds(sel.fit, flowId);
  sel.hooks = [...new Set([...sel.hooks.filter((h) => !flow.hooksOff.includes(h)), ...flow.hooksOn.filter((h) => !dup.has(h) && !unfit.has(h))])];
  return sel;
};
