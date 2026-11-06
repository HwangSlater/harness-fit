// 코드 쓰기 규칙(unsafe-html · pin-deps) 시험. node --test hooks/test
// 잘못 막는 것이 놓치는 것보다 나쁘다 — 「막아야 할 것」과 「통과해야 할 것」을 함께 둔다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluate } from '../lib/evaluate.mjs';
import { unpinned } from '../lib/pin-deps.mjs';
import { renderRule } from '../../scripts/lib/claude-md.mjs';

let repo;
const setRules = (rules, lang = 'en') =>
  fs.writeFileSync(path.join(repo, '.claude', 'harness.json'), JSON.stringify({ lang, rules }));
const run = (tool_name, tool_input) => evaluate({ tool_name, cwd: repo, tool_input });
const write = (file_path, content) => run('Write', { file_path, content });
const edit = (file_path, old_string, new_string) => run('Edit', { file_path, old_string, new_string });
const put = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), text);
};
const blocks = (file, lines) => lines.forEach((c) => assert.equal(write(file, c).length, 1, `막아야 함(${file}): ${c}`));
const allows = (file, lines) => lines.forEach((c) => assert.deepEqual(write(file, c), [], `통과해야 함(${file}): ${c}`));

before(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-code-'));
  fs.mkdirSync(path.join(repo, '.git'));
  fs.mkdirSync(path.join(repo, '.claude'));
});
after(() => fs.rmSync(repo, { recursive: true, force: true }));
test('unsafe-html: HTML 로 넣기·문자열 실행을 막는다', () => {
  setRules({ 'unsafe-html': true });
  blocks('src/view.js', [
    'el.innerHTML = name;',
    'el.innerHTML += `<li>${item}</li>`;',
    'el.outerHTML = html;',
    "el.insertAdjacentHTML('beforeend', row);",
    'document.write(msg);',
    'const f = eval(code);',
    "const f = new Function('a', body);",
  ]);
  blocks('src/Card.tsx', ['<div dangerouslySetInnerHTML={{ __html: body }} />']);
  blocks('src/Card.vue', ['<div v-html="body"></div>']);
  blocks('src/Card.svelte', ['<div>{@html body}</div>']);
  blocks('public/index.html', ['<script>document.body.innerHTML = location.hash;</script>']);
});

test('unsafe-html: 안전한 꼴·예외는 통과한다', () => {
  setRules({ 'unsafe-html': true });
  allows('src/view.js', [
    "el.innerHTML = '';",
    "catch (e) { el.innerHTML = ''; return null; }",
    'el.innerHTML = "<br>";',
    'el.textContent = name;',
    'const h = el.innerHTML;',
    "if (el.innerHTML === '') {}",
    'el.innerHTML = DOMPurify.sanitize(html);',
    'el.innerHTML = escapeHtml(name);',
    "await page.$eval('#a', (e) => e.value);",
    'redis.eval(script, 0);',
    'const evaluate = (x) => x;',
    '// el.innerHTML = name 는 쓰지 않는다',
    'el.innerHTML = trusted; // lint:allow unsafe-html 서버가 만든 고정 틀',
    'el.innerHTML = trusted; // harness:allow unsafe-html 0.2.x 의 옛 꼴',
  ]);
  allows('src/view.test.js', ['document.body.innerHTML = fixture;']);
  allows('README.md', ['el.innerHTML = name']);
  allows('src/a.py', ['eval(x)']);
  const old = 'el.innerHTML = name;\nconst a = 1;';
  assert.deepEqual(edit('src/view.js', old, 'el.innerHTML = name;\nconst a = 2;'), [], '이미 있던 줄은 막지 않는다');
});

test('pin-deps: 버전 글 판정', () => {
  for (const v of ['^1.2.3', '~1.2.3', '*', '', 'x', '1.x', '1.2.*', 'latest', 'next', '>=1.0.0', '1.0.0 || 2.0.0', '1.0.0 - 2.0.0', '1', '1.2', 'npm:foo@^1.0.0', 'npm:foo'])
    assert.ok(unpinned(v) !== null, `범위: ${v}`);
  for (const v of ['1.2.3', '1.2.3-beta.1', '=1.2.3', 'v1.2.3', 'npm:foo@1.2.3', 'workspace:*', 'workspace:^', 'file:../x', 'link:../x', 'catalog:', 'git+https://github.com/a/b.git', 'github:a/b', 'a/b#v1', 'https://x.io/a.tgz'])
    assert.equal(unpinned(v), null, `고정 또는 대상 아님: ${v}`);
});

