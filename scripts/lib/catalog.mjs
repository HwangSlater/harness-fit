// 카탈로그·훅/규칙 묶음·조합을 읽고, 감지 결과로 추천 선택을 만든다.
import { withoutDups, dupHooks, dupSkills, PROBE_FLOW } from '../../picker/dup.js';
import { LIST_MAX } from '../../picker/hook-options.js';
import { fmt } from '../../picker/dom.js';
import { ruleTexts } from './claude-md.mjs';
import { PLUGIN_ROOT, readPluginJson as readJson } from './paths.mjs';
import { rangesWide } from './signals.mjs';

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
  // 의존성을 대부분 범위(^·~)로 두는 저장소면 고정 훅도 뺀다 — 보안 지침의 「정확한 버전으로」 줄({{kind:pinned}})과 같은 기준(역할극 13 회차, 2026-11-13)
  else if (rangesWide(det.depRanges)) hooks['pin-deps'] = { key: 'fitPinRanges', vars: { n: det.depRanges.total, k: det.depRanges.ranged } };
  // 볼 파일이 없는 훅은 켜지 않는다(역할극 2·3·4·6 회차: 화면 없는 저장소에 unsafe-html, 워크플로 없는 저장소에 gha-inject — 2026-11-11).
  // 감지 결과에 그 칸이 없으면(옛 결과·시험) 그대로 둔다.
  if (det.js === false) hooks['unsafe-html'] = { key: 'fitNoJs', vars: {} };
  // JS·TS 는 있어도 화면 파일(HTML·서버 템플릿·JSX/TSX·Vue 등 — detect 의 kinds html)이 없고 웹 스택도 아니면 뺀다:
  // 화면 없는 TS 에이전트·서버에 화면 훅(역할극 6 회차 다시, 2026-11-13). eval 도 보는 훅이라 이유 글에 켤 수 있다고 적는다
  else if (Array.isArray(det.kinds) && !det.kinds.includes('html') && !det.kinds.includes('web')) hooks['unsafe-html'] = { key: 'fitNoUi', vars: {} };
  if (Array.isArray(det.stack) && 'js' in det && !det.stack.includes('GitHub Actions')) hooks['gha-inject'] = { key: 'fitNoWorkflows', vars: {} };
  // GitLab 저장소에 gh 쓰기·PR 병합 훅(역할극 14 회차, 2026-11-12)
  if (det.host === 'gitlab') for (const id of all.combos?.githubOnly?.hooks || []) hooks[id] = { key: 'fitNotGithub', vars: {} };
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
// 커밋 기록이 한 언어로 쓰여 있으면 커밋 메시지 언어 검사(commit-msg lang)를 그 언어로 켠다 — 기록이 모두 한국어인데 「언어는 보지 않음」으로
// 들어가던 일(역할극 2·4·5 회차, 2026-11-11). 기록이 적거나 섞여 있으면 정하지 않는다.
export const commitLang = (h = {}) => {
  const n = h.messages ?? h.subjects ?? 0; // 봇을 뺀 수(옛 감지 결과면 제목 수)
  if (n < FIT_MIN_SUBJECTS) return null;
  if ((h.korean || 0) / n >= FIT_SHARE) return 'ko';
  if ((h.english || 0) / n >= FIT_SHARE) return 'en';
  return null;
};
// 훅 옵션 합치기: 목록은 겹치지 않게 이어 붙이고, 나머지는 뒤의 값
// 합친 목록은 화면·서버의 한도(LIST_MAX)까지 — 앞이 먼저 남는다(저장소에서 찾은 값이 앞, catalog repoAddon).
const mergeOpts = (a = {}, b = {}) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = Array.isArray(v) && Array.isArray(out[k]) ? [...new Set([...out[k], ...v])] : v;
  for (const [k, v] of Object.entries(out)) if (Array.isArray(v) && v.length > LIST_MAX) out[k] = v.slice(0, LIST_MAX);
  return out;
};
const fitIds = (fit, flowId) => new Set([...Object.keys(fit?.hooks || {}), ...Object.keys(fit?.flows?.[flowId] || {})]);

