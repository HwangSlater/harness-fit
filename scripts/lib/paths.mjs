// 플러그인 폴더·JSON 읽기·폴더 훑기. scripts 여러 곳이 같은 꼴로 쓰던 것을 한 곳에 모았다(카탈로그·설정·스킬 폴더).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const BOM = /^﻿/;

// 사용자 파일(설정·package.json 등): 없거나 깨졌으면 null. 메모장이 붙이는 BOM 은 떼고 읽는다.
export const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(BOM, ''));
  } catch {
    return null;
  }
};

// 플러그인에 들어 있는 파일(카탈로그·config): 없거나 깨졌으면 플러그인이 망가진 것이라 그대로 오류를 낸다.
export const readPluginJson = (rel) => JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, rel), 'utf8').replace(BOM, ''));

// config/picker.json(화면·적용·GitHub 이 함께 쓰는 값). 한 프로세스에서 여러 번 불려도 한 번만 읽는다.
let picker;
export const pickerConfig = () => (picker ||= readPluginJson(path.join('config', 'picker.json')));

// 폴더 안 항목. 링크(심볼릭 링크·Windows 정션)는 가리키는 곳이 폴더·파일인지 본다 — 스킬 폴더는 링크로 둔 경우가 많다.
// 못 읽는 폴더는 빈 목록, 끊어진 링크는 뺀다.
export const entries = (dir) => {
  let list;
  try {
    list = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const d of list) {
    const p = path.join(dir, d.name);
    let isDir = d.isDirectory();
    let isFile = d.isFile();
    if (d.isSymbolicLink()) {
      try {
        const st = fs.statSync(p);
        isDir = st.isDirectory();
        isFile = st.isFile();
      } catch {
        continue;
      }
    }
    out.push({ name: d.name, path: p, isDir, isFile });
  }
  return out;
};

// 하위 폴더(링크 포함)
export const subdirs = (dir) => entries(dir).filter((e) => e.isDir);

// 아래 폴더까지 훑어 맞는 파일 경로. maxDepth·maxFiles 를 넘으면 멈춘다(링크가 돌아 들어오는 폴더도 끝이 있게).
export const walkFiles = (dir, { match = () => true, maxDepth = Infinity, maxFiles = Infinity } = {}, depth = 0, out = []) => {
  if (depth > maxDepth || out.length >= maxFiles) return out;
  for (const e of entries(dir)) {
    if (out.length >= maxFiles) break;
    if (e.isDir) walkFiles(e.path, { match, maxDepth, maxFiles }, depth + 1, out);
    else if (e.isFile && match(e.name)) out.push(e.path);
  }
  return out;
};
