// 되돌리기 안전 시험(네트워크 없이: 스킬은 고르지 않는다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDir, gitInit, gitIn } from './helpers.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { apply, undo } from '../lib/apply-run.mjs';
import { BACKUP_DIR } from '../lib/backup.mjs';

const sel = { lang: 'ko', combo: 'team', skills: [], hooks: ['secrets', 'protect-branch'], rules: ['collab'], flow: 'github-flow', explore: [], note: '', share: false };
const tmp = () => tmpDir('harness-undo-');
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');

test('적용 뒤 사용자가 고친 CLAUDE.md·.gitignore 는 넣은 부분만 빼고 남긴다', async () => {
  const dir = tmp();
  await apply(dir, sel);
  fs.appendFileSync(path.join(dir, 'CLAUDE.md'), '\n내 메모: 배포는 금요일 금지\n');
  fs.appendFileSync(path.join(dir, '.gitignore'), '.env\nnode_modules/\n');
  const r = undo(dir);
  assert.deepEqual(r.trimmed.sort(), ['.gitignore', 'CLAUDE.md']);
  assert.match(read(dir, 'CLAUDE.md'), /배포는 금요일 금지/);
  assert.doesNotMatch(read(dir, 'CLAUDE.md'), /harness-fit:start/);
  assert.match(read(dir, '.gitignore'), /^\.env$/m, '.env 무시 줄이 살아 있어야 비밀값이 커밋되지 않는다');
  assert.doesNotMatch(read(dir, '.gitignore'), /harness-backup/);
  assert.ok(!fs.existsSync(path.join(dir, '.claude', 'harness.json')), '고치지 않은 파일은 지운다');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('고치지 않았으면 원래대로(만든 것은 지우고, 있던 것은 되살린다)', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# 원래 글\n');
  await apply(dir, sel);
  const r = undo(dir);
  assert.deepEqual(r.restored, ['CLAUDE.md']);
  assert.equal(read(dir, 'CLAUDE.md'), '# 원래 글\n');
  assert.deepEqual(fs.readdirSync(dir), ['CLAUDE.md']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('가짜 백업 목록의 바깥 경로는 건드리지 않고, 목록 없는 폴더·이상한 이름은 무시한다', () => {
  const parent = tmp();
  const dir = path.join(parent, 'repo');
  const victim = path.join(parent, 'victim.txt');
  fs.writeFileSync(victim, '지우면 안 됨');
  const base = path.join(dir, BACKUP_DIR);
  fs.mkdirSync(path.join(base, 'zzzz'), { recursive: true });
  fs.writeFileSync(path.join(base, 'zzzz', 'manifest.json'), JSON.stringify({ created: ['../victim.txt'] }));
  assert.deepEqual(undo(dir), { error: 'no-backup' }, '이름 꼴이 아닌 폴더는 백업으로 보지 않는다');
  const stamp = '2026-01-01T00-00-00-000Z';
  fs.mkdirSync(path.join(base, stamp), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), '내 코드');
  const entries = [{ path: '../victim.txt', action: 'create' }, { path: 'src', action: 'create' }, { path: '.git/hooks/pre-commit', action: 'change' }];
  fs.writeFileSync(path.join(base, stamp, 'manifest.json'), JSON.stringify({ version: 2, stamp, entries }));
  fs.mkdirSync(path.join(base, '2026-02-01T00-00-00-000Z')); // 목록 없이 끊긴 백업
  fs.mkdirSync(path.join(base, '2026-03-01T00-00-00-000Z'));
  fs.writeFileSync(path.join(base, '2026-03-01T00-00-00-000Z', 'manifest.json'), '{ 깨짐'); // 깨진 목록
  const r = undo(dir);
  assert.equal(r.undone, stamp, '목록 없는·깨진 백업은 건너뛰고 그다음 것');
  assert.deepEqual(r.skipped, ['../victim.txt', 'src', '.git/hooks/pre-commit'], '적용이 만들 수 없는 경로는 믿지 않는다');
  assert.ok(fs.existsSync(victim) && fs.existsSync(path.join(dir, 'src', 'app.js')));
  fs.rmSync(parent, { recursive: true, force: true });
});

test('스킬 경로에 . 이나 .. 을 넣어 폴더째 지우게 하지 못한다', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, '.claude', 'skills', 'mine'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{}');
  const stamp = '2026-01-01T00-00-00-000Z';
  const d = path.join(dir, BACKUP_DIR, stamp);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({ version: 2, stamp, entries: [{ path: '.claude/skills/..', action: 'create' }, { path: '.claude/skills/.', action: 'create' }] }));
  assert.deepEqual(undo(dir).skipped, ['.claude/skills/..', '.claude/skills/.']);
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'settings.json')) && fs.existsSync(path.join(dir, '.claude', 'skills', 'mine')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('다시 받은 스킬도 지문이 남아, 그 뒤 고친 것은 되돌릴 때 따로 남긴다', async () => {
  const dir = tmp();
  const { retry } = await import('../lib/apply-run.mjs');
  const real = globalThis.fetch;
  const tree = { tree: [{ type: 'blob', path: 'skills/productivity/handoff/SKILL.md', size: 1 }] };
  const ok = (body) => ({ ok: true, json: async () => body, arrayBuffer: async () => new TextEncoder().encode(String(body)).buffer });
  try {
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    const first = await apply(dir, { ...sel, skills: ['handoff'] });
    assert.deepEqual(first.failed.map((f) => f.skill), ['handoff']);
    globalThis.fetch = async (url) => ok(url.includes('/git/trees/') ? tree : '받은 글');
    assert.deepEqual((await retry(dir, ['handoff'])).installed, ['handoff']);
  } finally {
    globalThis.fetch = real;
  }
  fs.appendFileSync(path.join(dir, '.claude', 'skills', 'handoff', 'SKILL.md'), '\n내가 고침');
  const r = undo(dir);
  assert.deepEqual(r.saved, ['.claude/skills/handoff']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('미래 날짜·git 이 추적하는 백업은 심어 둔 것으로 보고 무시한다', async () => {
  const dir = tmp();
  const git = gitIn(dir);
  gitInit(dir);
  const plant = (stamp) => {
    const d = path.join(dir, BACKUP_DIR, stamp);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({ version: 2, stamp, entries: [{ path: 'CLAUDE.md', action: 'create' }] }));
  };
  plant('2099-01-01T00-00-00-000Z');
  plant('2026-01-01T00-00-00-000Z');
  git('add', path.join(BACKUP_DIR, '2026-01-01T00-00-00-000Z', 'manifest.json'));
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '내 글');
  assert.deepEqual(undo(dir), { error: 'no-backup' });
  assert.equal(read(dir, 'CLAUDE.md'), '내 글');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('고친 설정 파일·스킬 폴더는 고친 모습을 따로 남기고 되돌린다(훅이 꺼지도록)', async () => {
  const dir = tmp();
  await apply(dir, sel);
  const skill = path.join(dir, '.claude', 'skills', 'mine');
  // 스킬 폴더를 받은 것처럼 목록에 더한 뒤 사용자가 고친다
  const { latestBackup, addEntries } = await import('../lib/backup.mjs');
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '받은 것');
  addEntries(latestBackup(dir), dir, [{ path: '.claude/skills/mine', kind: 'skill', action: 'create' }]);
  fs.writeFileSync(path.join(skill, 'note.md'), '내가 더함');
  fs.writeFileSync(path.join(dir, '.claude', 'harness.json'), '{"rules":{"commit-msg":{"lang":"ko"}}}');
  const r = undo(dir);
  assert.deepEqual(r.saved.sort(), ['.claude/harness.json', '.claude/skills/mine']);
  assert.ok(!fs.existsSync(path.join(dir, '.claude', 'harness.json')), '설정 파일은 되돌려 훅이 꺼진다');
  assert.ok(!fs.existsSync(skill));
  assert.match(r.savedIn, /\.undone\/edited$/);
  assert.equal(fs.readFileSync(path.join(dir, r.savedIn, '.claude', 'skills', 'mine', 'note.md'), 'utf8'), '내가 더함');
  assert.deepEqual(undo(dir), { error: 'no-backup' }, '남겨 둔 백업은 다음 되돌리기 대상이 아니다');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('.gitignore 의 줄만 뺄 때 CRLF 줄바꿈을 지킨다', async () => {
  const dir = tmp();
  await apply(dir, sel);
  fs.writeFileSync(path.join(dir, '.gitignore'), '.claude/harness-backup/\r\nnode_modules/\r\ndist/\r\n');
  undo(dir);
  assert.equal(read(dir, '.gitignore'), 'node_modules/\r\ndist/\r\n');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('파일을 쓰다 실패하면 바로 되돌려, 다시 적용해도 원래 상태가 백업된다', async () => {
  const dir = tmp();
  const md = path.join(dir, 'CLAUDE.md');
  fs.writeFileSync(md, '# 원래\n');
  fs.chmodSync(md, 0o444); // 읽기 전용 → harness.json 을 쓴 다음 CLAUDE.md 쓰기에서 실패
  await assert.rejects(apply(dir, sel));
  fs.chmodSync(md, 0o644);
  assert.equal(read(dir, 'CLAUDE.md'), '# 원래\n');
  assert.ok(!fs.existsSync(path.join(dir, '.claude', 'harness.json')), '먼저 쓴 파일도 되돌렸다');
  assert.deepEqual(undo(dir), { error: 'no-backup' }, '되돌린 백업은 남지 않는다');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('예전(0.2.x) 백업 목록도 되돌린다', () => {
  const dir = tmp();
  const stamp = '2026-01-01T00-00-00-000Z';
  const bdir = path.join(dir, BACKUP_DIR, stamp);
  fs.mkdirSync(path.join(bdir, 'files'), { recursive: true });
  fs.writeFileSync(path.join(bdir, 'files', 'CLAUDE.md'), '옛 글\n');
  fs.writeFileSync(path.join(bdir, 'manifest.json'), JSON.stringify({ stamp, created: ['.claude\\harness.json'], backedUp: ['CLAUDE.md'] }));
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '바뀐 글\n');
  fs.writeFileSync(path.join(dir, '.claude', 'harness.json'), '{}');
  const r = undo(dir);
  assert.deepEqual(r.removed, ['.claude/harness.json']);
  assert.equal(read(dir, 'CLAUDE.md'), '옛 글\n');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLAUDE.md 관리 구역: 표시가 거꾸로면 지우지 않고 새로 붙인다', async () => {
  const { buildClaudeMd } = await import('../lib/claude-md.mjs');
  const broken = '<!-- harness-fit:end -->\n내 글\n<!-- harness-fit:start -->\n';
  const out = buildClaudeMd(broken, sel);
  assert.ok(out.startsWith(broken.trimEnd()), '사용자 글은 그대로');
  assert.match(out, /<!-- harness-fit:start -->\n[\s\S]+<!-- harness-fit:end -->\n$/);
});
