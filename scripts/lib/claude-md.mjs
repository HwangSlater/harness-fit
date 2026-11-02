// CLAUDE.md 에 넣을 규칙 문장 만들기.
// 규칙 조각(rules/<id>.<lang>.md)의 줄 끝 표시로, 실제로 켠 훅과 문장이 어긋나지 않게 한다.
//   `… {{hook:commit-msg}}`  그 훅이 켜졌을 때만 넣는다
//   `… {{!hook:commit-msg}}` 그 훅이 꺼졌을 때만 넣는다
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_ROOT } from './catalog.mjs';

export const START = '<!-- harness-fit:start -->';
export const END = '<!-- harness-fit:end -->';
const TAG = /\s*\{\{(!?)hook:([\w-]+)\}\}\s*$/;

export const renderRule = (id, lang, hooks) => {
  const file = path.join(PLUGIN_ROOT, 'rules', `${id}.${lang}.md`);
  if (!fs.existsSync(file)) return '';
  const on = new Set(hooks);
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(TAG);
    if (!m) out.push(line);
    else if ((m[1] === '!') !== on.has(m[2])) out.push(line.replace(TAG, ''));
  }
  return out.join('\n').trim();
};

// 고른 것 → { 규칙 id: 들어갈 문장 }. 브랜치 방식도 규칙 하나로 친다.
export const ruleTexts = (sel) => {
  const ids = [sel.flow !== 'none' ? sel.flow : null, ...sel.rules].filter(Boolean);
  return Object.fromEntries(ids.map((id) => [id, renderRule(id, sel.lang, sel.hooks)]).filter(([, text]) => text));
};

// 관리 구역(START~END) 한 덩어리. 표시가 없거나 순서가 거꾸로면(END 가 먼저) 없는 것으로 본다.
const BLOCK = new RegExp(`\\n*${START}[\\s\\S]*?${END}\\n?`);
export const extractBlock = (text) => text?.match(new RegExp(`${START}[\\s\\S]*?${END}`))?.[0] || '';

// 관리 구역만 block 으로 바꾼다(빈 문자열이면 구역을 뺀다). 사용자가 쓴 나머지는 건드리지 않는다.
// 표시가 짝이 안 맞게 남아 있으면(END 만 있음 등) 지우지 않고 끝에 새 구역을 붙인다.
export const setBlock = (current, block) => {
  if (current && BLOCK.test(current)) return current.replace(BLOCK, block ? `\n\n${block}\n` : '\n').replace(/^\n+/, '');
  if (!block) return current;
  return current ? `${current.replace(/\s*$/, '')}\n\n${block}\n` : `${block}\n`;
};

export const buildClaudeMd = (current, sel) => {
  const body = Object.values(ruleTexts(sel)).join('\n\n');
  return setBlock(current, body ? `${START}\n${body}\n${END}` : '');
};
