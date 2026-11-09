// 규칙 조각 파일(rules/<id>.<lang>.md) 읽기와 줄 끝 표시. CLAUDE.md 문장 만들기(claude-md.mjs)와 토큰 어림(tokens.mjs)이 같이 쓴다.
// 줄 끝 표시: {{hook:id}} 켜졌을 때만 · {{!hook:id}} 꺼졌을 때만 · {{!skill:a|b}} 그 스킬이 없을 때만 · {{judge}} 늘(claude-md.mjs 머리 설명).
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_ROOT } from './paths.mjs';

// m[1] = '!'(꺼졌을 때만) 또는 '', m[2] = hook|skill(judge 면 비어 있음), m[3] = id 들(| 로 이음)
export const TAG = /\s*\{\{(?:(!?)(hook|skill):([\w|-]+)|judge)\}\}\s*$/;

const FILE = /^(.+)\.(ko|en)\.md$/;

// 규칙 하나의 줄들. 파일이 없으면 null.
export const ruleFileLines = (id, lang, root = PLUGIN_ROOT) => {
  const file = path.join(root, 'rules', `${id}.${lang}.md`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : null;
};

// 그 언어의 규칙 파일 모두 → [[id, 줄들]](폴더에 있는 순서)
export const ruleFiles = (lang, root = PLUGIN_ROOT) => {
  const out = [];
  for (const f of fs.readdirSync(path.join(root, 'rules'))) {
    const m = f.match(FILE);
    if (m && m[2] === lang) out.push([m[1], fs.readFileSync(path.join(root, 'rules', f), 'utf8').split(/\r?\n/)]);
  }
  return out;
};
