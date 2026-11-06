// 훅 공통: 입력 읽기, 결과 내보내기, 프로젝트 설정·문구 불러오기, git 도우미.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { QUOTED_OR_WORD, GIT_CMD } from './cmdline.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CONFIG_FILE = path.join('.claude', 'harness.json');

// 훅 입력. 깨진 입력(JSON 아님, 배열·숫자·null)은 빈 입력으로 — 막지 않고 통과한다(쓰레기 입력에 작업을 막지 않게).
// 값의 모양도 여기서 맞춘다: tool_name·cwd 는 글자, tool_input 은 객체여야 규칙이 그대로 쓴다.
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const normalizeInput = (raw) => {
  if (!isObject(raw)) return {};
  const out = { ...raw };
  if (typeof out.tool_name !== 'string') delete out.tool_name;
  if (typeof out.cwd !== 'string' || !out.cwd || out.cwd.includes('\0')) delete out.cwd;
  out.tool_input = isObject(out.tool_input) ? strings({ ...out.tool_input }) : {};
  // edits(지금 Claude Code 에는 없는 옛 MultiEdit 꼴 — 들어와도 받아 준다): 객체만, 그 안의 칸도 글자만(모양이 틀린 입력은 Claude Code 쪽 문제라 오류 알림 없이 지나가게)
  if ('edits' in out.tool_input) {
    const edits = out.tool_input.edits;
    out.tool_input.edits = Array.isArray(edits) ? edits.filter(isObject).map((e) => strings({ ...e })) : [];
  }
  return out;
};
// 규칙이 글자로 읽는 칸은 글자가 아니면 지운다(숫자·객체 file_path 등).
const TEXT_FIELDS = ['file_path', 'notebook_path', 'path', 'content', 'new_string', 'old_string', 'new_source', 'command', 'url'];
function strings(o) {
  for (const k of TEXT_FIELDS) if (k in o && typeof o[k] !== 'string') delete o[k];
  return o;
}
export const readInput = () => {
  try {
    return normalizeInput(JSON.parse(fs.readFileSync(0, 'utf8') || '{}'));
  } catch {
    return {};
  }
};

export const pass = () => {
  process.stdout.write('{}');
  process.exit(0);
};

// 막지 않고 사용자에게 알리기(설정이 깨졌을 때)
export const notice = (message) => {
  process.stdout.write(JSON.stringify({ systemMessage: message }));
  process.exit(0);
};

export const deny = (reason) => {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }),
  );
  process.exit(0);
};

// git 을 못 찾거나(PATH 에 없음), 저장소가 깨졌거나, 출력이 maxBuffer 를 넘으면 null.
// timeout·windowsHide 는 주지 않는다 — Windows 에서 git 한 번이 70ms → 250ms 로 느려졌다(2026-11-06 측정). 멈춘 git 은 Claude Code 의 훅 시간 한도가 끊는다.
export const git = (cwd, args, { maxBuffer = 1024 * 1024 } = {}) => {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer });
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
// 설정이 이보다 크면 손으로 쓴 설정이 아니다 — 읽지 않고 깨진 것으로 알린다(큰 파일을 도구 호출마다 읽지 않게).
export const MAX_CONFIG_BYTES = 256 * 1024; // 고르기 화면(scripts/lib/picker-state.mjs)도 같은 한도로 읽는다
export const loadConfig = (cwd) => {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    const file = path.join(dir, CONFIG_FILE);
    if (fs.existsSync(file)) {
      try {
        if (fs.statSync(file).size > MAX_CONFIG_BYTES) throw new Error('too big');
        const cfg = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
        // rules 는 { 훅 id: true | false | { 옵션 } } 이어야 한다. 모양이 다르면(배열·글자) 깨진 설정으로 알린다.
        if (!isObject(cfg) || (cfg.rules !== undefined && !isObject(cfg.rules))) throw new Error('shape');
        return { root: dir, lang: cfg.lang, rules: cfg.rules || {} };
      } catch {
        // 깨진 설정은 「검사 없음」으로 조용히 넘기지 않는다 — 모든 검사가 꺼진 줄 모르게 된다(2026-11-05 검토). 막지는 않고 알린다(고치는 쓰기까지 막지 않게).
        return { root: dir, lang: undefined, rules: {}, broken: file };
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

// 검사가 오류로 멈췄다는 알림 한 줄(run.mjs · entry.mjs 가 함께 쓴다). errors: 터진 규칙 id 들, '*' 는 바깥에서 터짐.
// t 가 없으면(설정을 읽기 전에 터짐) 시스템 언어로.
export const crashNotice = (errors, t) => {
  const say = t || translator(pickLang());
  return errors.includes('*') ? say('hook.crashed') : say('hook.ruleCrashed', { ids: errors.join(', ') });
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
