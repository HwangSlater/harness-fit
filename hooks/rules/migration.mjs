// 이미 커밋한(= 어딘가에 적용됐을) DB 마이그레이션 파일을 고치기·이름 바꾸기·지우기 막기(migration-edit).
// 역할극 8(Spring·Flyway)·9(Django) 회차: 가장 걱정한 것이 적용된 마이그레이션 고치기였다. protected-files 는 파일을 하나씩 적어야 해서
// 새 V3 를 손으로 더해야 했고, git mv·git rm 은 보지 않았다(2026-11-11).
// 마이그레이션 꼴(경로)만 본다 — 아래 MIGRATION. 새 마이그레이션 만들기, 아직 커밋하지 않은 마이그레이션 고치기는 둔다.
// 쓰기·셸 검사의 git 은 경로가 마이그레이션처럼 보일 때만 부른다(명령 하나에 ls-tree 한 번 — 보통 명령은 git 을 띄우지 않는다).
// 폴더를 통째로 보는 것은 지우거나 옮길 때(rm -r·git rm -r·mv 폴더)뿐이다. 폴더 「안으로」 복사·옮기기는 그 안에 생길 파일 이름으로,
// 글롭은 커밋한 마이그레이션 이름에 맞춰 본다(rm migrations/*.pyc 를 막던 일 — 검토 2026-11-11).
// git add·git commit 은 이 명령 자신이 올리는 것(같은 명령의 git add·commit -a·commit <경로>)만 이름으로 본다(staged.mjs commandStages —
// 작업 트리 이름 목록 한 번 + 마이그레이션이 있으면 ls-tree 한 번). 이미 stage 돼 있던 것은 사용자가 올렸을 수 있어 보지 않는다.
// git pre-commit 훅에는 넣지 않는다 — 사람은 마이그레이션을 합치기(squash)도 한다.
import fs from 'node:fs';
import path from 'node:path';
import { git, repoRoot } from '../lib/core.mjs';
import { shellWrites } from '../lib/shell-writes.mjs';
import { gitWrites } from '../lib/git-writes.mjs';
import { targetFile, normPath } from '../lib/lines.mjs';
import { commandStages, stageSources, once } from '../lib/staged.mjs';

// 도구별 마이그레이션 파일(경로를 / 로 맞춘 뒤 본다). 폴더 이름은 정확히 맞춘다(대소문자도 — 도구들이 그 이름만 읽는다).
//   flyway: db/migration 아래(하위 폴더도) V<버전>__<설명>.sql · Java·Kotlin 마이그레이션 V<버전>__<이름>.java·.kt
//           R__ 반복 마이그레이션은 바뀔 때마다 다시 도는 것이라 뺀다.
//   django: migrations/<숫자>_<이름>.py (__init__.py 는 아님)
//   alembic: alembic/versions/*.py · migrations/versions/*.py(Flask-Migrate) — __init__.py 는 아님
//   prisma: prisma/migrations/<폴더>/migration.sql
//   rails:  db/migrate/<숫자>_<이름>.rb
const MIGRATION = [
  ['flyway', /(?:^|\/)db\/migration\/(?:[^/]+\/)*V\d[^/]*\.(?:sql|java|kt)$/, (base) => base.includes('__')],
  ['django', /(?:^|\/)migrations\/\d+_[^/]+\.py$/],
  ['alembic', /(?:^|\/)(?:alembic|migrations)\/versions\/[^/]+\.py$/, (base) => base !== '__init__.py'],
  ['prisma', /(?:^|\/)prisma\/migrations\/[^/]+\/migration\.sql$/],
  ['rails', /(?:^|\/)db\/migrate\/\d+_[^/]+\.rb$/],
  // goose(00001_x.sql·.go)·golang-migrate(000001_x.up.sql)·dbmate — migrations/<숫자>_<이름>.sql|.go (역할극 14 회차, 2026-11-12)
  ['sql', /(?:^|\/)migrations\/\d+_[^/]+\.(?:sql|go)$/],
];
// 경로 → 도구 이름 또는 null
export const migrationKind = (file) => {
  const p = normPath(file);
  const base = p.slice(p.lastIndexOf('/') + 1);
  for (const [kind, re, more] of MIGRATION) if (re.test(p) && (!more || more(base))) return kind;
  return null;
};
// 마이그레이션을 품은 폴더(rm -rf db/migrate · git rm -r migrations 로 통째로 지우기). 이 이름일 때만 안을 git 에 물어본다.
const MIGRATION_DIR = /(?:^|\/)(?:db\/migration|db\/migrate|migrations|alembic\/versions|migrations\/versions|prisma\/migrations(?:\/[^/]+)?)\/?$/;

