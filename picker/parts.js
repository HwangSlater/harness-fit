// 화면 부품 한 벌(꼴은 components.css): 칩·스위치·체크 줄·구획 머리·묶음 줄·목록 줄·이름표·알림 띠.
// 단계·창은 모두 이 함수들로만 만든다. 글은 h() 를 거쳐 textContent 로만 들어간다.
import { h, icon } from './dom.js';

// GitHub 별 수: 브라우저의 언어별 짧은 수 표기(한국어 1.2만·3.4천, 영어 12K). 단위 글자를 코드에 두지 않는다.
const compact = new Map();
export const stars = (S, n) => {
  if (n == null) return '–';
  if (!compact.has(S.lang)) compact.set(S.lang, new Intl.NumberFormat(S.lang, { notation: 'compact', maximumFractionDigits: 1 }));
  return compact.get(S.lang).format(n);
};
export const num = (S, n) => Number(n || 0).toLocaleString(S.lang);

// 칩: 누르면 바로 켜고 끈다(스킬·자동 검사 같은 꼴). note = 오른쪽 작은 글, badge = 파란 작은 글
export const chip = ({ key, on, label, note, badge, title, onClick }) =>
  h('button.chip', { type: 'button', 'aria-pressed': String(on), 'data-key': key, title: title || null, on: { click: onClick } },
    h('span.dot'), h('span.cl', {}, label), note ? h('span.note', {}, note) : null, badge ? h('span.new', {}, badge) : null);

// 스위치(Primer ToggleSwitch small): 왼쪽에 「켬/끔」, 이름은 labelId 가 가리키는 글(없으면 label)
export const toggleSwitch = (t, { key, on, labelId, label, disabled, onToggle }) =>
  h('button.tgl', { type: 'button', role: 'switch', 'aria-checked': String(!!on), 'aria-labelledby': labelId || null, 'aria-label': labelId ? null : label, 'data-key': key, disabled: !!disabled, on: { click: onToggle } },
    h('span.st', { 'aria-hidden': 'true' }, on ? t('tglOn') : t('tglOff')), h('span.track', { 'aria-hidden': 'true' }));

// 체크 줄(여러 항목 가운데 고르기)
export const checkRow = ({ key, on, label, disabled, onChange, cls = '' }) =>
  h(`label.ck${cls}`, {}, h('input', { type: 'checkbox', checked: !!on, disabled: !!disabled, 'data-key': key, on: { change: onChange } }), h('span', {}, label));

// 구획 머리: 제목 · 개수 ……… 동작
export const shead = (title, count, ...acts) =>
  h('div.shead', {}, h('h2', {}, title), count ? h('span.muted', {}, count) : null, acts.flat().filter(Boolean).length ? h('div.acts', {}, acts) : null);

// 묶음 표 한 줄: 이름·개수 | 칩 | 자세히 보기
export const groupRow = ({ name, count, chips, empty, more }) =>
  h('div.grow', {}, h('div.gn', {}, h('b', {}, name), h('span', {}, count)), h('div.chips', {}, chips.length ? chips : h('span.empty', {}, empty)), more || h('span'));

// 목록 줄: 아이콘 · 제목+설명 · 끝에 붙는 것
export const lrow = ({ cls = '', ic, title, desc, descOne, id, extra, tail = [] }) =>
  h(`div.lrow${cls}`, {}, ic ? icon(ic) : null,
    h('div.main', {}, h('b', { id: id || null }, title), desc ? h(`span.d${descOne ? '.one' : ''}`, { title: descOne ? desc : null }, desc) : null, extra),
    ...tail);

// 알림 띠(노란 바탕): 제목 + 설명 + (단추)
export const flash = ({ title, desc, act, cls = '', role = 'note' }) =>
  h(`div.flash${cls}`, { role }, icon(cls.includes('info') ? 'i-info' : 'i-warn'), h('div.sp', {}, title ? h('b', {}, title) : null, desc ? h('p', {}, desc) : null), act || null);

