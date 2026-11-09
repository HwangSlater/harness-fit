// GitHub 저장소 설정(합치기 방식·브랜치 보호)을 브랜치 방식에 맞춰 켜고, 되돌린다.
// 로컬 훅은 Claude 가 치는 명령만 본다. 웹 화면·gh api·다른 사람이 합치는 길은 GitHub 서버 설정만 막을 수 있다.
// 그래서 사용자가 화면에서(또는 auto 에서 물어보고) 항목마다 분명히 고른 것만 바꾼다(저장소를 같이 쓰는 모든 사람에게 적용된다).
// 어떤 항목을 보여 주고 무엇을 추천할지는 catalog/packs.json flows 의 github 칸(데이터)이 정한다:
//   repo     { squashOnly: true, autoDelete: true }   항목이 있으면 보여 주고, 값은 추천(기본으로 골라 둘지)
//   branches ["{default}", "main|master", "develop"]  "{default}" = 저장소 기본 브랜치, "a|b" = GitHub 에 있는 첫 이름
//   protect  { pullRequest, approvals: 0, noForcePush, noDelete, enforceAdmins }  브랜치마다 같은 항목
//   notes    { pullRequest: { ko, en } }  그 방식에서만 덧붙일 설명
// 항목·선택 계산은 picker/github-plan.js(화면과 같이 쓴다).
// gh·git 은 run(cmd, args, { input }) 한 함수로만 부른다(시험은 가짜 run 을 넣는다. 네트워크 없이).
import { spawn } from 'node:child_process';
import { pickerConfig } from './paths.mjs';
import { latestBackup, undo } from './backup.mjs';
import { PROTECT_KEYS, SHORT, SQUASH_ONLY, defaultChoice, cleanChoice, changesFor } from '../../picker/github-plan.js';

export const REPO_KEYS = ['allow_squash_merge', 'allow_merge_commit', 'allow_rebase_merge', 'delete_branch_on_merge'];
export { PROTECT_KEYS };
const APPROVALS = [0, 1, 2];
const MAX_APPROVALS = 6; // GitHub 이 받는 최대값
// 연결이 안 될 때 gh·git 이 내는 글(오프라인으로 알린다)
const OFFLINE = /timeout|timed out|could not resolve|no such host|dial tcp|connection refused|network is unreachable|error connecting|ENOTFOUND|ECONNRESET|EAI_AGAIN/i;
const REPO_NAME = /^[\w.-]+\/[\w.-]+$/;
const BRANCH_NAME = /^[\w.-]+(\/[\w.-]+)*$/;

const timeoutMs = () => {
  try {
    return pickerConfig().githubTimeoutMs;
  } catch {
    return undefined;
  }
};

// 기본 실행기. 기다리는 동안 고르기 화면 서버가 멈추지 않게 비동기로 돌린다.
// HARNESS_FIT_GH: 시험·화면 점검용 가짜 gh(.mjs 면 node 로 실행). 사용자 환경 변수라 따로 권한을 넓히지 않는다.
export const defaultRunner = (cmd, args, { input } = {}) =>
  new Promise((resolve) => {
    const stub = cmd === 'gh' ? process.env.HARNESS_FIT_GH : null;
    const [bin, argv] = stub ? (/\.m?js$/.test(stub) ? [process.execPath, [stub, ...args]] : [stub, args]) : [cmd, args];
    let out = '';
    let err = '';
    let child;
    try {
      child = spawn(bin, argv, { windowsHide: true, timeout: timeoutMs(), env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } });
    } catch (e) {
      return resolve({ code: null, stdout: '', stderr: '', error: e });
    }
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => resolve({ code: null, stdout: out, stderr: err, error: e }));
    child.on('close', (code, signal) => resolve({ code, stdout: out, stderr: err, timedOut: !!signal }));
    child.stdin.on('error', () => {}); // 실행 파일이 없으면 stdin 쓰기가 EPIPE 로 끝난다
    child.stdin.end(input ?? '');
  });

