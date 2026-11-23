// GitLab 요금제 알림 상자: 확인 단계와 끝 화면. 설정은 바꾸지 않고, 그 요금제에서 서버가 강제할 수 없는 것과 대신 지킬 길을 알린다.
// 답은 GET /api/github 의 gitlab 칸(서버 scripts/lib/gitlab-settings.mjs). 보일지·문구 키는 서버와 같은 picker/gitlab-plan.js.
// GitLab 이 돌려준 글(그룹·요금제 이름)도 textContent 로만 넣는다(dom.js 의 h).
import { h } from './dom.js';
import { lrow, btn, noteList } from './parts.js';
import { hookBy } from './stats.js';
import { gitlabRelevant, planName, headKey, RETRY_REASONS } from './gitlab-plan.js';

const headOf = (t, x) => {
  const group = x.group || t('glNoGroup');
  if (x.level === 'unknown') return t('glHead_unknown', { group, reason: t(`glReason_${x.reason || 'error'}`) });
  return t(headKey(x), { group, plan: planName(x.plan), date: x.trialEndsOn || '' });
};
const descOf = (t, x) => (x.level === 'trial' && !x.trialEndsOn ? t('glD_trial_nodate') : t(`glD_${x.level}`, { date: x.trialEndsOn || '' }));

// 대신 지킬 길(Free·체험판·모름일 때): Claude 쪽 훅(카탈로그에 있을 때만, 이름은 카탈로그에서) · 사람 쪽 약속 · CI 관문
const alternatives = ({ S, t }, g) => {
  const hook = g.claudeHook ? hookBy(S, g.claudeHook) : null;
  return [hook ? t('glAltClaude', { name: hook.name }) : null, t('glAltPeople'), t('glAltCi')].filter(Boolean);
};

export function gitlabBox(c) {
  const { sel, ui, t, act } = c;
  const g = ui.github?.gitlab;
  if (!gitlabRelevant(g, sel)) return null;
  const weak = g.groups.some((x) => x.level !== 'paid');
  // 「다시 확인」: GitHub 상자와 같은 단추·동작(/api/github?refresh=1 이 GitLab 도 다시 읽는다). 끝 화면에서는 보이지 않는다
  const retry = (x) => (ui.done === undefined && x.level === 'unknown' && RETRY_REASONS.includes(x.reason) ? [btn('glRetry', t('ghRecheck'), act.retryGithub)] : []);
  return h('div.box.gl', { role: 'note' },
    h('div.box-h', {}, h('span', {}, t(weak ? 'glTitle' : 'glTitlePaid'))),
    g.groups.map((x) => lrow({ title: headOf(t, x), desc: descOf(t, x), extra: x.repos?.length ? h('span.d.mono', {}, t('glRepos', { list: x.repos.join(', ') })) : null, tail: retry(x) })),
    weak ? h('div.lrow', {}, h('div.main', {}, noteList({ title: t('glInstead'), items: alternatives(c, g) }))) : null);
}
