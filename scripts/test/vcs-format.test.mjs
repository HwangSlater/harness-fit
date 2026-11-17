// 커밋·PR 형식 감지(scripts/lib/vcs-format.mjs)와 지침 「커밋·PR 형식」(rules/vcs-format.*.md) 시험 — 사용자 요청 2026-11-17.
// 기록은 git fast-import 로 한 번에 만든다(커밋마다 git 을 부르면 느리다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpDir, writeFiles, gitInit } from './helpers.mjs';
import { vcsOf, analyze, readLog, FORMAT_SUBJECTS } from '../lib/vcs-format.mjs';
import { vcsTexts } from '../lib/vcs-text.mjs';
import { ruleTexts } from '../lib/claude-md.mjs';
import { loadAll } from '../lib/catalog.mjs';
import { makeState } from '../lib/picker-state.mjs';
import { pickerCfg } from './helpers.mjs';

// commits: [제목 또는 { s, b, merge: [가지 커밋 제목…] }](오래된 것부터). files: 맨 위 기준 { 경로: 글 }
const repo = (commits, files = {}) => {
  const dir = gitInit(tmpDir('harness-vcs-'), { branch: 'main' });
  writeFiles(dir, files);
  let mark = 0;
  let head = 0;
  let t = 1700000000;
  const parts = [];
  // 커밋 하나(빈 트리 그대로). from: 부모 표시, merge: 두 번째 부모 표시
  const commit = (ref, msg, from, merge) => {
    const m = ++mark;
    const data = Buffer.from(msg, 'utf8');
    parts.push(Buffer.from(`commit refs/heads/${ref}\nmark :${m}\ncommitter t <t@e.com> ${t++} +0000\ndata ${data.length}\n`), data,
      Buffer.from(`\n${from ? `from :${from}\n` : ''}${merge ? `merge :${merge}\n` : ''}\n`));
    return m;
  };
  for (const c of commits) {
    const x = typeof c === 'string' ? { s: c } : c;
    const msg = x.b ? `${x.s}\n\n${x.b}\n` : `${x.s}\n`;
    // 가지: head 에서 갈라진 커밋들 → main 에 merge 커밋(첫 부모는 head)
    let side = x.merge ? head : 0;
    for (const s of x.merge || []) side = commit('side', `${s}\n`, side);
    head = commit('main', msg, head, side);
  }
  if (!parts.length) return dir;
  execFileSync('git', ['-C', dir, 'fast-import', '--quiet', '--force'], { input: Buffer.concat(parts) });
  execFileSync('git', ['-C', dir, 'checkout', '-q', '-f', 'main']);
  return dir;
};
const rm = (dir) => fs.rmSync(dir, { recursive: true, force: true });
const rows = (subjects) => subjects.map((s) => ({ name: 't', mail: 't@e.com', s, b: '' }));
const all = loadAll();
const RULES = ['commands', 'collab', 'vcs-format'];
const render = (vcs, extra = {}) => ruleTexts({ lang: 'ko', rules: RULES, hooks: [], skills: [], commands: {}, flow: 'none', vcs, ...extra });

