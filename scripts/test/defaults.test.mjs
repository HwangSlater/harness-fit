// 조합 기본값(2026-11-09 사용자 결정): 개인 습관 훅은 기본에서 빼고, 형식 훅은 저장소 기록이 그 꼴일 때만,
// 의존성 고정은 꼼꼼하게 조합에서만(라이브러리 패키지는 뺌), prefer-gh 는 알리기만. 버전 세 곳이 같은지도 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadAll, expandCombo, recommend, applyFlow, fitOff, commitLang, PLUGIN_ROOT } from '../lib/catalog.mjs';
import { makeState } from '../lib/picker-state.mjs';
import { detect } from '../detect.mjs';

const all = loadAll();
const cfg = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'config', 'picker.json'), 'utf8'));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'harness-defaults-'));
// 사용자 PC 의 전역 git 훅이 시험 커밋에 끼지 않게 hooksPath 를 빈 폴더로 돌린다
const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', `core.hooksPath=${path.join(dir, '.nohooks')}`, ...args], { stdio: 'ignore' });
const repo = ({ subjects = [], branches = [], pkg = null } = {}) => {
  const dir = tmp();
  git(dir, 'init', '-q', '-b', 'main');
  if (pkg) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  for (const s of subjects) git(dir, 'commit', '-q', '--allow-empty', '-m', s);
  for (const b of branches) git(dir, 'branch', b);
  return dir;
};
const off = (dir) => fitOff(all, detect(dir));
const LOOSE = ['로그인 고침', 'update readme', 'wip', '버튼 색', 'Merge fix', 'tweak'];
const CONV = ['feat: 로그인', 'fix(api): 빈 응답', 'docs: 설치', 'chore: 정리', 'refactor!: 이름', 'test: 장바구니'];

test('개인 습관·엄격한 훅은 어느 조합도 기본으로 켜지 않지만 고를 수는 있다', () => {
  for (const id of ['commit-hash', 'work-checklist', 'stale-scratch', 'docs-check']) {
    assert.ok(all.packs.hooks.some((h) => h.id === id), `${id} 는 훅 목록에 남는다`);
    for (const c of all.combos.combos) assert.ok(!c.hooks.includes(id), `${c.id}: ${id}`);
  }
  const pin = all.combos.combos.filter((c) => c.hooks.includes('pin-deps')).map((c) => c.id);
  assert.deepEqual(pin, ['strict']);
});