// origin 주소 → "owner/repo". github.com 의 https·ssh 꼴만(GitHub Enterprise 는 제외).
export const parseRemote = (url) => {
  const m = String(url || '').trim().match(/^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|(?:ssh:\/\/)?git@github\.com[:/])([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
};

const readRemote = async (root, run) => {
  const r = await run('git', ['-C', root, 'remote', 'get-url', 'origin']);
  return r.code === 0 ? parseRemote(r.stdout) : null;
};

// gh api 한 번. 실패하면 HTTP 상태(gh 가 stderr 에 「(HTTP 404)」로 적는다)와 GitHub 의 message 를 돌려준다.
export const ghApi = async (run, method, endpoint, body) => {
  const args = ['api', '-X', method, endpoint, '-H', 'Accept: application/vnd.github+json'];
  if (body !== undefined) args.push('--input', '-');
  const r = await run('gh', args, { input: body !== undefined ? JSON.stringify(body) : undefined });
  if (r.error?.code === 'ENOENT') return { ok: false, status: 0, missing: true, message: 'gh not found' };
  let data = null;
  try {
    data = r.stdout.trim() ? JSON.parse(r.stdout) : null;
  } catch {}
  if (r.code === 0) return { ok: true, status: 200, data };
  const status = Number((String(r.stderr).match(/HTTP (\d{3})/) || [])[1]) || 0;
  const message = String(data?.message || r.stderr || r.error?.message || '').trim().replace(/^gh: /, '');
  return { ok: false, status, message, offline: r.timedOut || (!status && OFFLINE.test(`${r.stderr} ${r.error?.message || ''}`)) };
};

const enc = (b) => encodeURIComponent(b);
const protectionPath = (repo, b) => `repos/${repo}/branches/${enc(b)}/protection`;

// 브랜치 보호 읽기 → { state: 'none' | 'protected' | 'missing'(GitHub 에 브랜치 없음) | 'plan'(요금제 제한) | 'error', protection? }
export const readProtection = async (run, repo, b) => {
  const r = await ghApi(run, 'GET', protectionPath(repo, b));
  if (r.ok) return { state: 'protected', protection: r.data };
  if (r.status === 404 && /not protected/i.test(r.message)) return { state: 'none' };
  if (r.status === 404) return { state: 'missing' };
  // 무료 계정의 비공개 저장소: "Upgrade to GitHub Pro or make this repository public to enable this feature."
  if (r.status === 403 && /upgrade|github pro|make this repository public|plan/i.test(r.message)) return { state: 'plan', message: r.message };
  return { state: 'error', message: r.message, offline: r.offline };
};

// 보호 상태를 우리 낱말로(없으면 모두 꺼짐)
export const protectionState = (p) => ({
  pullRequest: !!p?.required_pull_request_reviews,
  approvals: p?.required_pull_request_reviews ? Number(p.required_pull_request_reviews.required_approving_review_count) || 0 : null,
  noForcePush: !!p && !p.allow_force_pushes?.enabled,
  noDelete: !!p && !p.allow_deletions?.enabled,
  enforceAdmins: !!p?.enforce_admins?.enabled,
});

const names = (list, key) => (Array.isArray(list) ? list.map((x) => String(x?.[key] ?? x)).filter(Boolean) : []);
const who = (o) => (o ? { users: names(o.users, 'login'), teams: names(o.teams, 'slug'), apps: names(o.apps, 'slug') } : null);
// GET 이 돌려주는 꼴 → PUT 이 받는 꼴. 아는 칸만 옮긴다(되돌리기에 쓰이는 백업 기록은 믿지 않으므로 여기서 거른다).
export const toPutBody = (g) => {
  const on = (x) => !!(x && typeof x === 'object' ? x.enabled : x);
  const sc = g?.required_status_checks;
  const pr = g?.required_pull_request_reviews;
  return {
    required_status_checks: sc ? { strict: !!sc.strict, ...(Array.isArray(sc.checks) && sc.checks.length ? { checks: sc.checks.map((c) => ({ context: String(c.context), ...(Number.isInteger(c.app_id) ? { app_id: c.app_id } : {}) })) } : { contexts: names(sc.contexts, 'context') }) } : null,
    enforce_admins: on(g?.enforce_admins),
    required_pull_request_reviews: pr ? {
      dismiss_stale_reviews: !!pr.dismiss_stale_reviews,
      require_code_owner_reviews: !!pr.require_code_owner_reviews,
      required_approving_review_count: Math.min(6, Math.max(0, Number.parseInt(pr.required_approving_review_count, 10) || 0)),
      require_last_push_approval: !!pr.require_last_push_approval,
      ...(pr.dismissal_restrictions ? { dismissal_restrictions: who(pr.dismissal_restrictions) } : {}),
      ...(pr.bypass_pull_request_allowances ? { bypass_pull_request_allowances: who(pr.bypass_pull_request_allowances) } : {}),
    } : null,
    restrictions: who(g?.restrictions),
    required_linear_history: on(g?.required_linear_history),
    allow_force_pushes: g ? on(g.allow_force_pushes) : true,
    allow_deletions: g ? on(g.allow_deletions) : true,
    block_creations: on(g?.block_creations),
    required_conversation_resolution: on(g?.required_conversation_resolution),
    lock_branch: on(g?.lock_branch),
    allow_fork_syncing: on(g?.allow_fork_syncing),
  };
};

// 우리 칸 하나를 PUT 꼴에 얹는다. on: 켜기(승인 수면 그 수) / false: 되돌리기(이전 PUT 꼴 prevBody 의 값)
const setKey = (body, key, on, prevBody) => {
  if (key === 'pullRequest') body.required_pull_request_reviews = on ? body.required_pull_request_reviews || { required_approving_review_count: 0 } : prevBody.required_pull_request_reviews;
  if (key === 'approvals' && body.required_pull_request_reviews) {
    const n = on === false ? prevBody.required_pull_request_reviews?.required_approving_review_count ?? 0 : on;
    body.required_pull_request_reviews = { ...body.required_pull_request_reviews, required_approving_review_count: n };
  }
  if (key === 'noForcePush') body.allow_force_pushes = on ? false : prevBody.allow_force_pushes;
  if (key === 'noDelete') body.allow_deletions = on ? false : prevBody.allow_deletions;
  if (key === 'enforceAdmins') body.enforce_admins = on ? true : prevBody.enforce_admins;
  return body;
};
// 보호가 없던 것과 같은 꼴이면(우리가 켠 것을 빼니 아무것도 안 남으면) 보호를 지운다
const isBare = (b) => JSON.stringify(b) === JSON.stringify(toPutBody(null));

const branchCandidates = (spec, defaultBranch) =>
  (spec?.protect ? spec.branches || [] : []).map((x) => (x === '{default}' ? defaultBranch : x).split('|').filter((n) => BRANCH_NAME.test(n)));

// 저장소가 이 기능을 쓸 수 있는지 + 현재 값. 실패하면 { offered: false, reason } (화면은 이유 한 줄을 보여 준다).
// reason: not-github · no-gh · not-logged-in · offline · not-found · no-admin · error
export const detectGithub = async (root, specs, { run = defaultRunner } = {}) => {
  const repo = await readRemote(root, run);
  if (!repo) return { offered: false, reason: 'not-github' };
  const auth = await run('gh', ['auth', 'status', '--hostname', 'github.com']);
  if (auth.error?.code === 'ENOENT') return { offered: false, reason: 'no-gh', repo };
  if (auth.code !== 0) return { offered: false, reason: OFFLINE.test(`${auth.stderr} ${auth.stdout}`) || auth.timedOut ? 'offline' : 'not-logged-in', repo };
  const info = await ghApi(run, 'GET', `repos/${repo}`);
  if (!info.ok) return { offered: false, reason: info.offline ? 'offline' : info.status === 404 ? 'not-found' : 'error', repo, message: info.message };
  if (!info.data?.permissions?.admin) return { offered: false, reason: 'no-admin', repo };
  const defaultBranch = String(info.data.default_branch || 'main');
  const wanted = [...new Set(specs.flatMap((s) => branchCandidates(s, defaultBranch).flat()))];
  const read = await Promise.all(wanted.map((b) => readProtection(run, repo, b)));
  const current = { repo: Object.fromEntries(REPO_KEYS.map((k) => [k, typeof info.data[k] === 'boolean' ? info.data[k] : null])), branches: Object.fromEntries(wanted.map((b, i) => [b, read[i]])) };
  return { offered: true, repo, private: !!info.data.private, defaultBranch, current };
};

// 고를 항목 목록(지금 값·추천 값 포함). 형태는 picker/github-plan.js 첫머리.
export const itemsFor = (spec, det) => {
  if (!spec || !det?.offered) return [];
  const items = [];
  const r = det.current.repo;
  if (spec.repo && 'squashOnly' in spec.repo) {
    const from = Object.fromEntries(Object.keys(SQUASH_ONLY).map((k) => [k, r[k]]));
    items.push({ id: 'squash', key: 'squash', type: 'toggle', default: spec.repo.squashOnly === true, from, already: Object.entries(SQUASH_ONLY).every(([k, v]) => r[k] === v) });
  }
  if (spec.repo && 'autoDelete' in spec.repo) items.push({ id: 'autodelete', key: 'autodelete', type: 'toggle', default: spec.repo.autoDelete === true, from: r.delete_branch_on_merge, already: r.delete_branch_on_merge === true });
  for (const cands of branchCandidates(spec, det.defaultBranch)) {
    const b = cands.find((n) => det.current.branches[n]?.state !== 'missing') || cands[0];
    if (!b) continue;
    const st = det.current.branches[b] || { state: 'error' };
    if (!['none', 'protected'].includes(st.state)) {
      items.push({ id: `branch:${b}`, branch: b, blocked: st.state });
      continue;
    }
    const now = protectionState(st.protection);
    for (const key of PROTECT_KEYS.filter((k) => k in spec.protect)) {
      const id = `${SHORT[key]}:${b}`;
      if (key === 'approvals') {
        // 이미 PR 을 요구하면 지금 수가 추천 값(바꾸지 않음). 고를 수 있는 값에 지금 수도 넣는다.
        const from = now.approvals;
        const choices = [...new Set([...APPROVALS, ...(from == null ? [] : [Math.min(from, MAX_APPROVALS)])])].sort((x, y) => x - y);
        items.push({ id, key, type: 'select', branch: b, choices, default: from ?? spec.protect.approvals ?? 0, from, prNow: now.pullRequest });
      } else items.push({ id, key, type: 'toggle', branch: b, default: spec.protect[key] === true, from: now[key], already: now[key] });
    }
  }
  return items;
};

// 고르기 화면용: 브랜치 방식마다 고를 항목(한 번 읽어 모든 방식에 쓴다)
export const offerAll = async (root, flows, opts) => {
  const specs = flows.filter((f) => f.github);
  const det = await detectGithub(root, specs.map((f) => f.github), opts);
  if (!det.offered) return { offered: false, reason: det.reason, repo: det.repo || null };
  return { offered: true, repo: det.repo, private: det.private, flows: Object.fromEntries(specs.map((f) => [f.id, itemsFor(f.github, det)])) };
};

// auto 용 미리보기(apply.mjs --dry-run --github-settings): 읽기만 한다. 항목·추천 값·추천대로 하면 바뀔 것.
export const previewGithub = async (root, spec, opts) => {
  if (!spec) return { offered: false, reason: 'no-settings', items: [] };
  const det = await detectGithub(root, [spec], opts);
  if (!det.offered) return { offered: false, reason: det.reason, repo: det.repo || null, items: [] };
  const items = itemsFor(spec, det);
  const defaults = defaultChoice(items);
  return { offered: true, repo: det.repo, private: det.private, items, defaults, changes: changesFor(items, defaults) };
};

// 적용: 지금 값을 다시 읽고(GET), 사용자가 고른 항목(choice)만 바꾸고, 바뀐 것만 이전 값과 함께 record(백업 목록)에 남긴다.
// choice 가 없으면 아무것도 바꾸지 않는다(reason: no-items) — 추천 값으로 알아서 바꾸지 않는다.
// 결과: { offered, repo, results: [{ …바꿀 것, ok, error? }], ok } — 하나라도 안 됐으면 ok 는 false(막힌 것도).
export const applyGithub = async (root, spec, { run = defaultRunner, record = () => {}, choice = null } = {}) => {
  if (!spec) return { offered: false, reason: 'no-settings', results: [], ok: false };
  if (!choice || typeof choice !== 'object') return { offered: false, reason: 'no-items', results: [], ok: false };
  const det = await detectGithub(root, [spec], { run });
  if (!det.offered) return { offered: false, reason: det.reason, repo: det.repo || null, results: [], ok: false };
  const items = itemsFor(spec, det);
  const changes = changesFor(items, cleanChoice(items, choice));
  // 고른 브랜치가 막혀 있으면(요금제·브랜치 없음) 그것도 결과에 남긴다
  const picked = new Set(Object.keys(choice).filter((k) => choice[k] !== false).map((k) => k.split(':')[1]).filter(Boolean));
  for (const i of items.filter((x) => x.blocked && picked.has(x.branch))) changes.push({ scope: 'branch', branch: i.branch, blocked: i.blocked });
  const results = [];
  const done = { repo: det.repo, repoPrev: {}, repoSet: {}, branches: {} };
  const repoCh = changes.filter((c) => c.scope === 'repo');
  if (repoCh.length) {
    const r = await ghApi(run, 'PATCH', `repos/${det.repo}`, Object.fromEntries(repoCh.map((c) => [c.key, c.to])));
    for (const c of repoCh) {
      // 응답에 새 값이 그대로 있어야 바뀐 것으로 본다(조직 정책 등으로 조용히 무시되는 때가 있다)
      const ok = r.ok && r.data?.[c.key] === c.to;
      results.push({ ...c, ok, ...(ok ? {} : { error: r.ok ? 'not-applied' : r.message || `HTTP ${r.status}` }) });
      if (ok && typeof c.from === 'boolean') (done.repoPrev[c.key] = c.from), (done.repoSet[c.key] = c.to);
    }
  }
  const byBranch = new Map();
  for (const c of changes.filter((x) => x.scope === 'branch')) {
    if (c.blocked) results.push({ ...c, ok: false, error: c.blocked });
    else byBranch.set(c.branch, [...(byBranch.get(c.branch) || []), c]);
  }
  for (const [b, list] of byBranch) {
    const prev = det.current.branches[b].protection || null;
    const body = list.reduce((acc, c) => setKey(acc, c.key, c.key === 'approvals' ? c.to : true), toPutBody(prev));
    const r = await ghApi(run, 'PUT', protectionPath(det.repo, b), body);
    const planLimited = r.status === 403 && /upgrade|github pro|make this repository public|plan/i.test(r.message);
    for (const c of list) results.push({ ...c, ok: r.ok, ...(r.ok ? {} : { error: planLimited ? 'plan' : r.message || `HTTP ${r.status}` }) });
    const appr = list.find((c) => c.key === 'approvals');
    if (r.ok) done.branches[b] = { prev, set: list.map((c) => c.key), ...(appr ? { approvals: appr.to } : {}) };
  }
  if (Object.keys(done.repoSet).length || Object.keys(done.branches).length) record(done);
  return { offered: true, repo: det.repo, results, ok: results.every((x) => x.ok) };
};

// 백업 목록에 적힌 기록은 저장소에 심어 둘 수 있다. 아는 칸·꼴만 남긴다.
const sanitize = (rec) => {
  if (!rec || typeof rec !== 'object' || !REPO_NAME.test(String(rec.repo))) return null;
  const bools = (o) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([k, v]) => REPO_KEYS.includes(k) && typeof v === 'boolean'));
  const repoSet = bools(rec.repoSet);
  const repoPrev = bools(rec.repoPrev);
  const branches = {};
  for (const [b, v] of Object.entries(rec.branches && typeof rec.branches === 'object' ? rec.branches : {})) {
    if (!BRANCH_NAME.test(b) || b.includes('..') || !v || typeof v !== 'object') continue;
    const approvals = Number.isInteger(v.approvals) && v.approvals >= 0 && v.approvals <= MAX_APPROVALS ? v.approvals : null;
    const set = (Array.isArray(v.set) ? v.set : []).filter((k) => PROTECT_KEYS.includes(k) && (k !== 'approvals' || approvals !== null));
    if (set.length) branches[b] = { prev: v.prev && typeof v.prev === 'object' ? v.prev : null, set, approvals };
  }
  return { repo: rec.repo, repoSet: Object.fromEntries(Object.entries(repoSet).filter(([k]) => k in repoPrev)), repoPrev, branches };
};

