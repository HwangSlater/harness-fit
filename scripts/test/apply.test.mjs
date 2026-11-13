// 시험: node --test scripts/test/*.test.mjs  (네트워크 없이 도는 것만)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildConfig, plan } from '../lib/plan.mjs';
import { undo, apply } from '../lib/apply-run.mjs';
import { buildClaudeMd } from '../lib/claude-md.mjs';
import { loadAll, expandCombo, recommend } from '../lib/catalog.mjs';
import { ruleHeading, ruleLine, escapeRe, tmpDir } from './helpers.mjs';

const all = loadAll();
const base = { lang: 'ko', combo: 'team', skills: [], hooks: ['protect-branch', 'branch-name', 'commit-msg', 'secrets'], rules: ['lean'], flow: 'git-flow' };

test('CLAUDE.md: 사용자 글은 남기고 관리 구역만 넣고·바꾸고·지운다', () => {
  const mine = '# 내 프로젝트\n\n내 규칙.\n';
  const once = buildClaudeMd(mine, base);
  const gitFlow = ruleHeading('git-flow', 'ko');
  assert.ok(once.startsWith(mine.trim()));
  assert.match(once, new RegExp(`<!-- harness-fit:start -->[\\s\\S]*${escapeRe(gitFlow)}[\\s\\S]*<!-- harness-fit:end -->`));
  assert.equal(buildClaudeMd(once, base), once, '같은 선택을 두 번 적용해도 그대로');
  const changed = buildClaudeMd(once, { ...base, flow: 'trunk' });
  assert.ok(changed.includes(ruleHeading('trunk', 'ko')));
  assert.ok(!changed.includes(gitFlow));
  const removed = buildClaudeMd(once, { ...base, flow: 'none', rules: [] });
  assert.doesNotMatch(removed, /harness-fit:start/);
  assert.match(removed, /내 규칙/);
});

test('harness.json: Git 전략이 보호 브랜치·브랜치 이름 옵션을 정한다', () => {
  const cfg = buildConfig(all, base);
  assert.deepEqual(cfg.rules['protect-branch'].branches, ['main', 'master', 'develop']);
  assert.match(cfg.rules['branch-name'].pattern, /release/);
  assert.equal(cfg.rules.secrets, true);
  const trunk = buildConfig(all, { ...base, flow: 'trunk' });
  assert.equal(trunk.rules['protect-branch'].allowCommit, true);
});

test('다시 적용해도 사용자가 넣은 훅 옵션은 남고, Git 전략이 정하는 값만 바뀐다', () => {
  const prev = { rules: { 'commit-msg': { lang: 'ko' }, 'protect-branch': { branches: ['옛것'], mine: 1 } } };
  const cfg = buildConfig(all, base, prev);
  assert.deepEqual(cfg.rules['commit-msg'], { lang: 'ko' });
  assert.deepEqual(cfg.rules['protect-branch'].branches, ['main', 'master', 'develop']);
  assert.equal(cfg.rules['protect-branch'].mine, 1);
  assert.equal(buildConfig(all, base, null).rules.secrets, true);
});

test('auto 추천도 팀 조합이면 팀원 공유를 켠다(화면과 같은 값)', () => {
  const det = { stack: [], authors: 3, team: true, host: 'github', commits: 40, hasDevelop: false };
  assert.equal(recommend(all, det, 'ko').share, true);
  assert.equal(recommend(all, { ...det, authors: 1, team: false }, 'ko').share, false);
});

test('추천: 팀이면 팀 협업 + GitHub Flow, 스택 스킬이 붙는다', () => {
  const det = { stack: ['Next.js', 'TypeScript'], authors: 3, team: true, host: 'github', commits: 40, hasDevelop: false };
  const r = recommend(all, det, 'ko');
  assert.equal(r.combo, 'team');
  assert.equal(r.flow, 'github-flow');
  assert.ok(r.skills.includes('react-best-practices'));
  assert.ok(!r.skills.includes('setup-pre-commit'), '형식 도구 단서(Prettier·lint-staged)가 없으면 Husky 를 까는 스킬은 넣지 않는다');
  const pretty = { ...det, stack: [...det.stack, 'Prettier'] };
  assert.ok(recommend(all, pretty, 'ko').skills.includes('setup-pre-commit'), '팀 조합 + Prettier');
  assert.ok(!expandCombo(all, 'solo', pretty).skills.includes('setup-pre-commit'));
  assert.ok(!recommend(all, { ...pretty, stack: [...pretty.stack, 'Husky'] }, 'ko').skills.includes('setup-pre-commit'), '커밋 훅 관리 도구가 이미 있으면 뺀다');
});