test('conventional + 범위: 타입(범위) 꼴과 자주 쓴 범위, 예는 실제 제목', () => {
  const subjects = ['feat(api): add login', 'fix(ui): cart badge', 'feat(api): token refresh', 'chore(deps): bump vite', 'fix(api): null user', 'feat(ui): dark mode', 'refactor(ui): split header', 'fix(api): retry', 'docs(api): endpoints', 'test(ui): cart'];
  const dir = repo(subjects);
  try {
    const v = vcsOf(dir);
    assert.ok(v.commit.conventional, '타입 꼴');
    assert.deepEqual(v.commit.conventional.scopes.slice(0, 2), ['api', 'ui']);
    assert.equal(v.commit.lang, 'en');
    assert.equal(v.commit.first, 'lower');
    assert.equal(v.commit.examples.length, 3);
    assert.equal(v.commit.examples[0], 'test(ui): cart', '새것부터');
    const t = render(v)['vcs-format'];
    assert.match(t, /`타입\(범위\): 요약`\(타입 [a-z·]+, 범위 `api` · `ui`/);
    assert.match(t, /예: `test\(ui\): cart`/);
    assert.doesNotMatch(render(v).collab || '', /타입: 설명/, '협업 지침의 「타입: 설명」 은 형식 줄과 겹쳐 뺀다');
  } finally {
    rm(dir);
  }
});

test('이슈 번호 앞붙이기 · gitmoji · 한국어 자유 꼴', () => {
  const ticket = analyze(rows(Array.from({ length: 9 }, (_, i) => `[SHOP-${100 + i}] Add item ${i}`)));
  assert.deepEqual(ticket.ticket, { pos: 'prefix', form: 'bracket', key: 'SHOP' });
  assert.equal(ticket.first, 'upper');
  assert.match(vcsTexts({ commit: ticket }, 'ko').commit, /앞에 이슈 번호 `\[SHOP-123\]`/);
  assert.match(vcsTexts({ commit: ticket }, 'en').commit, /issue key `\[SHOP-123\]` first/);
  const tail = analyze(rows(Array.from({ length: 9 }, (_, i) => `Fix cart total JIRA-${i + 1}`)));
  assert.deepEqual(tail.ticket, { pos: 'suffix', form: 'bare', key: 'JIRA' });
  const emoji = analyze(rows(Array.from({ length: 9 }, (_, i) => `${i % 2 ? ':bug:' : ':sparkles:'} change ${i}`)));
  assert.equal(emoji.emoji, 'code');
  assert.match(vcsTexts({ commit: emoji }, 'ko').commit, /gitmoji 이름/);
  assert.equal(analyze(rows(Array.from({ length: 9 }, (_, i) => `✨ change ${i}`))).emoji, 'char');
  const dir = repo(['장바구니 화면 고침', '로그인 추가', '결제 버튼 색 바꿈', '상품 목록 정리', '주문 내역 화면', '배송지 저장', '쿠폰 적용', '리뷰 쓰기', '찜 목록']);
  try {
    const v = vcsOf(dir);
    assert.equal(v.commit.lang, 'ko');
    assert.ok(!v.commit.conventional);
    const t = render(v);
    assert.match(t['vcs-format'], /커밋 형식: 한국어로, 끝에 마침표 없이 — 예: `찜 목록`/);
    assert.doesNotMatch(t.collab, /타입: 설명/, '자유 꼴 저장소에 「타입: 설명」 을 말하지 않는다');
    // 형식 지침을 고르지 않으면 협업 줄은 그대로
    assert.match(ruleTexts({ lang: 'ko', rules: ['collab'], hooks: [], skills: [], vcs: v, flow: 'none' }).collab, /타입: 설명/);
  } finally {
    rm(dir);
  }
});

test('섞인 기록·적은 기록은 아무것도 말하지 않는다(지침 줄도, 고를 목록도 없음)', () => {
  const mixed = ['feat: a', 'Fix the thing', '로그인 고침', '[ABC-1] stuff', ':bug: x', 'update', 'WIP', 'docs: readme', 'Merge fixes.', 'bump'];
  assert.equal(analyze(rows(mixed)), null);
  assert.equal(analyze(rows(['feat: a', 'feat: b', 'fix: c'])), null, '8개 미만');
  // 마침표 없음 하나만으로는 꼴이라 하지 않는다
  assert.equal(analyze(rows(['Add a', 'fix b', '고침 c', 'Update d', '정리 e', 'Bump f', '정리 g', 'move h', '바꿈 i'])), null);
  const dir = repo(mixed);
  try {
    const v = vcsOf(dir);
    assert.equal(v.commit, null);
    assert.equal(render(v)['vcs-format'], undefined);
    const det = { stack: [], kinds: [], commands: {}, vcs: v, history: {}, existing: {} };
    assert.ok(!makeState({ all, det, cfg: pickerCfg }, 'ko').rules.some((r) => r.id === 'vcs-format'), '고를 목록에서 뺀다');
  } finally {
    rm(dir);
  }
});

test('PR 양식: GitHub 여러 자리 · GitLab MR 양식 · 빈 파일은 아님 · 없으면 줄 없음', () => {
  const a = repo([], { '.github/pull_request_template.md': '## 바꾼 것\n- [ ] 시험\n' });
  const b = repo([], { '.github/PULL_REQUEST_TEMPLATE/feature.md': 'x', '.github/PULL_REQUEST_TEMPLATE/bugfix.md': 'y', 'docs/pull_request_template.md': '' });
  const c = repo([], { '.gitlab/merge_request_templates/Default.md': '## Why\n' });
  const d = repo([], { 'README.md': 'hi' });
  try {
    assert.deepEqual(vcsOf(a).pr.templates, ['.github/pull_request_template.md']);
    assert.match(render(vcsOf(a))['vcs-format'], /본문: `\.github\/pull_request_template\.md` 양식을 채운다 — 빈 칸·체크 상자/);
    assert.deepEqual(vcsOf(b).pr.templates, ['.github/PULL_REQUEST_TEMPLATE/bugfix.md', '.github/PULL_REQUEST_TEMPLATE/feature.md'], '빈 docs 양식은 뺀다');
    assert.match(render(vcsOf(b))['vcs-format'], /`\.github\/PULL_REQUEST_TEMPLATE\/bugfix\.md` · `[^`]+` 가운데 맞는 양식을 채운다/);
    assert.deepEqual(vcsOf(c).pr.templates, ['.gitlab/merge_request_templates/Default.md']);
    assert.deepEqual(vcsOf(d).pr, { templates: [], title: null, own: false });
    assert.equal(render(vcsOf(d))['vcs-format'], undefined);
  } finally {
    [a, b, c, d].forEach(rm);
  }
});

test('PR 제목: squash 「(#123)」 제목과 merge 커밋 본문 첫 줄', () => {
  const squash = repo(Array.from({ length: 9 }, (_, i) => `Add page ${i} (#${i + 10})`));
  const merges = repo(Array.from({ length: 9 }, (_, i) => ({ s: `Merge pull request #${i + 1} from me/b${i}`, b: `[WEB-${i + 1}] Checkout step ${i}`, merge: [`wip ${i}`] })));
  try {
    const v = vcsOf(squash);
    assert.equal(v.pr.title.first, 'upper');
    assert.ok(v.pr.own, 'pr-writer 의 type(scope) 꼴과 다르다');
    assert.ok(v.commit.examples.every((x) => !/\(#\d+\)/.test(x)), '커밋 예에는 squash 번호를 붙이지 않는다');
    assert.match(render(v)['vcs-format'], /제목 형식: 영어로, 첫 글자는 대문자로.* — 예: `Add page 8`/);
    const m = vcsOf(merges);
    assert.deepEqual(m.pr.title.ticket, { pos: 'prefix', form: 'bracket', key: 'WEB' });
    assert.match(render(m)['vcs-format'], /제목 형식: 앞에 이슈 번호 `\[WEB-123\]`/);
  } finally {
    rm(squash);
    rm(merges);
  }
});

test('「저장소 형식이 앞선다」 줄은 pr-writer 를 고르고 저장소 형식이 다를 때만', () => {
  const precedence = /pr-writer 스킬로 PR 을 쓸 때도/;
  const tpl = { commit: null, pr: { templates: ['.github/pull_request_template.md'], title: null, own: true } };
  assert.match(render(tpl, { skills: ['pr-writer'] })['vcs-format'], precedence);
  assert.match(render(tpl, { skills: ['pr-writer'] })['vcs-format'], /\(`\.github\/pull_request_template\.md` 양식\)/);
  assert.doesNotMatch(render(tpl)['vcs-format'], precedence, 'pr-writer 가 없으면');
  // 제목이 이미 type(scope) 꼴이고 양식이 없으면 스킬 꼴과 같다
  const conv = analyze(rows(Array.from({ length: 9 }, (_, i) => `feat(web): page ${i}`)));
  const same = { commit: null, pr: { templates: [], title: conv, own: false } };
  assert.doesNotMatch(render(same, { skills: ['pr-writer'] })['vcs-format'], precedence);
  const free = analyze(rows(Array.from({ length: 9 }, (_, i) => `Add page ${i}`)));
  assert.match(render({ commit: null, pr: { templates: [], title: free, own: true } }, { skills: ['pr-writer'] })['vcs-format'], /\(제목 꼴\)/);
  // 영어 글도 같은 조건
  const en = ruleTexts({ lang: 'en', rules: RULES, hooks: [], skills: ['pr-writer'], flow: 'none', vcs: tpl });
  assert.match(en['vcs-format'], /comes before the skill's default format/);
});

test('예에서 비밀값처럼 보이는 제목은 빼고, 백틱·지침 표시는 지운다', () => {
  const token = `ghp_${'a1B2'.repeat(9)}`;
  const subjects = [`fix: rotate ${token}`, 'fix: set password=hunter2secret', 'fix: use `npm ci` {{judge}}', ...Array.from({ length: 7 }, (_, i) => `fix: plain ${i}`)];
  const f = analyze(rows(subjects));
  const all3 = f.examples.join(' ');
  assert.doesNotMatch(all3, /ghp_|hunter2/);
  assert.ok(f.examples.includes("fix: use 'npm ci'"), '백틱은 따옴표로, {{ }} 는 지운다');
  const long = analyze(rows(Array.from({ length: 9 }, () => `fix: ${'긴 설명 '.repeat(30)}`)));
  assert.ok(long.examples.every((x) => x.length <= 72), '길이를 자른다');
});

test('커밋 형식 훅이 켜지면 훅이 막는 타입·언어는 적지 않고 범위·예는 남긴다', () => {
  const f = analyze(rows(Array.from({ length: 9 }, (_, i) => `feat(api): 기능 ${i}`)));
  const vcs = { commit: f, pr: { templates: [], title: null, own: false } };
  const on = render(vcs, { hooks: ['commit-msg'], hookOpts: { 'commit-msg': { lang: 'ko' } } })['vcs-format'];
  assert.doesNotMatch(on, /타입\(범위\): 요약|한국어로/);
  assert.match(on, /타입 뒤에 범위\(`api` 등\)/);
  assert.match(on, /예: `feat\(api\): 기능 0`/);
  const off = render(vcs)['vcs-format'];
  assert.match(off, /`타입\(범위\): 요약`.*한국어로/);
  // 형식만 훅이 다 맡아도 예는 남긴다
  const plain = analyze(rows(Array.from({ length: 9 }, (_, i) => `feat: 기능 ${i}`)));
  assert.match(render({ commit: plain, pr: {} }, { hooks: ['commit-msg'], hookOpts: { 'commit-msg': { lang: 'ko' } } })['vcs-format'], /커밋 형식: 끝에 마침표 없이 — 예:/);
});

test('본문 꼬리 줄(Signed-off-by)과 봇 커밋', () => {
  const dir = repo(Array.from({ length: 9 }, (_, i) => ({ s: `fix: thing ${i}`, b: `Longer text.\n\nSigned-off-by: T <t@e.com>` })));
  try {
    const v = vcsOf(dir);
    assert.deepEqual(v.commit.trailers, ['Signed-off-by']);
    assert.match(render(v)['vcs-format'], /본문 끝에 `Signed-off-by:` 줄\(`git commit -s`\)/);
    // 봇 커밋(dependabot 등)은 세지 않는다 — 사람 커밋 셋 + 봇 아홉은 표본이 모자라 말하지 않는다
    const bots = [...rows(['고침 a', '고침 b', '고침 c']), ...Array.from({ length: 9 }, (_, i) => ({ name: 'dependabot[bot]', mail: 'b@x', s: `Bump x from 1.${i} to 2.${i}`, b: '' }))];
    assert.equal(vcsOf(dir, bots).commit, null);
  } finally {
    rm(dir);
  }
});

test('커밋이 많은 저장소도 최근 기록만 읽어 빠르다', () => {
  const n = 5000;
  const dir = repo(Array.from({ length: n }, (_, i) => ({ s: `feat(core): change ${i}`, b: 'x'.repeat(i % 50 === 0 ? 200000 : 50) })));
  try {
    const t0 = performance.now();
    const v = vcsOf(dir);
    const ms = performance.now() - t0;
    assert.equal(readLog(dir).length, FORMAT_SUBJECTS);
    assert.ok(v.commit.conventional);
    assert.ok(ms < 3000, `${Math.round(ms)}ms`);
  } finally {
    rm(dir);
  }
});

test('하위 폴더에서 불러도 양식 파일은 저장소 맨 위에서 찾는다', () => {
  const dir = repo([], { '.github/pull_request_template.md': 'x', 'app/README.md': 'y' });
  try {
    assert.deepEqual(vcsOf(path.join(dir, 'app')).pr.templates, ['.github/pull_request_template.md']);
  } finally {
    rm(dir);
  }
});

test('겹침 확인(overlap)도 「커밋·PR 형식」 줄을 감지한 글로 채워 보인다 — 사용자 CLAUDE.md 와 견줄 수 있게', async () => {
  const { ruleLines } = await import('../overlap.mjs');
  const vcs = { commit: analyze(rows(Array.from({ length: 10 }, (_, i) => `feat(cart): 수량 바꾸기 ${i}`))), pr: null };
  const lines = ruleLines('ko', ['vcs-format'], { fmt: vcsTexts(vcs, 'ko') })['vcs-format'] || [];
  assert.ok(lines.length && lines.some((l) => /커밋 형식/.test(l.text) && !/\{\{fmt/.test(l.text)), JSON.stringify(lines));
  // 감지한 형식이 없으면 그 줄은 보이지 않는다
  assert.deepEqual(ruleLines('ko', ['vcs-format'], { fmt: vcsTexts(null, 'ko') })['vcs-format'], []);
});
