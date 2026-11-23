// GitLab 저장소의 요금제를 읽어(읽기만 한다) 무엇을 서버에서 강제할 수 없는지 알린다. 설정은 바꾸지 않는다.
// 판단(등급·알림을 보일지)은 picker/gitlab-plan.js, 화면은 picker/gitlab.js, 알림 글은 picker/i18n/*/review.json 의 gl* 와 SKILL.md.
// glab 이 있고 로그인돼 있을 때만 답이 온다. 못 읽어도 적용은 그대로 하고 「요금제를 모른다」로 알린다(level unknown + reason).
// glab·git 은 run(cmd, args, opts) 한 함수로만 부른다(시험은 가짜 run 을 넣는다 — github-settings.mjs 와 같은 꼴).
import path from 'node:path';
import { defaultRunner, OFFLINE } from './github-settings.mjs';
import { pickerConfig } from './paths.mjs';
import { reviewFlowIds, classifyPlan, SELF_MERGE_HOOK } from '../../picker/gitlab-plan.js';

export { classifyPlan, gitlabRelevant } from '../../picker/gitlab-plan.js';

const SEG = /^[\w.-]+$/;
const HOST = /^[a-z0-9][a-z0-9.-]*(?::\d{1,5})?$/i;
const SAAS = 'gitlab.com';

