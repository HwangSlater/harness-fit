// 커밋할 때 다시 보기: 파일 쓰기 검사(Write/Edit)는 셸로 쓴 파일(`cat >`, `sed -i`, `npm install x`)을 못 본다.
// 그래서 커밋에 들어갈 내용을 쓰기 검사와 같은 함수·문구로 본다. 이번 커밋이 더하는 줄·항목만 본다(HEAD 에 이미 있던 것은 막지 않는다).
// 보는 곳은 둘:
//   1) git pre-commit 훅(hooks/git-pre-commit.mjs) — 적용할 때 넣는다. 커밋하는 순간의 실제 색인을 보므로 정확하다.
//   2) 이 PreToolUse 규칙 — git 훅이 이 저장소에서 돌지 않을 때만(남의 훅·core.hooksPath 가 있어 못 넣음, 팀원의 새 clone, 플러그인을 못 찾음),
//      또는 명령이 git 훅을 건너뛰거나 바꿀 수 있을 때(-n·--no-verify·core.hooksPath·훅 파일 건드리기). 이때는 명령을 읽어
//      들어갈 내용을 짐작하고(lib/staged.mjs commitPlan), 같은 명령 앞부분이 파일을 쓰면 미리 볼 수 없어 나눠 실행하게 한다.
// git 훅이 돌면 여기서는 아무것도 막지 않는다 — 같은 것을 두 번 보지 않고, 「미리 볼 수 없다」 헛막음도 없다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { findSecrets, forbiddenFile, protectedBy } from '../lib/secrets.mjs';
import { commitPlan, commandStages, stageSources, once } from '../lib/staged.mjs';
import { gitSegments, dataMasked, commandSegments, innerCommands, splitWords, GIT, SUB_END } from '../lib/cmdline.mjs';
import { runWords } from '../lib/run-prefix.mjs';
import { askPatterns, blockHit } from '../lib/ask-match.mjs';
import { git } from '../lib/core.mjs';
import { gitHookActive, bypassesGitHook } from '../lib/git-hook.mjs';
import { findUnsafeHtml, unsafeHtmlTarget } from '../lib/unsafe-html.mjs';
import { isPackageJson, unpinnedChanges } from '../lib/pin-deps.mjs';
import { isWorkflow, newWorkflowHits, ownOwner } from '../lib/gha-inject.mjs';
import { allowFor, NO_ROWS } from '../lib/allow.mjs';
// 쓰기 검사(rules/files·code·lang)와 같은 판정·문구
import {
  sizeTarget, lineCount, DEFAULT_MAX_LINES, sizeVerdict, secretsAllowOn, secretsHint,
  unsafeHtmlMessage, pinDepsMessage, ghaMessage, langMessage, langCommitHits,
} from '../lib/messages.mjs';

// 더한 줄의 자리(줄 번호·바로 위 줄). 계획이 모르면(시험용 계획 등) 바로 위 줄을 모르는 것으로 — 떨어진 줄을 위 줄로 잘못 보지 않게.
const rowsOf = (plan, f) => (plan.rows ? plan.rows(f) : NO_ROWS);

const fileList = (pairs, t) => pairs.map(([f, why]) => `${f}(${t(why)})`).join(', ');
// 커밋에 들어가면 안 되는 파일은 .env·키 파일뿐이다. 사용자가 보호하기로 한 경로(옵션 paths)는 커밋에서 보지 않는다 —
// Claude 가 쓰는 것은 쓰는 순간(Write·Edit·셸)에 이미 막고, git 훅은 사람이 직접 고친 값을 커밋하는 것과 구별하지 못해
// 사람의 커밋까지 막았다(-n 을 써야 함 — 역할극 2 회차 2차, 2026-11-11). 소스 폴더를 git 에서 빼라는 엉뚱한 안내도 나왔다(3 회차 2차).
const badFiles = (plan) => plan.files.map((f) => [f, forbiddenFile(f)]).filter(([, why]) => why);
const badMessage = (bad, t) => t('secrets.commitFile', { files: fileList(bad, t) });

