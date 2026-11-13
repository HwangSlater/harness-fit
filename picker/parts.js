// 화면 부품 한 벌(꼴은 components.css): 칩·스위치·체크 줄·구획 머리·묶음 줄·목록 줄·이름표·알림 띠.
// 단계·창은 모두 이 함수들로만 만든다. 글은 h() 를 거쳐 textContent 로만 들어간다.
import { h, icon } from './dom.js';
import { skillBy, listable } from './stats.js';

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

// 체크 줄(여러 항목 가운데 고르기, 훅 옵션의 켜고 끄기). describedBy: 아래 설명 글 id
export const checkRow = ({ key, on, label, disabled, onChange, cls = '', describedBy }) =>
  h(`label.ck${cls}`, {}, h('input', { type: 'checkbox', checked: !!on, disabled: !!disabled, 'data-key': key, 'aria-describedby': describedBy || null, on: { change: onChange } }), h('span', {}, label));

// 단추(공통). cls: '.lg' 큰 단추, '.primary' 주 동작, '.on' 눌린 상태 등. extra: aria-pressed·disabled·title·data-autofocus 같은 속성
export const btn = (key, text, onClick, cls = '', extra = {}) =>
  h(`button.btn${cls}`, { type: 'button', 'data-key': key, on: { click: onClick }, ...extra }, text);

// 주소로 가는 단추(<a> — 「확인으로」 처럼 다른 단계로 데려가는 것). 모양은 btn 과 같다
export const btnLink = (key, text, href, cls = '') => h(`a.btn${cls}`, { href, 'data-key': key }, text);

// 이름 + 칸 한 덩어리(훅 옵션의 고르기, GitHub 승인 수): 이름이 위, 4px 아래 칸, 그 아래 설명(있으면) — 옵션 배치 A안.
// 이름을 칸 옆에 두면 좁은 화면에서 칸·메뉴가 오른쪽으로 밀려 넘쳤다(검토 2026-11-12)
export const field = ({ name, nameId, control, help }) =>
  h('div.fld', {}, h('span.fldn', { id: nameId }, name), control, help || null);

// 창 왼쪽 목록 단추(전체 훅·스킬 보기, 켜지는 것 보기): 이름 · 개수. 지금 고른 것은 aria-current
export const navItem = ({ key, current, name, count, cls = '', onClick }) =>
  h(`button${cls}`, { type: 'button', 'aria-current': String(!!current), 'data-key': key, on: { click: onClick } },
    h('span', {}, name), count == null ? null : h('span.n', {}, String(count)));

// 붙은 단추 묶음에서 하나 고르기(짧게 / 전체 같은 보기 바꾸기). items: [[값, 글, data-key]]
export const segmented = ({ label, items, value, onPick }) =>
  h('span.seg', { role: 'group', 'aria-label': label },
    items.map(([v, text, key]) => h('button', { type: 'button', 'aria-pressed': String(value === v), 'data-key': key, on: { click: () => onPick(v) } }, text)));

// 구획 머리: 제목 · 개수 ……… 동작
export const shead = (title, count, ...acts) =>
  h('div.shead', {}, h('h2', {}, title), count ? h('span.muted', {}, count) : null, acts.flat().filter(Boolean).length ? h('div.acts', {}, acts) : null);

// 묶음 표 한 줄: 이름·개수 | 칩 | 자세히 보기
export const groupRow = ({ name, count, chips, empty, more }) =>
  h('div.grow', {}, h('div.gn', {}, h('b', {}, name), h('span', {}, count)), h('div.chips', {}, chips.length ? chips : h('span.empty', {}, empty)), more || h('span'));

