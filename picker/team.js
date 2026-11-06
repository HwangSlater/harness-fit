// 팀원도 같은 훅을 쓸지(sel.share → .claude/settings.json 의 extraKnownMarketplaces·enabledPlugins, apply.mjs buildSettings).
// 브랜치 전략을 정했으면 확인 단계에서 꼭 묻는다(답하기 전엔 적용 단추를 잠근다). 「네」면 팀원이 할 일을 코드가 실제로 하는 대로 보여 준다.
import { h } from './dom.js';
import { lrow, toggleSwitch } from './parts.js';

// 저장소에 올라가 팀원에게 가는 것(apply.mjs plan 의 kind). git 훅(.git/hooks)·백업은 올라가지 않는다.
export const SHARED_KINDS = new Set(['config', 'claude-md', 'share', 'gitignore', 'skill']);
export const mustAsk = (sel) => sel.flow !== 'none';
export const shareOpen = (sel, ui) => mustAsk(sel) && !ui.shareAnswered;

// 커밋하고 푸시할 파일(스킬은 폴더 하나씩). p = 미리보기
export const sharedPaths = (p) => [...new Set((p?.changes || []).filter((x) => SHARED_KINDS.has(x.kind)).map((x) => (x.kind === 'skill' ? `${x.path}/` : x.path)))];

// 팀원이 할 일. done = 끝 화면(이미 적용함)
export function teamHowTo({ S, t }, p, done = false) {
  const files = sharedPaths(p);
  const steps = [
    [t(done ? 'teamStep1Done' : 'teamStep1'), files.length ? h('ul.files', {}, files.map((f) => h('li.mono', {}, f))) : null],
    [t('teamStep2', { repo: S.pluginRepo, ref: S.pluginRef })],
    [t('teamStep3')],
    [t('teamStep4'), h('p.hint', {}, t('teamStep4D'))],
  ];
  return h('div.box.team', {},
    h('div.box-h', {}, h('span', {}, t('teamHowTitle'))),
    h('ol.team-steps', {}, steps.map(([title, extra]) => h('li', {}, h('span', {}, title), extra || null))));
}

// 확인 단계 상자
export function teamBox(c) {
  const { S, sel, ui, t, act } = c;
  if (!mustAsk(sel)) {
    return h('div.box', {}, lrow({ id: 'lb-share', title: t('shareTitle'), desc: t('shareD'), extra: h('span.d', {}, t('sharePin', { repo: S.pluginRepo, ref: S.pluginRef })),
      tail: [toggleSwitch(t, { key: 'share', on: sel.share, labelId: 'lb-share', onToggle: () => act.answerShare(!sel.share) })] }));
  }
  const ans = ui.shareAnswered ? sel.share : null;
  const pick = (v, text) => h(`button.btn${ans === v ? '.on' : ''}`, { type: 'button', 'data-key': `share:${v}`, 'aria-pressed': String(ans === v), on: { click: () => act.answerShare(v) } }, text);
  return h('div.stack', {},
    h(`div.box${ans === null ? '.ask' : ''}`, {},
      h('div.lrow.ask', {}, h('div.main', {}, h('b', { id: 'q-share' }, t('teamQ')), h('span.d', {}, t('teamQD')), ans === null ? h('span.d.warn', {}, t('teamQNeed')) : null),
        h('div.yn', { role: 'group', 'aria-labelledby': 'q-share' }, pick(true, t('yes')), pick(false, t('no'))))),
    ans ? teamHowTo(c, ui.preview && !ui.preview.error ? ui.preview : null) : null);
}
