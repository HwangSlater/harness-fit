// 카탈로그의 스킬 하나를 고정된 커밋에서 받아 프로젝트 .claude/skills/<id>/ 에 넣는다.
// 받은 파일은 실행하지 않는다. 내용만 쓴다(SKILL.md 머리말의 name 만 폴더 이름으로 맞춘다). 출처는 .harness-source.json 에 남긴다(라이선스 표시·업데이트 확인용).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { readPluginJson } from './paths.mjs';
import { makeNet } from './net.mjs';

const MAX_FILES = 80;
const MAX_BYTES = 2 << 20; // 스킬 하나에 2MB

// Claude Code 에 이미 있는 명령·번들 스킬 이름. 프로젝트 스킬이 같은 이름이면 그 명령을 대신해 버린다
// (code.claude.com/docs/en/skills — 「Your skill replaces the bundled command」). 예: sentry 의 name: security-review → /security-review 가 바뀐다.
let reserved;
export const reservedNames = () =>
  (reserved ??= new Set(readPluginJson('config/reserved-skill-names.json').names));

// SKILL.md 머리말의 name 을 폴더 이름(카탈로그 id)으로 맞춘다. 명령 이름은 name 이 정하므로(없으면 폴더 이름)
// 원래 이름이 Claude Code 명령과 겹치거나 화면에 보인 이름과 다르지 않게 한다. 바꾼 것은 from 으로 돌려준다(.harness-source.json 에 남김).
// 머리말이나 name 줄이 없으면 그대로 둔다 — 그때는 폴더 이름이 곧 명령 이름이다.
export const setSkillName = (text, name) => {
  const m = text.match(/^(﻿?---\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/);
  const line = m?.[2].match(/^name:[ \t]*(.*)$/m);
  if (!line) return { text, from: null };
  const from = line[1].trim().replace(/^(["'])(.*)\1$/, '$2');
  if (from === name) return { text, from: null };
  const head = m[2].replace(/^name:[ \t]*.*$/m, `name: ${name}`);
  return { text: `${m[1]}${head}${m[3]}${text.slice(m[0].length)}`, from };
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
  // 실패한 요청은 기억하지 않는다(잠깐 끊겼던 연결 때문에 계속 실패하지 않게).
  if (!textCache.has(key)) textCache.set(key, getBytes(`${sources.rawBase}/${skill.repo}/${repo.sha}/${skill.path}`).then((b) => b.toString('utf8')).catch((e) => (textCache.delete(key), Promise.reject(e))));
  const text = await textCache.get(key);
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…` : text;
};

const treeCache = new Map();
const repoTree = async (sources, net, repo, sha) => {
  const key = `${repo}@${sha}`;
  if (!treeCache.has(key)) treeCache.set(key, net.json(`${sources.githubApi}/repos/${repo}/git/trees/${sha}?recursive=1`).catch((e) => (treeCache.delete(key), Promise.reject(e))));
  const tree = await treeCache.get(key);
  // 아주 큰 저장소는 목록이 잘려 온다. 일부만 받고 성공이라 하지 않는다.
  if (tree.truncated) throw new Error(`파일 목록이 잘림: ${repo}`);
  return tree;
};

// 스킬 폴더의 파일들. 저장소 맨 위에 있는 스킬(SKILL.md 가 루트)은 저장소 전체가 아니라 SKILL.md 하나만.
// scripts/dev/scan-skill-files.mjs 가 카탈로그의 fileList 를 만들 때도 이 함수를 쓴다(받을 때와 같은 기준).
export const skillFiles = (tree, skillPath) => {
  const dir = path.posix.dirname(skillPath);
  const blobs = (tree.tree || []).filter((e) => e.type === 'blob');
  return { dir, files: dir === '.' ? blobs.filter((e) => e.path === skillPath) : blobs.filter((e) => e.path.startsWith(`${dir}/`)) };
};

// 받을 파일 목록. 카탈로그에 고정 커밋 기준 목록(fileList: 스킬 폴더 기준 경로·크기)이 있으면 GitHub API 를 부르지 않는다
// (익명 한도 60회/시간 — 전체 검토 2026-11-13 에 한도가 0 이 되어 모든 스킬이 403 으로 실패했다). 없을 때만 트리 API.
const listFiles = async (sources, net, skill, repo) => {
  const dir = path.posix.dirname(skill.path);
  if (Array.isArray(skill.fileList) && skill.fileList.length) {
    return { dir, files: skill.fileList.map((f) => ({ path: dir === '.' ? f.path : `${dir}/${f.path}`, size: f.size })) };
  }
  return skillFiles(await repoTree(sources, net, skill.repo, repo.sha), skill.path);
};
const TMP_PREFIX = '.harness-tmp-';

// skill: 카탈로그 항목, repo: 카탈로그 저장소 항목(sha·license), dest: 설치할 폴더
// net: 받기 통로(net.mjs makeNet — 동시 수 한도·호출 한도·토큰). 여러 스킬을 함께 받을 때는 같은 것을 넘긴다.
export const installSkill = async ({ sources, skill, repo, dest, net = makeNet(sources) }) => {
  if (reservedNames().has(skill.id)) throw new Error(`Claude Code 명령과 이름이 같음: ${skill.id}`);
  const { dir, files } = await listFiles(sources, net, skill, repo);
  if (!files.length) throw new Error(`파일 없음: ${skill.repo}/${skill.path}`);
  if (files.length > MAX_FILES) throw new Error(`파일이 너무 많음(${files.length}개): ${skill.id}`);
  const total = files.reduce((s, f) => s + (f.size || 0), 0);
  if (total > MAX_BYTES) throw new Error(`너무 큼(${Math.round(total / 1024)}KB): ${skill.id}`);

  // 받는 동안은 .claude/skills 바깥(같은 디스크의 .claude 아래)에 둔다. 반쯤 받은 폴더가 스킬로 읽히지 않게,
  // 실패하면 지운다. 다 받은 뒤에만 바꿔 넣는다(원래 폴더는 그때까지 그대로).
  const tmp = path.join(path.dirname(path.dirname(dest)), `${TMP_PREFIX}${skill.id}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  let renamedFrom = null;
  const hashes = {};
  try {
    // 경로를 먼저 다 확인하고, 파일은 한꺼번에(net 의 동시 수 한도 안에서) 받은 뒤에 쓴다. 하나라도 실패하면 아직 차례를 기다리는 것은 부르지 않는다.
    const outs = files.map((f) => {
      const rel = dir === '.' ? f.path : f.path.slice(dir.length + 1);
      const out = path.join(tmp, ...rel.split('/'));
      if (!path.resolve(out).startsWith(path.resolve(tmp) + path.sep)) throw new Error(`잘못된 경로: ${f.path}`);
      return { f, rel, out };
    });
    let failed = false;
    const got = await Promise.all(outs.map(({ f }) => net.bytes(`${sources.rawBase}/${skill.repo}/${repo.sha}/${f.path}`, () => failed).catch((e) => {
      failed = true;
      throw e;
    })));
    // 목록의 크기는 카탈로그(또는 트리)가 적은 값이다. 받은 실제 크기로도 한 번 더 본다.
    const real = got.reduce((s, b) => s + b.length, 0);
    if (real > MAX_BYTES) throw new Error(`너무 큼(${Math.round(real / 1024)}KB): ${skill.id}`);
    for (const [i, { rel, out }] of outs.entries()) {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      let bytes = got[i];
      if (rel === 'SKILL.md') {
        const fixed = setSkillName(bytes.toString('utf8'), skill.id);
        if (fixed.from !== null) { renamedFrom = fixed.from; bytes = Buffer.from(fixed.text, 'utf8'); }
      }
      fs.writeFileSync(out, bytes);
      hashes[rel] = crypto.createHash('sha256').update(bytes).digest('hex');
    }
    // files: 받은 파일마다 해시 — 받은 그대로인 파일은 harness-fit 의 코드 검사(커밋 때)가 남의 코드로 보고 넘긴다(hooks/rules/commit.mjs withoutVendored)
    fs.writeFileSync(
      path.join(tmp, '.harness-source.json'),
      JSON.stringify({ repo: skill.repo, path: dir, sha: repo.sha, license: skill.license || repo.license, installedAt: new Date().toISOString().slice(0, 10), ...(renamedFrom !== null ? { renamedFrom } : {}), files: hashes }, null, 2) + '\n',
    );
    // 원래 폴더는 옆으로 치워 두었다가, 새 폴더가 자리를 잡은 뒤에 지운다.
    // (Windows 에서 백신 등이 잡고 있어 바꿔 넣기가 실패하면 원래 폴더를 되돌려 놓는다.)
    const old = `${tmp}-old`;
    fs.rmSync(old, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest)) fs.renameSync(dest, old);
    try {
      fs.renameSync(tmp, dest);
    } catch (e) {
      if (fs.existsSync(old)) fs.renameSync(old, dest);
      throw e;
    }
    // 바꿔 넣기는 끝났다. 옛 폴더를 못 지워도(Windows 에서 잡혀 있음) 받기는 성공이다. 남은 것은 다음 받기 때 지운다.
    try {
      fs.rmSync(old, { recursive: true, force: true });
    } catch {}
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { files: files.length, bytes: total };
};
