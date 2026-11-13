// 보호 파일 훅의 셸 쪽(rules/shell.mjs 가 400줄에 닿아 나눴다 — 2026-11-13). shell.mjs 가 이 규칙들을 함께 내보낸다.
import fs from 'node:fs';
import path from 'node:path';
import { git, repoRoot } from '../lib/core.mjs';
import { shellWrites } from '../lib/shell-writes.mjs';
import { gitWrites, askGit, wideTouched, restoresCommitted } from '../lib/git-writes.mjs';
import { forbiddenFile, foldCase, protectedBy } from '../lib/secrets.mjs';
import { isGlob, globMayHold, insideHit, skipNames } from '../lib/path-glob.mjs';
import { missingOnly } from '../lib/exist-guard.mjs';
import { substNote } from '../lib/hidden-runs.mjs';

// 보호 파일(.env·키·사용자가 적은 경로)을 셸로 바꾸거나 지우기 — Write·Edit 만 보던 빈틈(역할극 2·3·4 회차, 2026-11-11).
// 커밋에 들어가는지는 rules/commit.mjs 가 따로 본다.
// 끝의 글롭(*·**)과 / 를 뗀다 — 정규식 대신 끝에서 한 글자씩(아주 긴 「////…」 에서 정규식이 제곱 시간이 걸렸다, ReDoS 시험)
const trimTail = (p) => {
  let end = p.length;
  while (end > 0 && p[end - 1] === '*') end--;
  while (end > 0 && (p[end - 1] === '/' || p[end - 1] === '\\')) end--;
  return p.slice(0, end);
};
// 글롭 보호 경로(*.tfstate*)를 품을 수 있는 폴더를 지울 때는 실제 안의 파일을 훑어 맞는 것을 찾는다(lib/path-glob.mjs — 이름만으로는 모른다)
// 흔한 이름의 도구 폴더(dist·build·target …) 안에서 맞은 파일을 칠지: 그 폴더를 git 이 무시하고 그 파일을 추적하지 않으면 안 친다.
// git 은 지우기 명령 하나에 두 번만: 후보 폴더를 모두 모아 check-ignore --stdin 한 번, 무시된 폴더의 후보 파일을 ls-files 한 번
// (명령줄 길이 때문에 LS_CHUNK 자마다 나눈다). 폴더마다 부르던 때는 packages/p0…p299/dist 에서 26초(세 번째 검토 2026-11-12).
// git 을 못 부르면 친다(지키는 쪽)
const LS_CHUNK = 8000;
const trackedOf = (root, files) => {
  const out = new Set();
  for (let i = 0; i < files.length;) {
    const part = [];
    for (let len = 0; i < files.length && (len === 0 || len + files[i].length < LS_CHUNK); i++) { part.push(files[i]); len += files[i].length + 1; }
    const got = git(root, ['ls-files', '-z', '--', ...part.map((f) => `:(literal)${f}`)]);
    if (got === null) return null;
    for (const f of got.split('\0')) if (f) out.add(f);
  }
  return out;
};
const gitKeep = (root) => ({
  first(cands) {
    const roots = [...new Set(cands.map((c) => c.root))];
    const out = git(root, ['check-ignore', '--stdin', '-z'], { input: roots.map((d) => `${d}/`).join('\0') + '\0', okCodes: [1] });
    if (out === null) return cands[0].rel;
    const ignored = new Set(out.split('\0').filter(Boolean).map((d) => d.replace(/\/+$/, '')));
    const inIgnored = cands.filter((c) => ignored.has(c.root));
    const tracked = inIgnored.length ? trackedOf(root, inIgnored.map((c) => c.rel)) : new Set();
    if (!tracked) return cands[0].rel;
    return cands.find((c) => !ignored.has(c.root) || tracked.has(c.rel))?.rel ?? null;
  },
});
const globInside = (abs, rel, extra, root) => {
  const globs = extra.filter((g) => isGlob(String(g)) && globMayHold(foldCase(String(g).replace(/\\/g, '/').trim()), foldCase(rel)));
  if (!globs.length) return null;
  // 도구가 만드는 폴더(lib/path-glob.mjs): .terraform·node_modules 같은 것은 지워도 안을 보지 않고, dist·build 같은 흔한 이름은 git 이 무시하는지 본다
  const skip = skipNames(globs.map((g) => String(g).replace(/\\/g, '/').trim()));
  if (rel.split('/').some((p) => skip.always.has(p.toLowerCase()))) return null;
  if (!fs.statSync(abs, { throwIfNoEntry: false })?.isDirectory()) return null;
  return insideHit(abs, rel, (r) => globs.some((g) => protectedBy(r, g)), skip, undefined, gitKeep(root));
};
// 이 쓰기가 같은 경로의 「없을 때만」 구간 안인가(바깥 명령 조각만 — 숨은 실행은 자리를 견줄 수 없다)
const guardedMissing = (cmd, shell, here, w, abs) => w.at !== undefined
  && missingOnly(cmd, shell).some((g) => g.from < w.at && w.at < g.to && foldCase(path.resolve(here, trimTail(g.path) || '.')) === foldCase(abs));
