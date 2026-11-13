// .git 파일로 저장소 상태를 읽는 hooks/lib/repo-files.mjs — 애매하면 git 에게 묻는지(검토 2026-11-13)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { findRepo, hasRemoteRefsOf } from '../lib/repo-files.mjs';

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
const fresh = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-repofiles-'));
  git(dir, 'init', '-q', '-b', 'main');
  return dir;
};

test('가리키는 곳이 없는 origin/HEAD 하나뿐이면 원격 추적이 있다고 하지 않고 git 에게 묻는다', () => {
  const dir = fresh();
  try {
    const remotes = path.join(dir, '.git', 'refs', 'remotes', 'origin');
    fs.mkdirSync(remotes, { recursive: true });
    fs.writeFileSync(path.join(remotes, 'HEAD'), 'ref: refs/remotes/origin/main\n');
    const repo = findRepo(dir);
    assert.ok(repo, '보통 저장소는 파일로 찾는다');
    assert.equal(hasRemoteRefsOf(repo), undefined);
    // 진짜 원격 추적 브랜치가 있으면 그대로 true
    fs.writeFileSync(path.join(remotes, 'main'), '0'.repeat(40) + '\n');
    fs.rmSync(path.join(remotes, 'HEAD'));
    assert.equal(hasRemoteRefsOf(repo), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('core.bare = true 인 저장소는 파일로 정하지 않고 git 에게 묻는다', () => {
  const dir = fresh();
  try {
    assert.ok(findRepo(dir));
    git(dir, 'config', 'core.bare', 'true');
    assert.equal(findRepo(dir), undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
