// 2 스킬 단계: 조합이 켜는 것(단계 묶음 표) + 「추가로 추천」(저장소 스택에 맞춘 것) + 새로 나온 저장소.
// 「자세히 보기」·「전체 스킬 보기」는 전체 보기 창(browse.js)을 그 묶음으로 연다. 창의 스킬 한 줄도 여기서 만든다.
import { h } from './dom.js';
import { chip, shead, groupRow, onCount, alreadyNote, skillLabels, label, stars, num, checkRow, isNew, link } from './parts.js';
import { STAGES, stageOf, listable, skillBy, comboBy, recSkills } from './stats.js';
import { stepHead } from './frame.js';
import { browseBtn, itemRow } from './browse.js';

const addonIds = (k) => new Set((k?.addons || []).flatMap((a) => a.skills));
// 조합이 켜는 스킬(스택 맞춤은 빼고)
export const comboOwn = (S, sel) => {
  const k = comboBy(S, sel.combo);
  const add = addonIds(k);
  return (k?.base.skills || []).filter((id) => !add.has(id));
};
// 이 스킬이 왜 들어 있나: 조합 · 추천(스택) · 직접 넣음
export const skillWhy = (c, id) => {
  const { S, sel, t } = c;
  if (comboOwn(S, sel).includes(id)) return { k: 'combo', text: t('whyCombo') };
  const r = recSkills(S).find((x) => x.id === id);
  if (r) return { k: 'rec', text: t('whyRec', { stacks: r.stacks.join(' · ') }) };
  return sel.skills.has(id) ? { k: 'extra', text: t('whyExtra') } : null;
};
// 단계 표에 보일 스킬: 조합이 켜는 것 + 직접 넣거나 뺀 것(추천 칸에 있는 것은 그쪽에)
const boardIds = (c) => {
  const { S, sel, ui } = c;
  const rec = new Set(recSkills(S).map((x) => x.id));
  const own = comboOwn(S, sel);
  const extra = [...sel.skills, ...ui.touched].filter((id) => !rec.has(id) && skillBy(S, id));
  return [...new Set([...own, ...extra])].filter((id) => listable(S, skillBy(S, id)));
};

function skillChip(c, id, note) {
  const { S, sel, t, act, dup, mates } = c;
  const k = skillBy(S, id);
  const warn = dup.skills.get(id) ? t('chipDup') : mates.get(id) && !sel.skills.has(id) ? t('chipMate') : null;
  return chip({ key: `skill:${id}`, on: sel.skills.has(id), label: k.title, note: warn || note, badge: isNew(S, 'skills', id) ? t('badgeNewShort') : null, title: k.when,
    onClick: () => act.toggle('skills', id) });
}

// 목록 기준일 이후 새로 나오거나 업데이트된 저장소: 체크하면 적용 뒤 Claude 가 살펴보고 알려 준다(설치하지 않음)
function freshBox({ S, sel, ui, t, act }) {
  const f = ui.fresh;
  if (f === null) return h('p.hint', { role: 'status' }, t('freshLoading'));
  if (f.error) return h('p.hint', {}, t('freshError', { error: f.error, date: S.checkedAt }));
  if (!f.repos.length) return h('p.hint', {}, t('freshNoneShort', { date: S.checkedAt }));
  return h('div.box', {},
    h('div.box-h', {}, h('span', {}, t('freshTitle')), h('span.muted', {}, t('freshHint'))),
    f.repos.slice(0, 12).map((r) => h('div.lrow', {},
      checkRow({ key: `explore:${r.repo}`, on: sel.explore.has(r.repo), label: r.repo, onChange: () => act.toggle('explore', r.repo) }),
      h('div.main', {}, h('span.d', {}, r.description || ''), h('span.d', {}, `${t('stars', { n: stars(S, r.stars) })} · ${r.isNew ? t('freshNew') : t('freshUpdated')} ${r.isNew ? r.createdAt : r.pushedAt}`)))));
}

