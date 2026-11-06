// 대략적인 토큰 수: 영문은 4글자당 1, 한글 등은 1글자당 1. 화면에 「약 N 토큰」으로만 쓰므로 이 정도로 충분하다.
import fs from 'node:fs';
import path from 'node:path';

export const estimateTokens = (s) => {
  const nonAscii = (s.match(/[^\x00-\x7f]/g) || []).length;
  return Math.ceil((s.length - nonAscii) / 4 + nonAscii);
};

// rules/<id>.<lang>.md 들의 토큰 수 { id: n }.
// 조건 줄은 「훅 켜짐」 기준으로 센다(꺼짐 전용 줄은 뺀다). 화면 타일은 이 어림값을 쓴다(실제 CLAUDE.md 글은 훅·스킬·빠진 줄에 따라 조금 다르다).
const OFF_ONLY = /\{\{!(?:hook|skill):[\w|-]+\}\}/;
const TAG = /\s*\{\{(?:(?:hook|skill):[\w|-]+|judge)\}\}/g;

export const ruleTokens = (pluginRoot, lang) => {
  const out = {};
  for (const f of fs.readdirSync(path.join(pluginRoot, 'rules'))) {
    const m = f.match(/^(.+)\.(ko|en)\.md$/);
    if (!m || m[2] !== lang) continue;
    const lines = fs.readFileSync(path.join(pluginRoot, 'rules', f), 'utf8').split(/\r?\n/);
    out[m[1]] = estimateTokens(lines.filter((l) => !OFF_ONLY.test(l)).join('\n').replace(TAG, ''));
  }
  return out;
};