// restoring: false — 셸 쓰기·지우기와 git 의 쓰기(HEAD·stage 에서 되돌리기는 뺌). true — HEAD·stage 에서 되돌리기만(묻기, 아래 protectedRestore)
const protectedHit = ({ cmd, shell, cwd, project, root: repo, opts, t }, restoring) => {
  const extra = Array.isArray(opts.paths) ? opts.paths : [];
  const here = cwd || process.cwd();
  const root = project || here;
  const key = restoring ? 'protected.restore' : 'protected.shell';
  // git rm·mv·checkout -- 경로·restore·clean -f 경로도(역할극 8·11 회차). rm --cached 와 restore --staged(HEAD 에서)는 stage 만 바꿔 뺀다.
  const gitOnes = gitWrites(cmd, shell, here).filter((w) => !w.cached && w.op !== 'stage' && restoresCommitted(w) === restoring);
  // 넓은 pathspec(.·글롭·:/)과 checkout·restore 의 폴더는 git 이 푼 실제 파일로 본다 — rm 은 지울 추적 파일,
  // checkout·restore 는 내용이 실제로 바뀌는 파일만(lib/git-writes.mjs wideTouched, 검토 2026-11-11)
  let top;
  for (const w of gitOnes.filter((x) => askGit(x, here))) {
    const files = wideTouched(w, here);
    if (!files?.length) continue;
    top ??= repo || repoRoot(here);
    if (!top) break;
    for (const f of files) {
      const rel = path.relative(root, path.join(top, f)).replace(/\\/g, '/');
      const why = forbiddenFile(rel.startsWith('..') ? f : rel, extra);
      if (why) return t(key, { file: rel.startsWith('..') ? f : rel, why: t(why) });
    }
  }
  for (const w of [...(restoring ? [] : shellWrites(cmd, shell)), ...gitOnes]) {
    // 프로젝트 맨 위 기준 경로로 맞춘다(절대 경로·cd 한 폴더·끝의 /* 글롭 — 검토 2026-11-11). 프로젝트 밖이면 원래 글 그대로 본다.
    const abs = path.resolve(here, trimTail(w.file) || '.');
    const rel = path.relative(root, abs).replace(/\\/g, '/');
    const inRepo = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
    const target = inRepo ? rel : w.file;
    // 지우는 대상이 보호 경로를 품은 폴더면(rm -rf data 로 data/raw 가 사라짐) 그 보호 경로로 막는다 — 맨 위 기준 앞부분으로만(이름만 같은 다른 폴더는 아님)
    // Windows·macOS 는 대소문자를 가리지 않는다(rm -rf Data 로 data/raw 가 지워지던 일 — 검토 2026-11-11)
    const tidy = (g) => foldCase(String(g).replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/+$/, ''));
    const inside = w.op === 'delete' && inRepo ? extra.find((g) => !isGlob(String(g)) && tidy(g).startsWith(`${foldCase(rel)}/`)) || globInside(abs, rel, extra, root) : null;
    const why = forbiddenFile(target, extra) || (inside ? 'file.protected' : null);
    if (!why) continue;
    const note = w.subst ? substNote(t, shell) : '';
    // 값 없는 빈 .env 만들기(New-Item .env)는 앞에서 없는지 확인한 구간 안일 때만 처음 만들기로 본다 — 사용자가 적은 보호 경로는 그대로 막는다
    if (w.empty && why === 'file.env' && guardedMissing(cmd, shell, here, w, abs)) continue;
    if (w.op === 'copy') {
      // 예시 파일로 처음 만드는 것(.env 가 아직 없음)·덮어쓰지 않는 복사(cp -n)는 값을 쓰지 않으니 둔다 — 덮어쓰면 gitignore 된 진짜 값을 되살릴 수 없다.
      // 「없을 때만」 은 지금 없거나, 같은 경로를 앞에서 확인해 없을 때만 도는 구간 안일 때
      // (if [ ! -f .env ]; then cp …; fi · [ -f .env ] || cp … · if (-not (Test-Path .env)) { … } — lib/exist-guard.mjs, 검토 2026-11-13)
      const fromExample = w.from.length > 0 && w.from.every((f) => /\.(?:example|sample|template)$/i.test(f));
      const exists = fs.existsSync(abs);
      const guarded = exists && guardedMissing(cmd, shell, here, w, abs);
      if (w.noClobber || (fromExample && (!exists || guarded))) continue;
      if (exists && !guarded) return t('protected.overwrite', { file: w.file, why: t(why) }) + note;
    }
    return t(key, { file: inside || w.file, why: t(why) }) + note;
  }
  return null;
};
export const protectedShell = { id: 'protected-files', on: 'shell', check: (ctx) => protectedHit(ctx, false) };
// 보호 파일을 커밋된 판(HEAD)이나 stage 의 판으로 되돌리기(git checkout -- 파일 · git restore 파일 · --source=HEAD)는 막지 않고 묻는다 —
// 역할극 16 회차 다시(2026-11-13): Xcode 가 바꾼 project.pbxproj 를 되돌리지 못했다. 다만 사용자가 손으로 고친 값을 버리는 일이기도 해서
// (역할극 8·11 회차) 그냥 두지 않고 확인 창을 띄운다. 다른 커밋·브랜치에서 가져오기는 그대로 막는다(protectedShell)
export const protectedRestore = { id: 'protected-files', on: 'shell', ask: true, check: (ctx) => protectedHit(ctx, true) };

export default [protectedShell, protectedRestore];