test('pin-deps: package.json 에 범위 버전을 넣으면 막는다', () => {
  setRules({ 'pin-deps': true });
  const pkg = (deps) => JSON.stringify({ name: 'a', ...deps }, null, 2);
  assert.equal(write('package.json', pkg({ dependencies: { react: '^18.2.0' } })).length, 1);
  assert.equal(write('apps/web/package.json', pkg({ devDependencies: { vitest: 'latest' } })).length, 1);
  assert.equal(write('package.json', pkg({ optionalDependencies: { fsevents: '~2.3.0' } })).length, 1);
  assert.match(write('package.json', pkg({ dependencies: { react: '^18.2.0' } }))[0], /react@\^18\.2\.0/);
});

test('pin-deps: 고정 버전·peer·engines·기존 항목은 통과한다', () => {
  setRules({ 'pin-deps': true });
  const pkg = (o) => JSON.stringify({ name: 'a', ...o }, null, 2);
  assert.deepEqual(write('package.json', pkg({ dependencies: { react: '18.2.0', ui: 'workspace:*' } })), []);
  assert.deepEqual(write('package.json', pkg({ peerDependencies: { react: '^18.0.0' }, engines: { node: '>=18' }, overrides: { a: '^1.0.0' } })), []);
  assert.deepEqual(write('package.json', pkg({ scripts: { build: 'tsc' } })), []);
  assert.deepEqual(write('node_modules/x/package.json', pkg({ dependencies: { a: '^1.0.0' } })), []);
  assert.deepEqual(write('package.json', '{ not json'), [], '깨진 JSON 은 판단하지 않는다');

  // 이미 범위로 적힌 의존성이 있는 파일을 고칠 때: 새로 넣거나 바꾼 항목만 본다.
  const before = pkg({ dependencies: { lodash: '^4.17.0', react: '18.2.0' } });
  put('pkg/package.json', before);
  const file = 'pkg/package.json';
  assert.deepEqual(edit(file, '"react": "18.2.0"', '"react": "18.3.1"'), [], '고정 버전으로 바꾸기');
  assert.deepEqual(edit(file, '"name": "a"', '"name": "b"'), [], '의존성과 상관없는 고치기(기존 lodash 범위는 그대로)');
  assert.equal(edit(file, '"react": "18.2.0"', '"react": "^18.3.1"').length, 1, '범위로 바꾸기');
  assert.equal(edit(file, '"react": "18.2.0"', '"react": "18.2.0",\n    "zod": "^3.0.0"').length, 1, '범위로 새로 넣기');
  assert.deepEqual(edit(file, '"없는 글"', '"zod": "^3.0.0"'), [], '고칠 글을 못 찾으면(어차피 실패) 판단하지 않는다');
  assert.equal(run('Edit', { file_path: file, edits: [{ old_string: '"name": "a"', new_string: '"name": "b"' }, { old_string: '"react": "18.2.0"', new_string: '"react": "~18.2.0"' }] }).length, 1);
  assert.deepEqual(write(file, before.replace('"name": "a"', '"name": "c"')), [], 'Write 로 다시 써도 기존 범위는 막지 않는다');
});

// 훅이 줄 전체를 다 막을 때만 그 줄이 빠진다. 훅이 일부만 막는 줄(키·토큰, 위험 명령)은 늘 남는다(2026-11-06)
test('CLAUDE.md 문장: 훅을 켜면 훅이 다 막는 줄만 빠지고, 끄면 글로 남는다', () => {
  const cases = [['security', 'pin-deps', { ko: /정확한 버전/, en: /exact versions/ }]];
  for (const lang of ['ko', 'en']) {
    const all = renderRule('security', lang, ['secrets', 'danger-cmd', 'unsafe-html', 'password-cli']);
    assert.match(all, lang === 'ko' ? /키·토큰/ : /keys or tokens/, '비밀값 훅은 적어 둔 꼴만 막으니 줄이 남는다');
    assert.match(all, lang === 'ko' ? /되돌릴 수 없는/ : /cannot be undone/, '위험 명령 훅도 적어 둔 꼴만 막으니 줄이 남는다');
    assert.match(renderRule('structure', lang, []), lang === 'ko' ? /색·주소/ : /colors and URLs/, '값 바로 적기는 판단으로 남는다');
  }
  for (const [rule, hook, offRe] of cases)
    for (const lang of ['ko', 'en']) {
      const on = renderRule(rule, lang, [hook]);
      const off = renderRule(rule, lang, []);
      assert.ok(!/\{\{/.test(on + off), '표시가 남으면 안 된다');
      assert.match(off, offRe[lang], `${rule}/${hook}/${lang}: 끄면 글로`);
      assert.doesNotMatch(on, offRe[lang], `${rule}/${hook}/${lang}: 켜면 그 부분은 빠진다`);
      assert.doesNotMatch(on, /훅이 막|hooks? blocks?/i, '「훅이 막는다」는 글로 적지 않는다');
    }
  for (const lang of ['ko', 'en']) assert.doesNotMatch(renderRule('structure', lang, []), /커밋|commit/i, '커밋 나누기는 collab 규칙에만');
});
