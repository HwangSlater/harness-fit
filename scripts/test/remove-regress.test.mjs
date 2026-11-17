// 지우기·되돌리기 회귀 확인(2026-11-16): 하위 폴더에 적용한 저장소, 닫히지 않은 코드 울타리, 줄마다 다른 줄바꿈·BOM
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { apply } from '../lib/apply-run.mjs';
import { setBlock, findBlock, START, END } from '../lib/claude-md.mjs';
import { env, baseSel, fakeInstall } from './remove-helpers.mjs';
import { tmpDir } from './helpers.mjs';

let E;
before(() => { E = env(); });
after(() => E.done());
const APPLY = path.join(import.meta.dirname, '..', 'apply.mjs');
const cli = (args, cwd) => JSON.parse(spawnSync(process.execPath, [APPLY, ...args], { encoding: 'utf8', cwd, env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(E.home, '.claude') } }).stdout);

test('하위 폴더(모노레포 패키지)에 적용한 것은 그 폴더에서 되돌리고 지운다 — 맨 위로 올라가지 않는다', async () => {
  const root = tmpDir('harness-subpkg-');
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    const pkg = path.join(root, 'packages', 'app');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, 'CLAUDE.md'), '# 앱\n');
    await apply(pkg, baseSel({ share: false }), () => {}, { install: fakeInstall });
    assert.ok(fs.existsSync(path.join(pkg, '.claude', 'harness.json')));
    const dry = cli(['packages/app', '--remove', '--dry-run'], root);
    assert.ok(dry.removed.some((p) => p.includes('harness.json')), JSON.stringify(dry));
    assert.ok(path.resolve(dry.folder) === path.resolve(pkg));
    const u = cli(['packages/app', '--undo'], root);
    assert.ok(!u.error, JSON.stringify(u));
    assert.equal(fs.readFileSync(path.join(pkg, 'CLAUDE.md'), 'utf8'), '# 앱\n');
    // 적용하지 않은 하위 폴더에서는 여전히 맨 위로 간다
    const deep = path.join(root, 'src', 'deep');
    fs.mkdirSync(deep, { recursive: true });
    const d2 = cli(['src/deep', '--remove', '--dry-run'], root);
    assert.equal(fs.realpathSync(d2.folder).toLowerCase(), fs.realpathSync(root).toLowerCase());
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('닫히지 않은 코드 울타리 아래의 구역도 찾아 그 자리에서 바꾼다(적용마다 구역이 늘지 않는다)', () => {
  const text = ['# 메모', '```sh', 'npm test', '', START, '- 옛 줄', END, ''].join('\n');
  const once = setBlock(text, [START, '- 새 줄', END].join('\n'));
  const twice = setBlock(once, [START, '- 새 줄', END].join('\n'));
  assert.equal(once.split(START).length - 1, 1);
  assert.equal(twice, once);
  assert.ok(!once.includes('- 옛 줄'));
});

test('줄마다 원래 줄바꿈을 지키고(LF 파일의 CRLF 한 줄), 맨 앞 BOM 도 지킨다', () => {
  const mixed = `# 메모\r\n- 사용자 줄\n${START}\n- 옛 줄\n${END}\n- 끝 줄\n`;
  const out = setBlock(mixed, [START, '- 새 줄', END].join('\n'));
  assert.ok(out.startsWith('# 메모\r\n- 사용자 줄\n'), JSON.stringify(out));
  assert.ok(out.endsWith('- 끝 줄\n'));
  assert.ok(!out.slice(out.indexOf(START)).includes('\r\n'), '새 구역은 파일에 많은 줄바꿈(LF)을 따른다');
  const bom = `﻿${START}\n- 옛 줄\n${END}\n# 내 글\n`;
  const out2 = setBlock(bom, [START, '- 새 줄', END].join('\n'));
  assert.ok(out2.startsWith('﻿'), 'BOM 이 남는다');
  assert.equal(findBlock(out2).start, 0);
  const removed = setBlock(bom, '');
  assert.equal(removed, '﻿# 내 글\n');
});