// 되돌리기: 우리가 바꾼 칸만, 그 뒤 누가 다시 바꾸지 않았을 때만 이전 값으로.
// → { repo, restored: [항목], edited: [항목](그 뒤 바뀌어 그대로 둠), failed: [항목 + error, 되돌릴 값] }
export const undoGithub = async (root, rec, { run = defaultRunner } = {}) => {
  const clean = sanitize(rec);
  if (!clean) return { error: 'bad-record' };
  const out = { repo: clean.repo, restored: [], edited: [], failed: [] };
  const origin = await readRemote(root, run);
  if (origin !== clean.repo) return { ...out, error: 'repo-mismatch' }; // 다른 저장소를 건드리지 않는다
  const keys = Object.keys(clean.repoSet);
  if (keys.length) {
    const cur = await ghApi(run, 'GET', `repos/${clean.repo}`);
    if (!cur.ok) keys.forEach((key) => out.failed.push({ scope: 'repo', key, to: clean.repoPrev[key], error: cur.message || 'offline' }));
    else {
      const body = {};
      for (const key of keys) (cur.data?.[key] === clean.repoSet[key] ? (body[key] = clean.repoPrev[key]) : out.edited.push({ scope: 'repo', key }));
      if (Object.keys(body).length) {
        const r = await ghApi(run, 'PATCH', `repos/${clean.repo}`, body);
        for (const [key, to] of Object.entries(body)) (r.ok && r.data?.[key] === to ? out.restored.push({ scope: 'repo', key, to }) : out.failed.push({ scope: 'repo', key, to, error: r.message || 'not-applied' }));
      }
    }
  }
  for (const [b, { prev, set, approvals }] of Object.entries(clean.branches)) {
    const st = await readProtection(run, clean.repo, b);
    if (!['none', 'protected'].includes(st.state)) {
      set.forEach((key) => out.failed.push({ scope: 'branch', branch: b, key, error: st.message || st.state }));
      continue;
    }
    const now = protectionState(st.protection);
    // 우리가 넣은 값이 그대로인 칸만(승인 수는 그 수 그대로일 때)
    const kept = (k) => (k === 'approvals' ? now.approvals === approvals : now[k] === true);
    const still = set.filter(kept);
    set.filter((k) => !kept(k)).forEach((key) => out.edited.push({ scope: 'branch', branch: b, key }));
    if (!still.length) continue;
    const prevBody = toPutBody(prev);
    const body = still.reduce((acc, k) => setKey(acc, k, false, prevBody), toPutBody(st.protection));
    const r = isBare(body) ? await ghApi(run, 'DELETE', protectionPath(clean.repo, b)) : await ghApi(run, 'PUT', protectionPath(clean.repo, b), body);
    for (const key of still) (r.ok ? out.restored : out.failed).push({ scope: 'branch', branch: b, key, ...(r.ok ? {} : { error: r.message || `HTTP ${r.status}` }) });
  }
  return out;
};

// apply.mjs --undo: GitHub 설정을 먼저 되돌리고(기록이 백업 폴더에 있다), 그다음 파일을 되돌린다.
// GitHub 쪽이 실패해도 파일은 되돌린다 — 결과의 github.failed 에 되돌릴 값을 남겨 사용자가 직접 고칠 수 있게 한다.
export const undoWithGithub = async (root, opts) => {
  const found = latestBackup(root);
  const github = found?.manifest?.github ? await undoGithub(root, found.manifest.github, opts) : null;
  return { ...undo(root), ...(github ? { github } : {}) };
};