test('조합에 적힌 스킬·훅은 모두 카탈로그에 있다', () => {
  const skills = new Set(all.catalog.skills.map((s) => s.id));
  const hooks = new Set(all.packs.hooks.map((h) => h.id));
  for (const c of all.combos.combos) {
    for (const s of c.skills) assert.ok(skills.has(s), `${c.id}: 없는 스킬 ${s}`);
    for (const h of c.hooks) assert.ok(hooks.has(h), `${c.id}: 없는 훅 ${h}`);
  }
  for (const a of all.combos.stackAddons) for (const s of a.skills) assert.ok(skills.has(s), `stackAddons: 없는 스킬 ${s}`);
  for (const a of all.combos.stackAddons) for (const h of a.hooks || []) assert.ok(hooks.has(h), `stackAddons: 없는 훅 ${h}`);
});

test('언어별 훅은 그 언어를 쓰는 저장소에서만 기본으로 켜진다(가볍게는 빼고), push 묶기·답 언어는 어디서도 기본 꺼짐', () => {
  const det = (stack) => ({ stack, kinds: [], authors: 1, commits: 10, team: false, existing: {} });
  assert.ok(expandCombo(all, 'solo', det(['iOS'])).hooks.includes('swift-unsafe'));
  assert.ok(expandCombo(all, 'team', det(['Python'])).hooks.includes('python-unsafe'));
  assert.ok(!expandCombo(all, 'solo', det([])).hooks.some((h) => h === 'swift-unsafe' || h === 'python-unsafe'));
  assert.ok(!expandCombo(all, 'light', det(['iOS', 'Python'])).hooks.includes('swift-unsafe'));
  for (const c of all.combos.combos) for (const id of ['squash-push', 'answer-lang']) assert.ok(!expandCombo(all, c.id, det(['iOS', 'Python'])).hooks.includes(id), `${c.id}: ${id}`);
});

test('스택에 딸린 훅 옵션: ROS 2 면 ask-cmd 가 ros2 launch 를 묻고, Claude API·MCP 면 ask-cmd 가 켜진다(역할극 2·6 회차 2차)', () => {
  const det = (stack) => ({ stack, kinds: [], authors: 1, commits: 10, team: false, existing: {} });
  const ros = expandCombo(all, 'solo', det(['Python', 'ROS 2']));
  assert.ok(ros.hooks.includes('ask-cmd'));
  assert.ok(ros.hookOpts['ask-cmd'].commands.includes('ros2 launch'));
  assert.ok(expandCombo(all, 'solo', det(['TypeScript', 'Claude API'])).hooks.includes('ask-cmd'));
  assert.equal(expandCombo(all, 'solo', det(['TypeScript'])).hookOpts['ask-cmd'], undefined);
  const why = recommend(all, { ...det(['Python', 'ROS 2']), history: {} }, 'ko').why.join('\n');
  assert.match(why, /ROS 2 → .*ros2 launch/);
});

test('조합에 적힌 규칙은 packs.json 에 있고 한국어·영어 글이 모두 있다', async () => {
  const { renderRule } = await import('../lib/claude-md.mjs');
  const rules = new Set(all.packs.rules.map((r) => r.id));
  for (const c of all.combos.combos) for (const r of c.rules) assert.ok(rules.has(r), `${c.id}: 없는 규칙 ${r}`);
  // 이 저장소 명령(commands)은 저장소에서 읽은 명령으로 채우는 글이라 명령을 하나 준다
  for (const r of rules) for (const lang of ['ko', 'en']) assert.ok(renderRule(r, lang, [], [], [], { test: ['npm test'] }), `규칙 글 없음: rules/${r}.${lang}.md`);
});

