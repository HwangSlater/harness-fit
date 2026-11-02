// 개발용: 카탈로그의 스킬마다 고정 커밋 기준 폴더 안 파일을 세고, 실행할 수 있는 파일(스크립트) 목록을 적는다.
// 화면이 「실행 파일 포함」을 적용 전에 알려 주는 데 쓴다. 받은 파일은 실행하지 않고 목록만 본다.
// 사용: node scripts/scan-skill-files.mjs   (gh 로그인 필요)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PLUGIN_ROOT } from './lib/catalog.mjs';

const SCRIPT = /\.(sh|bash|zsh|ps1|bat|cmd|js|cjs|mjs|ts|py|rb|pl|go|exe)$/i;
const file = path.join(PLUGIN_ROOT, 'catalog', 'catalog.json');
const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
const trees = new Map();

for (const s of catalog.skills) {
  const repo = catalog.repos.find((r) => r.repo === s.repo);
  if (!repo?.sha) continue;
  if (!trees.has(s.repo)) {
    try {
      trees.set(s.repo, JSON.parse(execFileSync('gh', ['api', `repos/${s.repo}/git/trees/${repo.sha}?recursive=1`], { encoding: 'utf8', maxBuffer: 64 << 20 })).tree || []);
    } catch (e) {
      console.error(`트리를 못 읽음: ${s.repo} (${e.message})`);
      trees.set(s.repo, null);
    }
  }
  const tree = trees.get(s.repo);
  if (!tree) continue;
  const dir = path.posix.dirname(s.path);
  const files = tree.filter((e) => e.type === 'blob' && e.path.startsWith(`${dir}/`)).map((e) => e.path.slice(dir.length + 1));
  s.files = files.length;
  s.scripts = files.filter((f) => SCRIPT.test(f));
}
fs.writeFileSync(file, JSON.stringify(catalog, null, 1) + '\n');
const withScripts = catalog.skills.filter((s) => s.scripts?.length);
console.log(`스킬 ${catalog.skills.length} · 실행 파일 포함 ${withScripts.length}: ${withScripts.map((s) => `${s.id}(${s.scripts.length})`).join(', ')}`);
