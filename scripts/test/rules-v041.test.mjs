// v0.4.1 지침 쪽 고칠 점(역할극 13~16 회차에서 미룬 것, 2026-11-16): Next.js 지침, 인프라 지침의 Argo CD·EKS·PDB,
// sqlc 생성 코드 줄, Core Data 마이그레이션 시험, GitHub Flow 에서 「로컬 병합 대신 PR」.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detect } from '../detect.mjs';
import { loadAll, recommend, expandCombo } from '../lib/catalog.mjs';
import { ruleTexts } from '../lib/claude-md.mjs';
import { detectCommands } from '../lib/commands.mjs';
import { tmpDir, writeFiles, gitInit, gitIn } from './helpers.mjs';

const all = loadAll();
const made = [];
const repo = (files) => {
  const d = gitInit(tmpDir('harness-v041-'), { branch: 'main' });
  made.push(d);
  writeFiles(d, files);
  gitIn(d)('add', '-A');
  return d;
};
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const textsOf = (det, lang = 'ko') => ruleTexts({ ...recommend(all, det, lang), lang });

const NEXT = {
  'package.json': { name: 'shop-web', private: true, scripts: { test: 'vitest run' }, dependencies: { next: '15.0.3', react: '19.0.0' }, devDependencies: { typescript: '5.6.3', vitest: '2.1.4' } },
  'pnpm-lock.yaml': '',
  'app/page.tsx': 'export default function P() { return null }\n',
};

test('Next.js 지침: Next.js 저장소에만, 로그인 줄은 로그인 단서가 있을 때만', () => {
  const web = detect(repo(NEXT));
  for (const lang of ['ko', 'en']) {
    const t = textsOf(web, lang).nextjs;
    assert.ok(t && t.includes('NEXT_PUBLIC_') && t.includes('dangerouslySetInnerHTML'), lang);
    assert.ok(!t.includes('middleware'), `${lang}: 로그인 없는 화면에 로그인 줄`);
  }
  const auth = detect(repo({ ...NEXT, 'package.json': { ...NEXT['package.json'], dependencies: { ...NEXT['package.json'].dependencies, 'next-auth': '5.0.0' } } }));
  assert.ok(textsOf(auth).nextjs.includes('middleware'));
  // React 만(Vite)·Vue 저장소에는 없다
  const vite = detect(repo({ 'package.json': { name: 'v', private: true, dependencies: { react: '19.0.0' }, devDependencies: { vite: '5.4.0' } }, 'src/App.tsx': '' }));
  assert.ok(vite.stack.includes('React') && !textsOf(vite).nextjs);
});

test('인프라 지침: Argo CD 줄은 Argo CD 앱 정의가 있을 때만, EKS 공개 엔드포인트·prod PDB 는 있는 줄에', () => {
  const argo = detect(repo({ 'main.tf': 'resource "x" "y" {}\n', 'argocd/api-prod.yaml': 'apiVersion: argoproj.io/v1alpha1\nkind: Application\n' }));
  assert.ok(argo.kinds.includes('argocd'), argo.kinds.join(','));
  const tf = detect(repo({ 'main.tf': 'resource "x" "y" {}\n' }));
  assert.ok(!tf.kinds.includes('argocd'));
  for (const [lang, word] of [['ko', 'Argo CD 로만'], ['en', 'only through the repo and Argo CD']]) {
    assert.ok(textsOf(argo, lang).iac.includes(word), lang);
    const plain = textsOf(tf, lang).iac;
    assert.ok(!plain.includes(word), `${lang}: Argo CD 없는데 줄이 들어감`);
    assert.ok(plain.includes('endpoint_public_access') && plain.includes('PodDisruptionBudget'), lang);
  }
});

test('sqlc: 설정 파일로 감지, Makefile 대상이 있으면 그 명령, 없으면 sqlc generate', () => {
  const MK = 'test:\n\tgo test -race ./...\nsqlc:\n\tsqlc generate\nsqlc-diff:\n\tsqlc diff\n';
  const withMake = repo({ 'go.mod': 'module example.com/pay\n', 'sqlc.yaml': 'version: "2"\n', 'Makefile': MK, 'main.go': 'package main\n' });
  const det = detect(withMake);
  assert.ok(det.stack.includes('sqlc'), det.stack.join(','));
  const c = detectCommands(withMake).commands;
  assert.deepEqual(c.sqlc, ['make sqlc']);
  assert.ok(!(c.tools || []).includes('make sqlc') && c.tools.includes('make sqlc-diff'), (c.tools || []).join(','));
  for (const [lang, word] of [['ko', '`make sqlc` 로 다시 만든다'], ['en', 'regenerate with `make sqlc`']]) assert.ok(textsOf(det, lang).commands.includes(word), lang);
  // 변수로 부르는 대상($(SQLC) generate)도
  const viaVar = repo({ 'sqlc.yml': '', 'Makefile': 'SQLC ?= sqlc\ngen:\n\t$(SQLC) generate\n' });
  assert.deepEqual(detectCommands(viaVar).commands.sqlc, ['make gen']);
  // Makefile 이 없으면 sqlc generate, 설정이 DB 폴더에 있으면 -f 로
  assert.deepEqual(detectCommands(repo({ 'sqlc.json': '{}' })).commands.sqlc, ['sqlc generate']);
  assert.deepEqual(detectCommands(repo({ 'internal/db/sqlc.yaml': '' })).commands.sqlc, ['sqlc generate -f internal/db/sqlc.yaml']);
  // sqlc 가 없으면 줄도 없다
  const none = repo({ 'go.mod': 'module example.com/x\n', 'main.go': 'package main\n', 'Makefile': MK.replace(/sqlc[\s\S]*/, '') });
  assert.ok(!detectCommands(none).commands.sqlc && !detect(none).stack.includes('sqlc'));
  assert.ok(!/sqlc/.test(textsOf(detect(none)).commands || ''));
});

test('iOS 지침: Core Data 줄에 마이그레이션 시험, 줄은 늘지 않는다', () => {
  for (const lang of ['ko', 'en']) {
    const lines = fs.readFileSync(new URL(`../../rules/ios.${lang}.md`, import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('- '));
    const core = lines.filter((l) => l.includes('Core Data'));
    assert.equal(core.length, 1, lang);
    assert.match(core[0], lang === 'ko' ? /마이그레이션 시험/ : /migration test/);
    assert.equal(lines.length, 5, lang);
  }
});

test('GitHub Flow: 작업 마치기 스킬이 있으면 「로컬 병합 대신 PR」 줄', () => {
  const base = { lang: 'ko', rules: [], flow: 'github-flow', hooks: ['protect-branch'], skills: [] };
  const PR = '로컬 병합 대신 PR(GitLab 은 MR)을 연다';
  assert.ok(ruleTexts({ ...base, skills: ['finishing-a-development-branch'] })['github-flow'].includes(PR));
  assert.ok(!ruleTexts(base)['github-flow'].includes(PR), '스킬이 없으면 줄도 없다');
  // 팀 조합(GitHub Flow)은 스킬을 넣으므로 줄도 들어간다
  const sel = expandCombo(all, 'team', detect(repo({ ...NEXT })));
  assert.ok(sel.flow === 'github-flow' && sel.skills.includes('finishing-a-development-branch'));
  assert.ok(ruleTexts({ ...sel, lang: 'ko' })['github-flow'].includes(PR));
  assert.ok(ruleTexts({ ...sel, lang: 'en' })['github-flow'].includes('open a PR (an MR on GitLab) instead of merging locally'));
});
