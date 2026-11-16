// 인프라 설정 고치기(Write·Edit·MultiEdit): 안전장치를 끄는 설정이 새로 들어가면 막지 않고 사용자에게 묻는다(kind ask).
// 찾는 꼴은 lib/iac-edit.mjs. 묻는 결정(permissionDecision ask)은 도구 종류와 상관없이 Claude Code 가 확인 창을 띄운다.
import { findIacEdits } from '../lib/iac-edit.mjs';
import { targetFile } from '../lib/lines.mjs';

export const iacEdit = {
  id: 'iac-edit',
  on: 'write',
  ask: true,
  check({ input, cwd, project, t }) {
    const ti = input.tool_input || {};
    const hits = findIacEdits(ti, cwd, project);
    if (!hits.length) return null;
    const what = hits.map((h) => t(h.key, { cidr: h.cidr || '' })).join(', ');
    return t('iac.ask', { file: targetFile(ti), what });
  },
};

export default [iacEdit];
