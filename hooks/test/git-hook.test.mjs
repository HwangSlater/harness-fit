// git pre-commit 훅 시험: 적용이 넣는 실행기를 저장소에 두고 진짜 `git commit` 을 돌려 본다.
// 쓰기 훅 6개가 실제로 커밋되는 내용(색인)으로 막는지·통과시키는지, 깨진 입력·환경에서 커밋을 막거나 터지지 않는지.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launcherText, chainCommand, COMMIT_HOOK_IDS, gitHookState, gitHookActive, MARKER } from '../lib/git-hook.mjs';
import commitRules from '../rules/commit.mjs';
import { FAKE, assign, linesOf } from './strict-cases/helpers.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const SCRIPT = path.join(ROOT, 'hooks', 'git-pre-commit.mjs');
const IH = 'inner' + 'HTML';
const tokenLine = `export const token = "${FAKE.github}";\n`;
let tmp;
let seq = 0;
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-githook-')); });
after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

// 시험 밖 설정(이 PC 에 깔린 harness-fit)과 떼어 놓은 환경
const env = (extra = {}) => {
  const e = { ...process.env, CLAUDE_CONFIG_DIR: path.join(tmp, 'no-claude-config'), ...extra };
  delete e.CLAUDE_PLUGIN_ROOT;
  return e;
};
// PATH 만 바꾼 환경(Windows 는 이름이 Path 라 대소문자를 가리지 않고 지운다)
const withPath = (value) => {
  const e = env();
  for (const k of Object.keys(e)) if (k.toLowerCase() === 'path') delete e[k];
  e.PATH = value;
  return e;
};
const gitIn = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: env() });

