// v0.4.1 두 번째 검토(2026-11-16)의 작은 판정들: 넘겨쓰기 낱말(2>&1 뒤 낱말을 건너뛰지 않기), JSON 꼴 Argo CD 의 prune 세기.
// 훅 전체로 도는 사례는 strict-cases/v041-review2.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redirectWord } from '../lib/secret-files.mjs';
import { autoPrune } from '../lib/iac-edit.mjs';

test('넘겨쓰기 낱말: 대상이 다음 낱말인 것만 next, 2>&1·>&2·2>&- 는 낱말 안에서 끝난다', () => {
  for (const w of ['>', '>>', '2>', '2>>', '&>', '&>>', '>|', '>&']) assert.equal(redirectWord(w), 'next', w);
  for (const w of ['2>&1', '>&2', '1>&2', '2>&-', '>out', '2>/dev/null', '>>log.txt']) assert.equal(redirectWord(w), 'self', w);
  for (const w of ['kubeconfig', '-n', '<file', 'a>b']) assert.equal(redirectWord(w), null, w);
});

test('Argo CD prune 세기: YAML·한 줄 JSON·여러 줄 JSON·ApplicationSet 의 template', () => {
  const app = (prune) => ({ apiVersion: 'argoproj.io/v1alpha1', kind: 'Application', spec: { syncPolicy: { automated: { prune } } } });
  assert.equal(autoPrune(JSON.stringify(app(true))), 1);
  assert.equal(autoPrune(JSON.stringify(app(true), null, 2)), 1);
  assert.equal(autoPrune(JSON.stringify(app(false))), 0);
  assert.equal(autoPrune(JSON.stringify({ kind: 'ApplicationSet', spec: { template: { spec: { syncPolicy: { automated: { prune: true } } } } } })), 1);
  assert.equal(autoPrune('spec:\n  syncPolicy:\n    automated:\n      prune: true\n'), 1);
  // 깨진 JSON 은 줄 단위로 센다(끝 쉼표도 받는다)
  assert.equal(autoPrune('{\n  "spec": {\n    "syncPolicy": {\n      "automated": {\n        "prune": true,\n        "selfHeal": true\n'), 1);
});
