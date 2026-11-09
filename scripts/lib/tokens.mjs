// 대략적인 토큰 수: 영문은 4글자당 1, 한글 등은 1글자당 1. 화면에 「약 N 토큰」으로만 쓰므로 이 정도로 충분하다.
import { ruleFiles, TAG } from './rule-files.mjs';

// 영문 몇 글자를 토큰 하나로 보는지(스킬 목록 예산 셈 scripts/lib/skill-budget.mjs 도 같은 값)
export const CHARS_PER_TOKEN = 4;

export const estimateTokens = (s) => {
  const nonAscii = (s.match(/[^\x00-\x7f]/g) || []).length;
  return Math.ceil((s.length - nonAscii) / CHARS_PER_TOKEN + nonAscii);
};

// rules/<id>.<lang>.md 들의 토큰 수 { id: n }.
// 조건 줄은 「훅 켜짐」 기준으로 센다(꺼짐 전용 줄은 뺀다). 화면 타일은 이 어림값을 쓴다(실제 CLAUDE.md 글은 훅·스킬·빠진 줄에 따라 조금 다르다).
export const ruleTokens = (pluginRoot, lang) => {
  const out = {};
  for (const [id, lines] of ruleFiles(lang, pluginRoot)) {
    const kept = lines.filter((l) => l.match(TAG)?.[1] !== '!').map((l) => l.replace(TAG, ''));
    out[id] = estimateTokens(kept.join('\n'));
  }
  return out;
};