// 새 저장소: main 에 README 커밋 하나, harness.json(rules), 우리 훅(recorded 경로)
const repo = ({ rules = Object.fromEntries(COMMIT_HOOK_IDS.map((id) => [id, true])), recorded = ROOT, hook = true, name } = {}) => {
  const dir = path.join(tmp, name || `r${++seq}`);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  gitIn(dir, 'config', 'user.email', 't@example.com');
  gitIn(dir, 'config', 'user.name', 't');
  gitIn(dir, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(dir, 'README.md'), 'hello\n');
  gitIn(dir, 'add', 'README.md');
  gitIn(dir, 'commit', '-q', '-m', 'chore: 시작');
  fs.mkdirSync(path.join(dir, '.claude'));
  if (rules !== null) fs.writeFileSync(path.join(dir, '.claude', 'harness.json'), typeof rules === 'string' ? rules : JSON.stringify({ lang: 'en', rules }));
  if (hook) {
    fs.writeFileSync(path.join(dir, '.git', 'hooks', 'pre-commit'), launcherText(recorded));
    fs.chmodSync(path.join(dir, '.git', 'hooks', 'pre-commit'), 0o755);
  }
  return dir;
};
const put = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const commitTimes = []; // [ms, 사례] — 진짜 커밋 한 번(훅 포함)에 걸린 시간
const commit = (dir, ...args) => {
  const t0 = performance.now();
  const r = spawnSync('git', ['-C', dir, 'commit', '-q', '-m', 'feat: x', ...args], { encoding: 'utf8', env: env(), timeout: 60000 });
  commitTimes.push(performance.now() - t0);
  return r;
};
const STACK = /\n\s+at .+[:(]\d+|Error:|node:internal/;

// 사례: 준비(dir) → 커밋 인자. want: 'block' | 'pass'
const CASES = [
  // 비밀값
  ['block', 'stage 한 토큰', (d) => { put(d, 'src/k.js', tokenLine); gitIn(d, 'add', 'src/k.js'); }],
  ['block', 'commit -a 가 넣는 추적 파일(임시 색인)', (d) => { put(d, 'README.md', tokenLine); return ['-a']; }],
  ['block', 'commit <경로> 가 넣는 파일(임시 색인)', (d) => { put(d, 'README.md', tokenLine); return ['--', 'README.md']; }],
  ['block', 'SECRET_KEY 대입', (d) => { put(d, 'app/settings.py', assign('SECRET_KEY', FAKE.password) + '\n'); gitIn(d, 'add', 'app/settings.py'); }],
  ['block', '공백·한글 파일 이름', (d) => { put(d, '설정 파일/키 모음.js', tokenLine); gitIn(d, 'add', '설정 파일/키 모음.js'); }],
  ['block', 'CRLF 줄', (d) => { put(d, 'src/w.js', tokenLine.replace('\n', '\r\n')); gitIn(d, 'add', 'src/w.js'); }],
  ['block', '허용 주석(비밀값은 옵션 allowComment 를 켜야 받는다)', (d) => { put(d, 'src/a.ts', `const k = "${FAKE.aws}"; // lint:allow secrets 문서 예시\n`); gitIn(d, 'add', 'src/a.ts'); }],
  ['pass', '문제없는 파일', (d) => { put(d, 'src/ok.js', 'export const a = 1;\n'); gitIn(d, 'add', 'src/ok.js'); }],
  ['pass', 'stage 하지 않은 토큰은 커밋에 안 들어간다', (d) => { put(d, 'src/k.js', tokenLine); put(d, 'src/ok.js', 'export const a = 1;\n'); gitIn(d, 'add', 'src/ok.js'); }],
  ['pass', '이미 HEAD 에 있던 토큰을 옮기기(git mv)', (d) => {
    put(d, 'src/old.js', tokenLine + '// harness:allow secret 옛 기록\n');
    gitIn(d, 'add', 'src/old.js');
    gitIn(d, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'chore: 옛 파일');
    fs.writeFileSync(path.join(d, 'src', 'old.js'), tokenLine);
    gitIn(d, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-am', 'chore: 허용 주석 빼기');
    gitIn(d, 'mv', 'src/old.js', 'src/new.js');
  }],
  ['block', '이름을 바꾸면서 더한 토큰', (d) => {
    put(d, 'src/old.js', 'export const a = 1;\n');
    gitIn(d, 'add', 'src/old.js');
    gitIn(d, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'chore: 옛 파일');
    gitIn(d, 'mv', 'src/old.js', 'src/new.js');
    fs.appendFileSync(path.join(d, 'src', 'new.js'), tokenLine);
    gitIn(d, 'add', 'src/new.js');
  }],
  ['block', '10MB 파일 끝의 토큰', (d) => { put(d, 'src/big.js', '// x\n'.repeat(2 * 1024 * 1024) + tokenLine); gitIn(d, 'add', 'src/big.js'); }],
  ['pass', '40MB 파일(한 번에 읽는 한도 32MB 를 넘어 보지 않지만 터지지 않는다)', (d) => { fs.mkdirSync(path.join(d, 'data')); fs.writeFileSync(path.join(d, 'data', 'huge.txt'), Buffer.alloc(40 * 1024 * 1024, 0x61)); gitIn(d, 'add', 'data/huge.txt'); }],
  ['block', '파일 2000개 가운데 하나의 토큰', (d) => {
    for (let i = 0; i < 2000; i++) put(d, `many/f${i}.js`, `export const v${i} = ${i};\n`);
    put(d, 'many/f1999.js', tokenLine);
    gitIn(d, 'add', 'many');
  }],
  ['pass', 'NUL 이 든 파일(git 이 바이너리로 본다)', (d) => { put(d, 'src/n.js', 'a\0b\0' + tokenLine); gitIn(d, 'add', 'src/n.js'); }],
  ['pass', '깨진 UTF-8 파일', (d) => { fs.mkdirSync(path.join(d, 'src'), { recursive: true }); fs.writeFileSync(path.join(d, 'src', 'u.js'), Buffer.from([0x63, 0x6f, 0x6e, 0x73, 0x74, 0x20, 0xff, 0xfe, 0xc3, 0x28, 0x0a])); gitIn(d, 'add', 'src/u.js'); }],
  ['pass', '바이너리 파일',(d) => { fs.writeFileSync(path.join(d, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1, 2, 3, 0xff, 0xfe])); gitIn(d, 'add', 'logo.png'); }],
  ['pass', '파일 지우기', (d) => { gitIn(d, 'rm', '-q', 'README.md'); }],
  ['pass', '하위 모듈 추가', (d) => {
    const sub = repo({ rules: null, hook: false });
    gitIn(d, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'vendor/sub');
  }],
  // .env·키 파일
  ['block', '.env 파일', (d) => { put(d, '.env', 'X=1\n'); gitIn(d, 'add', '-f', '.env'); }],
  ['block', '한글 경로의 키 파일', (d) => { put(d, '설정/서버.pem', 'x\n'); gitIn(d, 'add', '설정/서버.pem'); }],
  ['pass', '.env.example', (d) => { put(d, '.env.example', 'X=\n'); gitIn(d, 'add', '.env.example'); }],
  ['pass', '.env 를 저장소에서 빼기', (d) => {
    put(d, '.env', 'X=1\n');
    gitIn(d, 'add', '-f', '.env');
    gitIn(d, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'chore: 옛 .env');
    gitIn(d, 'rm', '-q', '--cached', '.env');
  }],
  // 위험한 HTML
  ['block', 'innerHTML 대입', (d) => { put(d, 'src/r.js', `el.${IH} = name;\n`); gitIn(d, 'add', 'src/r.js'); }],
  ['pass', 'textContent', (d) => { put(d, 'src/r.js', 'el.textContent = name;\n'); gitIn(d, 'add', 'src/r.js'); }],
  // 의존성 범위
  ['block', 'package.json 범위 버전', (d) => { put(d, 'package.json', JSON.stringify({ dependencies: { react: '^18.2.0' } }, null, 2)); gitIn(d, 'add', 'package.json'); }],
  ['pass', 'package.json 고정 버전', (d) => { put(d, 'package.json', JSON.stringify({ dependencies: { react: '18.2.0' } }, null, 2)); gitIn(d, 'add', 'package.json'); }],
  // 워크플로
  ['block', '고정 안 한 남의 액션', (d) => { put(d, '.github/workflows/ci.yml', 'on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: tj-actions/changed-files@v45\n'); gitIn(d, 'add', '.github/workflows/ci.yml'); }],
  ['pass', 'actions/ 액션', (d) => { put(d, '.github/workflows/ci.yml', 'on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n'); gitIn(d, 'add', '.github/workflows/ci.yml'); }],
  // 큰 새 파일
  ['block', '500줄 새 코드 파일', (d) => { put(d, 'src/gen.ts', linesOf(500)); gitIn(d, 'add', 'src/gen.ts'); }],
  ['block', '2MB 넘는 새 코드 파일(예전에는 읽기 한도에 걸려 놓침)', (d) => { put(d, 'src/big.js', linesOf(450, `export const v = "${'a'.repeat(5000)}";`)); gitIn(d, 'add', 'src/big.js'); }],
  ['pass', '딱 400줄', (d) => { put(d, 'src/e.ts', linesOf(400)); gitIn(d, 'add', 'src/e.ts'); }],
  ['pass', '큰 문서', (d) => { put(d, 'docs/long.md', linesOf(900)); gitIn(d, 'add', 'docs/long.md'); }],
];

describe('git pre-commit 훅: 진짜 git commit', { concurrency: 6 }, () => {
  for (const [want, why, setup] of CASES) {
    test(`${want}: ${why}`, () => {
      const dir = repo();
      const args = setup(dir) || [];
      const r = commit(dir, ...args);
      assert.ok(r.status === 0 || r.status === 1, `커밋 결과 ${r.status}: ${r.stderr}`);
      assert.doesNotMatch(r.stderr, STACK, `오류 흔적이 나오면 안 된다: ${r.stderr}`);
      if (want === 'block') {
        assert.equal(r.status, 1, `막아야 함: ${r.stderr}`);
        assert.match(r.stderr, /harness-fit: Found in the changes to be committed/);
      } else assert.equal(r.status, 0, `통과해야 함: ${r.stderr}`);
    });
  }
});

test('걸린 시간(진단): 훅이 든 git commit 한 번', (t) => {
  const s = [...commitTimes].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(0);
  t.diagnostic(`commits=${s.length} p50=${at(0.5)}ms p95=${at(0.95)}ms max=${s.at(-1).toFixed(0)}ms`);
});

test('커밋 때 다시 보는 훅 목록이 rules/commit.mjs 와 같다', () => {
  assert.deepEqual(commitRules.map((r) => r.id).sort(), [...COMMIT_HOOK_IDS].sort());
});

describe('git 훅이 터지거나 커밋을 잘못 막지 않는다', { concurrency: 4 }, () => {
  const stagedToken = (d) => { put(d, 'src/k.js', tokenLine); gitIn(d, 'add', 'src/k.js'); };
  const passes = (r, note) => {
    assert.equal(r.status, 0, `${note}: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, STACK, `${note}: ${r.stderr}`);
  };
  test('플러그인을 못 찾으면 한 줄 알리고 통과', () => {
    const d = repo({ recorded: path.join(tmp, 'gone-plugin') });
    stagedToken(d);
    const r = commit(d);
    passes(r, '플러그인 없음');
    assert.match(r.stderr, /harness-fit: .*플러그인을 찾지 못해/);
  });
  test('installed_plugins.json 의 이 저장소 항목으로 찾는다(적어 둔 경로가 사라져도)', () => {
    const d = repo({ recorded: path.join(tmp, 'gone-plugin2') });
    stagedToken(d);
    const cfg = path.join(tmp, `cfg${++seq}`);
    fs.mkdirSync(path.join(cfg, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'harness-fit@harness-fit': [{ scope: 'local', projectPath: d, installPath: ROOT }] } }));
    const r = spawnSync('git', ['-C', d, 'commit', '-q', '-m', 'feat: x'], { encoding: 'utf8', env: env({ CLAUDE_CONFIG_DIR: cfg }) });
    assert.equal(r.status, 1, r.stderr);
  });
  test('CLAUDE_PLUGIN_ROOT 가 있으면 그것을 쓴다', () => {
    const d = repo({ recorded: path.join(tmp, 'gone-plugin3') });
    stagedToken(d);
    const r = spawnSync('git', ['-C', d, 'commit', '-q', '-m', 'feat: x'], { encoding: 'utf8', env: { ...env(), CLAUDE_PLUGIN_ROOT: ROOT } });
    assert.equal(r.status, 1, r.stderr);
  });
  test('node 를 PATH 에서 못 찾으면 한 줄 알리고 통과', () => {
    const d = repo();
    stagedToken(d);
    // Windows 는 설치가 PATH 에 넣는 Git\cmd\git.exe(자기 sh 를 찾아 훅을 돌린다)를 쓴다
    const found = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['git'], { encoding: 'utf8' }).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const gitExe = found.find((p) => /[\\/]cmd[\\/]git\.exe$/i.test(p)) || found[0];
    const r = spawnSync(gitExe, ['-C', d, 'commit', '-q', '-m', 'feat: x'], { encoding: 'utf8', env: withPath(path.dirname(gitExe)) });
    passes(r, 'node 없음');
    assert.match(r.stderr, /harness-fit: node 를 찾지 못해/);
  });
  test('harness.json 이 없으면 통과', () => { const d = repo({ rules: null }); stagedToken(d); passes(commit(d), '설정 없음'); });
  test('harness.json 이 깨졌으면 알리고 통과', () => {
    const d = repo({ rules: '{ 깨짐' });
    stagedToken(d);
    const r = commit(d);
    passes(r, '깨진 설정');
    assert.match(r.stderr, /harness\.json .*(JSON|not valid)/);
  });
  for (const [why, text] of [
    ['rules 가 배열', JSON.stringify({ rules: ['secrets'] })],
    ['rules 가 글자', JSON.stringify({ rules: 'secrets' })],
    ['JSON 이 null', 'null'],
    ['옵션 모양이 다름', JSON.stringify({ rules: { secrets: { paths: 'x' }, 'protected-files': { paths: 7 }, 'file-size': { maxLines: 'abc' } } })],
    ['아주 큰 설정', JSON.stringify({ rules: { secrets: true }, pad: 'x'.repeat(400 * 1024) })],
    ['BOM 이 붙은 설정(통과 아님 — 읽는다)', null],
  ]) {
    test(`설정 모양이 이상해도 터지지 않는다: ${why}`, () => {
      const d = repo({ rules: text ?? '\uFEFF' + JSON.stringify({ rules: { secrets: true } }) });
      stagedToken(d);
      const r = commit(d);
      assert.ok(r.status === 0 || r.status === 1, r.stderr);
      assert.doesNotMatch(r.stderr, STACK, r.stderr);
      if (text === null) assert.equal(r.status, 1, 'BOM 은 떼고 읽어 비밀값을 막는다');
      if (why === '옵션 모양이 다름') assert.equal(r.status, 1, '옵션이 이상해도 비밀값 모양 검사는 돈다');
    });
  }
  test('켠 쓰기 훅이 없으면 git 을 더 띄우지 않고 통과', () => { const d = repo({ rules: { 'commit-msg': true } }); stagedToken(d); passes(commit(d), '쓰기 훅 없음'); });
  test('빈 저장소(HEAD 없음)의 첫 커밋도 본다', () => {
    const d = path.join(tmp, `empty${++seq}`);
    execFileSync('git', ['init', '-q', '-b', 'main', d]);
    gitIn(d, 'config', 'user.email', 't@example.com');
    gitIn(d, 'config', 'user.name', 't');
    put(d, '.claude/harness.json', JSON.stringify({ rules: { secrets: true } }));
    fs.writeFileSync(path.join(d, '.git', 'hooks', 'pre-commit'), launcherText(ROOT));
    stagedToken(d);
    assert.equal(commit(d).status, 1);
  });
  test('본체를 git 밖·없는 폴더에서 바로 돌려도 0', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-nogit-'));
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: outside, encoding: 'utf8', env: env() });
    passes(r, 'git 밖');
    fs.rmSync(outside, { recursive: true, force: true });
  });
  test('깨진 저장소(.git 파일이 없는 곳을 가리킴)에서도 0', () => {
    const d = path.join(tmp, `broken${++seq}`);
    fs.mkdirSync(path.join(d, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(d, '.git'), 'gitdir: /no/such/place\n');
    fs.writeFileSync(path.join(d, '.claude', 'harness.json'), JSON.stringify({ rules: { secrets: true } }));
    passes(spawnSync(process.execPath, [SCRIPT], { cwd: d, encoding: 'utf8', env: env() }), '깨진 저장소');
  });
  test('git 을 PATH 에서 못 찾으면 0', () => {
    const d = repo();
    passes(spawnSync(process.execPath, [SCRIPT], { cwd: d, encoding: 'utf8', env: withPath('') }), 'git 없음');
  });
  test('남의 훅(core.hooksPath)에 이어 붙인 한 줄로도 막고, 플러그인이 없으면 건너뛴다', () => {
    const d = repo({ hook: false });
    fs.mkdirSync(path.join(d, '.husky'));
    const hookFile = path.join(d, '.husky', 'pre-commit');
    fs.writeFileSync(hookFile, `#!/bin/sh\necho husky\n${chainCommand(ROOT)}\n`);
    fs.chmodSync(hookFile, 0o755);
    gitIn(d, 'config', 'core.hooksPath', '.husky');
    stagedToken(d);
    assert.equal(commit(d).status, 1, '이어 붙인 줄이 막는다');
    fs.writeFileSync(hookFile, `#!/bin/sh\n${chainCommand(path.join(tmp, "gone it's"))}\n`);
    passes(commit(d), '플러그인 경로가 없으면 건너뛴다');
  });
  test('detached HEAD 에서도 본다', () => {
    const d = repo();
    gitIn(d, 'checkout', '-q', '--detach');
    stagedToken(d);
    assert.equal(commit(d).status, 1);
  });
  test('stdin 에 쓰레기를 넣어도 0(훅은 stdin 을 읽지 않는다)', () => {
    const d = repo();
    passes(spawnSync(process.execPath, [SCRIPT], { cwd: d, input: Buffer.from([0, 0xff, 0xfe, 0x00, 0x7b]), encoding: 'utf8', env: env() }), '쓰레기 stdin');
  });
});

describe('설치 상태 판단', () => {
  test('none → ours, 남의 훅은 other, core.hooksPath 는 hooks-path, 저장소 아님은 no-git', () => {
    const d = repo({ hook: false });
    assert.equal(gitHookState(d).state, 'none');
    fs.writeFileSync(path.join(d, '.git', 'hooks', 'pre-commit'), launcherText(ROOT));
    assert.equal(gitHookState(d).state, 'ours');
    fs.writeFileSync(path.join(d, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nnpm test\n');
    assert.equal(gitHookState(d).state, 'other');
    gitIn(d, 'config', 'core.hooksPath', '.husky');
    assert.equal(gitHookState(d).state, 'hooks-path');
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-nogit-'));
    assert.equal(gitHookState(outside).state, 'no-git');
    fs.rmSync(outside, { recursive: true, force: true });
  });
  test('git worktree 는 훅 폴더가 밖이라 elsewhere', () => {
    const d = repo({ hook: false });
    const wt = path.join(tmp, `wt${++seq}`);
    gitIn(d, 'worktree', 'add', '-q', '-b', 'feature/wt', wt);
    assert.equal(gitHookState(wt).state, 'elsewhere');
  });
  test('돌 수 있을 때만 active: 표시 + 플러그인을 찾을 수 있을 때', () => {
    const d = repo();
    assert.equal(gitHookActive(d), true);
    fs.writeFileSync(path.join(d, '.git', 'hooks', 'pre-commit'), launcherText(path.join(tmp, 'gone')));
    const saved = process.env.CLAUDE_PLUGIN_ROOT;
    const savedCfg = process.env.CLAUDE_CONFIG_DIR;
    delete process.env.CLAUDE_PLUGIN_ROOT;
    process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'no-claude-config');
    try {
      assert.equal(gitHookActive(d), false, '플러그인을 못 찾으면 PreToolUse 가 다시 맡는다');
    } finally {
      if (saved !== undefined) process.env.CLAUDE_PLUGIN_ROOT = saved;
      if (savedCfg !== undefined) process.env.CLAUDE_CONFIG_DIR = savedCfg;
      else delete process.env.CLAUDE_CONFIG_DIR;
    }
    fs.writeFileSync(path.join(d, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\n# 남의 훅\n');
    assert.equal(gitHookActive(d), false);
    assert.ok(launcherText(ROOT).includes(MARKER));
    // 경로 속 줄바꿈은 지운다(주석·heredoc 밖으로 새어 나가 명령이 되지 않게)
    assert.ok(!launcherText('/x\nrm -rf ~\nHARNESS_FIT_LAUNCHER').split('\n').some((l) => /^rm |^HARNESS_FIT_LAUNCHER.+/.test(l)));
    assert.equal(launcherText('/x\nHARNESS_FIT_LAUNCHER\nexit 0').split('\n').filter((l) => l === 'HARNESS_FIT_LAUNCHER').length, 1);
  });
});