test('형식 훅: 커밋 기록이 conventional 꼴이 아니면 commit-msg 를 기본에서 뺀다', () => {
  const dir = repo({ subjects: LOOSE });
  try {
    const det = detect(dir);
    const f = fitOff(all, det);
    assert.deepEqual(f.hooks['commit-msg'], { key: 'fitCommitMsg', vars: { n: 6, k: 0 } });
    const sel = expandCombo(all, 'team', det);
    assert.ok(!sel.hooks.includes('commit-msg') && sel.fitDropped.includes('commit-msg'));
    const r = recommend(all, { ...det, authors: 2, team: true, existing: {} }, 'ko');
    assert.ok(r.why.some((w) => w.includes('커밋 기록이 이 형식이 아니라')), r.why.join(' / '));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('형식 훅: conventional 기록·빈 저장소·커밋이 아주 적은 저장소는 켠다', () => {
  const dirs = [repo({ subjects: [...CONV, 'oops'] }), repo(), repo({ subjects: LOOSE.slice(0, 3) })];
  try {
    for (const dir of dirs) {
      const det = detect(dir);
      assert.deepEqual(Object.keys(fitOff(all, det).hooks).filter((id) => id === 'commit-msg'), [], dir);
      assert.ok(expandCombo(all, 'team', det).hooks.includes('commit-msg'), dir);
    }
  } finally {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('형식 훅: 브랜치 이름이 브랜치 전략 꼴이 아니면 branch-name 을 켜지 않는다(전략마다 따로)', () => {
  const loose = repo({ subjects: CONV.slice(0, 1), branches: ['wip', 'kim-test', 'new-ui', 'feature/a'] });
  const good = repo({ subjects: CONV.slice(0, 1), branches: ['feature/a', 'fix/b', 'feat/c'] });
  try {
    const f = off(loose);
    assert.deepEqual(f.flows['github-flow']['branch-name'].vars, { n: 4, k: 1 });
    assert.ok(f.flows['git-flow']['branch-name']);
    const sel = expandCombo(all, 'team', detect(loose));
    assert.ok(!sel.hooks.includes('branch-name') && sel.fitDropped.includes('branch-name'));
    assert.ok(!applyFlow(all, { ...sel, hooks: [] }, 'git-flow').hooks.includes('branch-name'), '브랜치 전략을 바꿔도 켜지 않는다');
    const S = makeState({ all, cfg, det: detect(loose) }, 'ko');
    const gh = S.flows.find((x) => x.id === 'github-flow');
    assert.ok(!gh.hooksOn.includes('branch-name') && gh.fitDropped.includes('branch-name'), '화면 브랜치 전략도 같은 데이터');
    // github-flow 꼴(fix/·feat/)은 맞지만 git-flow 꼴(feature/·release/…)에는 1개만 맞는다
    const g = off(good);
    assert.ok(!g.flows['github-flow'] && g.flows['git-flow']);
    assert.ok(expandCombo(all, 'team', detect(good)).hooks.includes('branch-name'));
  } finally {
    for (const d of [loose, good]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('의존성 고정: 라이브러리 패키지(main·exports·types, private 아님)면 꼼꼼하게 조합에서도 뺀다', () => {
  const lib = repo({ pkg: { name: 'lib', main: 'index.js' } });
  const app = repo({ pkg: { name: 'app', main: 'index.js', private: true } });
  const plain = repo({ pkg: { name: 'svc', scripts: { start: 'node .' } } });
  try {
    assert.ok(detect(lib).library && !detect(app).library && !detect(plain).library);
    assert.ok(!expandCombo(all, 'strict', detect(lib)).hooks.includes('pin-deps'));
    assert.equal(off(lib).hooks['pin-deps'].key, 'fitPinDeps');
    for (const d of [app, plain]) assert.ok(expandCombo(all, 'strict', detect(d)).hooks.includes('pin-deps'), d);
    assert.ok(!expandCombo(all, 'team', detect(plain)).hooks.includes('pin-deps'));
  } finally {
    for (const d of [lib, app, plain]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('prefer-gh: 실제 진입점이 막지 않고 Claude 문맥에 한 줄을 더한다', () => {
  const dir = tmp();
  try {
    fs.mkdirSync(path.join(dir, '.claude'));
    fs.writeFileSync(path.join(dir, '.claude', 'harness.json'), JSON.stringify({ lang: 'ko', rules: { 'prefer-gh': true } }));
    const run = (url) => JSON.parse(execFileSync(process.execPath, [path.join(PLUGIN_ROOT, 'hooks', 'run.mjs')], {
      input: JSON.stringify({ tool_name: 'WebFetch', cwd: dir, tool_input: { url, prompt: 'x' } }), encoding: 'utf8' }) || '{}');
    const out = run('https://github.com/owner/repo');
    assert.equal(out.hookSpecificOutput.permissionDecision, undefined, '막지 않는다');
    assert.match(out.hookSpecificOutput.additionalContext, /gh/);
    assert.deepEqual(run('https://docs.github.com/en'), {});
    assert.equal(all.packs.hooks.find((h) => h.id === 'prefer-gh').kind, 'notice');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('버전: plugin.json · package.json · config/sources.json pluginRef 가 같다', () => {
  const read = (rel) => JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, rel), 'utf8'));
  const v = read('package.json').version;
  assert.equal(read('.claude-plugin/plugin.json').version, v);
  assert.equal(all.sources.pluginRef, `v${v}`);
});

test('볼 파일이 없는 훅은 기본에서 뺀다: JS 없으면 unsafe-html, 워크플로 파일 없으면 gha-inject(빈 폴더도)', () => {
  const py = repo({ subjects: CONV });
  const web = repo({ subjects: CONV, pkg: { name: 'w', private: true, dependencies: { react: '18.0.0' } } });
  try {
    fs.mkdirSync(path.join(py, '.github', 'workflows'), { recursive: true }); // 빈 폴더는 GitHub Actions 가 아니다
    const f = off(py);
    assert.ok(f.hooks['unsafe-html'] && f.hooks['gha-inject'], JSON.stringify(f.hooks));
    assert.ok(!expandCombo(all, 'team', detect(py)).hooks.includes('unsafe-html'));
    fs.mkdirSync(path.join(web, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(web, '.github', 'workflows', 'ci.yml'), 'on: push\n');
    const w = off(web);
    assert.ok(!w.hooks['unsafe-html'] && !w.hooks['gha-inject'], JSON.stringify(w.hooks));
  } finally {
    for (const d of [py, web]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('커밋 기록 언어: 한 언어가 70% 넘으면 커밋 메시지 언어 검사를 그 언어로, 적거나 섞이면 정하지 않는다', () => {
  assert.equal(commitLang({ subjects: 6, korean: 6, english: 0 }), 'ko');
  assert.equal(commitLang({ subjects: 6, korean: 0, english: 5 }), 'en');
  assert.equal(commitLang({ subjects: 6, korean: 3, english: 3 }), null);
  assert.equal(commitLang({ subjects: 3, korean: 3, english: 0 }), null, '기록이 적으면');
  const ko = repo({ subjects: CONV });
  try {
    const sel = expandCombo(all, 'team', detect(ko));
    assert.deepEqual(sel.hookOpts['commit-msg'], { lang: 'ko' });
  } finally {
    fs.rmSync(ko, { recursive: true, force: true });
  }
});

// 역할극 2~6 회차에서 못 읽던 것(2026-11-11)
const put = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
test('감지: ROS 2 워크스페이스는 src/<패키지> 를 읽어 ROS 2·C/C++·Python 과 colcon 명령을 낸다', () => {
  const dir = repo({ subjects: CONV });
  try {
    put(dir, 'src/arm_controller/package.xml', '<package><buildtool_depend>ament_cmake</buildtool_depend></package>');
    put(dir, 'src/arm_controller/CMakeLists.txt', 'project(arm_controller)\n');
    put(dir, 'src/arm_bringup/package.xml', '<package><buildtool_depend>ament_python</buildtool_depend></package>');
    put(dir, 'src/arm_bringup/setup.py', 'from setuptools import setup\n');
    const d = detect(dir);
    for (const s of ['ROS 2', 'C/C++', 'Python']) assert.ok(d.stack.includes(s), `${s}: ${d.stack}`);
    assert.ok(d.kinds.includes('robotics') && !d.thin);
    assert.deepEqual(d.commands.build, ['colcon build']);
    assert.match(d.commands.test[0], /colcon test/);
    const sel = expandCombo(all, 'team', d);
    assert.ok(!sel.skills.includes('modern-python'), 'ROS 2 파이썬 패키지에 uv 세팅 스킬을 넣지 않는다');
    assert.ok(sel.hooks.includes('python-unsafe'), '파이썬 훅은 그대로');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('감지: LLM·MCP·Postgres·연구 도구를 의존성·Prisma·compose·노트북으로 읽고 맞춤 스킬을 붙인다', () => {
  const py = repo({ subjects: CONV });
  const ts = repo({ subjects: CONV, pkg: { name: 'a', private: true, dependencies: { '@anthropic-ai/sdk': '^0.68.0', '@modelcontextprotocol/sdk': '^1.20.0' } } });
  try {
    put(py, 'pyproject.toml', '[project]\ndependencies = ["fastapi", "anthropic>=0.40", "psycopg[binary]", "sqlalchemy", "slack-bolt", "wandb", "hydra-core", "mujoco"]\n');
    put(py, 'notebooks/eda.ipynb', '{}');
    const d = detect(py);
    for (const s of ['FastAPI', 'Claude API', 'PostgreSQL', 'SQLAlchemy', 'Slack', 'wandb', 'Hydra', 'MuJoCo', 'Jupyter']) assert.ok(d.stack.includes(s), `${s}: ${d.stack}`);
    assert.ok(!d.stack.includes('MCP'), '「mcp」 글자가 섞인 다른 이름은 MCP 가 아니다');
    const s1 = expandCombo(all, 'solo', d).skills;
    assert.ok(s1.includes('supabase-postgres') && s1.includes('api-and-interface-design'), s1.join(','));
    const t = detect(ts);
    assert.ok(t.stack.includes('Claude API') && t.stack.includes('MCP'), t.stack.join(','));
    assert.ok(expandCombo(all, 'solo', t).skills.includes('mcp-builder'));
    put(ts, 'prisma/schema.prisma', 'datasource db {\n  provider = "postgresql"\n}\n');
    assert.ok(detect(ts).stack.includes('PostgreSQL'), 'Prisma provider');
    const c = repo({ subjects: CONV });
    put(c, 'compose.yaml', 'services:\n  db:\n    image: pgvector/pgvector:pg16\n');
    assert.ok(!detect(c).stack.includes('PostgreSQL'), 'compose 이미지만으로는 아님(로컬 시험용 DB — 역할극 10 회차)');
    put(c, 'requirements.txt', 'sqlalchemy==2.0\n');
    assert.ok(detect(c).stack.includes('PostgreSQL'), 'compose 이미지 + 앱이 표를 만드는 ORM');
    fs.rmSync(c, { recursive: true, force: true });
  } finally {
    for (const d of [py, ts]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('--catalog 요약: 훅마다 막는 꼴(blocks)·옵션, 스킬마다 이름·쓰는 때 — 세션이 카탈로그 파일을 직접 읽지 않게', async () => {
  const { catalogDigest } = await import('../lib/catalog.mjs');
  for (const lang of ['ko', 'en']) {
    const d = catalogDigest(all, lang);
    assert.equal(d.hooks.length, all.packs.hooks.length);
    for (const h of d.hooks) assert.ok(h.name && h.desc && h.blocks, `${lang} ${h.id}`);
    const pf = d.hooks.find((h) => h.id === 'protected-files');
    assert.deepEqual(pf.options.map((o) => o.key), ['paths']);
    assert.ok(d.hooks.find((h) => h.id === 'commit-msg').options.find((o) => o.key === 'lang').choices.includes('ko'));
    assert.equal(d.skills.length, all.catalog.skills.length);
    assert.ok(d.skills.every((s) => s.id && s.title));
  }
});

test('검토 반영: 화면도 커밋 기록 언어를 기본으로 쓰고(사용자가 고친 것이 앞섬), package.json 없는 정적 사이트도 JS·HTML 로 보고, 봇 커밋은 세지 않는다', async () => {
  const { fromCombo } = await import('../../picker/selection.js');
  const k = { id: 'team', flow: 'github-flow', skills: [], hooks: ['commit-msg'], rules: [], hookOpts: { 'commit-msg': { lang: 'ko' } } };
  const { sentOpts } = await import('../../picker/hook-options.js');
  const sent = (x, prev = {}) => sentOpts(x.baseOpts, prev, x.hookOpts);
  assert.deepEqual(sent(fromCombo(k, null)), { 'commit-msg': { lang: 'ko' } });
  assert.deepEqual(sent(fromCombo(k, { hookOpts: { 'commit-msg': { lang: 'any', style: 'free' } } })), { 'commit-msg': { lang: 'any', style: 'free' } });
  // 지난번 harness.json 에 적어 둔 값은 조합 값이 덮지 않는다(ROS 기본 명령 목록이 사용자 목록을 지우던 일 — 검토 2026-11-11)
  const ros = { ...k, hookOpts: { 'ask-cmd': { commands: ['ros2 launch'] } } };
  assert.deepEqual(sent(fromCombo(ros, null), { 'ask-cmd': { commands: ['python scripts/train.py'], remote: false } }), {});
  assert.deepEqual(fromCombo(ros, null).hookOpts, {}, '조합 값은 사용자가 고친 것으로 치지 않는다');
  const site = repo({ subjects: CONV });
  try {
    put(site, 'index.html', '<!doctype html>\n');
    assert.equal(detect(site).js, true, '정적 사이트');
    assert.ok(!off(site).hooks['unsafe-html']);
    // 봇 커밋 6개 + 사람 영어 제목·한국어 본문: en 으로 정하지 않는다
    for (let i = 0; i < 6; i++) git(site, '-c', 'user.name=dependabot[bot]', '-c', 'user.email=bot@x', 'commit', '-q', '--allow-empty', '-m', `chore(deps): bump x ${i}`);
    for (let i = 0; i < 5; i++) git(site, 'commit', '-q', '--allow-empty', '-m', `fix: login ${i}`, '-m', '로그인 오류 고침');
    const h = detect(site).history;
    assert.equal(h.messages, 11, '봇 6개를 뺀 수(CONV 6 + 사람 5)');
    assert.equal(commitLang({ ...h }), null, JSON.stringify(h));
  } finally {
    fs.rmSync(site, { recursive: true, force: true });
  }
});

test('감지(검토 반영): ament_python 템플릿·맨 위 패키지·src/저장소/패키지, 패키지별 JS 판정, 주석·설명 글 무시, 다른 의존성 파일', () => {
  const made = [];
  const mk = (files, opts = {}) => {
    const d = repo({ subjects: CONV, ...opts });
    made.push(d);
    for (const [rel, text] of Object.entries(files)) put(d, rel, text);
    return detect(d);
  };
  try {
    // ros2 pkg create --build-type ament_python 이 만드는 package.xml(buildtool_depend 없음)
    const pyPkg = '<package format="3"><name>talker</name><export><build_type>ament_python</build_type></export></package>';
    const a = mk({ 'src/talker/package.xml': pyPkg, 'src/talker/setup.py': 'from setuptools import setup\n' });
    assert.ok(a.stack.includes('ROS 2') && a.stack.includes('Python'), a.stack.join(','));
    assert.match(a.commands.testOne[0], /colcon build --packages-select <pkg> && colcon test --packages-select <pkg> && colcon test-result/);
    assert.ok(!expandCombo(all, 'solo', a).skills.includes('modern-python'));
    assert.ok(mk({ 'my_robot_bringup/package.xml': pyPkg }).stack.includes('ROS 2'), '맨 위 하위 폴더 패키지');
    assert.ok(mk({ 'src/my_robot/my_robot_driver/package.xml': pyPkg }).stack.includes('ROS 2'), 'src/저장소/패키지');
    // 웹 + 모바일 모노레포: 웹 React 가 사라지지 않는다
    const m = mk({ 'apps/web/package.json': JSON.stringify({ dependencies: { react: '18.0.0', vite: '5.0.0' } }), 'apps/mobile/package.json': JSON.stringify({ dependencies: { react: '18.0.0', 'react-native': '0.74.0' } }) });
    assert.ok(m.stack.includes('React') && m.stack.includes('React Native'), m.stack.join(','));
    // 주석·keywords·description 은 의존성이 아니다
    const c = mk({
      'requirements.txt': '# anthropic==0.40  # 안 씀\n# psycopg2-binary\nrequests==2.31\n',
      'pyproject.toml': '[project]\nname = "x"\ndescription = "Not using django or flask; asyncpg-like api"\nkeywords = ["mcp", "anthropic"]\ndependencies = ["langchain-mcp-adapters"]\n',
    });
    for (const s of ['Claude API', 'PostgreSQL', 'MCP', 'Django', 'Flask']) assert.ok(!c.stack.includes(s), `${s}: ${c.stack}`);
    // 하위 폴더의 project.yml·vendored CMake 는 iOS·C/C++ 가 아니다
    const w = mk({ 'package.json': JSON.stringify({ dependencies: { react: '18.0.0' } }), 'apps/web/project.yml': 'name: x\n', 'libs/vendored/CMakeLists.txt': 'project(x)\n' });
    assert.ok(!w.stack.includes('iOS') && !w.stack.includes('C/C++'), w.stack.join(','));
    // 다른 의존성 파일: Pipfile · conda environment.yml · requirements/*.txt · poetry
    assert.ok(mk({ Pipfile: '[packages]\ndjango = "*"\n' }).stack.includes('Django'), 'Pipfile');
    const conda = mk({ 'environment.yml': 'name: lab\ndependencies:\n  - python=3.11\n  - pytorch\n  - pip:\n    - wandb==0.17\n    - hydra-core\n' });
    assert.ok(conda.stack.includes('Python') && conda.stack.includes('wandb') && conda.stack.includes('Hydra'), conda.stack.join(','));
    assert.ok(mk({ 'requirements/base.txt': 'django==5.0\npsycopg[binary]\n', 'manage.py': '' }).stack.includes('PostgreSQL'), 'requirements/base.txt');
    assert.ok(mk({ 'pyproject.toml': '[tool.poetry.dependencies]\npython = "^3.11"\nfastapi = "^0.110"\n' }).stack.includes('FastAPI'), 'poetry');
    // compose 이미지: bitnami/postgresql 은 Postgres, postgres-exporter 는 아님
    assert.ok(mk({ 'compose.yaml': 'services:\n  db:\n    image: bitnami/postgresql:16\n', 'requirements.txt': 'django==5\n' }).stack.includes('PostgreSQL'));
    assert.ok(!mk({ 'compose.yaml': 'services:\n  m:\n    image: prometheuscommunity/postgres-exporter\n' }).stack.includes('PostgreSQL'));
  } finally {
    for (const d of made) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('역할극 14·15 회차: 하위 폴더의 Terraform·Ansible·Helm, Ansible .j2 는 웹 파일이 아님, 번호 붙은 SQL 마이그레이션, origin 없는 GitLab', () => {
  const infra = repo({ subjects: CONV });
  const go = repo({ subjects: CONV });
  try {
    const put = (root, f, t = 'x\n') => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), t); };
    put(infra, 'envs/prod/main.tf');
    put(infra, 'ansible/ansible.cfg');
    put(infra, 'ansible/roles/bastion/templates/sshd_config.j2');
    put(infra, 'charts/api/Chart.yaml');
    git(infra, 'add', '.');
    const d = detect(infra);
    for (const s of ['Terraform', 'Ansible', 'Kubernetes']) assert.ok(d.stack.includes(s), d.stack.join(','));
    assert.equal(d.js, false, '.j2 만으로 JS 저장소가 아니다');
    assert.equal(d.code, false, '인프라 코드만');
    assert.ok(!expandCombo(all, 'team', d).skills.includes('tdd-lite'), '앱 코드가 없으면 TDD 스킬을 빼고');
    assert.ok(expandCombo(all, 'team', { ...d, code: undefined }).skills.includes('tdd-lite'), '옛 감지 결과면 그대로');
    put(infra, 'scripts/drain.sh');
    put(infra, 'lambda/handler.py');
    git(infra, 'add', '.');
    assert.equal(detect(infra).code, true, '인프라 저장소라도 소스 파일(lambda/*.py)이 있으면 앱 코드가 있다(운영 .sh 만으로는 아님)');
    put(go, 'go.mod', 'module gitlab.example.com/pay/api\n\nrequire github.com/jackc/pgx/v5 v5.5.0\n');
    put(go, 'db/migrations/00001_init.sql');
    git(go, 'add', '.');
    const g = detect(go);
    assert.equal(g.host, 'gitlab');
    for (const s of ['Go', 'PostgreSQL', 'SQL migrations']) assert.ok(g.stack.includes(s), g.stack.join(','));
    const sel = expandCombo(all, 'team', g);
    assert.ok(sel.hooks.includes('migration-edit') && !sel.hooks.includes('prefer-gh') && !sel.hooks.includes('pr-merge') && !sel.skills.includes('pr-writer'), JSON.stringify(sel.hooks));
  } finally {
    for (const d of [infra, go]) fs.rmSync(d, { recursive: true, force: true });
  }
});
