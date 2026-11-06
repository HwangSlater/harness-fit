// 허용 주석 시험(사용자 결정 2026-11-06): `lint:allow <훅 id> <이유>` 를 그 줄이나 바로 위 주석 줄에 달면 그 줄만 통과하고,
// 쓸 때마다 알린다(PreToolUse 는 systemMessage, git pre-commit 은 stderr). 이유가 없거나 짧으면·id 가 다르면 그대로 막는다.
// 비밀값은 훅 옵션 allowComment 를 켰을 때만 받는다. 진짜 진입점(hooks/run.mjs, 적용이 넣는 git 훅)으로 본다.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launcherText } from '../lib/git-hook.mjs';
import { FAKE, linesOf } from './strict-cases/helpers.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const RUN = path.join(ROOT, 'hooks', 'run.mjs');
const BUDGET_MS = Number(process.env.HARNESS_BUDGET_MS || 4000);
const IH = 'inner' + 'HTML';
const AWS = `const k = "${FAKE.aws}";`;
const NO_REASON = /reason is missing or too short/;
const USED = /lines passed by allow comments/;
const STACK = /\n\s+at .+[:(]\d+|node:internal|Error:/;

let tmp;
let seq = 0;
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-allow-')); });
after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

// 시험 밖 설정(이 PC 에 깔린 harness-fit)과 떼어 놓은 환경
const env = () => {
  const e = { ...process.env, CLAUDE_CONFIG_DIR: path.join(tmp, 'no-claude-config') };
  delete e.CLAUDE_PLUGIN_ROOT;
  return e;
};
const gitIn = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: env() });
const repo = (rules, { gitHook = false } = {}) => {
  const dir = path.join(tmp, `r${++seq}`);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  gitIn(dir, 'config', 'user.email', 't@example.com');
  gitIn(dir, 'config', 'user.name', 't');
  gitIn(dir, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(dir, 'README.md'), 'hello\n');
  gitIn(dir, 'add', 'README.md');
  gitIn(dir, 'commit', '-q', '-m', 'chore: 시작');
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.writeFileSync(path.join(dir, '.claude', 'harness.json'), JSON.stringify({ lang: 'en', rules }));
  if (gitHook) {
    fs.writeFileSync(path.join(dir, '.git', 'hooks', 'pre-commit'), launcherText(ROOT));
    fs.chmodSync(path.join(dir, '.git', 'hooks', 'pre-commit'), 0o755);
  }
  return dir;
};
const put = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const commitQuiet = (dir, msg) => gitIn(dir, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', msg);

// run.mjs 한 번 → { blocked, reason, notice, ms }. 터진 흔적·JSON 아닌 출력·{} 밖의 꼴은 실패.
const hook = (dir, tool_name, tool_input) =>
  new Promise((resolve, reject) => {
    const t0 = performance.now();
    const child = spawn(process.execPath, [RUN], { env: env() });
    const out = [];
    const err = [];
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', reject);
    child.on('close', (status) => {
      const ms = performance.now() - t0;
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8');
      try {
        assert.equal(status, 0, stderr.slice(0, 300));
        assert.doesNotMatch(stderr, STACK, stderr.slice(0, 300));
        const j = JSON.parse(stdout);
        if (j.hookSpecificOutput?.permissionDecision === 'deny') return resolve({ blocked: true, reason: j.hookSpecificOutput.permissionDecisionReason, ms });
        if (j.systemMessage !== undefined) {
          assert.deepEqual(Object.keys(j), ['systemMessage']);
          return resolve({ blocked: false, notice: j.systemMessage, ms });
        }
        assert.deepEqual(j, {});
        resolve({ blocked: false, notice: null, ms });
      } catch (e) {
        reject(e);
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ tool_name, cwd: dir, tool_input }));
  });
const write = (dir, rel, content) => hook(dir, 'Write', { file_path: path.join(dir, rel), content });
const edit = (dir, rel, old_string, new_string) => hook(dir, 'Edit', { file_path: path.join(dir, rel), old_string, new_string });
const bash = (dir, command) => hook(dir, 'Bash', { command });

const passes = (r, where, reason) => {
  assert.equal(r.blocked, false, r.reason);
  assert.match(r.notice || '', USED, '통과시킨 줄을 알려야 한다');
  if (where) assert.ok(r.notice.includes(where), `${where} 가 알림에 없음: ${r.notice}`);
  if (reason) assert.ok(r.notice.includes(reason), `이유가 알림에 없음: ${r.notice}`);
};
const blocks = (r, noReason = false) => {
  assert.equal(r.blocked, true, `막아야 한다: ${r.notice}`);
  if (noReason) assert.match(r.reason, NO_REASON);
};

describe('쓰기: 위험한 HTML(기본으로 받음)', { concurrency: true }, () => {
  const rules = { 'unsafe-html': true };
  test('줄 끝 허용 주석 + 이유 → 통과하고 file:줄·이유를 알린다', async () => {
    const d = repo(rules);
    passes(await write(d, 'src/view.js', `const a = 1;\nel.${IH} = trusted; // lint:allow unsafe-html 서버가 만든 고정 틀\n`), 'unsafe-html src/view.js:2', '서버가 만든 고정 틀');
  });
  test('이유가 없거나 짧으면 막고 「이유가 필요해요」', async () => {
    const d = repo(rules);
    blocks(await write(d, 'src/view.js', `el.${IH} = x; // lint:allow unsafe-html\n`), true);
    blocks(await write(d, 'src/view.js', `el.${IH} = x; // lint:allow unsafe-html ab\n`), true);
    blocks(await write(d, 'src/view.js', `el.${IH} = x; /* lint:allow unsafe-html */\n`), true);
  });
  test('다른 훅 id 면 막는다(이유 안내도 붙이지 않는다)', async () => {
    const d = repo(rules);
    const r = await write(d, 'src/view.js', `el.${IH} = x; // lint:allow secrets 이유를 적었음\n`);
    blocks(r);
    assert.doesNotMatch(r.reason, NO_REASON);
    blocks(await write(d, 'src/view.js', `el.${IH} = x; // lint:allow unsafe 이유를 적었음\n`));
  });
  test('바로 위 주석 줄도 받는다. 두 줄 위·코드가 있는 줄의 허용은 아래 줄에 듣지 않는다', async () => {
    const d = repo(rules);
    passes(await write(d, 'src/a.js', `// lint:allow unsafe-html 고정 틀만 넣음\nel.${IH} = x;\n`), 'src/a.js:2');
    passes(await write(d, 'src/t.html', `<!-- lint:allow unsafe-html 서버 템플릿 -->\n<div v-html="x"></div>\n`), null);
    passes(await write(d, 'src/c.vue', `<!-- lint:allow unsafe-html 서버 템플릿 -->\n<div v-html="x"></div>\n`), 'src/c.vue:2');
    blocks(await write(d, 'src/a.js', `// lint:allow unsafe-html 고정 틀만 넣음\nconst a = 1;\nel.${IH} = x;\n`));
    blocks(await write(d, 'src/a.js', `el.${IH} = a; // lint:allow unsafe-html 고정 틀만 넣음\nel.${IH} = b;\n`));
  });
  test('/* */ 안의 이유는 닫는 표시 앞까지', async () => {
    const d = repo(rules);
    const r = await write(d, 'src/a.js', `el.${IH} = x; /* lint:allow unsafe-html 고정 틀 */ foo();\n`);
    passes(r, 'src/a.js:1', '"고정 틀"');
  });
  test('Edit: 파일에 이미 있던 위 주석 줄을 보고, 줄 번호는 파일의 자리', async () => {
    const d = repo(rules);
    put(d, 'src/b.js', 'const a = 1;\nconst b = 2;\n// lint:allow unsafe-html 고정 틀만 넣음\nel.textContent = x;\n');
    passes(await edit(d, 'src/b.js', 'el.textContent = x;', `el.${IH} = x;`), 'src/b.js:4');
    blocks(await edit(d, 'src/b.js', 'const b = 2;', `const b = 2;\nel.${IH} = y;`));
  });
  test('허용한 줄과 안 한 줄이 함께면 막는다', async () => {
    const d = repo(rules);
    blocks(await write(d, 'src/a.js', `el.${IH} = a; // lint:allow unsafe-html 고정 틀\nconst z = 0;\nel.${IH} = b;\n`));
  });
  test('0.2.x 의 harness:allow 도 받고 알린다', async () => {
    const d = repo(rules);
    passes(await write(d, 'src/a.js', `el.${IH} = x; // harness:allow unsafe-html 옛 꼴 주석\n`), 'src/a.js:1');
  });
});

describe('쓰기: 비밀값(옵션 allowComment 를 켜야 받음)', { concurrency: true }, () => {
  test('옵션이 꺼져 있으면 이유가 있어도 막고 옵션을 알려 준다', async () => {
    const d = repo({ secrets: true });
    const r = await write(d, 'src/a.ts', `${AWS} // lint:allow secrets 문서 예시\n`);
    blocks(r);
    assert.match(r.reason, /Accept allow comments/);
  });
  test('옵션을 켜면 통과·알림, 이유 없으면 막음, 바로 위 줄도', async () => {
    const d = repo({ secrets: { allowComment: true } });
    passes(await write(d, 'src/a.ts', `${AWS} // lint:allow secrets 문서 예시\n`), 'secrets src/a.ts:1', '문서 예시');
    blocks(await write(d, 'src/a.ts', `${AWS} // lint:allow secrets\n`), true);
    passes(await write(d, 'src/a.ts', `// lint:allow secrets 문서에 싣는 가짜 키\n${AWS}\n`), 'src/a.ts:2');
    blocks(await write(d, 'src/a.ts', `${AWS} // lint:allow secrets 문서 예시\nconst j = "${FAKE.github}";\n`));
    passes(await write(d, 'src/a.ts', `${AWS} // harness:allow secret 옛 꼴 주석\n`), 'src/a.ts:1');
  });
});

describe('쓰기: 워크플로·큰 새 파일', { concurrency: true }, () => {
  const flow = (step) => `on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n${step}`;
  test('gha-inject: 줄 끝·위 줄 허용, 이미 있던 허용 줄은 다시 알리지 않는다', async () => {
    const d = repo({ 'gha-inject': true });
    passes(await write(d, '.github/workflows/ci.yml', flow('      - uses: someone/x@v1 # lint:allow gha-inject 사내 미러 액션\n')), '.github/workflows/ci.yml:6');
    passes(await write(d, '.github/workflows/ci.yml', flow('      # lint:allow gha-inject 사내 미러 액션\n      - uses: someone/x@v1\n')), 'ci.yml:7');
    blocks(await write(d, '.github/workflows/ci.yml', flow('      - uses: someone/x@v1 # lint:allow gha-inject\n')), true);
    put(d, '.github/workflows/ci.yml', flow('      - uses: someone/x@v1 # lint:allow gha-inject 사내 미러 액션\n      - run: echo hi\n'));
    const r = await edit(d, '.github/workflows/ci.yml', 'echo hi', 'echo bye');
    assert.deepEqual([r.blocked, r.notice], [false, null]);
  });
  test('file-size: 파일 맨 위 10줄 안의 허용 주석만', async () => {
    const d = repo({ 'file-size': true });
    passes(await write(d, 'src/gen.ts', `// 생성된 파일\n// lint:allow file-size 생성된 표라 나누지 않음\n${linesOf(500)}`), 'file-size src/gen.ts:2');
    blocks(await write(d, 'src/gen2.ts', `${linesOf(20)}// lint:allow file-size 생성된 표라 나누지 않음\n${linesOf(500)}`));
    blocks(await write(d, 'src/gen3.ts', `// lint:allow file-size\n${linesOf(500)}`), true);
  });
});

describe('커밋할 때(git 훅이 없는 저장소: PreToolUse 가 git commit 을 미리 봄)', { concurrency: true }, () => {
  test('stage 한 허용 줄 → 통과·file:줄 알림, 이유 없음 → 막음', async () => {
    const d = repo({ 'unsafe-html': true });
    put(d, 'src/r.js', `const a = 1;\nel.${IH} = x; // lint:allow unsafe-html 고정 틀만 넣음\n`);
    gitIn(d, 'add', 'src/r.js');
    passes(await bash(d, 'git commit -m "feat: x"'), 'unsafe-html src/r.js:2');
    put(d, 'src/s.js', `el.${IH} = x; // lint:allow unsafe-html\n`);
    gitIn(d, 'add', 'src/s.js');
    blocks(await bash(d, 'git commit -m "feat: x"'), true);
  });
  test('HEAD 에 있던 위 주석 줄 아래를 고친 커밋(더한 줄만 diff 에 있어도 위 줄을 찾는다)', async () => {
    const d = repo({ 'unsafe-html': true });
    put(d, 'src/r.js', 'const a = 1;\n// lint:allow unsafe-html 고정 틀만 넣음\nel.textContent = x;\nconst b = 2;\n');
    gitIn(d, 'add', 'src/r.js');
    commitQuiet(d, 'chore: 시작 파일');
    put(d, 'src/r.js', `const a = 1;\n// lint:allow unsafe-html 고정 틀만 넣음\nel.${IH} = x;\nconst b = 2;\nel.${IH} = y;\n`);
    gitIn(d, 'add', 'src/r.js');
    blocks(await bash(d, 'git commit -m "feat: x"'));
    put(d, 'src/r.js', `const a = 1;\n// lint:allow unsafe-html 고정 틀만 넣음\nel.${IH} = x;\nconst b = 2;\n`);
    gitIn(d, 'add', 'src/r.js');
    passes(await bash(d, 'git commit -m "feat: x"'), 'src/r.js:3');
  });
  test('비밀값: 옵션을 켜야 커밋에서도 받는다', async () => {
    const off = repo({ secrets: true });
    put(off, 'src/k.ts', `${AWS} // lint:allow secrets 문서 예시\n`);
    gitIn(off, 'add', 'src/k.ts');
    blocks(await bash(off, 'git commit -m "feat: x"'));
    const on = repo({ secrets: { allowComment: true } });
    put(on, 'src/k.ts', `${AWS} // lint:allow secrets 문서 예시\n`);
    gitIn(on, 'add', 'src/k.ts');
    passes(await bash(on, 'git commit -m "feat: x"'), 'secrets src/k.ts:1');
  });
});

describe('git pre-commit 훅(진짜 git commit)', { concurrency: true }, () => {
  const commit = (d) => spawnSync('git', ['-C', d, 'commit', '-q', '-m', 'feat: x'], { encoding: 'utf8', env: env(), timeout: 60000 });
  test('허용 줄은 커밋되고 stderr 에 file:줄·이유를 알린다', () => {
    const d = repo({ 'unsafe-html': true, 'file-size': true, secrets: { allowComment: true } }, { gitHook: true });
    put(d, 'src/r.js', `el.${IH} = x; // lint:allow unsafe-html 고정 틀만 넣음\n`);
    put(d, 'src/gen.ts', `// lint:allow file-size 생성된 표라 나누지 않음\n${linesOf(500)}`);
    put(d, 'src/k.ts', `// lint:allow secrets 문서에 싣는 가짜 키\n${AWS}\n`);
    gitIn(d, 'add', 'src/r.js', 'src/gen.ts', 'src/k.ts');
    const r = commit(d);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, USED);
    for (const where of ['unsafe-html src/r.js:1', 'file-size src/gen.ts:1', 'secrets src/k.ts:2']) assert.ok(r.stderr.includes(where), `${where}: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, STACK);
  });
  test('이유 없는 허용 주석은 커밋을 막고 이유가 필요하다고 알린다', () => {
    const d = repo({ 'unsafe-html': true }, { gitHook: true });
    put(d, 'src/r.js', `el.${IH} = x; // lint:allow unsafe-html\n`);
    gitIn(d, 'add', 'src/r.js');
    const r = commit(d);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, NO_REASON);
  });
});

