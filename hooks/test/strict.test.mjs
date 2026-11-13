// 엄격 시험(2026-11-06 사용자 원칙 「훅은 모두 엄격하게 시험한다」): 훅마다 packs.json detail 이 약속한 꼴을
// 하나씩 막는지(block), 비슷하지만 안전한 꼴은 통과하는지(pass)를 실제 진입점 hooks/run.mjs 에 JSON 을 넣어 본다.
// 셸 훅은 Bash·PowerShell 둘 다로(꼴이 다르면 각자의 꼴로). 사례는 strict-cases/*.mjs.
// 새 훅을 packs.json 에 더하면 사례(막음·통과 각 3개 이상)가 없어서 이 시험이 실패한다.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import writeCases from './strict-cases/write.mjs';
import codeCases from './strict-cases/code.mjs';
import shellCases from './strict-cases/shell.mjs';
import gitCases from './strict-cases/git.mjs';
import commitCases from './strict-cases/commit.mjs';
import langCases from './strict-cases/lang.mjs';
import eventCases from './strict-cases/events.mjs';
import migrationCases from './strict-cases/migration.mjs';
import followupCases from './strict-cases/followup.mjs';
import infraCases from './strict-cases/infra.mjs';
import infraReviewCases from './strict-cases/infra-review.mjs';
import infraReview2Cases from './strict-cases/infra-review2.mjs';
import infraReview3Cases from './strict-cases/infra-review3.mjs';
import askReviewCases from './strict-cases/ask-review.mjs';
import gapCases from './strict-cases/gaps.mjs';
import blockReviewCases from './strict-cases/block-review.mjs';
import iosReviewCases from './strict-cases/ios-review.mjs';
import blockReview2Cases from './strict-cases/block-review2.mjs';
import blockReview3Cases from './strict-cases/block-review3.mjs';
import blockReview4Cases from './strict-cases/block-review4.mjs';
import { makeProbeRepo, runProbeCase } from '../../scripts/lib/existing-hooks.mjs';
import { eventOf, ownSpace, buildScratch } from '../../scripts/lib/probe-run.mjs';
import { checklistFile } from '../rules/checklist.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RUN = path.join(ROOT, 'hooks', 'run.mjs');
// 때마다 진입점(도구 호출이 아닌 때의 훅은 hooks/stop.mjs 등)
const ENTRY = { PreToolUse: RUN, Stop: path.join(ROOT, 'hooks', 'stop.mjs'), SessionStart: path.join(ROOT, 'hooks', 'session-start.mjs'), UserPromptSubmit: path.join(ROOT, 'hooks', 'prompt-submit.mjs') };
const packs = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog', 'packs.json'), 'utf8'));
const probes = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog', 'probes.json'), 'utf8'));
const FLOW_OPTS = packs.flows.find((f) => f.id === 'github-flow').hooks;
const CASES = { ...writeCases, ...codeCases, ...shellCases, ...gitCases, ...commitCases, ...langCases, ...eventCases, ...migrationCases };
// 뒤에 더한 사례 파일은 같은 훅의 사례에 이어 붙인다(훅 옵션은 원래 파일의 것)
for (const [id, more] of [...Object.entries(followupCases), ...Object.entries(infraCases), ...Object.entries(infraReviewCases), ...Object.entries(infraReview2Cases), ...Object.entries(infraReview3Cases), ...Object.entries(askReviewCases), ...Object.entries(gapCases), ...Object.entries(blockReviewCases), ...Object.entries(iosReviewCases), ...Object.entries(blockReview2Cases), ...Object.entries(blockReview3Cases), ...Object.entries(blockReview4Cases)]) {
  const spec = CASES[id] || { block: [], pass: [] };
  CASES[id] = { ...spec, block: [...spec.block, ...more.block], pass: [...spec.pass, ...more.pass] };
}
const MIN_CASES = 3;
const PARALLEL = 8;

let tmp;
let base;
const gitIn = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();

