// 글롭 보호 경로를 품은 폴더 훑기(lib/path-glob.mjs insideHit) — 너비 우선, 도구 폴더 건너뛰기, 한도(2026-11-12)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { insideHit, skipNames, parseGlob } from '../lib/path-glob.mjs';

const tree = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-glob-'));
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), 'x');
  }
  return dir;
};
const hitState = (r) => r.endsWith('.tfstate');

test('너비 우선: 깊은 폴더가 한도를 다 써도 얕은 파일을 먼저 찾는다', () => {
  // readdir 순서는 a, z — 예전 깊이 우선은 z 를 먼저 꺼내 z 아래 파일 20개로 한도 8 을 다 써 a/terraform.tfstate 를 놓쳤다
  const files = ['a/terraform.tfstate', ...Array.from({ length: 20 }, (_, i) => `z/deep/m${i}.tf`)];
  const dir = tree(files);
  try {
    assert.equal(insideHit(dir, 'stacks', hitState, new Set(), 8), 'stacks/a/terraform.tfstate');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('도구 폴더는 들어가지도 세지도 않는다', () => {
  const files = [...Array.from({ length: 30 }, (_, i) => `node_modules/p${i}/x.js`), '.terraform/terraform.tfstate', 'prod/terraform.tfstate'];
  const dir = tree(files);
  try {
    const skip = skipNames(['*.tfstate*']);
    assert.equal(insideHit(dir, 'envs', hitState, skip, 4), 'envs/prod/terraform.tfstate');
    assert.equal(insideHit(dir, 'envs', (r) => r.includes('.terraform/'), skip), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('꼴이 도구 폴더 이름을 마디로 적으면 빼지 않는다', () => {
  assert.equal(skipNames(['.terraform/*.tfstate']).always.has('.terraform'), false);
  assert.equal(skipNames(['*.tfstate*']).always.has('.terraform'), true);
  assert.equal(skipNames(['**/Dist/**']).maybe.has('dist'), false);
  assert.equal(skipNames(['*.key']).maybe.has('dist'), true);
});

test('흔한 이름(dist·build)은 늘 건너뛰지 않고, keep 이 아니라고 한 파일만 건너뛴다(두 번째 검토 2026-11-12)', () => {
  const files = ['dist/secret.key', 'build/out/a.key', 'src/b.txt'];
  const dir = tree(files);
  const hitKey = (r) => r.endsWith('.key');
  try {
    const skip = skipNames(['*.key']);
    assert.equal(skip.always.has('dist'), false);
    // keep 이 늘 참(무시 안 됨)이면 흔한 이름 폴더 안 파일도 친다
    assert.equal(insideHit(dir, 'p', hitKey, skip), 'p/dist/secret.key');
    // dist 만 건너뛰게 하면 build 안 것을 찾는다 — keep 은 (폴더, 파일) 로 불린다
    const calls = [];
    const keep = (root, file) => { calls.push([root, file]); return root !== 'p/dist'; };
    assert.equal(insideHit(dir, 'p', hitKey, skip, undefined, keep), 'p/build/out/a.key');
    assert.deepEqual(calls[0], ['p/dist', 'p/dist/secret.key']);
    // 지우는 폴더 자체가 흔한 이름이면 그 폴더가 기준
    assert.equal(insideHit(path.join(dir, 'dist'), 'dist', hitKey, skip, undefined, (root) => root !== 'dist'), null);
    // 흔한 이름 폴더는 다른 것을 다 본 뒤에 훑는다
    assert.equal(insideHit(dir, 'p', (r) => r.endsWith('.key') || r.endsWith('.txt'), skip), 'p/src/b.txt');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('앞이 / 인 꼴은 맨 위 기준', () => {
  assert.equal(parseGlob('/kubeconfig*').anchored, true);
  assert.equal(parseGlob('kubeconfig*').anchored, false);
  assert.equal(parseGlob('*.tfstate.*').anchored, false);
});
