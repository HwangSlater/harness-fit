// ask-cmd: pyproject 의 설치 명령과 python -m 모듈 꼴을 같은 것으로 본다(역할극 7 회차, 2026-11-11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { askCmd, blockCmd } from '../rules/shell.mjs';
import { cmdList } from '../lib/ask-match.mjs';

const t = (k) => k;

// 검토 2026-11-13: "block": "terraform apply"(글 하나)가 막기를 조용히 껐다
test('commands·block 은 글 하나도 한 줄 목록으로, 객체는 오류로(알림이 뜬다)', () => {
  assert.deepEqual(cmdList('terraform apply'), ['terraform apply']);
  assert.deepEqual(cmdList(['a', '', 3, null, 'b']), ['a', 'b']);
  assert.deepEqual(cmdList(undefined), []);
  assert.deepEqual(cmdList('  '), []);
  assert.throws(() => cmdList({ x: 'terraform apply' }));
  assert.throws(() => cmdList(42));
  const check = (rule, opts, cmd = 'terraform apply -auto-approve') => rule.check({ cmd, shell: 'bash', opts: { remote: false, ...opts }, t, root: os.tmpdir() });
  assert.equal(check(blockCmd, { block: 'terraform apply' }), 'block.cmd');
  assert.equal(check(askCmd, { commands: 'terraform apply' }), 'ask.cmd');
  assert.equal(check(blockCmd, { block: 'terraform apply' }, 'terraform plan'), null);
  // 실제 진입점: 객체로 적은 block 은 막지 않고 「ask-cmd 훅이 멈췄다」 고 알린다(조용히 꺼지지 않게)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-blockcfg-'));
  try {
    fs.mkdirSync(path.join(dir, '.claude'));
    fs.mkdirSync(path.join(dir, '.git'));
    fs.writeFileSync(path.join(dir, '.claude', 'harness.json'), JSON.stringify({ lang: 'en', rules: { 'ask-cmd': { block: { x: 'terraform apply' }, remote: false } } }));
    const run = fileURLToPath(new URL('../run.mjs', import.meta.url));
    const r = spawnSync(process.execPath, [run], { input: JSON.stringify({ tool_name: 'Bash', cwd: dir, tool_input: { command: 'terraform apply' } }), encoding: 'utf8' });
    const j = JSON.parse(r.stdout);
    assert.equal(j.hookSpecificOutput?.permissionDecision, undefined, '막지 않는다');
    assert.match(j.systemMessage || '', /ask-cmd hook crashed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('[project.scripts] 이름을 적으면 python -m 모듈도 묻고, 모듈을 적으면 이름도 묻는다', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-entry-'));
  try {
    fs.writeFileSync(path.join(root, 'pyproject.toml'), '[project]\nname = "churn"\n[project.scripts]\nchurn-train = "churn.train:main"\n"churn-eval" = \'churn.evaluate:main\'\n[tool.ruff]\nline-length = 100\n');
    const ask = (cmd, commands) => askCmd.check({ cmd, shell: 'bash', opts: { commands, remote: false }, t, root });
    assert.equal(ask('python -m churn.train --config configs/xgb.yaml', ['churn-train']), 'ask.cmd');
    assert.equal(ask('uv run python -m churn.train', ['churn-train']), 'ask.cmd');
    assert.equal(ask('churn-eval', ['python -m churn.evaluate']), 'ask.cmd');
    assert.equal(ask('python -m churn.features', ['churn-train']), null, '다른 모듈');
    assert.equal(ask('python src/churn/train.py --config c.yaml', ['churn-train']), 'ask.cmd', '파일로 부른 꼴(역할극 7 회차 다시)');
    assert.equal(ask('python src/churn/features.py', ['churn-train']), null, '다른 파일');
    assert.equal(ask('python -m churn.train --help', ['churn-train']), null, '도움말');
    assert.equal(askCmd.check({ cmd: 'python -m churn.train', shell: 'bash', opts: { commands: ['churn-train'], remote: false }, t, root: path.join(root, 'none') }), null, 'pyproject 가 없으면 이름만');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
