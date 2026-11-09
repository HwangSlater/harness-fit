// 언어별 쓰기 규칙: Swift(try!·print(), Python(shell=True·eval(·exec(). 그 언어 파일(.swift / .py·.pyw)에서만 돈다.
// 이번 호출로 새로 들어가는 줄만 본다. 셸로 쓴 파일은 커밋할 때 같은 함수로 다시 본다(rules/commit.mjs INSPECT).
import { addedRows, targetFile, fileAfter } from '../lib/lines.mjs';
import { findLangUnsafe, langTarget } from '../lib/lang-unsafe.mjs';
import { allowFor } from '../lib/allow.mjs';
// 찾은 것 → 문구, 커밋 계획에서 찾기. 쓰기 검사와 커밋 검사가 같이 쓴다(lib/messages.mjs).
import { trimmedSet, langWhere as where, langMessage, langCommitHits } from '../lib/messages.mjs';

export { langMessage, langCommitHits };

const writeRule = (id) => ({
  id,
  on: 'write',
  check({ input, cwd, t, allows }) {
    const ti = input.tool_input || {};
    const file = targetFile(ti);
    if (!langTarget(id, file)) return null;
    const added = addedRows(ti, cwd).lines;
    if (!added.length) return null;
    // 쓴 뒤 파일 전체로 주석·글자를 가린다(고치는 조각이 여러 줄 글자 한가운데일 수 있다). 모르면 새 줄만으로.
    const { after } = fileAfter(ti, cwd);
    const whole = typeof after === 'string';
    const hits = findLangUnsafe(id, whole ? after : added.join('\n'), whole ? trimmedSet(added) : null, (rows) => allowFor(allows, id, file, rows), whole);
    return hits.length ? langMessage(id, hits.map((h) => where(h, t)), t) : null;
  },
});

export const swiftUnsafe = writeRule('swift-unsafe');
export const pythonUnsafe = writeRule('python-unsafe');

export default [swiftUnsafe, pythonUnsafe];