test('미리보기는 파일을 바꾸지 않고, 되돌릴 것이 없으면 알린다', () => {
  const dir = tmpDir('harness-apply-');
  const { changes } = plan(dir, { ...base, skills: ['handoff'] }, all);
  assert.ok(changes.some((c) => c.skill === 'handoff'));
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.deepEqual(undo(dir), { error: 'no-backup' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLAUDE.md 문장은 실제로 켠 훅을 따른다', async () => {
  const { renderRule } = await import('../lib/claude-md.mjs');
  const on = renderRule('collab', 'ko', ['commit-msg']);
  const off = renderRule('collab', 'ko', []);
  // 커밋 메시지 형식 줄({{!hook:commit-msg}})은 훅이 꺼졌을 때만
  const format = ruleLine('collab', 'ko', '!hook:commit-msg');
  assert.ok(!on.includes(format), '형식은 훅이 막으니 글로 적지 않는다');
  assert.ok(off.includes(format));
  assert.doesNotMatch(on + off, /훅/);
  assert.doesNotMatch(on + off, /\{\{/);
  assert.ok(renderRule('github-flow', 'ko', []).includes(ruleLine('github-flow', 'ko', '!hook:protect-branch')));
  assert.doesNotMatch(renderRule('github-flow', 'ko', []), /훅이 막는다/);
});

test('브랜치 방식이 훅을 켜고 끈다', async () => {
  const { applyFlow } = await import('../lib/catalog.mjs');
  const sel = { flow: 'github-flow', hooks: ['secrets', 'protect-branch', 'branch-name'] };
  assert.deepEqual(applyFlow(all, { ...sel }, 'none').hooks, ['secrets']);
  assert.deepEqual(applyFlow(all, { ...sel }, 'trunk').hooks.sort(), ['protect-branch', 'secrets']);
  assert.deepEqual(applyFlow(all, { flow: 'none', hooks: ['secrets'] }, 'git-flow').hooks.sort(), ['branch-name', 'protect-branch', 'secrets']);
});

test('팀원 설치 안내: 기존 설정은 두고 두 항목만 더한다', async () => {
  const { buildSettings } = await import('../lib/plan.mjs');
  const src = all.sources;
  const out = JSON.parse(buildSettings(JSON.stringify({ permissions: { allow: ['Bash(ls)'] } }), src));
  assert.deepEqual(out.permissions, { allow: ['Bash(ls)'] });
  assert.equal(out.enabledPlugins[src.pluginId], true);
  assert.equal(out.extraKnownMarketplaces[src.marketplace].source.repo, src.pluginRepo);
  assert.match(out.extraKnownMarketplaces[src.marketplace].source.ref, /^v\d+\.\d+\.\d+$/, '팀원이 받는 버전은 태그로 고정');
  assert.equal(buildSettings('{ 깨진', src), null, '깨진 파일은 건드리지 않는다');
});

test('보고용 이름은 스킬·훅·규칙으로 나뉘고 id 대신 이름이다', async () => {
  const { labelsFor } = await import('../lib/catalog.mjs');
  const l = labelsFor(all, { ...base, skills: ['handoff'], rules: ['collab'] }, 'ko');
  assert.deepEqual(Object.keys(l).sort(), ['combo', 'flow', 'hooks', 'rules', 'skills']);
  assert.equal(l.hooks.length, base.hooks.length);
  assert.ok(!l.hooks.includes('secrets') && !l.rules.includes('collab') && !l.skills.includes('handoff'), '이름이 있으면 id 를 보이지 않는다');
});

test('빈 저장소는 thin, 사용자가 알려 준 스택·인원은 추천에 들어간다', async () => {
  const { detect, withHints } = await import('../detect.mjs');
  const { parseArgs } = await import('../lib/args.mjs');
  const dir = tmpDir('harness-empty-');
  const det = detect(dir);
  assert.equal(det.thin, true);
  const { root, hints } = parseArgs([dir, '--lang', 'ko', '--stack', 'next.js, Supabase,없는것', '--team']);
  assert.equal(root, path.resolve(dir), '--stack 값을 프로젝트 경로로 착각하지 않는다');
  const hinted = withHints(det, hints);
  assert.deepEqual(hinted.hinted.stack, ['Next.js', 'Supabase'], '대소문자 무시, 모르는 이름은 버림');
  assert.ok(hinted.team);
  const r = recommend(all, hinted, 'ko');
  assert.equal(r.combo, 'team');
  assert.ok(r.skills.includes('react-best-practices'));
  assert.doesNotMatch(r.why[0], /커밋/, '알려 준 인원을 커밋 기록처럼 쓰지 않는다');
  assert.equal(withHints(det, { stack: [], team: false }), det, '알려 준 게 없으면 그대로');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('요청 칸과 팀 공유는 파일 목록에 들어간다', () => {
  const dir = tmpDir('harness-plan-');
  const kinds = plan(dir, { ...base, note: '커밋은 한국어로', share: true }, all).changes.map((c) => c.kind);
  assert.ok(kinds.includes('request') && kinds.includes('share') && kinds.includes('claude-md'));
  assert.ok(!plan(dir, { ...base, note: '  ', share: false }, all).changes.some((c) => c.kind === 'request' || c.kind === 'share'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('명령줄 적용: 깨진 선택 파일은 bad-selection, 쓰기 실패는 mode 를 담은 write-failed(전체 검토 2026-11-13)', async () => {
  const { execFileSync } = await import('node:child_process');
  const dir = tmpDir('harness-cli-');
  const cli = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', 'apply.mjs');
  const run = (...a) => {
    try {
      return JSON.parse(execFileSync(process.execPath, [cli, dir, ...a], { encoding: 'utf8' }));
    } catch (e) {
      return JSON.parse(e.stdout);
    }
  };
  const bad = path.join(dir, 'sel.json');
  fs.writeFileSync(bad, '{ 깨짐');
  assert.equal(run('--selection', bad).error, 'bad-selection');
  // 되돌릴 백업이 없으면 no-backup(쓰기 실패가 아니다)
  assert.equal(run('--undo').error, 'no-backup');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('적용 실패: 자동 되돌리기가 백업을 못 찾거나(no-backup) 스킬 받기가 터지면 partial — 「바뀐 것 없음」이라 하지 않는다(검토 2026-11-13)', async () => {
  const sel = { ...base, hooks: ['secrets'] };
  // 쓰기 실패(읽기 전용 CLAUDE.md): 되돌리기가 해냈으면 partial 아님, no-backup 을 돌려주거나 던지면 partial
  const failWrite = async (opts) => {
    const dir = tmpDir('harness-partial-');
    const md = path.join(dir, 'CLAUDE.md');
    fs.writeFileSync(md, '# x\n');
    fs.chmodSync(md, 0o444);
    try {
      await apply(dir, sel, () => {}, opts);
      return 'no-error';
    } catch (e) {
      return e.code === 'EPERM' || e.code === 'EACCES' ? !!e.partial : `다른 오류: ${e.message}`;
    } finally {
      fs.chmodSync(md, 0o644);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  // root 는 읽기 전용 파일도 쓴다(그때는 쓰기 실패 꼴을 건너뛴다)
  if (process.getuid?.() !== 0) {
    assert.equal(await failWrite({ undoRun: () => ({ undone: 'x', removed: [], restored: [] }) }), false, '스스로 되돌렸다');
    assert.equal(await failWrite({ undoRun: () => ({ error: 'no-backup' }) }), true, 'no-backup 은 되돌리지 못한 것');
    assert.equal(await failWrite({ undoRun: () => { throw new Error('x'); } }), true);
  }
  // 스킬 받기가 터짐(진행 알림 오류 등) — 파일은 이미 썼다
  const dir = tmpDir('harness-partial-');
  await assert.rejects(apply(dir, sel, () => {}, { install: async () => { throw new Error('받기 준비 실패'); } }), (e) => e.partial === true && /받기 준비/.test(e.message));
  await assert.rejects(apply(dir, sel, () => { throw new Error('진행 알림'); }), (e) => e.partial === true);
  fs.rmSync(dir, { recursive: true, force: true });
});
