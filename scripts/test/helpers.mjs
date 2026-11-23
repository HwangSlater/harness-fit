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

// 시험 저장소 틀: 같은 꼴의 저장소를 git 으로 매번 만들지 않고, 처음 만든 .git 을 복사한다.
// Windows 에서 git 을 한 번 띄우는 데 50~100ms(전체 시험과 함께 돌면 그 배) — 저장소 하나에 init·commit 여럿이면 그것만 1초 가까이(2026-11-19).
// 복사한 .git 은 같은 PC 에서 같은 명령으로 만든 것과 같다(설정·HEAD·커밋). 틀은 프로세스가 끝날 때 지운다.
let tplRoot = null;
const templates = new Map();
const template = (key, build) => {
  if (!templates.has(key)) {
    if (!tplRoot) {
      tplRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-tpl-'));
      // 백신·색인이 .git 파일을 잡고 있어도 시험 결과가 바뀌지 않게(지우기 실패로 프로세스가 0 이 아닌 코드로 끝나던 위험 — 검토 2026-11-19)
      process.once('exit', () => {
        try {
          fs.rmSync(tplRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        } catch {}
      });
    }
    const dir = path.join(tplRoot, String(templates.size));
    build(dir);
    templates.set(key, dir);
  }
  return templates.get(key);
};
const copyGit = (tpl, dir) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(path.join(tpl, '.git'), path.join(dir, '.git'), { recursive: true });
  return dir;
};

// 새 git 저장소(dir 이 없으면 만든다). branch 를 주면 첫 브랜치 이름. 이미 .git 이 있으면(다시 init) git 을 그대로 부른다
export const gitInit = (dir, { branch } = {}) => {
  const init = (d) => execFileSync('git', ['init', '-q', ...(branch ? ['-b', branch] : []), d]);
  if (fs.existsSync(path.join(dir, '.git'))) {
    init(dir);
    return dir;
  }
  return copyGit(template(`init:${branch || ''}`, init), dir);
};
// 그 저장소에서 git 을 부르는 함수(커밋 작성자는 시험용으로 고정)
export const gitIn = (dir) => (...args) =>
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@e.com', '-c', 'user.name=t', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
// 출력 없이 git 을 부른다. 사용자 PC 의 전역 git 훅이 시험 커밋에 끼지 않게 hooksPath 를 빈 폴더로 돌린다
export const gitQuiet = (d, ...args) => execFileSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', `core.hooksPath=${path.join(d, '.nohooks')}`, ...args], { stdio: 'ignore' });
// main 브랜치에 빈 커밋 subjects(차례대로)를 둔 새 저장소. 같은 subjects 는 틀을 복사한다. branches 는 복사한 뒤 저장소마다 만든다
export const historyRepo = ({ subjects = [], branches = [], prefix = 'harness-history-' } = {}) => {
  const git = gitQuiet;
  const tpl = template(`history:${JSON.stringify(subjects)}`, (d) => {
    fs.mkdirSync(d, { recursive: true });
    git(d, 'init', '-q', '-b', 'main');
    for (const s of subjects) git(d, 'commit', '-q', '--allow-empty', '-m', s);
  });
  const dir = copyGit(tpl, tmpDir(prefix));
  for (const b of branches) git(dir, 'branch', b);
  return dir;
};

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