// 이 저장소에 쓸모없어 조합에서 뺄 스킬: GitLab 이면 GitHub 전용, 앱 코드가 없으면(code: false — 인프라만) 시험 먼저 쓰기 스킬.
// 감지 결과에 그 칸이 없으면(옛 결과·시험) 빼지 않는다
const notForRepo = (all, det) => [
  ...(det.host === 'gitlab' ? all.combos.githubOnly?.skills || [] : []),
  ...(det.code === false ? all.combos.codeOnly?.skills || [] : []),
];
// 스택 덧붙임 하나가 이 조합·감지 결과에 들어가는지 — 들어가면 그 덧붙임을 켠 스택들, 아니면 빈 목록.
// onlyIf: 그 조합에서만. unless: 그 스택이 함께 있으면 넣지 않는다(파이썬 스킬이 pre-commit 을 따로 세워 두 번 깔리던 일 — 2026-11-05)
const addonStacks = (a, comboId, det) => {
  if (a.onlyIf && !a.onlyIf.includes(comboId)) return [];
  if (a.unless?.some((s) => det.stack.includes(s))) return [];
  return a.when.filter((s) => det.stack.includes(s));
};
// 이 저장소가 받을 수 있는 CLAUDE.md 지침 묶음 id: 어느 조합에든 든 것 + 감지한 스택에 딸린 것(expandCombo 와 같은 조건).
// overlap.mjs 가 이 묶음의 줄만 보여 준다 — 모든 묶음을 보이자 세션이 감지가 뺀 결제 묶음을 스스로 꺼내 물었다(역할극 13 회차 4차, 2026-11-13)
export const reachableRules = (all, det) => {
  const out = new Set(all.combos.combos.flatMap((c) => c.rules));
  for (const c of all.combos.combos.filter((x) => x.stackAddons)) {
    for (const a of all.combos.stackAddons) if (addonStacks(a, c.id, det).length) for (const id of a.rules || []) out.add(id);
  }
  return all.packs.rules.map((r) => r.id).filter((id) => out.has(id));
};
// 조합 하나를 감지 결과에 맞춰 실제 선택으로 펼친다(스택 스킬·언어별 훅 더하기).
export const expandCombo = (all, comboId, det) => {
  const combo = all.combos.combos.find((c) => c.id === comboId);
  if (!combo) throw new Error(`없는 조합: ${comboId}`);
  const skills = combo.skills.filter((id) => !notForRepo(all, det).includes(id));
  const hooks = [...combo.hooks];
  const added = [];
  const rules = [...combo.rules];
  const addons = []; // 화면에 「Next.js → React 성능 규칙」처럼 이유를 보여 주려고 남긴다
  const addonOpts = {}; // 스택에 딸린 훅 옵션(ROS 2 → ask-cmd 에 ros2 launch — 역할극 2 회차 2차). 목록은 합친다
  if (combo.stackAddons) {
    for (const a of all.combos.stackAddons) {
      const stacks = addonStacks(a, comboId, det);
      if (!stacks.length) continue;
      // 언어별 훅(swift-unsafe 등)은 그 언어를 쓰는 저장소에서만 기본으로 켠다
      const newHooks = (a.hooks || []).filter((id) => !hooks.includes(id));
      for (const [id, o] of Object.entries(a.hookOpts || {})) addonOpts[id] = mergeOpts(addonOpts[id], o);
      hooks.push(...newHooks);
      // 스택에 딸린 지침 묶음(Claude API → llm — 역할극 4·6 회차)
      const newRules = (a.rules || []).filter((id) => !rules.includes(id));
      rules.push(...newRules);
      const fresh = a.skills.filter((id) => !skills.includes(id));
      for (const id of fresh) skills.push(id), added.push(id);
      // 이유 줄: 그 항목을 켠 스택만 적는다(훅·지침도 — 네 번째 검토: Terraform 이 React 스킬의 이유처럼 읽혔다)
      // optWhy: 스택 기본 옵션 값의 까닭(화면이 값마다 보인다 — picker/opt-list.js repoWhy)
      if (fresh.length || newHooks.length || newRules.length || a.hookOpts) addons.push({ stacks, skills: fresh, hooks: newHooks, rules: newRules, hookOpts: a.hookOpts || null, ...(a.optWhy ? { optWhy: a.optWhy } : {}) });
    }
    // 저장소 단서(scripts/lib/suggest.mjs): 긴 학습·배포 명령 → 실행 전에 묻기, .gitignore 의 원본 데이터·비밀 파일 → 보호(역할극 7·8·9 회차)
    const repoAddon = (id, key, list, from) => {
      if (!list?.length) return;
      const fresh = !hooks.includes(id);
      if (fresh) hooks.push(id);
      const o = { [key]: list };
      // 저장소에서 찾은 값을 스택 기본값보다 앞에 — 한도에 걸려 잘릴 때 이 저장소의 출시 명령(fastlane release·match)이 먼저 빠지던 일(정답지 다시 매기기 2026-11-13)
      addonOpts[id] = mergeOpts(o, addonOpts[id]);
      addons.push({ stacks: [], from, skills: [], hooks: fresh ? [id] : [], rules: [], hookOpts: { [id]: o } });
    };
    repoAddon('ask-cmd', 'commands', det.suggest?.ask, 'repo-commands');
    repoAddon('protected-files', 'paths', det.suggest?.protect, 'repo-ignored');
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
  // 이미 있는 훅이 .env·키 파일을 막아 protected-files 를 겹침으로 뺐어도, 저장소에서 찾은 보호 경로(data/raw/ 등)는 그 훅이 지키지 않는다 — 다시 둔다(검토 2026-11-11)
  const revived = det.suggest?.protect?.length && base.hooks.includes('protected-files') && !kept.hooks.includes('protected-files');
  if (revived) kept.hooks.push('protected-files');
  // 다시 둔 훅은 「이미 있음 → 뺌」 이유 줄과 겹침 목록에서도 뺀다(같은 훅이 「뺌」 과 「켜짐」 으로 함께 보이던 일 — 검토 2026-11-11)
  const notRevived = (x) => !(revived && (x.id ?? x) === 'protected-files');
  const already = { hooks: dupHooks(det.existing, share, flowObj).filter((x) => base.hooks.includes(x.id)).filter(notRevived), skills: dupSkills(det.existing, known, share).filter((x) => base.skills.includes(x.id)) };
  // covered: 같은 일을 하는 기존 훅이 있는 훅 전부 — 조합에 없던 훅도(브랜치 방식이 켜려 할 때 막고, 규칙 글을 「켜짐」 기준으로 만들려고)
  const covered = dupHooks(det.existing, share, flowObj).map((x) => x.id).filter(notRevived);
  // 혼자 쓰는 조합에도, 기록이 이미 그 꼴이면(70% 이상 conventional, 5개 넘게) 커밋 형식 검사를 켠다 — 기록의 언어·타입과 함께(역할극 11 회차)
  const h = det.history || {};
  if (combo.stackAddons && !kept.hooks.includes('commit-msg') && !unfit.has('commit-msg') && (h.subjects || 0) >= FIT_MIN_SUBJECTS && h.conventional / h.subjects >= FIT_SHARE && !covered.includes('commit-msg')) {
    kept.hooks.push('commit-msg');
    addons.push({ stacks: [], from: 'history', skills: [], hooks: ['commit-msg'], rules: [], hookOpts: null });
  }
  const lang = kept.hooks.includes('commit-msg') ? commitLang(det.history) : null;
  const hookOpts = Object.fromEntries(Object.entries(addonOpts).filter(([id]) => kept.hooks.includes(id)));
  if (lang) hookOpts['commit-msg'] = { ...hookOpts['commit-msg'], lang };
  // 저장소가 이미 쓰는 표준 밖 타입(bench: 등)은 허용 — 기록이 그 꼴인데 막던 일(역할극 11 회차, 2026-11-11)
  const types = det.history?.extraTypes || [];
  if (types.length && kept.hooks.includes('commit-msg')) hookOpts['commit-msg'] = { ...hookOpts['commit-msg'], types };
  return { combo: comboId, ...kept, hookOpts, base, already, covered, fit, fitDropped, stackSkills: added.filter((id) => kept.skills.includes(id)), addons, rules, flow: combo.flow, share, skipLines: det.skipLines || {}, commands: det.commands || {}, kinds: det.kinds || null };
};

// 원격·운영 명령 묻기를 이유 줄에 한 마디로: 감지된 스택의 명령(catalog/combos.json remoteSay) 몇 개 + ssh
// 「ssh 등 원격 명령」으로만 적어 사용자가 terraform·kubectl·helm 이 이미 묻기 대상인 줄 몰랐다(역할극 15 회차, 2026-11-13)
export const remoteSay = (all, det, lang) => {
  const r = all.combos.remoteSay || {};
  const says = [...(r.stacks || []).filter((x) => det.stack?.includes(x.stack)).slice(0, r.max || 4).map((x) => x.say), ...(r.always ? [r.always.say] : [])];
  return lang === 'ko' ? `${says.join(', ')} 등 원격 명령` : `remote commands such as ${says.join(', ')}`;
};

// 감지 결과 → 추천 조합과 이유(사용자에게 보이는 한 줄들).
export const recommend = (all, det, lang) => {
  const rule = all.combos.recommend.find((r) => holds(r.if, det));
  // 인원을 사용자가 알려 줬으면 커밋 기록에서 읽은 것처럼 쓰지 않는다.
  const why = [det.hinted?.team ? (lang === 'ko' ? '여럿이 개발한다고 알려 주심' : 'You said several people will work on it') : fmt(rule.why[lang] || rule.why.en, det, lang)];
  const sel = expandCombo(all, rule.combo, det);
  const titles = readJson('catalog/titles.json');
  const nameOf = (x, kind) => (kind === 'hook' ? all.packs.hooks.find((h) => h.id === x.id)?.name[lang] : titles[x.id]?.title?.[lang]) || x.id;
  const ruleName = (id) => all.packs.rules.find((r) => r.id === id)?.name[lang] || id;
  // 스택 맞춤마다 한 줄: 「Terraform → 실행 전에 묻기」 「Claude API → LLM 앱(지침)」
  let remoteSaid = false; // 원격 명령 묻기는 이유 줄에 한 번만
  for (const a of sel.addons) {
    // 옵션만 더한 훅(ROS 2 → 실행 전에 묻기(ros2 launch·…))도 이유 줄에 — 명령 두 개까지 보인다
    // ask-cmd 는 원격·운영 명령 묻기가 기본으로 켜져 있다 — 이유 줄에 밝혀 세션이 「켰다」고 말하지 않게(역할극 9 회차 다시)
    const remoteOn = (id) => id === 'ask-cmd' && !remoteSaid && a.hookOpts?.[id]?.remote !== false && (remoteSaid = true);
    const optsOf = (id) => {
      const list = [...(a.hookOpts?.[id]?.commands || a.hookOpts?.[id]?.paths || [])];
      const shown = [...list.slice(0, 2), ...(list.length > 2 ? ['…'] : [])];
      if (remoteOn(id)) shown.push(remoteSay(all, det, lang));
      return shown.length ? `(${shown.join(' · ')})` : '';
    };
    const hookIds = [...new Set([...a.hooks, ...Object.keys(a.hookOpts || {})])].filter((id) => sel.hooks.includes(id));
    const names = [...a.skills.filter((id) => sel.skills.includes(id)).map((id) => nameOf({ id }, 'skill')), ...hookIds.map((id) => `${nameOf({ id }, 'hook')}${optsOf(id)}`), ...a.rules.map((id) => `${ruleName(id)}(${lang === 'ko' ? '지침' : 'rules'})`)];
    // 저장소 단서에서 온 것은 스택 이름 대신 어디서 찾았는지
    const FROM = { history: { ko: '커밋 기록이 이미 feat:·fix: 형식', en: 'Commit history already uses feat:/fix:' }, 'repo-commands': { ko: '저장소에서 찾은 오래 걸리거나 원격에 닿는 명령', en: 'Long-running or remote commands found in the repo' }, 'repo-ignored': { ko: '.gitignore 의 원본 데이터·비밀 파일', en: 'Raw data / secret files in .gitignore' } };
    const head = a.from ? FROM[a.from][lang === 'ko' ? 'ko' : 'en'] : a.stacks.join(' · ');
    if (names.length) why.push(`${head} → ${names.join(', ')}`);
  }
  // 이미 있는 것과 겹쳐 뺀 것(auto 에서도 사용자가 알 수 있게)
  for (const [kind, list] of [['hook', sel.already.hooks], ['skill', sel.already.skills]]) {
    for (const x of list) why.push(lang === 'ko' ? `이미 있음(${x.by.join(', ')}) → 「${nameOf(x, kind)}」 뺌` : `Already covered by ${x.by.join(', ')} → left out "${nameOf(x, kind)}"`);
  }
  // 이 저장소에 쓸모없어 뺀 스킬(훅은 아래 fitOff 이유 줄이 말한다 — 검토 2026-11-12)
  const base = all.combos.combos.find((c) => c.id === sel.combo)?.skills || [];
  for (const id of notForRepo(all, det).filter((x) => base.includes(x))) {
    const gl = (all.combos.githubOnly?.skills || []).includes(id) && det.host === 'gitlab';
    const head = gl ? (lang === 'ko' ? 'GitLab 저장소' : 'GitLab repository') : lang === 'ko' ? '앱 코드가 없는 저장소' : 'No application code';
    why.push(lang === 'ko' ? `${head} → 「${nameOf({ id }, 'skill')}」 뺌` : `${head} → left out "${nameOf({ id }, 'skill')}"`);
  }
  if (det.team && det.host === 'github') applyFlow(all, sel, 'github-flow');
  if (det.hasDevelop) {
    applyFlow(all, sel, 'git-flow');
    why.push(lang === 'ko' ? 'develop 브랜치가 있음 → Git Flow' : 'develop branch found → Git Flow');
  }
  if (sel.hookOpts['commit-msg']?.lang) {
    const ko = sel.hookOpts['commit-msg'].lang === 'ko';
    why.push(lang === 'ko' ? `커밋 기록이 ${ko ? '한국어' : '영어'} → 커밋 메시지를 ${ko ? '한국어' : '영어'}로 쓰는지 검사` : `Commit history is in ${ko ? 'Korean' : 'English'} → commit messages are checked for ${ko ? 'Korean' : 'English'}`);
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

// auto 에서 사용자가 걱정·요청을 말했을 때 Claude 가 카탈로그 파일을 직접 읽지 않고 고를 수 있게 주는 요약(SKILL.md 「Before applying」).
// 훅은 막는 꼴(detail)과 옵션까지 — 근거 문서·보고가 detail 보다 넓게 말하지 않게. 스킬은 이름과 쓰는 때만.
// 역할극 2~5 회차: 세션들이 catalog/packs.json 을 직접 읽거나, 훅이 막지 않는 것을 막는다고 적었다(2026-11-11).
export const catalogDigest = (all, lang) => {
  const pick = (o) => (o && typeof o === 'object' ? o[lang] || o.en : o);
  const titles = readJson('catalog/titles.json');
  return {
    // kind 는 block 이 아닐 때만(notice: 알리기만, ask: 확인 창). 옵션 item 은 목록 한 줄의 꼴(path·branch·command — picker/hook-options.js ITEM)
    hooks: all.packs.hooks.map((h) => ({
      id: h.id, name: pick(h.name), ...(h.kind && h.kind !== 'block' ? { kind: h.kind } : {}), desc: pick(h.desc), blocks: pick(h.detail),
      ...(h.options ? { options: h.options.map((o) => ({ key: o.key, type: o.type, default: o.default, ...(o.item ? { item: o.item } : {}), ...(o.choices ? { choices: o.choices.map((c) => c.value) } : {}), help: pick(o.help) })) } : {}),
    })),
    skills: all.catalog.skills.map((s) => ({ id: s.id, title: pick(titles[s.id]?.title) || s.id, when: pick(titles[s.id]?.when) || '' })),
    // CLAUDE.md 규칙 묶음(selection.rules 에 넣고 뺄 id). 줄 번호는 overlap.mjs 출력의 rules 에 있다.
    rules: all.packs.rules.map((r) => ({ id: r.id, name: pick(r.name) })),
    // 브랜치 방식이 훅 옵션과 막는 꼴을 바꾼다(Git Flow 의 protect-branch 는 develop 도 막는다). 선택의 flow 와 같은 항목의 글을 쓴다 —
    // 이것 없이 기본 글로 「develop 은 안 막는다」고 잘못 말하던 일(역할극 8 회차, 2026-11-11)
    flows: all.packs.flows.map((f) => ({
      id: f.id, name: pick(f.name), hooksOn: f.hooksOn || [], hooksOff: f.hooksOff || [], options: f.hooks || {},
      blocks: Object.fromEntries(Object.entries(f.override || {}).map(([id, o]) => [id, pick(o.detail)])),
    })),
  };
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