// 다만 Claude 가 만드는 커밋이 「새로」 넣는 파일이 .gitignore 에 걸리거나 보호 경로면 막는다 — git add -f 로 올린
// Config/Secrets.xcconfig·.cer·.provisionprofile 이 커밋됐다(역할극 16 회차, 2026-11-13). 이미 추적 중인 파일을 고친 커밋은 보지 않으니
// 사람이 고친 값을 커밋하는 일(2 회차 헛막음)과 부딪히지 않는다. Claude 의 커밋인지: PreToolUse 는 늘 Claude, git 훅은 Claude Code 가
// 셸에 붙이는 CLAUDECODE 환경 변수로(ctx.claude). 무시 여부는 git check-ignore --no-index 한 번(stage 에 올라도 규칙으로 본다)
// 새 파일은 모두 본다 — 앞 2000개만 보아 2100개 뒤에 숨긴 파일이 지나갔다(검토 2026-11-13). check-ignore 는 한 번에 받는다(3만 개에 5초 남짓)
const IGNORED_BUFFER = 64 * 1024 * 1024;
// CLAUDECODE 가 있기만 하면(값이 0·false 여도) Claude 로 본다 — 「CLAUDECODE=0 git commit」 으로 검사를 피하던 회귀(검토 2026-11-13).
// 명령줄에서 지우거나 바꾸는 꼴(unset·env -u·CLAUDECODE=…)은 PreToolUse 의 claudeTamper 가 막는다
export const claudeEnv = (v) => v !== undefined;
// 새 파일 이름이 「:!x」·「:(glob)y」 처럼 pathspec 마법 꼴이면 check-ignore 가 128 로 끝나 결과가 비었다 — 그 틈에 -f 로 올린
// Config/Secrets.xcconfig 가 지나갔다(검토 2026-11-13). 「./」 를 붙이면 마법으로 읽지 않는다(--literal-pathspecs 는 check-ignore 가 받지 않는다).
// 한 번에 못 보면 파일마다, 그래도 못 보면 { failed: true } — 부르는 쪽이 Claude 의 커밋만 막는다(지키는 쪽)
const unDot = (x) => x.replace(/^\.\//, '');
const ignoredNew = (plan, root) => {
  const fresh = plan.files.filter((f) => plan.isNew?.(f));
  if (!fresh.length || !root) return { files: [] };
  const ask = (list) => git(root, ['check-ignore', '--no-index', '--stdin', '-z'], { input: list.map((f) => `./${f}`).join('\0') + '\0', okCodes: [1], maxBuffer: IGNORED_BUFFER });
  const out = ask(fresh);
  if (out !== null) return { files: out.split('\0').filter(Boolean).map(unDot) };
  const files = [];
  for (const f of fresh) {
    const one = ask([f]);
    if (one === null) return { files, failed: true };
    files.push(...one.split('\0').filter(Boolean).map(unDot));
  }
  return { files };
};
// 지정한 보호 경로는 여기서 보지 않는다 — Claude 가 올리는 순간(git add, 아래 protectedCommit)에 이미 막고, 사용자가 손으로 stage 해 둔
// 보호 경로는 Claude 의 커밋에 섞여도 두기로 했다(검토 2026-11-11). .gitignore 에 걸린 새 파일은 누가 올렸든 -f 로 억지로 넣은 것이라 막는다
const claudeNewFiles = (plan, { root, claude = true }) => (claude && plan.isNew ? ignoredNew(plan, root) : { files: [] });

// 훅 id → (계획, { opts, t, root }) → 문구 또는 null. PreToolUse 규칙과 git 훅이 같은 함수를 쓴다.
export const INSPECT = {
  // 비밀값: 넣으면 안 되는 파일(.env·키) + 더한 줄의 비밀값 모양
  secrets(plan, { opts, t, allows }) {
    const bad = badFiles(plan);
    if (bad.length) return badMessage(bad, t);
    // 파일마다 경로와 함께 본다 — 쓰기 검사와 같이 테스트 파일은 대입 검사에서 뺀다. 허용 주석은 opts.allowComment 일 때만.
    const on = secretsAllowOn(opts);
    const hits = [...plan.added].flatMap(([file, ls]) => findSecrets(ls.join('\n'), file, allowFor(allows, 'secrets', file, rowsOf(plan, file), on)));
    return hits.length ? t('secrets.commit', { hits: [...new Set(hits)].join(', '), hint: secretsHint(opts, t) }) : null;
  },
  // .env·키 파일이 커밋에 들어가는지(비밀값 검사와 같은 문구라 둘 다 켜져도 한 번만 나온다)
  'protected-files'(plan, ctx) {
    const bad = badFiles(plan);
    if (bad.length) return badMessage(bad, ctx.t);
    const fresh = claudeNewFiles(plan, ctx);
    if (fresh.files.length) return ctx.t('protected.commitNew', { files: fresh.files.slice(0, 5).join(', ') });
    return fresh.failed ? ctx.t('protected.commitNewUnchecked') : null;
  },
  'unsafe-html'(plan, { t, allows }) {
    const hits = [...plan.added]
      .filter(([f]) => unsafeHtmlTarget(f))
      .flatMap(([f, ls]) => findUnsafeHtml(ls, f, allowFor(allows, 'unsafe-html', f, rowsOf(plan, f))).map((h) => `${f}: ${h}`));
    return hits.length ? unsafeHtmlMessage(hits, t) : null;
  },
  'pin-deps'(plan, { t }) {
    const hits = plan.files.filter(isPackageJson).flatMap((f) => unpinnedChanges(plan.before(f), plan.after(f)).map((h) => `${f}: ${h}`));
    return hits.length ? pinDepsMessage(hits, t) : null;
  },
  'gha-inject'(plan, { root, t, allows }) {
    const flows = plan.files.filter(isWorkflow);
    if (!flows.length) return null;
    const owner = ownOwner(root);
    const hits = flows.flatMap((f) => newWorkflowHits(plan.before(f), plan.after(f), owner, allows, f));
    return hits.length ? ghaMessage(hits, t) : null;
  },
  // 큰 새 파일: 이번 커밋으로 저장소에 처음 들어가는 코드 파일. 파일 맨 위 허용 주석은 한도를 넘은 파일만 읽어 본다.
  'file-size'(plan, { opts, t, allows }) {
    const max = Number.isFinite(opts.maxLines) && opts.maxLines > 0 ? opts.maxLines : DEFAULT_MAX_LINES;
    for (const f of plan.files.filter(sizeTarget)) {
      if (!plan.isNew(f)) continue;
      // 계획이 줄 수를 한 번에 세어 두었으면 그것을(파일마다 git 을 띄우지 않게). 못 세면(바이너리·한도 넘음) 0.
      const lines = plan.lineCount ? plan.lineCount(f) ?? 0 : lineCount(plan.after(f) ?? '');
      if (lines <= max) continue;
      const msg = sizeVerdict(f, plan.after(f), lines, max, { t, allows });
      if (msg) return `${f}: ${msg}`;
    }
    return null;
  },
  // 언어별: 그 언어 파일에 이번 커밋이 더하는 줄의 try!·print( / shell=True·eval(·exec(
  'swift-unsafe'(plan, { t, allows }) {
    const hits = langCommitHits('swift-unsafe', plan, t, allows);
    return hits.length ? langMessage('swift-unsafe', hits, t) : null;
  },
  'python-unsafe'(plan, { t, allows }) {
    const hits = langCommitHits('python-unsafe', plan, t, allows);
    return hits.length ? langMessage('python-unsafe', hits, t) : null;
  },
};

// harness-fit 이 받아 넣은 스킬 파일 가운데 받은 그대로인 것은 코드 검사(unsafe-html·file-size·언어별·pin-deps)에서 뺀다 —
// 고정 커밋으로 받은 남의 코드(vendor 와 같음)를 자기 훅이 막아 적용 결과를 커밋하지 못하던 일(역할극 5 회차 2차, 2026-11-11).
// 받은 뒤 고친 파일(해시가 다름)은 그대로 본다. 비밀값·보호 파일 검사는 늘 본다.
const VENDORED_SKIP = ['unsafe-html', 'file-size', 'swift-unsafe', 'python-unsafe', 'pin-deps'];
const sourceOf = (root, name, cache) => {
  if (!(name in cache)) {
    try {
      cache[name] = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'skills', name, '.harness-source.json'), 'utf8'));
    } catch {
      cache[name] = null;
    }
  }
  return cache[name];
};
// 믿는 출처: harness-fit 이 이 저장소에 넣기로 한 스킬(.claude/harness.json selection.skills)이고, 출처 기록의 저장소·커밋이
// 카탈로그의 그 스킬과 같을 때만(아무 폴더에 .harness-source.json 을 써서 코드 검사를 피하던 빈틈 — 검토 2026-11-11)
let catalogBy;
const catalogSkill = (id) => {
  if (!catalogBy) {
    try {
      const c = JSON.parse(fs.readFileSync(new URL('../../catalog/catalog.json', import.meta.url), 'utf8'));
      const sha = Object.fromEntries(c.repos.map((r) => [r.repo, r.sha]));
      catalogBy = new Map(c.skills.filter((s) => s.install === 'copy').map((s) => [s.id, { repo: s.repo, sha: sha[s.repo] }]));
    } catch {
      catalogBy = new Map();
    }
  }
  return catalogBy.get(id);
};
const chosenSkills = (root) => {
  try {
    return new Set(JSON.parse(fs.readFileSync(path.join(root, '.claude', 'harness.json'), 'utf8')).selection?.skills || []);
  } catch {
    return new Set();
  }
};
const trusted = (root, name, cache, chosen) => {
  const src = sourceOf(root, name, cache);
  const cat = catalogSkill(name);
  return src && cat && chosen.has(name) && src.repo === cat.repo && src.sha === cat.sha ? src : null;
};
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
// 받은 바이트로 만든 해시와 견준다 — autocrlf 로 줄 끝이 바뀌어 들어와도 같은 파일로 본다
const sameFile = (text, want) => [text, text.replace(/\r\n/g, '\n'), text.replace(/\r?\n/g, '\r\n')].some((x) => sha256(x) === want);
export const withoutVendored = (plan, root) => {
  if (!root || !plan?.files) return plan;
  const cache = {};
  let chosen;
  const skip = new Set(plan.files.filter((f) => {
    const m = /^\.claude\/skills\/([^/]+)\/(.+)$/.exec(String(f).replace(/\\/g, '/'));
    if (!m) return false;
    chosen ??= chosenSkills(root);
    const want = trusted(root, m[1], cache, chosen)?.files?.[m[2]];
    const now = want ? plan.after(f) : null;
    return typeof now === 'string' && sameFile(now, want);
  }));
  if (!skip.size) return plan;
  return { ...plan, files: plan.files.filter((f) => !skip.has(f)), added: new Map([...plan.added].filter(([f]) => !skip.has(f))) };
};
for (const id of VENDORED_SKIP) {
  const check = INSPECT[id];
  INSPECT[id] = (plan, ctx) => check(withoutVendored(plan, ctx.root), ctx);
}

