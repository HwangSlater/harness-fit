// 「확인 없이 PR·MR 을 올린다」 지적(2026-11-24) 뒤 바꾼 것: PR·MR 낱말을 저장소에 맞게({{pr}}·prWordOf), PR 병합 방식은
// 「PR·MR 병합은 사람이」가 켜지면 쉰다, 보호 브랜치 막는 글이 push·PR 을 시키지 않는다. 독립 검토(2026-11-26)가 짚은 빈 시험.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpDir } from './helpers.mjs';
import { loadAll } from '../lib/catalog.mjs';
import { ruleTexts } from '../lib/claude-md.mjs';
import { cleanSelection } from '../lib/picker-state.mjs';
import { pickerConfig } from '../lib/paths.mjs';
import { prWordOf } from '../../hooks/lib/forge.mjs';
import { evaluate } from '../../hooks/lib/evaluate.mjs';

const all = loadAll();
let tmp;
const repo = (name, origin, files = {}) => {
  const d = path.join(tmp, name);
  fs.mkdirSync(path.join(d, 'sub', 'deep'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', d]);
  if (origin) execFileSync('git', ['-C', d, 'remote', 'add', 'origin', origin]);
  for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(d, f), text);
  return d;
};
before(() => (tmp = tmpDir('hf-publish-')));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('prWordOf: GitLab origin 은 MR, GitHub 은 PR, 저장소 밖은 둘 다 · 하위 폴더에서도 맨 위의 .gitlab-ci.yml 을 본다', () => {
  const gl = repo('gl', 'git@gitlab.com:acme/shop.git');
  const gh = repo('gh', 'https://github.com/acme/shop.git'); // lint:allow url 시험용 가짜 origin(네트워크에 닿지 않음)
  const ci = repo('ci', null, { '.gitlab-ci.yml': 'stages: [test]\n' });
  assert.equal(prWordOf(gl), 'MR');
  assert.equal(prWordOf(path.join(gl, 'sub', 'deep')), 'MR');
  assert.equal(prWordOf(gh), 'PR');
  assert.equal(prWordOf(path.join(ci, 'sub')), 'MR', 'origin 이 없으면 저장소 맨 위의 GitLab 단서');
  assert.equal(prWordOf(path.join(tmp)), 'PR/MR', '저장소 밖');
  assert.equal(prWordOf(null), 'PR/MR');
});

test('지침의 {{pr}}: GitLab 저장소에는 PR 낱말이 없고(브랜치 전략·협업·커밋 형식·인프라), GitHub 은 MR 이 없다', () => {
  const base = { lang: 'ko', combo: 'team', skills: [], hooks: ['protect-branch', 'self-merge'], rules: ['collab', 'iac'], flow: 'git-flow' };
  for (const lang of ['ko', 'en']) {
    for (const flow of ['github-flow', 'git-flow']) {
      const gl = Object.values(ruleTexts({ ...base, lang, flow, host: 'gitlab' })).join('\n');
      const gh = Object.values(ruleTexts({ ...base, lang, flow, host: 'github' })).join('\n');
      assert.doesNotMatch(gl, /\bPR\b|\{\{pr\}\}/, `${lang} ${flow} GitLab`);
      assert.doesNotMatch(gh, /\bMR\b|\{\{pr\}\}/, `${lang} ${flow} GitHub`);
    }
  }
});

test('선택의 host 는 서버가 읽은 github·gitlab 만 받는다(화면이 보낸 값은 받지 않는다)', () => {
  const cfg = pickerConfig();
  const clean = (det, sel = {}) => cleanSelection({ all, cfg, det }, { lang: 'ko', ...sel }, 'ko').host;
  assert.equal(clean({ host: 'gitlab' }), 'gitlab');
  assert.equal(clean({ host: 'github' }), 'github');
  assert.equal(clean({ host: 'other' }), null);
  assert.equal(clean({}, { host: 'gitlab' }), null);
});

test('보호 브랜치 막는 글은 push·PR 을 시키지 않고 전략에 맞는 브랜치 접두어를 권한다 · 막음이 물음보다 앞선다', () => {
  const d = repo('rules', 'https://github.com/acme/shop.git'); // lint:allow url 시험용 가짜 origin(네트워크에 닿지 않음)
  execFileSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-q', '--allow-empty', '-m', 'x']);
  fs.mkdirSync(path.join(d, '.claude'));
  const run = (rules, command) => {
    fs.writeFileSync(path.join(d, '.claude', 'harness.json'), JSON.stringify({ lang: 'ko', rules }));
    const asks = [];
    const msgs = evaluate({ tool_name: 'Bash', cwd: d, tool_input: { command } }, [], [], [], asks);
    return { msgs, asks };
  };
  const pb = run({ 'protect-branch': { branches: ['main'] } }, 'git commit --allow-empty -m "feat: x"').msgs[0];
  assert.match(pb, /사용자가 올리라고 할 때만/);
  assert.doesNotMatch(pb, /PR 로 병합하세요|PR 을 여세요/);
  // 막음이 물음보다 앞선다: 보호 브랜치로 바로 올리는 push 는 막고 묻지 않는다
  const both2 = run({ 'protect-branch': { branches: ['main'], noDirectPush: true }, 'ask-publish': true }, 'git push origin main');
  assert.ok(both2.msgs.length >= 1);
});
