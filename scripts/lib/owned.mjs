// harness-fit 이 넣은 것인지 가리기: 프로젝트 안 경로(연결을 따라 밖으로 나가지 않는다)와 받은 그대로인 스킬 폴더.
// 지우기(scripts/lib/remove.mjs)와 다시 적용(plan.mjs — 고르지 않게 된 스킬 빼기)이 함께 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// 받은 스킬 폴더의 출처 표시(scripts/lib/install-skill.mjs 가 쓴다 — files 에 받은 파일마다 sha256)
export const SOURCE_FILE = '.harness-source.json';
// 스킬 폴더 하나를 훑는 한도. 이보다 많으면 받은 그대로가 아니다(받기 한도도 이보다 훨씬 작다 — install-skill.mjs MAX_FILES)
const MAX_WALK = 2000;

const lstat = (p) => {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
};
export const isLink = (st) => !!st && st.isSymbolicLink();

// 프로젝트 안의 경로 → { abs, st }(st 는 끝 자리 lstat, 없으면 null). 루트 밖이거나 가는 길의 폴더가
// 연결(심볼릭 링크·Windows 정션 — Node 는 둘 다 isSymbolicLink)이면 null: 밖을 가리킬 수 있어 따라가지 않는다.
// 끝 자리가 연결이면 st 로 알 수 있다 — 부르는 쪽이 지우지 않고 알린다.
export const within = (root, rel) => {
  const base = path.resolve(root);
  const abs = path.resolve(base, rel);
  const r = path.relative(base, abs);
  if (!r || r === '..' || r.startsWith(`..${path.sep}`) || path.isAbsolute(r)) return null;
  let cur = base;
  for (const part of r.split(path.sep).slice(0, -1)) {
    cur = path.join(cur, part);
    const st = lstat(cur);
    if (!st) return { abs, st: null }; // 가는 길이 없으면 끝도 없다
    if (st.isSymbolicLink() || !st.isDirectory()) return null;
  }
  return { abs, st: lstat(abs) };
};

const hashFile = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// 받은 스킬 폴더의 상태 →
//   'clean'        받은 그대로(.harness-source.json 의 files 와 파일 목록·내용이 같다)
//   'edited'       고쳤거나 파일을 더하거나 지웠다
//   'unverifiable' 지문 기록이 없다(v0.4.0 전에 받은 폴더) — 받은 그대로인지 알 수 없다
//   'link'         폴더나 안의 항목이 연결이다(harness-fit 은 연결을 만들지 않는다 — 따라가지 않는다)
//   null           폴더가 없다
export const skillState = (dir) => {
  const st = lstat(dir);
  if (!st) return null;
  if (st.isSymbolicLink() || !st.isDirectory()) return 'link';
  let want = null;
  try {
    const src = JSON.parse(fs.readFileSync(path.join(dir, SOURCE_FILE), 'utf8'));
    if (src?.files && typeof src.files === 'object' && !Array.isArray(src.files)) want = src.files;
  } catch {}
  let link = false;
  let edited = false;
  let count = 0;
  const seen = new Set();
  const walk = (d, rel) => {
    for (const name of fs.readdirSync(d)) {
      if (link) return;
      if (++count > MAX_WALK) { edited = true; return; }
      const abs = path.join(d, name);
      const r = rel ? `${rel}/${name}` : name;
      const s = fs.lstatSync(abs);
      if (s.isSymbolicLink()) { link = true; return; }
      if (s.isDirectory()) walk(abs, r);
      else if (r !== SOURCE_FILE) {
        seen.add(r);
        if (want && want[r] !== hashFile(abs)) edited = true;
      }
    }
  };
  walk(dir, '');
  if (link) return 'link';
  if (!want) return 'unverifiable';
  if (edited || Object.keys(want).some((k) => !seen.has(k))) return 'edited';
  return 'clean';
};

// 폴더 이름이 받은 스킬 id 인가. 출처 표시의 id(v0.4.2 부터 적는다)로, 없으면 SKILL.md 머리말 name(받을 때 id 로 맞춘다 —
// install-skill.mjs setSkillName)으로 본다. 받은 스킬을 다른 이름(my-copy)으로 복사한 폴더를 우리 것으로 보고 지우던 일(검토 2026-11-16).
// → true · false(다른 이름) · null(둘 다 없어 알 수 없음)
const FRONT = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const namedAs = (dir, name) => {
  let src;
  try {
    src = JSON.parse(fs.readFileSync(path.join(dir, SOURCE_FILE), 'utf8'));
  } catch {}
  if (typeof src?.id === 'string') return src.id === name;
  let md;
  try {
    md = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
  } catch {
    return null;
  }
  const line = md.match(FRONT)?.[1].match(/^name:[ \t]*(.*)$/m);
  return line ? line[1].trim().replace(/^(["'])(.*)\1$/, '$2') === name : null;
};

// .claude/skills 아래 harness-fit 이 받은 스킬 폴더(출처 표시가 있는 것) → [{ id, abs, state }]
// state 는 skillState 의 것에 더해 'not-ours'(폴더 이름이 받은 스킬 id 가 아니다). 이름을 알 수 없으면 'unverifiable'.
// 연결인 폴더는 안을 훑지 않는다 — 출처 표시가 있는지만 보고(읽기만) 있으면 'link' 로 돌려준다(지우지 않고 알리게).
// skip: 훑지 않을 id(다시 적용에서 고른 스킬 — 미리보기마다 도는데 고른 스킬의 지문은 볼 일이 없다)
export const ownedSkills = (root, skip = new Set()) => {
  const at = within(root, path.join('.claude', 'skills', '_'));
  if (!at) return null; // .claude 나 skills 가 연결이다
  const dir = path.dirname(at.abs);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const id of names.sort()) {
    if (skip.has(id)) continue;
    const abs = path.join(dir, id);
    const st = lstat(abs);
    if (!st) continue;
    if (st.isSymbolicLink()) {
      if (fs.existsSync(path.join(abs, SOURCE_FILE))) out.push({ id, abs, state: 'link' });
      continue;
    }
    if (!st.isDirectory() || !fs.existsSync(path.join(abs, SOURCE_FILE))) continue;
    const state = skillState(abs);
    const named = state === 'link' ? true : namedAs(abs, id); // 연결 안은 읽지 않는다(skillState 가 이미 link)
    out.push({ id, abs, state: named === false ? 'not-ours' : named === null && state === 'clean' ? 'unverifiable' : state });
  }
  return out;
};
