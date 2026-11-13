// 목록 옵션 칸(실행 전에 물을 명령·더 지킬 경로·커밋 타입 …)을 칩으로 — 옵션 칸 2안(2026-11-12).
// 한 줄 글칸에 쉼표로 이어 적던 때는 긴 명령이 잘려 보이고, 무엇이 저장소에서 찾은 값인지·어느 것이 빠졌는지 알 수 없었다.
// 값마다 칩 하나(× 로 빼기), 저장소에서 찾은 값은 저장소 표시와 까닭 한 줄, 받지 않는 값은 빨간 칩과 까닭.
import { h, icon } from './dom.js';
import { withCode, btn } from './parts.js';
import { parseList, badWhy, LIST_MAX, offerChoices, placeOne } from './hook-options.js';
import { afterPress } from './press.js';

// 저장소에서 찾아 넣은 값의 까닭(scripts/lib/suggest.mjs why). 그 값을 넣는 칸에서만
// offer: 미리 넣지 않고 묻기만 한 값(커밋한 결과·논문 폴더 — scripts/lib/record-folders.mjs). 사용자가 칸에 넣으면 같은 까닭을 보인다
const SOURCES = { 'ask-cmd': { key: 'commands', list: 'ask' }, 'protected-files': { key: 'paths', list: 'protect', offer: 'offer' } };
// 스택 기본값(combos.json stackAddons 의 hookOpts + optWhy — iOS → xcrun altool --upload-app, ROS 2 → ros2 launch)의 까닭
const stackWhy = (S, hookId, optKey, x) => {
  const adds = [...(S.recommended?.addons || []), ...(S.combos || []).flatMap((c) => c.addons || [])];
  const a = adds.find((y) => y.optWhy && y.stacks?.length && (y.hookOpts?.[hookId]?.[optKey] || []).includes(x));
  return a ? { k: 'stack', at: a.stacks.join(' · '), ref: a.optWhy[S.lang] || a.optWhy.en } : null;
};
// 화면에 보일 까닭 한 줄: 저장소에서 찾은 값은 「저장소에서 찾음: …」, 스택 기본값은 그 문장 그대로
// (「저장소에서 찾음: iOS 저장소의 기본값이에요」처럼 말이 겹치던 일 — 검토 2026-11-13). 칩·목록·확인 표가 모두 이것을 쓴다
export const reasonLine = (t, w) => (w.k === 'stack' ? repoWhyText(t, w) : t('srcFound', { why: repoWhyText(t, w) }));
export const repoWhy = (S, hookId, optKey, x) => {
  const src = SOURCES[hookId];
  const sg = S.detected?.suggest;
  if (!src || src.key !== optKey) return null;
  const found = sg?.[src.list]?.includes(x) || (src.offer && sg?.[src.offer]?.includes(x));
  return (found && sg.why?.[x]) || stackWhy(S, hookId, optKey, x);
};
export const repoWhyText = (t, w) => t(`srcWhy_${w.k}`, { at: w.at || '', ref: w.ref || '' });

// 적는 중인 글(칸 key → 글). 미리보기를 받아 다시 그려도 적던 글을 잃지 않게
const pending = new Map();

const clip = (x) => (x.length > 40 ? `${x.slice(0, 40)}…` : x);

// 누르는 동안 다시 그리지 않기는 공통 press.js(afterPress)

