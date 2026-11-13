// 팀원 공유 때 커밋·푸시할 파일 가운데 아직 커밋되지 않은 것(새 파일·고친 파일).
// 「이번에 바뀌는 파일」만 보면, 전에 적용하고 커밋하지 않은 CLAUDE.md·.claude/settings.json 이 다시 적용할 때 목록에서 빠졌다(화면 역할 평가, 2026-11-11).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const FIXED = ['.claude/harness.json', 'CLAUDE.md', '.claude/settings.json', '.gitignore'];

// → ['CLAUDE.md', '.claude/skills/tdd-lite/', …](저장소 맨 위 기준, / 구분). git 이 없거나 실패하면 빈 목록.
export const uncommittedShared = (root, skills = []) => {
  const skillDirs = skills.map((id) => `.claude/skills/${id}`).filter((d) => fs.existsSync(path.join(root, d)));
  const wanted = [...FIXED.filter((f) => fs.existsSync(path.join(root, f))), ...skillDirs];
  if (!wanted.length) return [];
  let out = '';
  try {
    out = execFileSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=all', '-z', '--', ...wanted], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 });
  } catch {
    return [];
  }
  // porcelain 경로는 저장소 맨 위 기준 — 프로젝트가 하위 폴더(모노레포의 packages/app)면 그 앞부분을 뗀다(검토 2026-11-11).
  // 이름 바꿈(R  새\0옛\0)의 옛 이름 칸은 건너뛴다
  let prefix = '';
  try {
    prefix = execFileSync('git', ['-C', root, 'rev-parse', '--show-prefix'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {}
  const entries = out.split('\0');
  const changed = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e) continue;
    if (e[0] === 'R' || e[0] === 'C') i++; // 다음 칸은 옛 이름
    const f = e.slice(3).replace(/\\/g, '/');
    changed.push(prefix && f.startsWith(prefix) ? f.slice(prefix.length) : f);
  }
  const hit = new Set();
  for (const f of changed) {
    const dir = skillDirs.find((d) => f === d || f.startsWith(`${d}/`));
    hit.add(dir ? `${dir}/` : f);
  }
  return [...hit];
};
