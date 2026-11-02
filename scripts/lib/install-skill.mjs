// 카탈로그의 스킬 하나를 고정된 커밋에서 받아 프로젝트 .claude/skills/<id>/ 에 넣는다.
// 받은 파일은 실행하지 않는다. 내용만 쓴다. 출처는 .harness-source.json 에 남긴다(라이선스 표시·업데이트 확인용).
import fs from 'node:fs';
import path from 'node:path';

const MAX_FILES = 80;
const MAX_BYTES = 2 << 20; // 스킬 하나에 2MB

const getJson = async (url) => {
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
};
const getBytes = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
};

// 화면의 「원문 보기」: 고정 커밋의 SKILL.md 글만 받아 온다(실행하지 않음, 너무 길면 자름).
const textCache = new Map();
export const fetchSkillText = async ({ sources, skill, repo, maxChars }) => {
  const key = `${skill.repo}@${repo.sha}/${skill.path}`;
  if (!textCache.has(key)) textCache.set(key, getBytes(`${sources.rawBase}/${skill.repo}/${repo.sha}/${skill.path}`).then((b) => b.toString('utf8')));
  const text = await textCache.get(key);
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…` : text;
};

const treeCache = new Map();
const repoTree = async (sources, repo, sha) => {
  const key = `${repo}@${sha}`;
  if (!treeCache.has(key)) treeCache.set(key, getJson(`${sources.githubApi}/repos/${repo}/git/trees/${sha}?recursive=1`));
  return treeCache.get(key);
};

// skill: 카탈로그 항목, repo: 카탈로그 저장소 항목(sha·license), dest: 설치할 폴더
export const installSkill = async ({ sources, skill, repo, dest }) => {
  const dir = path.posix.dirname(skill.path);
  const tree = await repoTree(sources, skill.repo, repo.sha);
  const files = (tree.tree || []).filter((e) => e.type === 'blob' && e.path.startsWith(`${dir}/`));
  if (!files.length) throw new Error(`파일 없음: ${skill.repo}/${dir}`);
  if (files.length > MAX_FILES) throw new Error(`파일이 너무 많음(${files.length}개): ${skill.id}`);
  const total = files.reduce((s, f) => s + (f.size || 0), 0);
  if (total > MAX_BYTES) throw new Error(`너무 큼(${Math.round(total / 1024)}KB): ${skill.id}`);

  const tmp = `${dest}.harness-tmp`;
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const f of files) {
    const rel = f.path.slice(dir.length + 1);
    const out = path.join(tmp, ...rel.split('/'));
    if (!path.resolve(out).startsWith(path.resolve(tmp) + path.sep)) throw new Error(`잘못된 경로: ${f.path}`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, await getBytes(`${sources.rawBase}/${skill.repo}/${repo.sha}/${f.path}`));
  }
  fs.writeFileSync(
    path.join(tmp, '.harness-source.json'),
    JSON.stringify({ repo: skill.repo, path: dir, sha: repo.sha, license: repo.license, installedAt: new Date().toISOString().slice(0, 10) }, null, 2) + '\n',
  );
  // 다 받은 뒤에만 바꿔 넣는다(중간에 실패하면 원래 폴더가 그대로 남게).
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(tmp, dest);
  return { files: files.length, bytes: total };
};