// 저장소 하나: main 에 커밋 하나(README.md), 훅 설정. 사례마다 이것을 복사해 쓴다(git init 을 되풀이하지 않게).
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-strict-'));
  base = path.join(tmp, 'base');
  fs.mkdirSync(base);
  execFileSync('git', ['init', '-q', '-b', 'main', base]);
  gitIn(base, 'config', 'user.email', 't@example.com');
  gitIn(base, 'config', 'user.name', 't');
  gitIn(base, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(base, 'README.md'), 'hello\n');
  gitIn(base, 'add', 'README.md');
  // 시작 커밋은 오래전 것으로(reflog 시각 = 커밋 시각) — 「이번 턴에 만든 커밋」 사례에 섞이지 않게
  execFileSync('git', ['-C', base, 'commit', '-q', '-m', 'chore: 시작'], { stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_DATE: '2020-01-01T00:00:00+0000', GIT_COMMITTER_DATE: '2020-01-01T00:00:00+0000' } });
  fs.mkdirSync(path.join(base, '.claude'));
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let seq = 0;
const templates = new Map(); // 준비 key → 준비를 마친 저장소(복사해 쓴다)
const freshRepo = (hook, opts, setup) => {
  const dir = path.join(tmp, `r${++seq}`);
  const cached = setup?.key && templates.get(setup.key);
  fs.cpSync(cached || base, dir, { recursive: true });
  if (setup && !cached) {
    prepare(dir, setup);
    if (setup.key) {
      const tpl = path.join(tmp, `t${templates.size}`);
      fs.cpSync(dir, tpl, { recursive: true });
      templates.set(setup.key, tpl);
    }
  }
  fs.writeFileSync(path.join(dir, '.claude', 'harness.json'), JSON.stringify({ lang: 'en', rules: { [hook]: opts } }));
  return dir;
};
const prepare = (dir, setup) => {
  const r = {
    dir,
    put: (rel, text) => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), text);
    },
    git: (...args) => gitIn(dir, ...args),
    commit: (rel, text, msg) => {
      r.put(rel, text);
      gitIn(dir, 'add', '-f', rel);
      gitIn(dir, 'commit', '-q', '-m', msg);
      return gitIn(dir, 'rev-parse', 'HEAD');
    },
  };
  setup(r);
};

