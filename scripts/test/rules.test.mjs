// 규칙 글과 겹침 묶음 검사(2026-11-05 사용자 지적: 검사로 막을 수 있는 걸 글로만 두면 놓친다, 같은 걸 두 번 넣으면 안 된다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadAll, expandCombo } from '../lib/catalog.mjs';
import { TAG } from '../lib/claude-md.mjs';

const all = loadAll();
const dir = new URL('../../rules/', import.meta.url);
const files = fs.readdirSync(dir).filter((f) => /\.(ko|en)\.md$/.test(f));
const bullets = (f) => fs.readFileSync(new URL(f, dir), 'utf8').split(/\r?\n/).filter((l) => l.startsWith('- '));
const hookIds = new Set(all.packs.hooks.map((h) => h.id));
const skillIds = new Set(all.catalog.skills.map((s) => s.id));
const tagOf = (l) => { const m = l.match(TAG); return m ? (m[2] ? `${m[1]}${m[2]}:${m[3]}` : 'judge') : null; };

test('규칙 줄마다 「훅 · 스킬 · 판단」 중 하나를 밝힌다', () => {
  for (const f of files) {
    for (const l of bullets(f)) {
      const m = l.match(TAG);
      assert.ok(m, `${f}: 표시 없는 줄 — 검사로 막을 수 있으면 훅으로, 아니면 {{judge}}: ${l.slice(0, 50)}`);
      for (const x of m[3]?.split('|') || []) {
        if (m[2] === 'hook') assert.ok(hookIds.has(x), `${f}: 없는 훅 ${x}`);
        if (m[2] === 'skill') assert.ok(skillIds.has(x), `${f}: 없는 스킬 ${x}`);
      }
    }
  }
});

test('「훅이 막는다」를 글로 적지 않는다(훅이 막을 때 알려 준다)', () => {
  for (const f of files) for (const l of bullets(f)) assert.doesNotMatch(l, /훅이 막|hooks? blocks?/i, `${f}: ${l.slice(0, 50)}`);
});

test('한국어·영어 규칙 글은 같은 줄을 같은 표시로 갖는다', () => {
  for (const f of files.filter((x) => x.endsWith('.ko.md'))) {
    const en = f.replace('.ko.md', '.en.md');
    assert.ok(files.includes(en), `영어 글 없음: ${en}`);
    assert.deepEqual(bullets(en).map(tagOf), bullets(f).map(tagOf), `${f} ↔ ${en}`);
  }
});

// 스택에 딸린 지침 묶음(combos.json stackAddons 의 rules): 그 스택이 있는 저장소에만 들어간다(2026-11-13 전체 검토 — 8개 분야에서 꼭 필요한 지침이 없었다)
const DOMAIN = { ml: ['PyTorch', 'scikit-learn', 'XGBoost', 'MLflow', 'Optuna', 'Hydra', 'wandb'], dbt: ['dbt'], iac: ['Terraform', 'Ansible'], ios: ['iOS'], rust: ['Rust'], payments: ['Payments'] };
const detOf = (stack) => ({ stack, kinds: [], authors: 1, commits: 10, team: false, existing: {} });

test('스택 지침 묶음은 지침 목록·글·스택 맞춤에 모두 있다', () => {
  const ruleIds = new Set(all.packs.rules.map((r) => r.id));
  for (const a of all.combos.stackAddons) for (const id of a.rules || []) assert.ok(ruleIds.has(id), `stackAddons: 없는 지침 ${id}`);
  for (const id of Object.keys(DOMAIN)) {
    const r = all.packs.rules.find((x) => x.id === id);
    assert.ok(r?.name.ko && r.name.en && r.desc.ko && r.desc.en, `${id}: 이름·설명`);
    for (const lang of ['ko', 'en']) {
      assert.ok(files.includes(`${id}.${lang}.md`), `${id}.${lang}.md 없음`);
      // 분야 지침은 짧게(다른 스택 지침과 같은 크기 — 매 대화 읽힌다)
      assert.ok(bullets(`${id}.${lang}.md`).length <= 8, `${id}.${lang}: 8줄 넘음`);
    }
  }
});