describe('터짐·느림: 아주 긴 줄, 이상한 글자, 아주 많은 허용 줄', { concurrency: false }, () => {
  const MB = 1024 * 1024;
  const fast = (r) => assert.ok(r.ms < BUDGET_MS, `${r.ms.toFixed(0)}ms (한도 ${BUDGET_MS}ms)`);
  test('5MB 한 줄 이유 → 통과, 알림의 이유는 잘라서', async () => {
    const d = repo({ 'unsafe-html': true });
    const r = await write(d, 'src/a.js', `el.${IH} = x; // lint:allow unsafe-html ${'가'.repeat(5 * MB)}\n`);
    passes(r, 'src/a.js:1');
    assert.ok(r.notice.length < 500, `알림 길이 ${r.notice.length}`);
    fast(r);
  });
  test('한 줄에 토큰 20만 개 + 위험한 줄 → 터지지 않고 시간 안에', async () => {
    const d = repo({ 'unsafe-html': true, secrets: { allowComment: true } });
    const r = await write(d, 'src/a.js', `el.${IH} = x; ${'lint:allow '.repeat(200000)}\n${'// lint:allow unsafe-html '.repeat(100000)}\n`);
    assert.equal(typeof r.blocked, 'boolean');
    fast(r);
  });
  test('이상한 글자의 이유(글 방향 바꿈·제어 글자·짝 없는 서로게이트·결합 문자) → 알림에 그대로 새지 않는다', async () => {
    const d = repo({ 'unsafe-html': true });
    const odd = 'a\u202Eb\u0007c\u0000d\uD800e\u0301\u200Bf 😀';
    const r = await write(d, 'src/a.js', `el.${IH} = x; // lint:allow unsafe-html ${odd}\n`);
    passes(r, 'src/a.js:1');
    assert.doesNotMatch(r.notice, /[\u0000-\u001f\u202e]/);
    fast(r);
  });
  test('허용 줄 2만 개 → 알림은 10개까지 + 나머지 수', async () => {
    const d = repo({ 'unsafe-html': true });
    const body = Array.from({ length: 20000 }, (_, i) => `el.${IH} = v${i}; // lint:allow unsafe-html 고정 틀 ${i}`).join('\n');
    const r = await write(d, 'src/a.js', body + '\n');
    passes(r, 'src/a.js:1');
    assert.match(r.notice, /and 19990 more|외 19990건/);
    fast(r);
  });
  test('10MB 비밀값 글(줄마다 허용) → 시간 안에', async () => {
    const d = repo({ secrets: { allowComment: true } });
    const line = `${AWS} // lint:allow secrets 문서 예시\n`;
    const r = await write(d, 'docs/keys.txt', line.repeat(Math.floor((10 * MB) / line.length)));
    passes(r, 'docs/keys.txt:1');
    fast(r);
  });
});
