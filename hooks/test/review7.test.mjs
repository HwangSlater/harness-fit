// v0.4.1 짧은 검토(2026-11-16): 빈 줄이 많은 글에서 세제곱으로 느려지던 정규식 둘, Terragrunt 의 live 폴더, 환경별 tfvars
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSecretWhy } from '../lib/secret-files.mjs';
import { preCommitPasted } from '../lib/git-hook.mjs';
import { findIacEdits } from '../lib/iac-edit.mjs';

const timed = (fn) => { const t = process.hrtime.bigint(); const r = fn(); return [r, Number(process.hrtime.bigint() - t) / 1e6]; };

test('틀 파일 속 비밀 값 찾기: 빈 줄 만 줄에도 빠르고, 진짜 값은 여전히 찾는다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-r7-'));
  try {
    const f = path.join(dir, 'kubeconfig.yaml.tmpl');
    fs.writeFileSync(f, `apiVersion: v1\n${'\n'.repeat(10000)}${' \n'.repeat(5000)}`);
    const [none, ms] = timed(() => readSecretWhy('kubeconfig.yaml.tmpl', [], { abs: f, root: dir }));
    assert.ok(ms < 300, `${ms}ms`);
    assert.equal(none, null, '빈 틀은 묻지 않는다');
    fs.writeFileSync(f, `apiVersion: v1\n${'\n'.repeat(10000)}users:\n- user:\n    token: abc123real\n`);
    assert.ok(readSecretWhy('kubeconfig.yaml.tmpl', [], { abs: f, root: dir }), '진짜 토큰은 묻는다');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('붙여 넣은 pre-commit 항목 찾기: 빈 줄 만 줄에도 빠르다', () => {
  const [, ms] = timed(() => preCommitPasted(`repos:\n${'\n'.repeat(10000)}${' '.repeat(50000)}\n`));
  assert.ok(ms < 300, `${ms}ms`);
});

test('iac-edit: Terragrunt 의 live 폴더 아래 dev 는 개발 자리, 환경별 dev.tfvars 도, 운영 낱말이 있으면 묻는다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-r7-'));
  try {
    const w = (rel, content) => findIacEdits({ file_path: path.join(dir, rel), content }, dir, dir).map((x) => x.key);
    const snap = 'resource "aws_db_instance" "x" {\n  skip_final_snapshot = true\n}\n';
    assert.deepEqual(w('infrastructure-live/dev/rds/main.tf', snap), []);
    assert.deepEqual(w('live/dev/rds/main.tf', snap), []);
    assert.deepEqual(w('environments/dev.tfvars', 'skip_final_snapshot = true\n'), []);
    assert.ok(w('infrastructure-live/prod/rds/main.tf', snap).length, '운영은 묻는다');
    assert.ok(w('live/us-east-1/rds/main.tf', snap).length, '환경을 모르면 묻는다');
    assert.ok(w('environments/prod.tfvars', 'skip_final_snapshot = true\n').length);
    // 개발 자리라도 공개 DB 는 묻는다
    assert.ok(w('live/dev/rds/main.tf', 'resource "aws_db_instance" "x" {\n  publicly_accessible = true\n}\n').length);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
