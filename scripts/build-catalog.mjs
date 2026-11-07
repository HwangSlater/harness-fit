// 개발용: 조사 결과(JSON) + 받아 둔 SKILL.md 들로 catalog/catalog.json 을 만든다.
// - 토큰은 원문에서 잰다: 상시 비용 = name+description, 호출 비용 = 본문 전체. 목록 예산용 설명 글자 수(descChars)도 함께.
// - 저장소마다 지금 커밋 해시를 고정한다(설치할 때 이 해시로 받는다 — 나중에 바뀐 내용이 몰래 들어오지 않게).
// 사용: node scripts/build-catalog.mjs <research.json> <dl 폴더>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { estimateTokens } from './lib/tokens.mjs';
import { skillMeta, saysWhen } from './lib/skill-meta.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [researchFile, dlDir] = process.argv.slice(2);
if (!researchFile || !dlDir) {
  console.error('사용: node scripts/build-catalog.mjs <research.json> <dl 폴더>');
  process.exit(1);
}
const research = JSON.parse(fs.readFileSync(researchFile, 'utf8'));
// 영어 요약은 손으로 다듬은 catalog/summaries.en.json 이 있으면 그것을 쓴다(원문 description 첫 문장은 어색한 경우가 많다).
const enFile = path.join(ROOT, 'catalog', 'summaries.en.json');
const enSummaries = fs.existsSync(enFile) ? JSON.parse(fs.readFileSync(enFile, 'utf8')) : {};

const headSha = (repo) => {
  try {
    return execFileSync('gh', ['api', `repos/${repo}/commits/HEAD`, '--jq', '.sha'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
};

// 라이선스가 확실히 허용하는 것만 파일로 복사해 설치한다. 나머지는 원 저장소의 플러그인 설치로 안내한다.
const COPY_OK = /^(MIT|Apache-2\.0|BSD-[23]-Clause|ISC|CC-BY-4\.0|CC-BY-SA-4\.0|MPL-2\.0)$/;

const repos = research.repos.map((r) => ({
  repo: r.repo,
  stars: r.stars,
  pushedAt: (r.pushedAt || '').slice(0, 10),
  license: COPY_OK.test(r.license || '') ? r.license : null,
  kind: r.kind,
  install: r.install || null,
  sha: headSha(r.repo),
}));
const repoBy = Object.fromEntries(repos.map((r) => [r.repo, r]));

const skills = [];
for (const s of research.skills) {
  const file = path.join(dlDir, `${s.repo.replace('/', '_')}_${s.path.replace(/\//g, '_')}`);
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const fm = skillMeta(text, s.id);
  const desc = fm.description;
  skills.push({
    id: s.id,
    repo: s.repo,
    path: s.path,
    stages: s.stages,
    stacks: s.stacks,
    needs: s.needs || [],
    summary: { ko: s.summary, en: enSummaries[s.id] || desc.split(/(?<=\.)\s/)[0].slice(0, 160) || s.summary },
    always: text ? estimateTokens(`${fm.name || s.id}: ${desc}`) : null,
    onUse: text ? estimateTokens(text) : null,
    install: repoBy[s.repo]?.license ? 'copy' : 'plugin',
    // 목록 예산(picker/budget.js) — scripts/check-descriptions.mjs 와 같은 셈
    ...(text ? { descChars: (fm.whenToUse ? `${desc} ${fm.whenToUse}` : desc).length, saysWhen: saysWhen(fm) } : {}),
  });
}

const catalog = {
  checkedAt: research.checkedAt,
  criteria: research.criteria,
  repos,
  skills,
};
fs.writeFileSync(path.join(ROOT, 'catalog', 'catalog.json'), JSON.stringify(catalog, null, 1) + '\n');
const missing = skills.filter((s) => s.onUse === null).map((s) => s.id);
console.log(`저장소 ${repos.length} · 스킬 ${skills.length} · 원문 없음 ${missing.length}${missing.length ? ` (${missing.join(', ')})` : ''}`);
console.log(`복사 설치 ${skills.filter((s) => s.install === 'copy').length} · 플러그인 안내 ${skills.filter((s) => s.install === 'plugin').length}`);
