// GitLab 요금제 알림의 판단(서버 scripts/lib/gitlab-settings.mjs 와 화면 picker/gitlab.js 가 같이 쓴다 — 브라우저에서도 돌므로 node: 모듈 없이).
// GitLab 은 「필요한 승인 수」·승인 규칙·CODEOWNERS 승인을 Premium 부터 강제한다. Free 의 보호 브랜치는 역할로만 나눠서
// 모두 Owner·Maintainer 인 팀은 「작성자는 병합 못 함」을 걸 수 없다(2026-11-21 실제 팀 저장소 — GitLab 체험판이 끝나면 풀리는 것을 아무도 몰랐다).

// 알림을 보일 팀 조합 id(catalog/combos.json)
export const TEAM_COMBO = 'team';

// MR 로 병합하는 브랜치 방식: packs.json flows 의 github.protect 에 pullRequest 칸이 있는 것(github-flow·git-flow).
// 방식 id 를 코드에 적지 않고 데이터에서 읽는다(새 방식을 더해도 따라온다)
export const reviewFlowIds = (flows) => flows.filter((f) => f.github?.protect && 'pullRequest' in f.github.protect).map((f) => f.id);

// 요금제 이름 → 등급. GitLab.com 의 namespaces API plan 값(free · premium · ultimate · *_trial · opensource, 옛 bronze·silver·gold).
// 체험판은 trial 이 참이거나 이름이 _trial 로 끝난다. 유료 고객이 상위 등급을 체험하는 ultimate_trial_paid_customer 는 체험이 끝나도 유료라 paid.
const PAID = /premium|ultimate|silver|gold|bronze|opensource|starter/;
const PLAN_NAME = /^[a-z0-9_-]{1,40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// → { level: 'free' | 'trial' | 'paid' | 'unknown', plan?, trialEndsOn?, reason? }. API 가 준 글은 꼴을 검사해 아는 것만 남긴다
export const classifyPlan = (ns) => {
  const raw = typeof ns?.plan === 'string' ? ns.plan.toLowerCase() : '';
  const plan = PLAN_NAME.test(raw) ? raw : null;
  const ends = typeof ns?.trial_ends_on === 'string' && DATE.test(ns.trial_ends_on) ? ns.trial_ends_on : null;
  // plan 칸이 없다: 그룹 Owner 가 아니거나 자체 설치(GitLab Self-Managed)라 요금제를 알려 주지 않는다
  if (!plan) return { level: 'unknown', reason: 'no-plan' };
  if (/paid_customer/.test(plan)) return { level: 'paid', plan };
  if (ns.trial === true || /_trial$/.test(plan)) return { level: 'trial', plan, ...(ends ? { trialEndsOn: ends } : {}) };
  if (plan === 'free') return { level: 'free', plan };
  if (PAID.test(plan)) return { level: 'paid', plan };
  return { level: 'unknown', plan, reason: 'no-plan' };
};

// Claude 쪽 대신 지킬 길: 이 훅이 카탈로그에 있을 때만 이름(카탈로그 데이터)을 보인다 — 없으면 그 줄을 뺀다
export const SELF_MERGE_HOOK = 'self-merge';

// API 요금제 이름 → GitLab 이 화면에 쓰는 이름(ultimate_trial → Ultimate, opensource → Open Source Program)
const PLAN_LABEL = { opensource: 'Open Source Program' };
export const planName = (p) => {
  const base = String(p || '').replace(/_trial.*$/, '');
  return PLAN_LABEL[base] || base.split('_').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
};

// 그룹 한 줄 제목의 문구 키(picker/i18n/*/review.json glHead_*) — 끝나는 날을 모르는 체험판은 따로
export const headKey = (x) => (x.level === 'trial' && !x.trialEndsOn ? 'glHead_trial_nodate' : `glHead_${x.level}`);

// 다시 읽으면 달라질 수 있는 까닭(화면의 「다시 확인」 단추 — GitHub 상자와 같은 기준)
export const RETRY_REASONS = ['no-glab', 'not-logged-in', 'offline', 'error'];

// 이 선택에서 알림을 보일지: GitLab 저장소를 읽었고(g.groups) MR 방식이거나 팀 조합일 때
export const gitlabRelevant = (g, sel) => !!g?.groups?.length && ((g.reviewFlows || []).includes(sel?.flow) || sel?.combo === TEAM_COMBO);