// git 훅 실행기가 플러그인을 찾는 곳을 시험 밖 설정과 떼어 놓는다(이 PC 에 깔린 harness-fit 이 결과를 바꾸지 않게).
// 도구 호출이 아닌 때의 훅은 홈도 시험 폴더로(체크리스트 파일이 사용자 홈에 생기지 않게).
const hookEnv = (home = null) => {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(tmp, 'no-claude-config') };
  delete env.CLAUDE_PLUGIN_ROOT;
  // 홈을 시험 폴더로 돌리면 Claude 설정 폴더도 그 아래로(체크리스트는 CLAUDE_CONFIG_DIR 을 따른다)
  if (home) Object.assign(env, { HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude') });
  return env;
};
const homeDir = () => path.join(tmp, 'home');
// 한도를 넉넉히: npm test 는 crash·git 훅 시험(10~50MB 입력, 진짜 커밋)과 함께 돌아, 보통 0.3초인 호출이 30초를 넘긴 적이 있다.
// 시간은 crash.test.mjs 가 따로 잰다 — 여기는 막음·통과만 본다.
// tmpRoot: 세션 시작 사례마다 따로 둔 임시 폴더(TEMP·TMP·TMPDIR — stale-scratch 가 이 PC 의 진짜 Temp 를 보지 않게)
const runHook = (input, event = 'PreToolUse', tmpRoot = null) =>
  new Promise((resolve, reject) => {
    const env = hookEnv(event === 'PreToolUse' ? null : homeDir());
    if (tmpRoot) Object.assign(env, { TEMP: tmpRoot, TMP: tmpRoot, TMPDIR: tmpRoot });
    const child = execFile(process.execPath, [ENTRY[event]], { encoding: 'utf8', timeout: 120000, env }, (err, out) =>
      err ? reject(new Error(`${path.basename(ENTRY[event])} 실패(${err.killed ? '시간 초과' : err.code}): ${JSON.stringify(input.tool_input || input.transcript_path).slice(0, 200)}`)) : resolve(out));
    child.stdin.end(JSON.stringify(input));
  });

const decision = (out, c = {}) => {
  const j = JSON.parse(out);
  // Stop: decision block 이 막음. SessionStart·UserPromptSubmit: 보여 준 글에 c.expect 가 있으면 「막음」(보여 줌)
  if (c.event === 'Stop') {
    if (j.decision === 'block') return { blocked: true, reason: j.reason };
    assert.deepEqual(j, {}, `막지 않을 때는 {} 만 내야 한다: ${out}`);
    return { blocked: false };
  }
  if (c.event) {
    assert.equal(j.systemMessage, undefined, `오류 알림이 나옴: ${out}`);
    const shown = j.hookSpecificOutput?.additionalContext || '';
    if (shown) assert.equal(j.hookSpecificOutput.hookEventName, c.event);
    return { blocked: shown.includes(c.expect), reason: shown };
  }
  if (j.hookSpecificOutput?.permissionDecision === 'deny') return { blocked: true, kind: 'deny', reason: j.hookSpecificOutput.permissionDecisionReason };
  // 묻는 훅(kind ask — ask-cmd): 확인 창을 띄우면 「걸림」
  if (j.hookSpecificOutput?.permissionDecision === 'ask') return { blocked: true, kind: 'ask', reason: j.hookSpecificOutput.permissionDecisionReason };
  // 알림 훅(kind notice — prefer-gh): 막지 않고 Claude 문맥에 글을 더하면 「걸림」
  if (j.hookSpecificOutput?.additionalContext) {
    assert.equal(j.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(j.hookSpecificOutput.permissionDecision, undefined, `알림 훅은 결정을 내지 않는다: ${out}`);
    return { blocked: true, reason: j.hookSpecificOutput.additionalContext };
  }
  // 막지 않을 때는 {} 만, 허용 주석으로 통과시켰으면 그 알림만(hooks/test/allow.test.mjs)
  if (j.systemMessage !== undefined) assert.ok(Object.keys(j).length === 1 && /lint:allow|allow comments|허용 주석/.test(j.systemMessage), `알림은 허용 주석 알림만: ${out}`);
  else assert.deepEqual(j, {}, `막지 않을 때는 {} 만 내야 한다: ${out}`);
  return { blocked: false };
};

// 사례 하나 → 훅 입력들(셸 사례는 셸마다 하나)
let sessionSeq = 0;
const tmpRoots = new WeakMap(); // 훅 입력 → 그 사례의 임시 폴더
const inputsOf = (c, dir) => {
  const abs = (f) => path.join(dir, f);
  if (c.event) {
    // 사례마다 다른 세션(체크리스트 파일이 겹치지 않게). 대화 기록은 저장소를 준비한 뒤에 만든다.
    const session = `strict-${++sessionSeq}`;
    const input = { hook_event_name: c.event, cwd: dir, ...(c.noSession ? {} : { session_id: session }), ...(c.input || {}) };
    if (c.transcript) {
      const recs = typeof c.transcript === 'function' ? c.transcript({ dir, git: (...a) => gitIn(dir, ...a) }) : c.transcript;
      input.transcript_path = path.join(tmp, `${session}.jsonl`);
      fs.writeFileSync(input.transcript_path, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
    }
    if (c.event === 'SessionStart') {
      // 사례의 scratch: 임시 폴더 <tmp>/claude 아래에 만들 것(dir 의 <session> 은 이 사례의 세션 id)
      const root = path.join(tmp, `${session}-tmp`);
      fs.mkdirSync(root, { recursive: true });
      if (c.scratch) buildScratch(path.join(root, 'claude'), c.scratch.map((e) => ({ ...e, dir: e.dir.replace('<session>', session) })));
      tmpRoots.set(input, root);
    }
    if (typeof c.checklist === 'string') {
      const file = checklistFile(dir, c.otherSession ? `${session}-other` : session, homeDir());
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, c.checklist);
    }
    return [input];
  }
  if (c.shells) return c.shells.map((tool_name) => ({ tool_name, cwd: dir, tool_input: { command: c.cmd } }));
  if (c.tool === 'Write') return [{ tool_name: 'Write', cwd: dir, tool_input: { file_path: abs(c.file), content: c.content } }];
  if (c.tool === 'Edit') return [{ tool_name: 'Edit', cwd: dir, tool_input: { file_path: abs(c.file), old_string: c.old_string, new_string: c.new_string } }];
  if (c.tool === 'NotebookEdit') return [{ tool_name: 'NotebookEdit', cwd: dir, tool_input: { notebook_path: abs(c.file), new_source: c.new_source } }];
  if (c.tool === 'WebFetch') return [{ tool_name: 'WebFetch', cwd: dir, tool_input: { url: c.url, prompt: 'x' } }];
  throw new Error(`모르는 사례: ${JSON.stringify(c)}`);
};

// 모든 훅 시험이 함께 쓰는 자리 PARALLEL 개(Node 를 띄우는 시간이 대부분이라 동시에 돌린다)
let busy = 0;
const waiting = [];
const slot = async (job) => {
  if (busy >= PARALLEL) await new Promise((r) => waiting.push(r));
  busy++;
  try {
    return await job();
  } finally {
    busy--;
    waiting.shift()?.();
  }
};
const pool = (jobs) => Promise.all(jobs.map((j) => slot(j)));

test('packs.json 의 훅마다 엄격 사례가 있다(막음·통과 각 3개 이상), 없는 훅의 사례는 없다', () => {
  const ids = packs.hooks.map((h) => h.id);
  for (const id of ids) {
    assert.ok(CASES[id], `엄격 사례 없음: ${id} — hooks/test/strict-cases 에 더하세요`);
    assert.ok(CASES[id].block.length >= MIN_CASES, `${id}: 막음 사례 ${CASES[id].block.length}개`);
    assert.ok(CASES[id].pass.length >= MIN_CASES, `${id}: 통과 사례 ${CASES[id].pass.length}개`);
  }
  for (const id of Object.keys(CASES)) assert.ok(ids.includes(id), `packs.json 에 없는 훅의 사례: ${id}`);
});

// 사례 하나를 돌려 기대와 다르면 그 설명을 돌려준다.
const check = (want, c, input) => async () => {
  const got = decision(await runHook(input, c.event, tmpRoots.get(input)), c);
  // 막음 사례의 c.decision('deny'·'ask')은 결정 꼴까지, c.reason(정규식)은 글까지 본다 — ask-cmd 의 막기·묻기, GitLab 의 MR 글(2026-11-13)
  const kindOk = !(want === 'block' && got.blocked) || ((!c.decision || got.kind === c.decision) && (!c.reason || c.reason.test(got.reason || '')));
  if (got.blocked === (want === 'block') && kindOk) return null;
  const ti = input.tool_input || {};
  const where = ti.command ?? ti.file_path ?? ti.notebook_path ?? ti.url ?? c.event;
  const wanted = kindOk ? want : `${want}(${c.decision || ''}${c.reason ? ` ${c.reason}` : ''}, 받은 것 ${got.kind || ''})`;
  return `${wanted} 이어야 함 [${input.tool_name || c.event}] ${c.why}: ${JSON.stringify(where).slice(0, 120)}${got.reason ? ` → ${got.reason.slice(0, 160)}` : ''}`;
};

describe('엄격 사례(훅마다 함께 돈다)', { concurrency: true }, () => {
  for (const hook of Object.keys(CASES)) {
    test(`엄격: ${hook} — 약속한 꼴은 막고 비슷한 안전한 꼴은 통과(hooks/run.mjs)`, async () => {
      const spec = CASES[hook];
      // 훅 옵션: 사례의 opts(다른 브랜치 방식 등) > 훅 묶음의 opts > GitHub Flow 값 > true
      const hookOpts = spec.opts || FLOW_OPTS[hook] || true;
      const shared = freshRepo(hook, hookOpts);
      const jobs = [];
      for (const want of ['block', 'pass']) {
        for (const c of spec[want]) {
          const dir = c.setup || c.opts ? freshRepo(hook, c.opts || hookOpts, c.setup) : shared;
          for (const input of inputsOf(c, dir)) jobs.push(check(want, c, input));
        }
      }
      const failures = (await pool(jobs)).filter(Boolean);
      assert.deepEqual(failures, [], failures.join('\n'));
    });
  }
});

// 도구 호출(PreToolUse) 가운데 저장소 준비가 없는 입력은 scripts/test/probes.test.mjs 가 판정(evaluate)을 바로 불러 본다 —
// 여기서는 그 밖의 것(Stop·SessionStart·UserPromptSubmit, 저장소 준비가 있는 것 = ownSpace)만 진입점으로 돌린다.
test('catalog/probes.json 의 시험 입력(때마다·자기 자리)도 실제 진입점에서 block 은 막고 pass 는 통과한다', async () => {
  const dir = makeProbeRepo();
  try {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    const ids = Object.keys(probes).filter((k) => !k.startsWith('_'));
    assert.deepEqual([...ids].sort(), packs.hooks.map((h) => h.id).sort(), 'probes.json 과 packs.json 의 훅 목록이 같아야 한다');
    // 기존 훅을 시험할 때와 같은 길(scripts/lib/existing-hooks.mjs runProbeCase)로 harness-fit 진입점을 돌린다
    const cmd = (event) => ({ command: `"${process.execPath}" "${ENTRY[event]}"`, timeout: 120 });
    const failures = [];
    for (const id of ids) {
      const config = JSON.stringify({ lang: 'en', rules: { [id]: probes[id].opts || FLOW_OPTS[id] || true } });
      const prepare = (d) => {
        fs.mkdirSync(path.join(d, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(d, '.claude', 'harness.json'), config);
      };
      prepare(dir);
      for (const want of ['block', 'pass']) {
        for (const p of probes[id][want].filter(ownSpace)) {
          const [r] = await runProbeCase(p, [cmd(eventOf(p))], { sharedDir: dir, startCommands: [cmd('SessionStart').command], prepare });
          if (r.blocked !== (want === 'block')) failures.push(`${id} ${want} [${eventOf(p)}${ownSpace(p) ? ' · 자기 자리' : ''}]: ${JSON.stringify(p.tool_input || p.checklist || '').slice(0, 100)}`);
        }
      }
    }
    assert.deepEqual(failures, [], failures.join('\n'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