export function skillsStep(c) {
  const { S, sel, t } = c;
  const board = boardIds(c);
  const rec = recSkills(S).filter((x) => listable(S, skillBy(S, x.id)));
  const total = S.skills.filter((k) => listable(S, k)).length;
  const stages = STAGES.filter((st) => st.id !== 'other' || board.some((id) => stageOf(skillBy(S, id)) === 'other'));
  return [
    ...stepHead(c, 'skills'),
    h('p.qs', {}, t('s2p')),
    h('div.qb', {},
      alreadyNote(c, 'skills', (id) => skillBy(S, id)?.title || id),
      shead(t('skComboHead', { name: comboBy(S, sel.combo)?.name || '' }), onCount(t, board.filter((id) => sel.skills.has(id)).length, board.length),
        browseBtn(c, t('browseAllSkills', { n: total }), 'skills', 'all', 'browseAll')),
      h('div.gtable', {}, stages.map((st) => {
        const ids = board.filter((id) => stageOf(skillBy(S, id)) === st.id);
        return groupRow({ name: t(`stage.${st.id}`), count: ids.length ? onCount(t, ids.filter((id) => sel.skills.has(id)).length, ids.length) : t(`stage.${st.id}.sub`),
          chips: ids.map((id) => skillChip(c, id)), empty: t('emptyStage'), more: browseBtn(c, t('details'), 'skills', st.id) });
      })),
      shead(t('skRecHead'), rec.length ? t('skRecSub', { list: [...new Set(rec.flatMap((x) => x.stacks))].join(' · ') }) : ''),
      h('div.gtable', {}, groupRow({ name: t('skRecRow'), count: rec.length ? onCount(t, rec.filter((x) => sel.skills.has(x.id)).length, rec.length) : t('sumNone'),
        chips: rec.map((x) => skillChip(c, x.id, x.stacks.join(' · '))), empty: t('skRecEmpty'), more: rec.length ? browseBtn(c, t('details'), 'skills', 'rec') : null })),
      shead(t('freshHead'), ''),
      freshBox(c)),
  ];
}

// 전체 보기 창의 스킬 한 줄. 「자세히」를 펼치면 출처·라이선스·고정 커밋·실행 파일·원문(SKILL.md)
export function skillItem(c, id) {
  const { S, sel, ui, t, act } = c;
  const k = skillBy(S, id);
  const why = skillWhy(c, id);
  const row = (key, ...v) => [h('dt', {}, t(key)), h('dd', {}, ...v)];
  const raw = ui.raw?.id === id ? ui.raw : null;
  return itemRow(c, {
    key: `s:${id}`, on: sel.skills.has(id), name: k.title,
    labels: [why ? label(why.text, why.k === 'combo' ? '' : '.accent') : null, ...skillLabels(c, k)],
    plain: k.when,
    meta: [h('span', {}, t('skillMeta', { always: num(S, k.always), onUse: num(S, k.onUse) }), ' · ', h('span.mono', {}, k.repo), ` · ${t('stars', { n: stars(S, k.stars) })}`)],
    scope: [h('dl', {},
      row('dSource', `${k.repo} · ${t('stars', { n: stars(S, k.stars) })}`),
      row('dLicense', k.license || t('dLicenseNone')),
      row('dPinned', k.install === 'plugin' ? `${t('dPlugin')} ${t('dManualPin')}` : t('dPinnedV', { sha: k.sha })),
      row('dFiles', t('dFilesV', { n: k.files ?? '–' })),
      row('dCostK', t('dCost', { always: num(S, k.always), onUse: num(S, k.onUse) })),
      // 설명이 긴 스킬(늘 드는 토큰 상위 10% — picker-state.mjs longDesc)
      k.longDesc ? row('dListK', t('dLongDesc', { n: num(S, k.descChars ?? k.always * 4) })) : null,
      k.scripts.length ? row('dScripts', t('dScriptsNote'), h('ul', {}, k.scripts.map((f) => h('li.mono', {}, f)))) : row('dScriptsK', t('dNoScripts'))),
    raw ? [h('p.hint', {}, t('rawNote')), h('pre.raw', { tabindex: '0' }, raw.text ?? t('loadingRaw'))] : link(`raw:${id}`, t('viewRaw'), () => act.loadRaw(id))],
    onToggle: () => act.toggle('skills', id),
  });
}
