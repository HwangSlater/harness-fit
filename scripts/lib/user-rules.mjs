// 사용자가 직접 쓴 Claude Code 규칙 파일(.claude/rules/**/*.md — 프로젝트와 ~/.claude/rules/).
// paths 가 없는 규칙은 CLAUDE.md 처럼 매 대화에 읽히므로, harness-fit 지침이 같은 말을 또 넣지 않게 견줄 글에 더한다
// (code.claude.com/docs/en/memory 「Organize rules with .claude/rules/」). 읽기만 하고, 못 읽는 파일은 건너뛴다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeHome } from '../../hooks/lib/claude-home.mjs';
import { walkFiles } from './paths.mjs';
import { parseFrontmatter } from './skill-meta.mjs';

// 견줄 글은 대화에 들어가므로 모아서 이 크기까지만(나머지는 잘림 표시)
export const MAX_RULES_CHARS = 20000;
const MAX_FILES = 200;
const MAX_DEPTH = 6;

const mdFiles = (dir) => walkFiles(dir, { match: (name) => name.endsWith('.md'), maxDepth: MAX_DEPTH, maxFiles: MAX_FILES });

// 앞머리의 paths(있으면 그 경로를 다룰 때만 읽히는 규칙). 한 줄 값은 적힌 그대로, 목록은 「a, b」.
const pathsOf = (text) => {
  const { fields, raw } = parseFrontmatter(text);
  return raw.paths || fields.paths || null;
};

// 홈 아래 경로는 ~ 로 줄여 보여 준다(CLAUDE_CONFIG_DIR 이 홈 밖이면 그대로)
const tilde = (home, p) => {
  const r = path.relative(home, p);
  return r && !r.startsWith('..') && !path.isAbsolute(r) ? path.join('~', r) : p;
};

// → [{ scope: 'project'|'user', file: 표시용 경로, paths?: '…', text }]. harness-fit 이 쓰는 이름(harness-fit-*)은 뺀다.
// home: 시험이 임시 홈을 넘긴다. 안 주면 CLAUDE_CONFIG_DIR → ~/.claude.
export const listUserRules = (root, home) => {
  const sources = [
    ['project', path.join(root, '.claude', 'rules'), (p) => path.relative(root, p)],
    ['user', path.join(claudeHome(home), 'rules'), (p) => tilde(home || os.homedir(), p)],
  ];
  const out = [];
  let budget = MAX_RULES_CHARS;
  for (const [scope, dir, show] of sources) {
    for (const f of mdFiles(dir)) {
      if (path.basename(f).startsWith('harness-fit')) continue;
      let text;
      try {
        text = fs.readFileSync(f, 'utf8');
      } catch {
        continue;
      }
      if (budget <= 0) break;
      const body = text.length > budget ? `${text.slice(0, budget)}\n…(잘림)` : text;
      budget -= body.length;
      const paths = pathsOf(text);
      out.push({ scope, file: show(f).split(path.sep).join('/'), ...(paths ? { paths } : {}), text: body.trim() });
    }
  }
  return out;
};

// 명령 찾기처럼 글자만 필요할 때: 모든 사용자 규칙 글을 한 덩어리로
export const userRulesText = (root, home) => listUserRules(root, home).map((r) => r.text).join('\n');
