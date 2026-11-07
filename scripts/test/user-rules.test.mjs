// 사용자가 쓴 .claude/rules/ 규칙도 「이미 있는 지침」으로 견준다(중복 적용 금지).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listUserRules, MAX_RULES_CHARS } from '../lib/user-rules.mjs';
import { detectCommands } from '../lib/commands.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hf-user-rules-'));
const put = (dir, rel, text) => {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};

test('프로젝트·홈의 규칙 파일을 하위 폴더까지 읽고, harness-fit 파일과 .md 아닌 것은 뺀다', () => {
  const root = tmp();
  const home = tmp();
  put(root, '.claude/rules/testing.md', '- 시험은 `pnpm test` 로 돌린다.');
  put(root, '.claude/rules/api/handlers.md', '---\npaths:\n  - "src/api/**/*.ts"\n---\n- 핸들러는 오류 도우미를 쓴다.');
  put(root, '.claude/rules/harness-fit-commands.md', '- harness-fit 이 쓴 것');
  put(root, '.claude/rules/notes.txt', '무시');
  put(home, '.claude/rules/style.md', '---\npaths: "**/*.py"\n---\n- 들여쓰기 4칸');
  const got = listUserRules(root, home);
  assert.deepEqual(got.map((r) => [r.scope, r.file, r.paths || null]).sort(), [
    ['project', '.claude/rules/api/handlers.md', 'src/api/**/*.ts'],
    ['project', '.claude/rules/testing.md', null],
    ['user', '~/.claude/rules/style.md', '"**/*.py"'],
  ]);
});

test('규칙 폴더가 없거나 못 읽어도 빈 목록, 글은 상한까지만', () => {
  assert.deepEqual(listUserRules(tmp(), tmp()), []);
  const root = tmp();
  put(root, '.claude/rules/big.md', 'x'.repeat(MAX_RULES_CHARS + 500));
  const [r] = listUserRules(root, tmp());
  assert.ok(r.text.length <= MAX_RULES_CHARS + 10);
  assert.match(r.text, /잘림/);
});

test('규칙 파일에 이미 적힌 명령은 「이 저장소 명령」에 다시 넣지 않는다', () => {
  const root = tmp();
  put(root, 'package.json', JSON.stringify({ scripts: { test: 'vitest run', build: 'vite build' } }));
  put(root, '.claude/rules/testing.md', '- 시험: `npm test`');
  const { commands, listed } = detectCommands(root, { home: tmp() });
  assert.ok(!commands.test, '이미 규칙 파일에 있음');
  assert.ok(listed.includes('npm test'));
  assert.deepEqual(commands.build, ['npm run build']);
});