// 목록 줄: 아이콘 · 제목+설명 · 끝에 붙는 것.
// open = { key, onOpen } 이면 제목·설명 칸이 단추가 되어 누르면(Enter·Space 도) 창을 연다. 줄의 빈 곳을 눌러도 열고,
// 끝에 붙은 스위치·링크를 누르면 열지 않는다(스위치는 켜고 끄기만).
export const lrow = ({ cls = '', ic, title, desc, descOne, id, extra, tail = [], open }) =>
  h(`div.lrow${cls}${open ? '.click' : ''}`, open ? { on: { click: (e) => (e.target.closest('.tgl, a') ? null : open.onOpen()) } } : {}, ic ? icon(ic) : null,
    h(open ? 'button.main' : 'div.main', open ? { type: 'button', 'aria-haspopup': 'dialog', 'data-key': open.key } : {},
      h('b', { id: id || null }, title), desc ? h(`span.d${descOne ? '.one' : ''}`, { title: descOne ? desc : null }, desc) : null, extra),
    ...tail);

// 알아 둘 점(스킬·훅의 대가): 작은 이름표를 단 조용한 둘째 줄. 경고가 아니라 고를 때 함께 볼 사실이라 빨간색을 쓰지 않는다.
export const keepNote = (t, text) => (text ? h('p.keep', {}, h('span.kl', {}, t('keepLabel')), ' ', withCode(text)) : null);

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

// (link 는 따로 서는 동작 단추, lk 는 문장·이름표 속에 끼는 글자 링크 — 모양과 누르는 넓이가 달라 둘 다 둔다)
// 따라가는 링크 하나(이름표·알림 글 속). 보이는 크기는 글자 그대로, 누르는 넓이만 44px(.lk — 줄 높이는 늘리지 않는다).
// popup: 작은 창을 여는 링크(aria-haspopup). 글은 <span> 안에 — 초점 테두리를 글자에만 두려고.
export const lk = ({ key, text, title, popup, onClick }) =>
  h('button.lk', { type: 'button', 'data-key': key, title: title || null, 'aria-haspopup': popup ? 'dialog' : null, on: { click: onClick } }, h('span', {}, text));
// 링크가 든 이름표: 앞말(있으면) + 링크들(쉼표로 잇는다)
const linkLabel = (cls, lead, links) => h(`span.label.links${cls}`, {}, lead ? h('span', {}, lead) : null,
  links.map((l, i) => (i < links.length - 1 ? h('span.lkw', {}, lk(l), ',') : lk(l))));

// 스킬에 붙는 이름표: 새로 생김 · 비슷한 스킬이 이미 들어 있음 · 이미 깔림 · 실행 파일 · 직접 설치.
// 「비슷한 스킬이 이미 들어 있어요」의 이름은 그 스킬로 가는 링크(전체 보기 창에서 그 묶음을 열고 그 줄로 — panel.js browseTo),
// 「이미 깔려 있어요」의 이름은 그 스킬이 무엇이고 어디 있는지 보여 주는 작은 창(info-dialog.js).
export const skillLabels = ({ S, t, act, dup, mates }, k) => {
  const d = dup?.skills.get(k.id);
  const m = (mates?.get(k.id) || []).filter((id) => skillBy(S, id) && listable(S, skillBy(S, id)));
  return [
    isNew(S, 'skills', k.id) ? label(t('badgeNew'), '.accent') : null,
    m.length && !d ? linkLabel('.warn', t('mateLead'), m.map((id) => ({ key: `mate:${k.id}:${id}`, text: skillBy(S, id).title, title: t('mateGo'), onClick: () => act.browseTo('skills', id) }))) : null,
    d ? linkLabel('.warn', t(d.same ? 'dupSameLead' : 'dupSimilarLead'), [{ key: `info:s:${k.id}`, text: d.by.join(', '), popup: true, onClick: () => act.openInfo({ kind: 'skill', id: k.id }) }]) : null,
    k.scripts.length ? label(t('badgeScripts', { n: k.scripts.length })) : null,
    k.install === 'plugin' ? label(t('badgePlugin')) : null,
  ];
};
// 검사(훅)에 붙는 「이미 쓰고 있는 훅이 같은 일을 해요」: 누르면 그 훅·시험 결과를 보여 주는 작은 창
export const dupHookLabel = ({ t, act }, id) => linkLabel('.warn', null, [{ key: `info:h:${id}`, text: t('dupHook'), popup: true, onClick: () => act.openInfo({ kind: 'hook', id }) }]);

