// 감지(scripts/detect.mjs) — 역할극·검토에서 못 읽던 스택(ROS 2·LLM·MCP·Postgres·연구 도구·인프라·GitLab)과 그때 붙는 추천.
// defaults.test.mjs 에서 나눴다(한 파일이 시험 전체에서 가장 오래 걸려 — 2026-11-19)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadAll, expandCombo } from '../lib/catalog.mjs';
import { detect } from '../detect.mjs';
import { filesByGlobs, lsFiles, globRe } from '../lib/git-files.mjs';
import { writeFiles, historyRepo, gitQuiet as git } from './helpers.mjs';

const all = loadAll();
const repo = ({ subjects = [], pkg = null } = {}) => {
  const dir = historyRepo({ subjects, prefix: 'harness-stacks-' });
  if (pkg) writeFiles(dir, { 'package.json': pkg });
  return dir;
};
const CONV = ['feat: 로그인', 'fix(api): 빈 응답', 'docs: 설치', 'chore: 정리', 'refactor!: 이름', 'test: 장바구니'];
// 역할극 2~6 회차에서 못 읽던 것(2026-11-11)
const put = (dir, rel, text) => writeFiles(dir, { [rel]: text });

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

// 감지는 글롭 무리 셋을 git 한 번으로 받아 나눈다(lib/git-files.mjs) — 무리마다 git 에 따로 물은 것과 같아야 한다.
// 대소문자, 이름이 x.js 인 폴더, .claude/, 한글 경로(-z 라 따옴표 없이)
test('git 한 번으로 나눈 글롭 무리는 무리마다 git 에 따로 물은 결과와 같다', () => {
  const dir = repo();
  try {
    for (const f of ['A.JS', 'b.js', 'x.js/readme.txt', 'deep/c/d.tsx', '.claude/e.js', '화면/첫.js', 'charts/api/Chart.yaml', 'Chart.yaml', 'App.xcodeproj/project.pbxproj', 'roles/t/a.j2', 'Info.plist']) put(dir, f, '');
    const groups = { src: ['*.js', '*.tsx', '*.JS'], infra: ['*/Chart.yaml', '*.xcodeproj/project.pbxproj', '*Info.plist'], tpl: ['*.j2', '*.html'] };
    const got = filesByGlobs(dir, groups);
    for (const [name, globs] of Object.entries(groups)) assert.deepEqual(got[name], lsFiles(dir, globs), name);
    assert.ok(got.src.includes('화면/첫.js') && !got.src.includes('.claude/e.js') && !got.src.includes('x.js/readme.txt'), got.src.join(','));
    assert.deepEqual(got.infra, ['App.xcodeproj/project.pbxproj', 'Info.plist', 'charts/api/Chart.yaml']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
// 한글 경로: git ls-files 를 -z 로 받기 전에는 경로가 따옴표·8진수로 와서 「.tf」·소스 확장자에 맞지 않았다(2026-11-19 — 고친 동작을 지킨다)
test('한글 폴더·파일 이름도 감지한다(인프라/main.tf → Terraform, 앱.py → 앱 코드)', () => {
  const tf = repo();
  const app = repo();
  try {
    put(tf, '인프라/main.tf', 'terraform {}\n');
    const det = detect(tf);
    assert.ok(det.stack.includes('Terraform'), det.stack.join(','));
    assert.ok(det.kinds.includes('terraform'), det.kinds.join(','));
    put(app, '인프라/main.tf', 'terraform {}\n');
    put(app, '앱.py', 'print(1)\n');
    assert.equal(detect(app).code, true);
  } finally {
    for (const d of [tf, app]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('globRe 는 * 밖의 와일드카드(?·[…])를 받으면 멈춘다 — git 이 낸 파일을 조용히 버리지 않게', () => {
  assert.throws(() => globRe(['*.[jt]s']), /\* 만 안다/);
  assert.throws(() => globRe(['a?.js']), /\* 만 안다/);
  assert.ok(globRe(['*.js']).test('a/b.js'));
});
