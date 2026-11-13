// 「GitHub 저장소 설정도 바꾸기」: 확인 단계의 상자(큰 스위치 + 항목별 체크), 적용 전 확인 창 묶음, 끝 화면 결과.
// 항목은 서버가 GitHub 에서 읽은 지금 값과 packs.json flows 의 github 칸(추천 값)으로 만든 것(GET /api/github).
// 고른 것 → 바뀔 칸 계산은 서버와 같은 picker/github-plan.js. GitHub 이 돌려준 글도 textContent 로만 넣는다(dom.js 의 h).
import { h } from './dom.js';
import { lrow, toggleSwitch, checkRow, btn, field } from './parts.js';
import { menuSelect } from './menu-select.js';
import { defaultChoice, changesFor } from './github-plan.js';

const itemsOf = (ui, sel) => ui.github?.flows?.[sel.flow] || [];
// 지금 고른 값: 추천 값 위에 사용자가 고친 값
export const choiceOf = (ui, sel) => {
  const d = defaultChoice(itemsOf(ui, sel));
  for (const k of Object.keys(d)) if (sel.githubChoice && k in sel.githubChoice) d[k] = sel.githubChoice[k];
  return d;
};
const changesOf = (ui, sel) => changesFor(itemsOf(ui, sel), choiceOf(ui, sel));
// 실제로 바꿀지: 큰 스위치를 켰고, 고른 항목 중 바뀌는 것이 하나라도 있을 때. 적용 요청도 이 값을 보낸다(app.js payload).
export const githubOn = (ui, sel) => !!sel.github && !!ui.github?.offered && changesOf(ui, sel).length > 0;

const val = (t, c, v) => (v == null ? t('ghUnknown') : c.key === 'approvals' ? t('ghN', { n: v }) : t(v ? 'on' : 'off'));
const label = (t, c) => t(`gh_${c.key}`, { branch: c.branch || '' });
const changeLine = (t, c, many) => `${many ? `${label(t, c)} · ` : t('ghNow')}${val(t, c, c.from)} → ${val(t, c, c.to)}`;

// 항목 한 줄: 체크(또는 수 고르기) · 설명 · (그 방식의 덧붙임) · 고르면 바뀌는 값
function itemRow({ S, sel, t, act }, i, choice, changes, open) {
  if (i.blocked) return h('div.lrow.note', {}, t(`ghBlocked_${i.blocked}`, { branch: i.branch }));
  const name = label(t, i);
  const note = S.flows.find((f) => f.id === sel.flow)?.githubNotes?.[i.key];
  const mine = changes.filter((c) => c.item === i.id);
  const help = h('span.d', {}, t(`ghh_${i.key}`), note ? ` ${note}` : '');
  if (i.already) return h('div.lrow.gh.dim', {}, h('div.main', {}, h('b', {}, name), help), h('span.ch', {}, t('ghAlreadyOn')));
  // 바뀌는 칸이 하나면 줄 끝에, 여럿이면(squash 로만 합치기) 설명 아래에 한 줄씩
  const many = mine.length > 1;
  const lines = many ? mine.map((c) => h('span.d', {}, changeLine(t, c, true))) : null;
  const after = many ? null : mine.map((c) => h('span.ch', {}, changeLine(t, c, false)));
  if (i.type === 'select') {
    const usable = i.prNow || choice[`pr:${i.branch}`] === true;
    // 고르기는 공통 메뉴(menu-select.js) — 훅 옵션과 같은 모양·키보드(2026-11-12 사용자: 공통 부품은 다 맞춘다)
    const nameId = `ghn-${i.id}`.replace(/[^\w-]/g, '_');
    // 설명·권장값(또는 잠긴 까닭)을 화면 읽기에 이어 준다 — 훅 옵션 칸과 같게(전체 검토 2026-11-13)
    const helpId = `ghh-${i.id}`.replace(/[^\w-]/g, '_');
    return h(`div.lrow.gh${open ? '' : '.dim'}`, {},
      h('div.main', {}, field({ name, nameId,
        control: menuSelect({ key: `gh:${i.id}`, labelId: nameId, describedBy: `${helpId} ${helpId}-r`, disabled: !usable || !open, value: choice[i.id],
          choices: i.choices.map((n) => ({ value: n, label: t('ghN', { n }) })), onChange: (ch) => act.setGithubItem(i.id, ch.value) }) }),
        Object.assign(help, { id: helpId }), h('span.d', { id: `${helpId}-r` }, usable ? t('ghRecN', { n: i.default }) : t('ghNeedsPr')), lines),
      after);
  }
  const on = choice[i.id] === true;
  return h(`div.lrow.gh${open ? '' : '.dim'}`, {},
    h('div.main', {}, checkRow({ key: `gh:${i.id}`, on, label: name, disabled: !open, onChange: () => act.setGithubItem(i.id, !on) }), help, h('span.d', {}, t(i.default ? 'ghRec_on' : 'ghRec_off')), lines),
    after);
}