// 이미 있어서 기본에서 뺀 것(kind: hooks · skills). 원래 기본으로 들어갈 것(조합·브랜치 방식)이었고 지금 꺼져 있는 것만 —
// 기본에 없던 것까지 「뺐다」고 하면 거짓이고, 사용자가 다시 켰으면 알릴 까닭이 없다. 그 밖의 겹침은 각 항목 옆에 표시한다.
// 이름마다 링크 — 누르면 무엇과 겹치는지 보여 주는 작은 창(info-dialog.js)
export function alreadyNote({ S, sel, t, act, dup, defaults }, kind, names) {
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
    list.length ? flash({ cls: '.info', title: t('dupTitle'), desc: [
      list.map((x, i) => [i ? ' · ' : null, lk({ key: `already:${kind}:${x.id}`, text: names(x.id), popup: true, onClick: () => act.openInfo({ kind: kind === 'hooks' ? 'hook' : 'skill', id: x.id }) })]),
      userOnly && !sel.share ? ` ${t('dupShareNote')}` : null] }) : null,
    skipped ? h('p.hint', {}, t('projectHooksSkipped', { n: skipped })) : null);
}

// 전에 적용한 프로젝트면: 지난번 선택에서 시작했다는 한 줄 + 새로 생긴 수 + 「추천으로 되돌리기」.
// 되돌리면 같은 자리에 「이전 선택으로 돌리기」(지운 것을 되살리는 방법)를 띄운다.
export function previousLine({ S, ui, t, act }) {
  const p = S.previous;
  if (!p) return null;
  if (ui.switched?.reset) return flash({ cls: '.info', role: 'status', title: t('resetDone'), act: btn('undoSwitch', t('undoSwitch'), act.undoSwitch) });
  const n = S.newSince;
  const counts = [['diffSkill', n.skills.length], ['diffHook', n.hooks.length], ['diffRule', n.rules.length]].filter(([, x]) => x).map(([k, x]) => `${t(k)} ${x}`);
  return flash({ cls: '.info', role: 'status', title: p.at ? t('prevLine', { date: p.at }) : t('prevLineNoDate'),
    desc: counts.length ? t('prevNew', { list: counts.join(' · ') }) : null,
    act: btn('resetRec', t('resetRec'), act.resetToRecommended) });
}

// 「자세히 보기」·「전체 보기」 단추: 전체 보기 창(browse.js)을 그 묶음으로 연다
export const browseBtn = (c, text, kind, g = 'all', key = `browse:${kind}:${g}`) =>
  btn(key, text, () => c.act.openBrowse(kind, g), '', { 'aria-haspopup': 'dialog' });

// 항목 한 줄(스킬·검사 같은 꼴): 이름·이름표 / 쉬운 한 줄 / 정보 · 스위치 · 옵션 · 자세히(펼침)
export function itemRow(c, { key, on, name, labels, plain, meta = [], keep, opts = [], scope, onToggle }) {
  const { ui, t, act } = c;
  const open = ui.open.has(key);
  const safe = key.replace(/[^\w-]/g, '_');
  // data-item: 링크로 이 줄을 찾아올 때(browseTo). hit: 방금 찾아온 줄(잠깐 밝게)
  return h(`div.item${ui.hit === key ? '.hit' : ''}`, { 'data-item': key },
    h('div', {},
      h('div.nm', {}, h('span', { id: `nm-${safe}` }, name), labels),
      plain ? h('p.plain', {}, plain) : null,
      meta.filter(Boolean).map((m) => h('p.meta', {}, m)),
      keepNote(t, keep)),
    // 스위치가 없으면(켜지는 것 보기 combo-panel.js) 켜고 끄지 않고 보여 주기만
    onToggle ? h('div.tg', {}, toggleSwitch(t, { key: `tg:${key}`, on, labelId: `nm-${safe}`, onToggle })) : null,
    opts.length || scope ? h('div.more', {},
      opts.length ? h('div.opts', {}, opts) : null,
      scope ? link(`sc:${key}`, open ? t('scopeClose') : t('scopeOpen'), () => act.toggleOpen(key), { 'aria-expanded': String(open), class: 'scopebtn' }) : null,
      open && scope ? h('div.scopefull', {}, scope) : null) : null);
}
