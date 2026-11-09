// scripts 시험이 같이 쓰는 도우미: 임시 폴더·파일 만들기, git 저장소, 화면 설정, 규칙 글(rules/*.md)에서 기대 문장 읽기.
// 규칙 문장을 시험에 그대로 적지 않고 파일에서 읽는다 — 글을 다듬어도 시험이 함께 따라온다(시험하는 것은 「어느 줄이 들어가나」).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PLUGIN_ROOT, pickerConfig } from '../lib/paths.mjs';
import { TAG, ruleFileLines } from '../lib/rule-files.mjs';
import { fillCmd } from '../lib/claude-md.mjs';

export { PLUGIN_ROOT };
export const pickerCfg = pickerConfig();

export const tmpDir = (prefix = 'harness-test-') => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

// { 경로: 글 또는 JSON 으로 쓸 값 } → dir 에 쓴다
export const writeFiles = (dir, files) => {
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), typeof text === 'string' ? text : JSON.stringify(text));
  }
  return dir;
};

// 새 git 저장소(dir 이 없으면 만든다). branch 를 주면 첫 브랜치 이름.
export const gitInit = (dir, { branch } = {}) => {
  execFileSync('git', ['init', '-q', ...(branch ? ['-b', branch] : []), dir]);
  return dir;
};
// 그 저장소에서 git 을 부르는 함수(커밋 작성자는 시험용으로 고정)
export const gitIn = (dir) => (...args) =>
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@e.com', '-c', 'user.name=t', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

export const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const lines = (id, lang) => {
  const ls = ruleFileLines(id, lang);
  if (!ls) throw new Error(`규칙 파일 없음: rules/${id}.${lang}.md`);
  return ls;
};
// 규칙 파일 첫 줄(## 제목) 그대로 / 「## 」를 뺀 글
export const ruleTitle = (id, lang) => lines(id, lang)[0];
export const ruleHeading = (id, lang) => ruleTitle(id, lang).replace(/^#+\s*/, '');
// 표시 tag(예: '!hook:commit-msg', 'cmd:test')가 붙은 「- 」 줄(파일에 적힌 그대로)
export const ruleRawLine = (id, lang, tag) => {
  const line = lines(id, lang).find((l) => l.startsWith('- ') && (l.includes(`{{${tag}}}`) || l.includes(`{{${tag}|`)));
  if (!line) throw new Error(`rules/${id}.${lang}.md 에 {{${tag}}} 줄 없음`);
  return line;
};
// 그 줄을 CLAUDE.md 에 들어가는 꼴로(줄 끝 표시는 떼고, 명령 자리는 cmds 로 채운다)
export const ruleLine = (id, lang, tag, cmds = {}) => fillCmd(ruleRawLine(id, lang, tag).replace(TAG, ''), cmds);