// PreToolUse 규칙: 커밋이 없거나 git 훅이 볼 커밋이면 null, 내용을 못 보면 그 안내, 아니면 찾은 것.
const onCommit = (id) => ({
  id,
  on: 'shell',
  check(ctx) {
    const { cmd, cwd, root, shell, shared, t } = ctx;
    if (!root || !gitSegments(cmd, 'commit', shell).length) return null;
    if (once(shared, 'gitHookCovers', () => !bypassesGitHook(cmd, shell) && gitHookActive(root))) return null;
    const plan = once(shared, 'commitPlan', () => commitPlan(cmd, cwd, root, shell, ctx.repo));
    if (!plan) return null;
    if (plan.unseen) return t('commit.unseen', { part: plan.unseen.slice(0, 80) });
    const msg = INSPECT[id](plan, ctx);
    return msg ? `${t('commit.prefix')} ${msg}` : null;
  },
});

// 사용자가 보호한 경로(옵션 paths)를 Claude 가 git add·git commit 으로 커밋에 넣는 것. git 훅과 상관없이 Claude 의 명령만 본다 —
// 사람의 커밋은 git 훅이 보지 않기로 했고(5c293c3), 그 뒤 Claude 의 `git add -f data/raw/…` 커밋까지 지나갔다(역할극 7 회차, 2026-11-11).
// 이 명령 자신이 올리는 것(같은 명령의 git add·commit -a·commit <경로>)만 본다. 이미 stage 돼 있던 것은 사용자가 손으로 올렸을 수 있어
// 보지 않는다 — Claude 가 앞 명령에서 올렸다면 그 git add 때 여기서 이미 막았다(git add . 처럼 넓게 올린 것도). 이름만 읽는다(내용은 안 읽음).
const isFile = (f) => fs.statSync(f, { throwIfNoEntry: false })?.isFile() ?? false;
// 경로들 가운데 커밋하면 내용이 더해지거나 바뀌는 것(저장소 맨 위 기준). 작업 트리 쪽(Y)이 있으면 그것, 없으면 stage 쪽(X).
// 무시 목록의 파일(!!)은 add -f 일 때만 올라간다.
const ADDS = /[AMTRCU?!]/;
const contentChanged = (root, rels, force) => {
  const args = ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all', ...(force ? ['--ignored=matching'] : []), '--', ...rels.map((r) => `:(top,literal)${r}`)];
  const out = [];
  for (const rec of (git(root, args) || '').split('\0')) {
    if (rec.length < 4) continue;
    const [x, y] = [rec[0], rec[1]];
    if (ADDS.test(y !== ' ' ? y : x)) out.push(rec.slice(3));
  }
  return out;
};
const protectedCommit = {
  id: 'protected-files',
  on: 'shell',
  check({ cmd, cwd, root, shell, shared, opts, t }) {
    const paths = Array.isArray(opts.paths) ? opts.paths : [];
    if (!root || !paths.length) return null;
    const src = stageSources(cmd, shell, root);
    if (!src) return null;
    const base = cwd || root;
    const rel = (f) => path.relative(root, path.resolve(base, f)).replace(/\\/g, '/');
    // 지정한 경로에 맞으면 — 키 파일 이름(.cer 등)이 먼저 'file.key' 로 잡혀 *.cer 을 적어도 add 때 지나가지 않게(2026-11-13)
    const guarded = (f) => paths.some((g) => protectedBy(f, g));
    // 이름으로 준 보호 경로는 내용을 더하거나 고치는 변경이 있을 때만(git status 한 번). 바뀌지 않았거나 지운 것뿐이면 둔다 —
    // 사용자가 지운 보호 파일을 `git commit 그 경로` 로 커밋하던 것까지 막던 회귀(검토 2026-11-11, add -u 는 이미 통과).
    let hits = src.specs.map(rel).filter(guarded);
    if (hits.length) hits = contentChanged(root, hits, src.force).filter(guarded);
    if (!hits.length && (src.all || src.specs.some((s) => !isFile(path.resolve(base, s))))) {
      const st = once(shared, 'commandStages', () => commandStages(cmd, base, root, shell));
      hits = [...st.changed, ...st.untracked()].filter(guarded);
    }
    return hits.length ? t('protected.commit', { files: [...new Set(hits)].slice(0, 5).join(', ') }) : null;
  },
};