// 저장소 맨 위(필요할 때 한 번만 찾는다). 셸 명령에 git 이 없으면 judge 가 root 를 주지 않는다.
const rootOf = (ctx) => ctx.root || repoRoot(ctx.project || ctx.cwd || process.cwd());
const relTo = (root, cwd, f) => path.relative(root, path.resolve(cwd, f)).split(path.sep).join('/');
const inRepo = (rel) => rel && !rel.startsWith('../') && rel !== '..' && !path.isAbsolute(rel);

// HEAD 에 있는 경로들(한 번에 묻는다). 폴더를 주면 그 안의 파일도 나온다. HEAD 가 없으면(첫 커밋 전) 빈 목록.
const inHead = (root, rels) => {
  if (!rels.length) return [];
  const out = git(root, ['--literal-pathspecs', 'ls-tree', '-r', '--name-only', '-z', 'HEAD', '--', ...rels], { maxBuffer: 8 * 1024 * 1024 });
  return (out || '').split('\0').filter(Boolean);
};

// ── 셸·쓰기 대상 → 물어볼 것 ─────────────────────
// 대상 하나(shell-writes 꼴 { file, op, from, recursive, noClobber })를 절대 경로 기준으로 본다(cd 한 폴더·.. 도 맞게).
//   { exact }: 그 파일, { dir }: 그 폴더 안 전부(폴더째 지우기·옮기기만), { glob }: 글롭에 맞는 커밋한 파일
const GLOB = /[*?[]/;
// 글롭이 마이그레이션에 닿을 수 있는지(폴더 이름으로 먼저 거른다 — rm *.log 마다 git 을 띄우지 않게)
const NEAR = /(?:^|\/)(?:db\/migration|db\/migrate|migrations|versions)(?:\/|$)/;
const nameOf = (f) => {
  const p = normPath(f).replace(/\/+$/, '');
  return p.slice(p.lastIndexOf('/') + 1);
};
// NUL 이 든 경로 등 읽을 수 없는 이름은 폴더가 아닌 것으로(statSync 가 던진다)
const isDir = (abs) => {
  try {
    return fs.statSync(abs, { throwIfNoEntry: false })?.isDirectory() ?? false;
  } catch {
    return false;
  }
};
// 보내는 쪽 → 받는 폴더 안에 생길 이름들. 끝 낱말만 글롭이면 그 폴더를 한 번 읽어 맞춘다(한 폴더 4000개까지 — 넘으면 앞 4000개만).
// 앞 폴더에 글롭이 있으면(a/*/b) 풀지 않는다.
const MAX_LIST = 4000;
const landingNames = (f, cwd) => {
  const name = nameOf(f);
  if (!GLOB.test(name)) return [name];
  const p = normPath(f).replace(/\/+$/, '');
  const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '.';
  if (GLOB.test(dir)) return [];
  let names = [];
  try {
    names = fs.readdirSync(path.resolve(cwd, dir || '/')).slice(0, MAX_LIST);
  } catch {
    return [];
  }
  const re = globRe(name, false);
  return names.filter((n) => re.test(n) && (name.startsWith('.') || !n.startsWith('.')));
};
const queriesOf = (w, cwd) => {
  const raw = normPath(w.file);
  const abs = normPath(path.resolve(cwd, w.file));
  if (raw.startsWith(':')) return []; // git 의 :/ 같은 마법 pathspec 은 풀지 않는다
  if (GLOB.test(raw)) {
    const dirPart = abs.slice(0, abs.lastIndexOf('/'));
    // git 이 푸는 글롭은 * 가 / 를 넘는다(git rm "*" 가 shop/migrations/0001 까지) — 폴더 이름으로 거르지 않는다
    return w.gitGlob || NEAR.test(abs) || GLOB.test(dirPart) ? [{ glob: abs, deep: w.gitGlob }] : [];
  }
  if (w.op === 'delete') {
    if (migrationKind(abs)) return [{ exact: abs }];
    // 폴더째 지우기·옮기기: 마이그레이션 폴더 이름이거나, 그것을 품을 수 있는 있는 폴더(rm -rf shop 으로 shop/migrations 가 사라짐 — 보호 경로와 같게)
    return w.recursive && (MIGRATION_DIR.test(abs) || isDir(abs)) ? [{ dir: abs.replace(/\/+$/, '') }] : [];
  }
  if (w.noClobber) return [];
  // 받는 쪽이 폴더면(끝 / 이거나 있는 폴더) 그 안에 생길 같은 이름 파일 — 그 이름이 커밋한 마이그레이션이면 덮어쓰기.
  // 보내는 쪽이 글롭(cp -r tmp/* shop/migrations/)이면 지금 디스크에서 풀어 생길 이름을 얻는다(검토 2026-11-11 — 글롭 이름 「*」 로는 맞출 수 없었다).
  const kids = (w.from || []).flatMap((f) => landingNames(f, cwd)).map((n) => `${abs.replace(/\/+$/, '')}/${n}`).filter(migrationKind);
  if (kids.length && (/[\\/]$/.test(w.file) || isDir(abs))) return kids.map((exact) => ({ exact }));
  return migrationKind(abs) ? [{ exact: abs }] : [];
};
// 글롭 → 정규식(셸 글롭의 * 는 / 를 넘지 않는다. git rm 의 pathspec 은 넘는다)
const globRe = (g, deep) => new RegExp(`^${g.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\[!/g, '[^').replace(/\*+/g, deep ? '.*' : '[^/]*').replace(/\?/g, deep ? '.' : '[^/]')}$`);

// 대상들 가운데 HEAD 에 있는 마이그레이션 파일. 물어볼 것이 없으면 git 을 부르지 않는다.
const committedMigrations = (ctx, targets, cwd) => {
  const qs = targets.flatMap((w) => queriesOf(w, cwd));
  if (!qs.length) return [];
  const root = rootOf(ctx);
  if (!root) return [];
  const rel = (abs) => relTo(root, cwd, abs);
  const want = qs
    .map((q) => {
      if (q.exact) return { exact: rel(q.exact) };
      if (q.dir) return { dir: rel(q.dir) };
      const g = rel(q.glob);
      const fixed = g.split('/');
      const at = fixed.findIndex((part) => GLOB.test(part));
      return { glob: globRe(g, q.deep), under: fixed.slice(0, at).join('/') };
    })
    // 폴더·글롭 앞부분이 빈 글(저장소 맨 위 — git rm -r .·git rm "*")은 저장소 전체
    .filter((q) => (q.exact === undefined && (q.dir ?? q.under) === '') || inRepo(q.exact ?? q.dir ?? q.under));
  const specs = [...new Set(want.map((q) => q.exact ?? ((q.dir ?? q.under) || '.')))];
  const hit = (f) => want.some((q) => (q.exact ? q.exact === f : q.dir !== undefined ? q.dir === '' || f.startsWith(`${q.dir}/`) : q.glob.test(f)));
  return inHead(root, specs).filter((f) => migrationKind(f) && hit(f));
};

// 도구별 「새 마이그레이션 만드는 법」
const verdict = (hits, t) => {
  const file = hits[0];
  const more = hits.length > 1 ? t('migration.more', { n: hits.length - 1 }) : '';
  return t('migration.edit', { file: `${file}${more}`, how: t(`migration.how.${migrationKind(file)}`) });
};

export const migrationWrite = {
  id: 'migration-edit',
  on: 'write',
  check(ctx) {
    const file = targetFile(ctx.input.tool_input || {});
    if (!file || !migrationKind(file)) return null;
    const hits = committedMigrations(ctx, [{ file, op: 'write' }], ctx.cwd || process.cwd());
    return hits.length ? verdict(hits, ctx.t) : null;
  },
};

// git rm·mv(rm --cached 도 — 커밋하면 HEAD 에서 빠진다), 다른 커밋에서 가져오는 checkout <커밋> -- 경로·restore --source <커밋> 경로.
// 읽기는 lib/git-writes.mjs 하나(보호 경로와 같이). HEAD·stage 에서 되살리기(checkout -- 경로, restore 경로)는 커밋한 내용으로 돌아가는 것이라 둔다.
// 저장소 전체를 stage 에서 빼기(git rm -r --cached . — .gitignore 다시 적용할 때, 곧 git add . 이 따른다)는 마이그레이션 지우기가 아니다(검토 2026-11-11)
// . · * 는 저장소 맨 위에서 부를 때만 전체다 — shop/migrations 안에서 git rm -r --cached . 은 마이그레이션만 뺀다(검토 2026-11-11)
const WHOLE_TOP = /^(?::\/|:\(top\))$/;
const WHOLE_HERE = /^(?:\.|\.\/|\*)$/;
const atTop = (cwd, root) => { const r = typeof root === "function" ? root() : root; return !!r && path.resolve(cwd) === path.resolve(r); }; // root 는 필요할 때만 구한다(git 을 띄우지 않게)
const gitTargets = (cmd, shell, cwd, root = null) => gitWrites(cmd, shell, cwd).filter((w) =>
  (w.git === 'rm' && !(w.cached && (WHOLE_TOP.test(w.file) || (WHOLE_HERE.test(w.file) && atTop(cwd, root))))) || w.git === 'mv' || ((w.git === 'checkout' || w.git === 'restore') && w.op === 'write' && w.source && !/^(?:HEAD|@)$/.test(w.source)));

// 다른 커밋에서 폴더째 가져오기(checkout HEAD~1 -- shop/migrations · restore -s HEAD~1 shop — 검토 2026-11-11 에 지나갔다).
// 폴더 안 커밋한 마이그레이션 가운데 그 커밋과 HEAD 가 다른 것만 — 같으면 바뀌지 않는다. restore·checkout --no-overlay 는
// 그 커밋에 없는 파일을 지우므로 HEAD 에만 있는 것(diff 의 A)도, 보통 checkout 은 두므로 내용이 다른 것(M)만.
// 폴더 이름이 마이그레이션 폴더이거나 있는 폴더일 때만 git 을 부른다(대상마다 한 번).
const folderFromCommit = (ctx, cmd, shell, cwd) => {
  const ws = gitTargets(cmd, shell, cwd).filter((w) => (w.git === 'checkout' || w.git === 'restore') && w.source && !w.source.startsWith('-') && !GLOB.test(w.file) && !w.file.startsWith(':'));
  const out = [];
  for (const w of ws) {
    const abs = normPath(path.resolve(cwd, w.file)).replace(/\/+$/, '');
    if (migrationKind(abs) || !(MIGRATION_DIR.test(abs) || isDir(abs))) continue;
    const root = rootOf(ctx);
    if (!root) return out;
    const rel = relTo(root, cwd, abs);
    if (rel && !inRepo(rel)) continue;
    const filter = w.git === 'restore' || w.noOverlay ? 'MA' : 'M';
    const diff = git(root, ['diff', '--name-only', '--no-renames', '-z', `--diff-filter=${filter}`, w.source, 'HEAD', '--', rel || '.'], { maxBuffer: 8 * 1024 * 1024 });
    out.push(...(diff || '').split('\0').filter((f) => f && migrationKind(f)));
  }
  return out;
};

// git add·commit 경로 가운데 마이그레이션에 닿을 수 있는 것(있는 보통 파일은 그 이름으로만 — git 을 띄우지 않게)
const mayHold = (s, cwd) => {
  const abs = normPath(path.resolve(cwd, s));
  return GLOB.test(s) || migrationKind(abs) || !fs.statSync(abs, { throwIfNoEntry: false })?.isFile();
};

export const migrationShell = {
  id: 'migration-edit',
  on: 'shell',
  check(ctx) {
    const { cmd, shell, t } = ctx;
    const cwd = ctx.cwd || process.cwd();
    // 셸로 쓰기·지우기·덮어쓰는 복사(받는 쪽), git mv·git rm
    const hits = committedMigrations(ctx, [...shellWrites(cmd, shell), ...gitTargets(cmd, shell, cwd, () => rootOf(ctx))], cwd);
    if (hits.length) return verdict(hits, t);
    const fromCommit = folderFromCommit(ctx, cmd, shell, cwd);
    if (fromCommit.length) return verdict(fromCommit, t);
    // Claude 의 git add·commit 이 HEAD 의 마이그레이션 고침·지움을 올리는지(git 훅이 돌든 말든 — 사람 커밋은 보지 않는다).
    // 이 명령이 올리는 것만 본다 — 이미 stage 돼 있던 것은 사용자가 올렸을 수 있다(Claude 가 올렸다면 그 git add·git rm 때 막았다).
    const src = stageSources(cmd, shell, () => rootOf(ctx));
    if (!src || (!src.all && !src.specs.some((s) => mayHold(s, cwd)))) return null;
    const root = rootOf(ctx);
    if (!root) return null;
    const st = once(ctx.shared, 'commandStages', () => commandStages(cmd, cwd, root, shell));
    const changed = [...st.changed, ...st.deleted].filter(migrationKind);
    if (!changed.length) return null;
    const inCommit = inHead(root, [...new Set(changed)]).filter(migrationKind);
    return inCommit.length ? `${t('commit.prefix')} ${verdict(inCommit, t)}` : null;
  },
};

export default [migrationWrite, migrationShell];
