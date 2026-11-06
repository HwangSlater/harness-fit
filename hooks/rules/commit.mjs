// 커밋할 때 다시 보기: 파일 쓰기 검사(Write/Edit)는 셸로 쓴 파일(`cat >`, `sed -i`, `npm install x`)을 못 본다.
// 그래서 커밋에 들어갈 내용을 쓰기 검사와 같은 함수·문구로 본다. 이번 커밋이 더하는 줄·항목만 본다(HEAD 에 이미 있던 것은 막지 않는다).
// 보는 곳은 둘:
//   1) git pre-commit 훅(hooks/git-pre-commit.mjs) — 적용할 때 넣는다. 커밋하는 순간의 실제 색인을 보므로 정확하다.
//   2) 이 PreToolUse 규칙 — git 훅이 이 저장소에서 돌지 않을 때만(남의 훅·core.hooksPath 가 있어 못 넣음, 팀원의 새 clone, 플러그인을 못 찾음),
//      또는 명령이 git 훅을 건너뛰거나 바꿀 수 있을 때(-n·--no-verify·core.hooksPath·훅 파일 건드리기). 이때는 명령을 읽어
//      들어갈 내용을 짐작하고(lib/staged.mjs commitPlan), 같은 명령 앞부분이 파일을 쓰면 미리 볼 수 없어 나눠 실행하게 한다.
// git 훅이 돌면 여기서는 아무것도 막지 않는다 — 같은 것을 두 번 보지 않고, 「미리 볼 수 없다」 헛막음도 없다.
import { findSecrets, forbiddenFile } from '../lib/secrets.mjs';
import { commitPlan } from '../lib/staged.mjs';
import { gitSegments } from '../lib/cmdline.mjs';
import { gitHookActive, bypassesGitHook } from '../lib/git-hook.mjs';
import { findUnsafeHtml, unsafeHtmlTarget } from '../lib/unsafe-html.mjs';
import { isPackageJson, unpinnedChanges } from '../lib/pin-deps.mjs';
import { isWorkflow, newWorkflowHits, ownOwner } from '../lib/gha-inject.mjs';
import { sizeTarget, lineCount, DEFAULT_MAX_LINES, sizeVerdict, secretsAllowOn, secretsHint } from './files.mjs';
import { unsafeHtmlMessage, pinDepsMessage, ghaMessage } from './code.mjs';
import { allowFor, NO_ROWS } from '../lib/allow.mjs';
import { langMessage, langCommitHits } from './lang.mjs';

// 더한 줄의 자리(줄 번호·바로 위 줄). 계획이 모르면(시험용 계획 등) 바로 위 줄을 모르는 것으로 — 떨어진 줄을 위 줄로 잘못 보지 않게.
const rowsOf = (plan, f) => (plan.rows ? plan.rows(f) : NO_ROWS);

// 한 명령을 보는 동안 규칙마다 같은 계산을 다시 하지 않는다(shared 는 evaluate 가 명령마다 새로 준다).
const once = (shared, key, make) => {
  if (!shared) return make();
  if (!(key in shared)) shared[key] = make();
  return shared[key];
};

const fileList = (pairs, t) => pairs.map(([f, why]) => `${f}(${t(why)})`).join(', ');
const badFiles = (plan, opts) => plan.files.map((f) => [f, forbiddenFile(f, Array.isArray(opts.paths) ? opts.paths : [])]).filter(([, why]) => why);

// 훅 id → (계획, { opts, t, root }) → 문구 또는 null. PreToolUse 규칙과 git 훅이 같은 함수를 쓴다.
export const INSPECT = {
  // 비밀값: 넣으면 안 되는 파일(.env·키) + 더한 줄의 비밀값 모양
  secrets(plan, { opts, t, allows }) {
    const bad = badFiles(plan, opts);
    if (bad.length) return t('secrets.commitFile', { files: fileList(bad, t) });
    // 파일마다 경로와 함께 본다 — 쓰기 검사와 같이 테스트 파일은 대입 검사에서 뺀다. 허용 주석은 opts.allowComment 일 때만.
    const on = secretsAllowOn(opts);
    const hits = [...plan.added].flatMap(([file, ls]) => findSecrets(ls.join('\n'), file, allowFor(allows, 'secrets', file, rowsOf(plan, file), on)));
    return hits.length ? t('secrets.commit', { hits: [...new Set(hits)].join(', '), hint: secretsHint(opts, t) }) : null;
  },
  // .env·키 파일이 커밋에 들어가는지(비밀값 검사와 같은 문구라 둘 다 켜져도 한 번만 나온다)
  'protected-files'(plan, { opts, t }) {
    const bad = badFiles(plan, opts);
    return bad.length ? t('secrets.commitFile', { files: fileList(bad, t) }) : null;
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

// PreToolUse 규칙: 커밋이 없거나 git 훅이 볼 커밋이면 null, 내용을 못 보면 그 안내, 아니면 찾은 것.
const onCommit = (id) => ({
  id,
  on: 'shell',
  check(ctx) {
    const { cmd, cwd, root, shell, shared, t } = ctx;
    if (!root || !gitSegments(cmd, 'commit', shell).length) return null;
    if (once(shared, 'gitHookCovers', () => !bypassesGitHook(cmd, shell) && gitHookActive(root))) return null;
    const plan = once(shared, 'commitPlan', () => commitPlan(cmd, cwd, root, shell));
    if (!plan) return null;
    if (plan.unseen) return t('commit.unseen', { part: plan.unseen.slice(0, 80) });
    const msg = INSPECT[id](plan, ctx);
    return msg ? `${t('commit.prefix')} ${msg}` : null;
  },
});

export default Object.keys(INSPECT).map(onCommit);