// 명령줄에서 CLAUDECODE 를 바꾸거나 지우는 꼴(CLAUDECODE=0 git commit · CLAUDECODE=0 make release · unset · env -u · env -i ·
// $env:CLAUDECODE = · Remove-Item Env:CLAUDECODE) — git 훅이 그 커밋을 사람의 것으로 보게 된다(검토 2026-11-13).
// PreToolUse 는 늘 Claude 이므로 값과 상관없이 막는다. 읽기($CLAUDECODE·echo)는 둔다. 실행되지 않는 글(커밋 메시지)은 비운 뒤 본다
const CLAUDE_TAMPER = [
  /(?:^|[\s;&|({`])CLAUDECODE\+?=/,
  /(?:^|[\s;&|({])unset\s+(?:-[vf]\s+)?(?:[\w-]+\s+)*CLAUDECODE\b/,
  // env 바로 뒤 옵션들 가운데 -u CLAUDECODE·--unset=CLAUDECODE — 명령 뒤의 옵션은 보지 않는다
  /(?:^|[\s;&|({])env(?:\s+-[a-zA-Z]*[uCS]\s+(?!CLAUDECODE\b)\S+|\s+--(?!unset|ignore)[\w-]+(?:=\S*)?|\s+-[a-zA-Z]*[0v])*\s+(?:-u\s*CLAUDECODE\b|--unset[=\s]CLAUDECODE\b)(?=\s|$)/,
  /\$env:CLAUDECODE\s*=(?!=)/i,
  /\b(?:Remove-Item|ri|rm|del|Clear-Item|Set-Item)\s+(?:-\w+\s+)*(?:-Path\s+)?["']?Env:\\?CLAUDECODE\b/i,
  /SetEnvironmentVariable\(\s*["']CLAUDECODE["']/i,
];
// env -i · env - · env --ignore-environment(env 바로 뒤 옵션 자리에서만 — node -i 는 아니다)
const ENV_CLEAR = /(?:^|[\s;&|({])env(?:\s+-[a-zA-Z]*[uCS]\s+\S+|\s+--(?!ignore)[\w-]+(?:=\S*)?|\s+-[a-zA-Z]*[0v])*\s+(?:-[a-zA-Z]*i|--ignore-environment|-)(?=\s|$)/;
// env -i 는 같은 명령이 커밋할 때만 막는다: git commit(git -c … commit · bash -c "…" 속도), 또는 ask-cmd 의 묻기·막기 목록에 적은 make 목표
// (make release 처럼 그 안에서 커밋할 수 있는 것). env -i PATH="$PATH" make test 같은 깨끗한 환경 시험은 둔다(검토 2026-11-13)
const GIT_COMMIT = new RegExp(`${GIT}commit${SUB_END}`);
const listOf = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).filter((c) => typeof c === 'string' && /^\s*g?make(?:\s|$)/.test(c));
const commitsHere = (view, shell, rules) => {
  const runs = [{ cmd: view, shell }, ...innerCommands(view, shell)];
  if (runs.some((c) => GIT_COMMIT.test(c.cmd))) return true;
  const ask = rules?.['ask-cmd'];
  const list = ask && typeof ask === 'object' ? [...listOf(ask.commands), ...listOf(ask.block)] : [];
  if (!list.length) return false;
  const pats = askPatterns(list, {}, (c) => splitWords(c, shell));
  return runs.some((c) => commandSegments(c.cmd, c.shell).some((seg) => {
    const line = runWords(seg.words);
    return /^g?make$/.test(line[0] || '') && blockHit(seg.words, line, pats, {});
  }));
};
const claudeTamper = {
  id: 'protected-files',
  on: 'shell',
  check({ cmd, shell, rules, t }) {
    if (!/claudecode|\benv\b/i.test(cmd)) return null;
    const view = dataMasked(cmd, shell);
    if (CLAUDE_TAMPER.some((re) => re.test(view))) return t('commit.claudeEnv');
    return ENV_CLEAR.test(view) && commitsHere(view, shell, rules) ? t('commit.claudeEnv') : null;
  },
};

export default [...Object.keys(INSPECT).map(onCommit), protectedCommit, claudeTamper];