test('스택 지침 묶음은 그 스택에서만 들어간다(혼자·팀·꼼꼼, 가볍게는 빼고)', () => {
  for (const [id, stacks] of Object.entries(DOMAIN)) {
    for (const s of stacks) for (const c of ['solo', 'team', 'strict']) assert.ok(expandCombo(all, c, detOf([s])).rules.includes(id), `${c} [${s}]: ${id} 빠짐`);
    assert.ok(!expandCombo(all, 'light', detOf(stacks)).rules.includes(id), `light: ${id}`);
  }
  // 이웃 스택에는 넣지 않는다: 파이썬·pandas 만(분석 스크립트)은 ml 아님, Docker·Go 는 iac·rust 아님, Swift 패키지 없는 웹은 ios 아님
  const unrelated = [['Python'], ['pandas', 'Jupyter'], ['PySpark', 'Airflow'], ['Docker'], ['Go'], ['Kubernetes'], ['Go', 'Docker', 'Kubernetes', 'PostgreSQL'], ['React', 'TypeScript'], ['Next.js', 'Vercel'], ['Django', 'PostgreSQL'], []];
  for (const stack of unrelated) {
    const rules = expandCombo(all, 'team', detOf(stack)).rules;
    for (const id of Object.keys(DOMAIN)) assert.ok(!rules.includes(id), `[${stack}]: ${id} 이 들어감`);
  }
  // 여러 분야가 겹치면 같이(데이터 파이프라인 = dbt + Terraform), 같은 지침은 한 번만
  const both = expandCombo(all, 'team', detOf(['dbt', 'Terraform', 'Kubernetes', 'PyTorch', 'MLflow'])).rules;
  for (const id of ['dbt', 'iac', 'ml']) assert.equal(both.filter((x) => x === id).length, 1, id);
});

// 검토 2026-11-13: rust 지침이 「이 저장소 명령」과 같은 cargo 명령을 옵션까지 다시 적어 11 회차에 두 번 들어갔고, CI 가 다르면 서로 어긋났다
test('분야 지침은 명령 옵션을 박아 두지 않고 저장소 명령을 따르게 한다, 한국어는 업계 말로', () => {
  for (const lang of ['ko', 'en']) {
    const rust = bullets(`rust.${lang}.md`).join('\n');
    assert.doesNotMatch(rust, /cargo (?:clippy|test) --|-D warnings/, `rust.${lang}: 옵션을 박아 둠`);
    assert.match(rust, /`cargo clippy`/, `rust.${lang}: 검사 명령 줄이 사라짐`);
    assert.match(rust, lang === 'ko' ? /「이 저장소 명령」/ : /"Commands in this repo"/, `rust.${lang}: 저장소 명령을 가리키지 않음`);
  }
  // 지침 제목이 바뀌면 rust 줄도 같이 바꾼다
  assert.match(fs.readFileSync(new URL('commands.ko.md', dir), 'utf8'), /^## 이 저장소 명령$/m);
  assert.match(fs.readFileSync(new URL('commands.en.md', dir), 'utf8'), /^## Commands in this repo$/m);
  const ko = ['ml', 'dbt', 'iac', 'ios', 'rust', 'payments'].flatMap((id) => bullets(`${id}.ko.md`)).join('\n');
  for (const odd of ['묻지 않고 바꾸지 않는다', '아래 모델까지', '쓰는 쪽을 알린다']) assert.ok(!ko.includes(odd), `어색한 말: ${odd}`);
  assert.match(ko, /하위\(downstream\) 모델/);
});

// 한 스킬이 여러 묶음에 들어갈 수 있다(find-bugs 는 변경분 리뷰이면서 보안 리뷰다)
test('겹침 묶음: 스킬은 카탈로그에 있고, 같은 묶음이 두 번 있지 않다', () => {
  const { groups } = JSON.parse(fs.readFileSync(new URL('../../catalog/overlaps.json', import.meta.url), 'utf8'));
  const keys = new Set();
  for (const g of groups) {
    assert.ok(g.skills.length >= 2, `${g.id}: 둘 이상이어야 묶음`);
    for (const s of g.skills) assert.ok(skillIds.has(s), `${g.id}: 없는 스킬 ${s}`);
    const key = [...g.skills].sort().join(',');
    assert.ok(!keys.has(key), `${g.id}: 같은 묶음이 또 있음`);
    keys.add(key);
  }
});

test('조합 기본값에는 같은 일을 하는 스킬이 둘 들어가지 않는다(스택 스킬까지 펼쳐서)', () => {
  const { groups } = JSON.parse(fs.readFileSync(new URL('../../catalog/overlaps.json', import.meta.url), 'utf8'));
  // 스택은 detect 가 실제로 함께 내는 모양으로: 하나씩, 그리고 흔한 묶음(RN 앱 = React Native + Expo, 웹 + TS + 파이썬 등)
  const stacks = [...new Set(all.combos.stackAddons.flatMap((a) => a.when))];
  const sets = [...stacks.map((s) => [s]), ['React Native', 'Expo', 'TypeScript'], ['Next.js', 'TypeScript', 'Supabase', 'GitHub Actions'], ['React', 'TypeScript', 'Python']];
  for (const c of all.combos.combos) {
    for (const stack of sets) {
      const sel = expandCombo(all, c.id, { stack, existing: {} });
      for (const g of groups) {
        const both = g.skills.filter((s) => sel.skills.includes(s));
        assert.ok(both.length <= 1, `${c.id} [${stack}]: ${g.id} 묶음에서 ${both.join(', ')} 둘 다`);
      }
    }
  }
});
