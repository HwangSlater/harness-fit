// 개발용: 카탈로그의 스킬마다 고정 커밋 기준 폴더 안 파일을 세고, 실행할 수 있는 파일(스크립트) 목록을 적는다.
// 화면이 「실행 파일 포함」을 적용 전에 알려 주는 데 쓴다. 받은 파일은 실행하지 않고 목록만 본다.
// 복사해 받는 스킬(install: copy)은 파일 목록(fileList: 스킬 폴더 기준 경로·크기)도 적는다 — 적용할 때 GitHub API(익명 60회/시간)를
// 부르지 않고 raw 파일만 받게(scripts/lib/install-skill.mjs). 커밋이 고정이라 목록도 바뀌지 않는다. build-catalog.mjs 다음에 돌린다.
// 사용: node scripts/dev/scan-skill-files.mjs   (gh 로그인 필요)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PLUGIN_ROOT } from '../lib/catalog.mjs';
import { skillFiles } from '../lib/install-skill.mjs';

const SCRIPT = /\.(sh|bash|zsh|ps1|bat|cmd|js|cjs|mjs|ts|py|rb|pl|go|exe)$/i;
const file = path.join(PLUGIN_ROOT, 'catalog', 'catalog.json');
const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
const trees = new Map();

for (const s of catalog.skills) {
  const repo = catalog.repos.find((r) => r.repo === s.repo);
  if (!repo?.sha) continue;
  if (!trees.has(s.repo)) {
    try {
      trees.set(s.repo, JSON.parse(execFileSync('gh', ['api', `repos/${s.repo}/git/trees/${repo.sha}?recursive=1`], { encoding: 'utf8', maxBuffer: 64 << 20 })));
    } catch (e) {
      console.error(`트리를 못 읽음: ${s.repo} (${e.message})`);
      trees.set(s.repo, null);
    }
  }
  const tree = trees.get(s.repo);
  if (!tree) continue;
  // 받을 때와 같은 기준(맨 위 스킬은 SKILL.md 하나)
  const { dir, files } = skillFiles(tree, s.path);
  const rels = files.map((e) => (dir === '.' ? e.path : e.path.slice(dir.length + 1)));
  s.files = rels.length;
  s.scripts = rels.filter((f) => SCRIPT.test(f));
  // 잘린 트리는 목록이 빠졌을 수 있어 적지 않는다(받을 때 트리 API 로 다시 보고 잘렸으면 실패로 알린다)
  if (s.install === 'copy' && !tree.truncated && files.length) s.fileList = files.map((e, i) => ({ path: rels[i], size: e.size || 0 }));
  else delete s.fileList;
}
fs.writeFileSync(file, JSON.stringify(catalog, null, 1) + '\n');
const withScripts = catalog.skills.filter((s) => s.scripts?.length);
console.log(`스킬 ${catalog.skills.length} · 실행 파일 포함 ${withScripts.length}: ${withScripts.map((s) => `${s.id}(${s.scripts.length})`).join(', ')}`);
console.log(`파일 목록을 적은 스킬 ${catalog.skills.filter((s) => s.fileList).length} / 복사 설치 ${catalog.skills.filter((s) => s.install === 'copy').length}`);