// 확인 단계 상자. 브랜치 방식을 정하지 않았으면 아무것도 보이지 않는다.
export function githubBox(c) {
  const { sel, ui, t, act } = c;
  if (sel.flow === 'none') return null;
  const g = ui.github;
  const box = (...kids) => h('div.box', {}, ...kids);
  if (!g) return box(h('div.lrow.note', { role: 'status' }, t('ghLoading')));
  if (!g.offered) {
    const retry = ['offline', 'not-logged-in', 'no-gh', 'error'].includes(g.reason);
    return box(lrow({ cls: '.note', title: t('ghTitle'), desc: t('ghNotOffered', { reason: t(`ghReason_${g.reason}`) }),
      tail: retry ? [btn('ghRetry', t('ghRecheck'), act.retryGithub)] : [] }));
  }
  const items = itemsOf(ui, sel);
  const choosable = items.filter((i) => !i.blocked && !i.already);
  if (!choosable.length && !items.some((i) => i.blocked)) return box(h('div.lrow.note', {}, t('ghAlready', { repo: g.repo })));
  const open = !!sel.github && choosable.length > 0;
  const choice = choiceOf(ui, sel);
  const changes = changesOf(ui, sel);
  return box(
    lrow({ id: 'lb-gh', title: t('ghTitle'), desc: t('ghD'), extra: h('span.d.mono', {}, t('ghShared', { repo: g.repo })),
      tail: [toggleSwitch(t, { key: 'github', on: open, labelId: 'lb-gh', disabled: !choosable.length, onToggle: act.toggleGithub })] }),
    items.map((i) => itemRow(c, i, choice, changes, open)),
    h('div.lrow.note', { role: 'status' }, open ? (changes.length ? t('ghSelectedN', { n: changes.length }) : t('ghNoneSelected')) : t('ghPickHint', { n: choosable.length })));
}

// 끝 화면: 항목마다 됐는지. 하나라도 안 됐으면 「다 됐다」고 말하지 않는다.
export function githubResult({ t }, r) {
  if (!r) return null;
  if (!r.offered) return h('p.err', { role: 'alert' }, t('ghResultNone', { reason: t(`ghReason_${r.reason}`) }));
  const bad = r.results.filter((x) => !x.ok);
  const why = (x) => (x.blocked || x.error === 'plan' ? t(`ghBlocked_${x.blocked || 'plan'}`, { branch: x.branch }) : t('ghFailedWhy', { error: x.error }));
  return h('div.box', bad.length ? { role: 'alert' } : {},
    h('div.box-h', {}, h('span', {}, bad.length ? t('ghResultPartial', { n: bad.length, total: r.results.length }) : t('ghResultOk', { repo: r.repo }))),
    r.results.map((x) => h(`div.lrow.gh${x.ok ? '' : '.fail'}`, {},
      h('div.main', {}, h('b', {}, `${x.ok ? '✓' : '✗'} ${x.key ? label(t, x) : x.branch}`)),
      h('span.ch', {}, x.ok ? `${val(t, x, x.from)} → ${val(t, x, x.to)}` : why(x)))),
    r.results.some((x) => x.ok) ? h('div.lrow.note', {}, t('ghUndoNote')) : null);
}
