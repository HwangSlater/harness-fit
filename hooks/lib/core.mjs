// 훅 공통: 입력 읽기, 결과 내보내기, 프로젝트 설정·문구 불러오기, git 도우미.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { QUOTED_OR_WORD, GIT_CMD } from './cmdline.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CONFIG_FILE = path.join('.claude', 'harness.json');

export const readInput = () => {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
};

export const pass = () => {
  process.stdout.write('{}');
  process.exit(0);
};

export const deny = (reason) => {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }),
  );
  process.exit(0);
};

export const git = (cwd, args) => {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
};

export const repoRoot = (dir) => {
  const out = git(dir, ['rev-parse', '--show-toplevel']);
  return out ? path.resolve(out.trim()) : null;
};

// 프로젝트 설정. cwd 에서 위로 올라가며 .claude/harness.json 을 찾되, 저장소 맨 위(.git 이 있는 폴더)에서 멈춘다.
// 없으면 null — 이 프로젝트에서는 아무것도 하지 않는다.
// 이 훅은 플러그인을 켠 모든 프로젝트의 도구 호출마다 돌므로 git 프로세스를 띄우지 않고 파일만 본다.
export const loadConfig = (cwd) => {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    const file = path.join(dir, CONFIG_FILE);
    if (fs.existsSync(file)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
        return { root: dir, lang: cfg.lang, rules: cfg.rules || {} };
      } catch {
        return null;
      }
    }
    if (fs.existsSync(path.join(dir, '.git')) || path.dirname(dir) === dir) return null;
  }
};

export const pickLang = (cfgLang) => {
  if (cfgLang === 'ko' || cfgLang === 'en') return cfgLang;
  const sys = process.env.LANG || process.env.LC_ALL || Intl.DateTimeFormat().resolvedOptions().locale || '';
  return /^ko/i.test(sys) ? 'ko' : 'en';
};

// 문구: messages/<lang>.json. {이름} 자리를 vars 로 채운다. 없는 키는 영어 → 키 이름 순으로 대신한다.
const cache = {};
const loadMessages = (lang) => {
  if (!cache[lang]) {
    try {
      cache[lang] = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'messages', `${lang}.json`), 'utf8'));
    } catch {
      cache[lang] = {};
    }
  }
  return cache[lang];
};
export const translator = (lang) => (key, vars = {}) => {
  const text = loadMessages(lang)[key] ?? loadMessages('en')[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
};

// 명령줄 읽기 도우미는 cmdline.mjs 에 있다(규칙 파일이 core 하나만 불러도 되게 다시 내보낸다).
export { GIT, SUB_END, BASH, POWERSHELL, shellOf, stripQuoted, shortFlags, splitWords, gitSegments, dataMasked } from './cmdline.mjs';

// 명령이 도는 저장소: `cd 경로 &&` 나 `git -C 경로` 를 따른다.
const unquote = (s) => s.replace(/^["']|["']$/g, '');
export const commandCwd = (cmd, cwd) => {
  let dir = cwd;
  const cd = cmd.match(/(?:^|[;&|]\s*)cd\s+("[^"]+"|'[^']+'|\S+)\s*(?:&&|;)/);
  if (cd) dir = path.resolve(dir, unquote(cd[1]));
  const dashC = cmd.match(new RegExp(String.raw`${GIT_CMD}(?:(?:-c\s+${QUOTED_OR_WORD}|--[\w-]+(?:=${QUOTED_OR_WORD})?|-[pP])\s+)*-C\s+(${QUOTED_OR_WORD})`));
  if (dashC) dir = path.resolve(dir, unquote(dashC[1]));
  return dir;
};
