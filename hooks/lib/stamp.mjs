// 한 번만 알리는 훅의 「본 적 있음」 표시: 설정 폴더(<CLAUDE_CONFIG_DIR>/harness-fit/<훅>/<지문>.txt)에 짧은 글 하나.
// 읽지 못하면 '' (처음 보는 것), 적지 못하면 그냥 넘어간다(다음에 한 번 더 알릴 뿐 — 훅은 터지면 안 된다).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { claudeHome } from './claude-home.mjs';

// parts 를 이어 지문으로(윈도는 경로 대소문자가 같은 곳이라 소문자로 맞춘다)
export const stampFile = (hook, ...parts) => {
  const key = parts.map((p) => (process.platform === 'win32' ? String(p).toLowerCase() : String(p))).join('\0');
  return path.join(claudeHome(), 'harness-fit', hook, `${createHash('sha256').update(key).digest('hex').slice(0, 12)}.txt`);
};

export const readStamp = (file) => {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
};

export const writeStamp = (file, text) => {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  } catch {} // 적지 못하면 다음에 다시 볼 뿐
};