// 카탈로그 글의 `…` 를 <code> 로(글자는 그대로 textContent). 백틱을 글자로 보이지 않게 — 화면의 다른 명령·경로와 같은 꼴
export const withCode = (text) => String(text ?? '').split(/`([^`]+)`/).map((x, i) => (i % 2 ? h('code', {}, x) : x));

export const label = (text, cls = '') => h(`span.label${cls}`, {}, text);
export const onCount = (t, on, all) => t('onCount', { on, all });
export const link = (key, text, onClick, extra = {}) => h('button.link', { type: 'button', 'data-key': key, on: { click: onClick }, ...extra }, text);

// 지난번 적용 뒤 카탈로그에 새로 생긴 것(꺼진 채로 시작한다)
export const isNew = (S, kind, id) => !!S.newSince?.[kind]?.includes(id);

// 스킬에 붙는 이름표: 새로 생김 · 비슷한 스킬이 이미 들어 있음 · 이미 깔림 · 실행 파일 · 직접 설치
export const skillLabels = ({ S, t, dup, mates }, k) => {
  const d = dup?.skills.get(k.id);
  const m = mates?.get(k.id);
  return [
    isNew(S, 'skills', k.id) ? label(t('badgeNew'), '.accent') : null,
    m && !d ? label(t('mateSelected', { names: m.join(', ') }), '.warn') : null,
    d ? h('span.label.warn', { title: `${d.by.join(', ')} · ${t(`scope_${d.scope}`)}` }, t(d.same ? 'dupSkillSame' : 'dupSkillSimilar', { by: d.by.join(', ') })) : null,
    k.scripts.length ? label(t('badgeScripts', { n: k.scripts.length })) : null,
    k.install === 'plugin' ? label(t('badgePlugin')) : null,
  ];
};

// 이미 있어서 기본에서 뺀 것(kind: hooks · skills). 원래 기본으로 들어갈 것(조합·브랜치 방식)이었고 지금 꺼져 있는 것만 —
// 기본에 없던 것까지 「뺐다」고 하면 거짓이고, 사용자가 다시 켰으면 알릴 까닭이 없다. 그 밖의 겹침은 각 항목 옆에 표시한다.
export function alreadyNote({ S, sel, t, dup, defaults }, kind, names) {
  const list = [...dup[kind].values()].filter((x) => !sel[kind].has(x.id) && defaults?.[kind].has(x.id));
  const failed = kind === 'hooks' && S.detected.existing?.hookProbeFailed;
  const skipped = kind === 'hooks' ? S.detected.existing?.projectHooksSkipped || 0 : 0;
  // 기존 훅 시험은 화면을 띄운 뒤 서버가 마저 한다(몇 초~십몇 초). 답이 오면 app.js 가 다시 그린다.
  const pending = kind === 'hooks' && S.detected.existing?.hooksPending;
  if (!list.length && !failed && !skipped && !pending) return null;
  const userOnly = list.some((x) => x.scope !== 'project');
  return h('div.notes', {},
    pending ? flash({ cls: '.info', role: 'status', title: t('probePending') }) : null,
    failed ? flash({ title: t('probeFailed') }) : null,
    list.length ? flash({ cls: '.info', title: t('dupTitle'), desc: [list.map((x) => `${names(x.id)} (${x.by.join(', ')} · ${t(`scope_${x.scope}`)})`).join(' · '), userOnly && !sel.share ? ` ${t('dupShareNote')}` : ''].join('') }) : null,
    skipped ? h('p.hint', {}, t('projectHooksSkipped', { n: skipped })) : null);
}

// 전에 적용한 프로젝트면: 지난번 선택에서 시작했다는 한 줄 + 새로 생긴 수 + 「추천으로 되돌리기」.
// 되돌리면 같은 자리에 「이전 선택으로 돌리기」(지운 것을 되살리는 방법)를 띄운다.
export function previousLine({ S, ui, t, act }) {
  const p = S.previous;
  if (!p) return null;
  if (ui.switched?.reset) return flash({ cls: '.info', role: 'status', title: t('resetDone'), act: h('button.btn', { type: 'button', 'data-key': 'undoSwitch', on: { click: act.undoSwitch } }, t('undoSwitch')) });
  const n = S.newSince;
  const counts = [['diffSkill', n.skills.length], ['diffHook', n.hooks.length], ['diffRule', n.rules.length]].filter(([, x]) => x).map(([k, x]) => `${t(k)} ${x}`);
  return flash({ cls: '.info', role: 'status', title: p.at ? t('prevLine', { date: p.at }) : t('prevLineNoDate'),
    desc: counts.length ? t('prevNew', { list: counts.join(' · ') }) : null,
    act: h('button.btn', { type: 'button', 'data-key': 'resetRec', on: { click: act.resetToRecommended } }, t('resetRec')) });
}
