// 작업 체크리스트(work-checklist): 보여 주기만 하고 막지 않는다.
//   세션 시작(SessionStart): 이 프로젝트·세션의 체크리스트 파일 경로를 Claude 에게 알려 준다(매 턴이 아니라 시작 때만 — 토큰을 아끼려고).
//   사람 메시지(UserPromptSubmit): 그 파일에 남은 「- [ ]」 항목이 있으면 짧게 보여 준다. 없으면 아무것도 넣지 않는다(토큰 0).
// 파일은 ~/.claude/harness-fit/checklists/<프로젝트>/<세션>.md — 사용자 전역 ~/.claude/checklists/ 와 겹치지 않는 자리.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { claudeHome } from '../lib/claude-home.mjs';

export const LIST_MAX = 5;
const MAX_READ = 256 * 1024;
const UNCHECKED = /^[ \t]*[-*][ \t]+\[ \][ \t]+(\S.*)$/gm;
const SLUG_MAX = 40;

// 프로젝트 폴더 → 폴더 이름(읽을 수 있는 앞부분 + 겹치지 않게 경로 지문 8자)
const projectSlug = (project) => {
  const abs = path.resolve(project);
  const norm = process.platform === 'win32' ? abs.toLowerCase() : abs;
  const tail = path.basename(abs).replace(/[^\w.-]+/g, '-').slice(0, SLUG_MAX) || 'root';
  return `${tail}-${createHash('sha256').update(norm).digest('hex').slice(0, 8)}`;
};
const safeSession = (id) => (typeof id === 'string' ? id.replace(/[^\w-]/g, '').slice(0, 128) : '');

// Claude 설정 폴더(CLAUDE_CONFIG_DIR, 없으면 ~/.claude) 아래에 둔다. home 을 주면(시험) 그 아래 .claude.
export const checklistFile = (project, sessionId, home) => {
  const sid = safeSession(sessionId);
  return sid ? path.join(claudeHome(home), 'harness-fit', 'checklists', projectSlug(project), `${sid}.md`) : null;
};

export const uncheckedItems = (text) => [...String(text || '').matchAll(UNCHECKED)].map((m) => m[1].trim());

export const checklistStart = {
  id: 'work-checklist',
  on: 'session-start',
  check({ input, project, t }) {
    const file = checklistFile(project, input.session_id);
    if (!file) return null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    return t('checklist.start', { file });
  },
};

export const checklistRemind = {
  id: 'work-checklist',
  on: 'prompt',
  check({ input, project, t }) {
    const file = checklistFile(project, input.session_id);
    if (!file) return null;
    let text;
    try {
      const st = fs.statSync(file);
      if (!st.isFile()) return null;
      const fd = fs.openSync(file, 'r');
      try {
        const buf = Buffer.alloc(Math.min(st.size, MAX_READ));
        fs.readSync(fd, buf, 0, buf.length, 0);
        text = buf.toString('utf8');
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return null; // 아직 파일이 없다(적은 것이 없다)
    }
    const left = uncheckedItems(text);
    if (!left.length) return null;
    const items = left.slice(0, LIST_MAX).map((x) => `- ${x}`).join('\n');
    const more = left.length > LIST_MAX ? `\n${t('list.more', { n: left.length - LIST_MAX })}` : '';
    return t('checklist.left', { file, n: left.length, items: items + more });
  },
};

export default [checklistStart, checklistRemind];