// origin 주소 → { host, path, group(맨 위 그룹) } · 못 읽으면 null.
// https://[사용자@]호스트[:포트]/그룹/…/프로젝트[.git] · ssh://[사용자@]호스트[:포트]/… · 사용자@호스트:그룹/…(scp 꼴).
// ssh 포트는 API 주소가 아니라 버린다. https 포트는 API 도 같은 곳이라 남긴다(기본 :443 은 뗀다). 자체 설치(GitLab Self-Managed) 호스트도 같은 꼴로 읽는다.
// ssh·scp 꼴의 호스트가 ~/.ssh/config 별칭 꼴(gitlab.com-work·gitlab-work — 마지막 칸이 최상위 도메인 꼴이 아님)이면 alias: true(API 호스트를 모른다)
const isAlias = (host) => !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) && host !== 'localhost' && !/\.[a-z]{2,63}$/.test(host);
export const parseGitlabRemote = (url) => {
  const s = String(url || '').trim();
  const web = s.match(/^https?:\/\/(?:[^@/\s]+@)?([^/\s]+)\/(.+?)(?:\.git)?\/?$/i);
  const m = web
    || s.match(/^ssh:\/\/(?:[^@/\s]+@)?([^/:\s]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/i)
    || s.match(/^(?:[^@/\s]+@)?([^/:\s]+):(?!\/)(.+?)(?:\.git)?\/?$/);
  if (!m || !HOST.test(m[1])) return null;
  const parts = m[2].split('/');
  if (parts.length < 2 || !parts.every((p) => SEG.test(p) && p !== '..')) return null;
  const host = m[1].toLowerCase().replace(/:443$/, '');
  return { host, path: parts.join('/'), group: parts[0], ...(!web && isAlias(host) ? { alias: true } : {}) };
};

const timeoutMs = () => {
  try {
    return pickerConfig().gitlabTimeoutMs;
  } catch {
    return undefined;
  }
};

// 토큰 환경 변수는 gitlab.com 이나 사용자가 GITLAB_HOST·GL_HOST 로 정한 호스트에만 넘긴다. glab 은 GITLAB_TOKEN 을 어느 호스트에나 붙이므로,
// origin 이 낯선 호스트를 가리키면 그곳으로 토큰이 갈 수 있다 — 그 밖의 호스트는 glab 에 저장된 그 호스트의 로그인만 쓴다.
// Windows 환경 변수는 대소문자를 가리지 않아 이름을 대문자로 견준다.
const TOKEN_ENV = new Set(['GITLAB_TOKEN', 'GITLAB_ACCESS_TOKEN', 'OAUTH_TOKEN', 'GLAB_TOKEN', 'CI_JOB_TOKEN']);
const hostOfVar = (v) => String(v || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:443$/, '');
const trustedHost = (host, env) => host === SAAS || Object.keys(env).some((k) => ['GITLAB_HOST', 'GL_HOST'].includes(k.toUpperCase()) && hostOfVar(env[k]) === host);
export const envFor = (host, env = process.env) => ({
  GLAB_CHECK_UPDATE: 'false',
  ...(trustedHost(host, env) ? {} : Object.fromEntries(Object.keys(env).filter((k) => TOKEN_ENV.has(k.toUpperCase())).map((k) => [k, undefined]))),
});

const LOGIN = /401|unauthori[sz]ed|not authenticated|authentication|glab auth login|no token|not logged/i;
// 그룹 하나의 요금제 → classifyPlan 꼴 + 못 읽은 까닭(reason: no-glab · not-logged-in · offline · not-found · error)
export const readNamespacePlan = async (run, host, group, timeout = timeoutMs()) => {
  const r = await run('glab', ['api', '--hostname', host, `namespaces/${encodeURIComponent(group)}`], { timeout, env: envFor(host) });
  if (r.error?.code === 'ENOENT') return { level: 'unknown', reason: 'no-glab' };
  if (r.code !== 0) {
    const err = `${r.stderr || ''} ${r.stdout || ''} ${r.error?.message || ''}`;
    const reason = r.timedOut || OFFLINE.test(err) ? 'offline' : LOGIN.test(err) ? 'not-logged-in' : /404/.test(err) ? 'not-found' : 'error';
    return { level: 'unknown', reason };
  }
  try {
    return classifyPlan(JSON.parse(r.stdout));
  } catch {
    return { level: 'unknown', reason: 'error' };
  }
};
// 이 폴더에서 GitLab 인 저장소 폴더: 한 저장소면 det.host, 작업 폴더면 저장소마다(det.workspace[].host — lib/workspace.mjs)
const gitlabDirs = (root, det) => {
  if (Array.isArray(det?.workspace)) return det.workspace.filter((r) => r.host === 'gitlab').map((r) => ({ dir: path.join(root, r.name), name: r.name }));
  return det?.host === 'gitlab' ? [{ dir: root, name: null }] : [];
};

// 고르기 화면·--dry-run 용: GitLab 저장소가 없으면 null. 있으면 그룹마다 한 번 읽는다(작업 폴더의 저장소들이 한 그룹이면 한 번).
// packs: catalog/packs.json(flows 로 MR 방식, hooks 에 self-merge 가 있으면 claudeHook 으로 그 id — 화면이 이름을 카탈로그에서 찾는다)
// → { reviewFlows, claudeHook?, groups: [{ host, group, repos, level, plan?, trialEndsOn?, reason? }] }
// origin 이 없어 그룹을 모르면(.gitlab-ci.yml 로만 GitLab 인 줄 안 때) group 없이 reason: no-remote. ssh 별칭 호스트면 읽지 않고 reason: ssh-alias.
export const gitlabPlans = async (root, det, packs, { run = defaultRunner, timeout } = {}) => {
  const dirs = gitlabDirs(root, det);
  if (!dirs.length) return null;
  const remotes = await Promise.all(dirs.map(async ({ dir }) => {
    const r = await run('git', ['-C', dir, 'remote', 'get-url', 'origin']);
    return r.code === 0 ? parseGitlabRemote(r.stdout) : null;
  }));
  const byKey = new Map();
  dirs.forEach(({ name }, i) => {
    const remote = remotes[i];
    const key = remote ? `${remote.host}/${remote.group}` : '';
    const g = byKey.get(key) || { ...(remote ? { host: remote.host, group: remote.group, ...(remote.alias ? { alias: true } : {}) } : {}), repos: [] };
    if (name) g.repos.push(name);
    byKey.set(key, g);
  });
  const readOne = async ({ alias, ...g }) => {
    if (!g.group) return { ...g, level: 'unknown', reason: 'no-remote' };
    if (alias) return { ...g, level: 'unknown', reason: 'ssh-alias' };
    return { ...g, ...(await readNamespacePlan(run, g.host, g.group, timeout)) };
  };
  const groups = await Promise.all([...byKey.values()].map(readOne));
  const claudeHook = (packs.hooks || []).some((h) => h.id === SELF_MERGE_HOOK) ? { claudeHook: SELF_MERGE_HOOK } : {};
  return { reviewFlows: reviewFlowIds(packs.flows || []), ...claudeHook, groups };
};
