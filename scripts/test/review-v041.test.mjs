// v0.4.1 독립 검토(2026-11-16)의 추천·감지 쪽: GitOps 만 있는 저장소의 인프라 지침(Argo CD 줄, Terraform 줄은 빼기),
// next 가 devDependencies 에만 있는 React 라이브러리, sqlc/sqlc.yaml 과 sqlc generate 찾기의 속도.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detect } from '../detect.mjs';
import { loadAll, recommend } from '../lib/catalog.mjs';
import { ruleTexts } from '../lib/claude-md.mjs';
import { detectCommands } from '../lib/commands.mjs';
import { callsGenerate } from '../lib/sqlc.mjs';
import { tmpDir, writeFiles, gitInit, gitIn } from './helpers.mjs';

const all = loadAll();
const made = [];
const repo = (files) => {
  const d = gitInit(tmpDir('harness-v041r-'), { branch: 'main' });
  made.push(d);
  writeFiles(d, files);
  gitIn(d)('add', '-A');
  return d;
};
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const textsOf = (det, lang = 'ko') => ruleTexts({ ...recommend(all, det, lang), lang });
const ARGO_APP = 'apiVersion: argoproj.io/v1alpha1\nkind: Application\nmetadata:\n  name: api\n';
const K8S = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: api\n';

test('GitOps 만(k8s + Argo CD · Helm + Argo CD): 인프라 지침과 Argo CD 줄이 들어가고 Terraform 줄은 빠진다', () => {
  const words = { ko: ['Argo CD 로만', 'terraform fmt', 'endpoint_public_access'], en: ['only through the repo and Argo CD', 'terraform fmt', 'endpoint_public_access'] };
  for (const files of [
    { 'k8s/deploy.yaml': K8S, 'argocd/api.yaml': ARGO_APP },
    { 'charts/api/Chart.yaml': 'name: api\n', 'charts/api/values.yaml': 'a: 1\n', 'argocd/api.yaml': ARGO_APP },
  ]) {
    const det = detect(repo(files));
    assert.ok(det.stack.includes('Argo CD') && !det.stack.includes('Terraform'), det.stack.join(','));
    for (const lang of ['ko', 'en']) {
      const [argo, fmt, eks] = words[lang];
      const t = textsOf(det, lang).iac;
      assert.ok(t && t.includes(argo), `${lang}: Argo CD 줄 없음`);
      assert.ok(!t.includes(fmt) && !t.includes(eks), `${lang}: Terraform 줄이 들어감`);
    }
  }
  // Terraform 저장소에는 그대로 있다
  const tf = detect(repo({ 'main.tf': 'resource "x" "y" {}\n', 'argocd/api.yaml': ARGO_APP }));
  assert.ok(tf.kinds.includes('terraform'));
  const t = textsOf(tf).iac;
  assert.ok(t.includes('terraform fmt') && t.includes('endpoint_public_access') && t.includes('Argo CD 로만'));
  // Argo CD 없는 k8s 만 저장소에는 여전히 넣지 않는다
  assert.ok(!textsOf(detect(repo({ 'k8s/deploy.yaml': K8S }))).iac);
});

test('Next.js: next 가 devDependencies 에만 있고 설정·라우트 폴더가 없으면 Next.js 가 아니다(React 로 본다)', () => {
  const lib = { 'package.json': { name: 'ui-kit', dependencies: { react: '19.0.0' }, devDependencies: { next: '15.0.3', '@storybook/nextjs': '8.4.0' } }, 'src/Button.tsx': 'export const B = () => null;\n' };
  const det = detect(repo(lib));
  assert.ok(!det.stack.includes('Next.js') && det.stack.includes('React'), det.stack.join(','));
  assert.ok(!textsOf(det).nextjs);
  // 설정 파일이나 app/·pages/ 가 있으면 devDependencies 여도 Next.js
  for (const extra of [{ 'next.config.mjs': 'export default {};\n' }, { 'app/page.tsx': 'export default function P() { return null }\n' }, { 'pages/index.tsx': '' }]) {
    const d = detect(repo({ ...lib, ...extra }));
    assert.ok(d.stack.includes('Next.js'), JSON.stringify(extra));
  }
  // dependencies 의 next 는 그대로 Next.js
  assert.ok(detect(repo({ 'package.json': { name: 'w', dependencies: { next: '15.0.3', react: '19.0.0' } } })).stack.includes('Next.js'));
});

test('sqlc: sqlc/sqlc.yaml 도 찾고, generate 찾기는 긴 줄에서도 빠르다', () => {
  const d = repo({ 'sqlc/sqlc.yaml': 'version: "2"\n', 'go.mod': 'module example.com/x\n' });
  assert.ok(detect(d).stack.includes('sqlc'));
  assert.deepEqual(detectCommands(d).commands.sqlc, ['sqlc generate -f sqlc/sqlc.yaml']);
  for (const [line, want] of [['sqlc generate', true], ['$(SQLC) generate', false], ['sqlc -f db/sqlc.yaml generate', true], ['go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1 generate', true], ['docker run sqlc/sqlc generate', true], ['generate sqlc', false], ['sqlc diff', false], ['sqlc generated', false]]) assert.equal(callsGenerate(line), want, line);
  const long = 'sqlc '.repeat(50_000);
  const t0 = performance.now();
  assert.equal(callsGenerate(long), false);
  assert.ok(performance.now() - t0 < 100, `${(performance.now() - t0).toFixed(0)}ms`);
});