// v: 지금 값 배열, bad: 받지 않은 글(ui.optBad), set(values, bad): 바꾸기
export function listField({ S, t }, { hook, opt, v, bad, key, helpId, help, set }) {
  const values = v || [];
  const wrong = bad || [];
  const labelId = `lb-${helpId}`;
  const focusInput = () => document.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus();
  // 적은 글을 나눠(쉼표·줄바꿈) 맞는 것은 값에, 틀린 것은 빨간 칩으로. 이미 있는 값은 다시 넣지 않는다
  // 한도(20개)를 넘는 값도 빨간 칩으로 남긴다 — 말없이 버리던 일(독립 검토 2026-11-12)
  const add = (text, { focus = true } = {}) => {
    pending.delete(key);
    const { values: ok, bad: no } = parseList(opt, text);
    const fresh = ok.filter((x) => !values.includes(x));
    const room = Math.max(0, LIST_MAX - values.length);
    const placed = fresh.slice(0, room);
    // 넣은 값은 빨간 목록에서 뺀다 — 한도로 빨간 칩이 됐던 값을 자리가 난 뒤 넣으면 양쪽에 남던 일(다시 검토 2026-11-12)
    set([...values, ...placed], [...new Set([...wrong.filter((x) => !placed.includes(x)), ...no, ...fresh.slice(room)])]);
    if (focus) focusInput();
  };
  // 제안 단추: 값 하나를 그대로(쉼표로 나누지 않고) 넣는다
  const addOffer = (x) => {
    const next = placeOne(opt, x, values, wrong);
    set(next.values, next.bad);
    focusInput();
  };
  const removeAt = (x) => (set(values.filter((y) => y !== x), wrong), focusInput());
  const removeBad = (x) => (set(values, wrong.filter((y) => y !== x)), focusInput());
  const full = values.length >= LIST_MAX;
  // 빨간 칩의 까닭: 형식이 틀렸으면 그 까닭, 형식은 맞으면 한도를 넘어 못 넣은 것
  const whyOf = (x) => badWhy(opt, x) || 'full';

  const tag = (x, { why, isBad }) => h(`span.tag${isBad ? '.bad' : why ? '.fromrepo' : ''}`,
    { title: isBad ? t(`optBadWhy_${whyOf(x)}`) : why ? reasonLine(t, why) : null, 'aria-invalid': isBad ? 'true' : null },
    isBad ? icon('i-err') : why ? icon('i-repo') : null,
    h('code', {}, isBad ? clip(x) : x),
    h('button.tx', { type: 'button', 'aria-label': t('optRemove', { item: clip(x) }), on: { click: () => (isBad ? removeBad(x) : removeAt(x)) } }, icon('i-x')));

  const input = h('input.tagin', {
    // 꽉 차도 disabled 로 두지 않는다 — 초점이 창 밖(body)으로 빠졌다. 읽기 전용으로 두고 Backspace 로 뺄 수 있게
    type: 'text', 'data-key': key, value: pending.get(key) || '', placeholder: full ? t('optFull', { n: LIST_MAX }) : t(`optAddPh_${opt.item}`), readonly: full, 'aria-disabled': full ? 'true' : null,
    'aria-labelledby': labelId, 'aria-describedby': helpId,
    on: {
      input: (e) => pending.set(key, e.target.value),
      keydown: (e) => {
        if (e.isComposing) return; // 한글 조합 중 Enter 는 글자 확정
        if (e.key === 'Enter') { e.preventDefault(); if (e.target.value.trim()) add(e.target.value); }
        // 빈 칸에서 지우기: 맨 끝 칩(빨간 칩이 있으면 그것부터)을 뺀다
        else if (e.key === 'Backspace' && !e.target.value) {
          if (wrong.length) removeBad(wrong.at(-1));
          else if (values.length) removeAt(values.at(-1));
        }
      },
      // 줄바꿈·쉼표가 든 글을 붙여 넣으면 바로 나눠 넣는다
      // 적던 글은 커서 자리에 붙인 글과 합쳐 넣는다(붙여 넣으면 적던 글이 사라지던 일 — 독립 검토 2026-11-12)
      paste: (e) => {
        const text = e.clipboardData?.getData('text') || '';
        if (!/[\r\n,]/.test(text)) return;
        e.preventDefault();
        const el = e.target;
        const at = el.selectionStart ?? el.value.length;
        add(el.value.slice(0, at) + text + el.value.slice(el.selectionEnd ?? at));
      },
      // 칸을 떠날 때 적다 만 글도 넣는다(Enter 를 몰라 그냥 다음으로 가도 잃지 않게).
      // 바로 다시 그리면 누른 체크 상자·단추가 사라져 그 조작이 먹히지 않았다 — 그 조작이 끝난 뒤에 넣고, 초점은 옮기지 않는다(독립 검토 2026-11-12).
      // × 를 누르려고 떠날 때는 넣지 않는다 — 적던 글은 pending 에 남는다
      blur: (e) => {
        const text = e.target.value;
        if (text.trim() && !e.currentTarget.parentElement?.contains(e.relatedTarget)) afterPress(() => {
          // 붙여 넣기·Enter 가 먼저 넣고 다시 그리면, 지워지는 옛 칸이 붙이기 전 글로 blur 를 한 번 더 보낸다 —
          // 그 글로 다시 넣으면 앞서 넣은 값을 덮어썼다(다시 검토 2026-11-12). 적던 글이 그대로일 때만 넣는다
          if (pending.get(key) === text) add(text, { focus: false });
        });
      },
    },
  });

  // 받지 않은 값: 까닭별로 한 줄(까닭이 하나면 칩을 다시 적지 않는다)
  const byWhy = new Map();
  for (const x of wrong) { const k = whyOf(x); byWhy.set(k, [...(byWhy.get(k) || []), x]); }
  const errs = [...byWhy].map(([k, list]) => h('p.err', { role: 'alert' }, byWhy.size === 1
    ? t('optBadOne', { why: t(`optBadWhy_${k}`) })
    : t('optBad', { list: list.map(clip).join(', '), why: t(`optBadWhy_${k}`) })));
  // 찾은 까닭이 같은 값은 한 줄로 묶는다(.gitignore 항목 아홉 개가 같은 줄을 되풀이하던 일 — 화면 역할 평가 2026-11-12).
  // 줄 앞 아이콘은 두지 않는다 — 빈 체크 상자로 보여 누르게 됐다
  const fromRepo = new Map();
  for (const x of values) {
    const w = repoWhy(S, hook.id, opt.key, x);
    if (!w) continue;
    const text = reasonLine(t, w);
    fromRepo.set(text, [...(fromRepo.get(text) || []), x]);
  }
  // 기본값이 있는 칸(지킬 브랜치)을 비우면 훅이 켜진 채 아무것도 막지 않는다 — 알린다
  const emptyWarn = !values.length && Array.isArray(opt.default) && opt.default.length > 0;
  // 미리 넣지 않고 제안만 한 값(커밋한 결과·논문 폴더): 칸 아래에 「+ 넣기」 단추로 — 화면에는 아무 표시가 없어 정확한 글을 직접 쳐야 했다(화면 역할 평가 2026-11-13).
  // 칸이 가득 차면 단추를 감춘다(글칸의 「가득 참」 안내와 같은 뜻), 이미 든 값·빨간 칩 값은 내지 않는다(offerChoices)
  const src = SOURCES[hook.id];
  const offers = src?.offer && src.key === opt.key ? offerChoices(S.detected?.suggest?.[src.offer], values, wrong) : [];
  // 같은 까닭으로 묶인 값이 많으면 앞 셋 + 「외 N개」(iOS 기본값 17개가 한 문단으로 이어지던 일 — 같은 평가). 전부는 title 로
  const MANY = 4;
  const shortList = (xs) => (xs.length > MANY
    ? [...xs.slice(0, 3).flatMap((x, i) => [i ? ', ' : null, h('code', {}, x)]), ` ${t('optMore', { n: xs.length - 3 })}`]
    : xs.flatMap((x, i) => [i ? ', ' : null, h('code', {}, x)]));

  return h('div.opt.list', {},
    h('div.lhead', {}, h('span', { id: labelId }, opt.label), h('span.cnt', {}, `${values.length}/${LIST_MAX}`)),
    h('div.tagbox', { role: 'group', 'aria-labelledby': labelId, on: { click: (e) => (e.target === e.currentTarget ? focusInput() : null) } },
      values.map((x) => tag(x, { why: repoWhy(S, hook.id, opt.key, x) })),
      wrong.map((x) => tag(x, { isBad: true })),
      input),
    errs,
    emptyWarn ? h('p.warn', { role: 'status' }, icon('i-warn'), h('span', {}, t('optEmptyWarn'))) : null,
    fromRepo.size ? h('ul.src', {}, [...fromRepo].map(([text, xs]) => h('li', { title: xs.length > MANY ? xs.join('\n') : null },
      h('span', {}, shortList(xs), ` — ${text}`)))) : null,
    offers.length ? h('div.offers', {}, h('span', {}, t('optOfferLead')),
      offers.map((x) => {
        const w = repoWhy(S, hook.id, opt.key, x);
        return btn(`offer:${key}:${x}`, ['+ ', h('code', {}, x)], () => addOffer(x), '.offer', { title: w ? reasonLine(t, w) : null, 'aria-label': t('optOfferAdd', { item: x }) });
      })) : null,
    h('p.meta', { id: helpId }, withCode(opt.help), help));
}
