// 문서 형식 검사(docs-check). 형식 규칙은 lib/docs-format.mjs.
//   쓰기(Write·Edit): docs/ 에 문서(.md)·그림이 아닌 파일을 쓰지 못하게 막는다(비밀값·메모 파일이 문서 폴더로 들어가지 않게).
//   끝낼 때(Stop): 커밋하지 않은 docs/ 변경 + 이번 사람 턴에 커밋한 docs/ 변경의 형식·목차를 보고, 어긋나면 한 번 되묻는다.
//   셸로 쓴 파일도 이때 잡는다. git 저장소가 아니면 끝낼 때 검사는 하지 않는다.
import path from 'node:path';
import { git } from '../lib/core.mjs';
import { targetFile } from '../lib/lines.mjs';
import { DOCS_DIR, inDocs, isDocFile, slash, docsProblems } from '../lib/docs-format.mjs';
import { turnCommits } from '../lib/turn-commits.mjs';
import { findRepo } from '../lib/repo-files.mjs';
import { turnOf, markOf } from './turn.mjs';

const MAX_SHOWN = 6;

// 프로젝트 기준 경로(프로젝트 밖이면 null)
const relTo = (project, file, cwd) => {
  const rel = path.relative(project, path.resolve(cwd || project, file));
  return !rel || rel.startsWith('..') || path.isAbsolute(rel) ? null : slash(rel);
};

export const docsWrite = {
  id: 'docs-check',
  on: 'write',
  check({ input, cwd, project, t }) {
    const file = targetFile(input.tool_input || {});
    const rel = file && project ? relTo(project, file, cwd) : null;
    if (!rel || !inDocs(rel) || isDocFile(rel)) return null;
    return t('docs.notDocWrite', { file: rel, dir: DOCS_DIR });
  },
};

const lines = (out) => (out || '').split('\n').map((s) => s.trim()).filter(Boolean);
// git 저장소 안인가: .git 을 파일로 찾고, 애매할 때만 git 에게(lib/repo-files.mjs)
const inRepo = (dir) => {
  const found = findRepo(dir);
  return found === undefined ? git(dir, ['rev-parse', '--is-inside-work-tree']) !== null : !!found;
};

// 바뀐 docs/ 파일(프로젝트 기준): HEAD 와 다른 것(stage 한 것 포함) + 새 파일(무시 목록 밖) + 이번 턴 커밋이 바꾼 것
const changedDocs = (project, commits) => {
  const out = new Set();
  const diff = git(project, ['-c', 'core.quotepath=false', 'diff', '--name-only', '--relative', '--no-renames', 'HEAD', '--', DOCS_DIR]);
  if (diff === null) {
    // 커밋이 없는 저장소: 색인에 올린 것을 모두 바뀐 것으로
    lines(git(project, ['-c', 'core.quotepath=false', 'ls-files', '--', DOCS_DIR])).forEach((f) => out.add(f));
  } else lines(diff).forEach((f) => out.add(f));
  lines(git(project, ['-c', 'core.quotepath=false', 'ls-files', '--others', '--exclude-standard', '--', DOCS_DIR])).forEach((f) => out.add(f));
  if (commits.length) {
    const log = git(project, ['-c', 'core.quotepath=false', 'log', '--no-walk=unsorted', '--format=', '--name-only', '--relative', '--no-renames', ...commits.map((c) => c.hash), '--', DOCS_DIR]);
    lines(log).forEach((f) => out.add(f));
  }
  return [...out].map(slash).filter(inDocs);
};

export const docsStop = {
  id: 'docs-check',
  on: 'stop',
  check({ input, project, opts, t, shared }) {
    if (!project || !inRepo(project)) return null;
    const turn = turnOf(input, shared);
    const commits = turn && Number.isFinite(turn.since) ? turnCommits(project, turn.since, shared) : [];
    const changed = changedDocs(project, commits);
    if (!changed.length) return null;
    const problems = docsProblems(project, changed, { dateLine: opts.dateLine !== false });
    if (!problems.length) return null;
    const shown = problems.slice(0, MAX_SHOWN).map((p) => `- ${t(p.key, p.vars)}`);
    if (problems.length > MAX_SHOWN) shown.push(t('list.more', { n: problems.length - MAX_SHOWN }));
    return `${markOf('docs-check')} ${t('docs.stop', { list: shown.join('\n') })}`;
  },
};

export default [docsWrite, docsStop];
