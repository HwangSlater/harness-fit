// GitHub Actions 워크플로(.github/workflows/*.yml)의 흔한 구멍 찾기.
//   1. run: 안에 바깥 사람이 정하는 값(이슈·PR 제목·본문, 커밋 메시지, PR 브랜치 이름 등)을 ${{ }} 로 바로 넣기 — 명령 주입
//   2. pull_request_target 에서 PR 쪽 코드(head.sha·head.ref)를 checkout — 비밀값이 있는 권한으로 남의 코드를 돌린다
//   3. 남이 만든 액션을 태그·브랜치로 쓰기(uses: owner/repo@v1) — 태그는 옮겨질 수 있어 커밋 해시(40자)로 고정한다
// YAML 라이브러리 없이 줄 단위로 읽는다. 쓴 뒤 파일 전체를 보고, 쓰기 전 파일에 이미 있던 것은 막지 않는다.
import { git } from './core.mjs';
import { normPath, targetFile, fileAfter } from './lines.mjs';
import { allowOf, recordAllow } from './allow.mjs';

export const isWorkflow = (file) => /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i.test(normPath(file));

// 바깥 사람이 정하는 값. github.event 아래 이 자리에서 시작해 이 이름으로 끝나는 것만 본다
// (github.event.repository.name·inputs.* 처럼 저장소 쪽이 정하는 값은 빼려고).
const UNTRUSTED_ROOT = /^github\.event\.(?:issue|pull_request|comment|review|review_comment|discussion|discussion_comment|head_commit|commits|pages|workflow_run|check_suite)\b/;
const UNTRUSTED_LEAF = /\.(?:title|body|message|name|label|ref|head_ref|default_branch|email|page_name|head_branch)$/;
// PR 의 base 쪽(이 저장소의 브랜치), 워크플로·앱 이름, workflow_run 의 저장소 정보는 이 저장소가 정한다
const TRUSTED_PART = /\.base\.|^github\.event\.workflow_run\.(?:name$|repository\.)|\.app\.name$/;
// 식 하나는 다음 `${{`·`[` 를 넘지 않는다 — 닫히지 않은 `${{ ${{ …` 에서 자리마다 줄 끝까지 읽어 길이의 제곱만큼 걸렸다(2026-11-06 crash 시험).
const PATH = /github(?:\.[\w-]+|\[[^\]\[]*\]|\.\*)+/g;
const EXPR = /\$\{\{((?:[^}$]|\$(?!\{\{))*)\}\}/g;

export const untrustedIn = (expr) => {
  const out = [];
  for (const m of expr.matchAll(PATH)) {
    const p = m[0].replace(/\[[^\]]*\]/g, '.*').replace(/\.\*\.\*/g, '.*');
    if (p === 'github.head_ref' || (UNTRUSTED_ROOT.test(p) && UNTRUSTED_LEAF.test(p) && !TRUSTED_PART.test(p))) out.push(m[0]);
  }
  return out;
};

// 명령·코드가 들어가는 자리: run:(셸), script:(actions/github-script 의 JS, ssh 액션의 셸 등)
const RUN_KEY = /^(\s*)(?:-\s+)?(?:run|script)\s*:\s?(.*)$/;
const BLOCK_SCALAR = /^[|>][+-]?\d*\s*(?:#.*)?$/;
const indentOf = (l) => l.match(/^\s*/)[0].length;

// run: 값의 줄들 [{ row, text }]
const runLines = (rows) => {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    if (/^\s*#/.test(rows[i])) continue;
    // 한 줄 꼴 { name: x, run: "…" }
    const flow = rows[i].match(/[{,]\s*(?:run|script)\s*:\s*(.*)$/);
    if (flow) out.push({ row: i, text: flow[1] });
    const m = rows[i].match(RUN_KEY);
    if (!m) continue;
    const keyIndent = indentOf(rows[i]) + (rows[i].trimStart().startsWith('-') ? 2 : 0);
    if (!BLOCK_SCALAR.test(m[2].trim())) out.push({ row: i, text: m[2] });
    // 블록 글(| >)의 줄들, 또는 여러 줄로 이어 쓴 보통 글(키보다 더 들여 쓴 다음 줄들)
    for (let k = i + 1; k < rows.length; k++) {
      if (rows[k].trim() && indentOf(rows[k]) <= keyIndent) break;
      out.push({ row: k, text: rows[k] });
    }
  }
  return out;
};

const PRT = /^on\s*:.*\bpull_request_target\b|^\s+pull_request_target\s*:?\s*$|^\s+pull_request_target\s*:|^\s*-\s*pull_request_target\s*$/m;
// PR 쪽 코드를 가리키는 checkout 입력: ref 에 head.sha·head.ref·head_ref·refs/pull/…, repository 에 PR 쪽 저장소
const PR_HEAD = String.raw`(?:github\.event\.pull_request\.head\.(?:sha|ref)|github\.head_ref)`;
const HEAD_CHECKOUT = new RegExp(String.raw`^\s*(?:ref\s*:\s*["']?(?:\$\{\{[^}]*${PR_HEAD}|[^#\n]*refs/pull/)|repository\s*:\s*["']?\$\{\{[^}]*github\.event\.pull_request\.head\.repo\.full_name)`);
const CHECKOUT = /\buses\s*:\s*["']?actions\/checkout@/;
// run: 안에서 PR 코드를 받는 명령
const RUN_PR_FETCH = /\bgh\s+pr\s+checkout\b|\bgit\s+fetch\b[^\n]*\bpull\/|\brefs\/pull\//;

const USES = /^\s*(?:-\s+)?uses\s*:\s*["']?([^\s"'#]+)/;
const SHA = /^[0-9a-f]{40}$/;
const TRUSTED_OWNERS = new Set(['actions', 'github']);

// 이 저장소의 owner(origin 주소에서). 같은 조직의 재사용 워크플로는 남의 코드가 아니다.
const ownOwner = (cwd) => {
  const url = (git(cwd, ['config', '--get', 'remote.origin.url']) || '').trim();
  const m = url.match(/[:/]([^/:]+)\/[^/]+?(?:\.git)?$/);
  return m ? m[1].toLowerCase() : null;
};

// 파일 내용 → 찾은 것 [{ kind, value, row, allow }]. allow: 그 줄(또는 바로 위 주석 줄)의 허용 주석(allow.mjs allowOf 의 결과, 없으면 null).
// 허용했는지는 여기서 정하지 않고 표시만 한다 — 쓰기 전 파일에 이미 있던 것인지 newWorkflowHits 가 가른 뒤에 알린다.
export const scanWorkflow = (text, owner) => {
  const rows = String(text || '').split(/\r?\n/);
  const out = [];
  const at = (row) => allowOf(rows[row], row > 0 ? rows[row - 1] : null, 'gha-inject');
  const push = (kind, value, row) => out.push({ kind, value, row, allow: at(row) });
  for (const { row, text: t } of runLines(rows)) {
    for (const m of t.matchAll(EXPR)) for (const v of untrustedIn(m[1])) push('run', v, row);
  }
  if (PRT.test(text)) {
    // PR 코드 받기는 파일에 하나만 알린다: 허용하지 않은 줄이 있으면 그 줄, 모두 허용했으면 첫 줄(허용 알림용)
    const rowsOf = (keep) => rows.map((l, i) => (keep(l) ? i : -1)).filter((i) => i !== -1);
    const found = [
      ...(CHECKOUT.test(text) ? rowsOf((l) => HEAD_CHECKOUT.test(l)) : []),
      ...runLines(rows).map((x) => x.row).filter((i) => RUN_PR_FETCH.test(rows[i])),
    ];
    const row = found.find((i) => !at(i)?.reason) ?? found[0];
    if (row !== undefined) push('prt', rows[row].trim(), row);
  }
  rows.forEach((l, row) => {
    const m = l.match(USES);
    if (!m || /^\s*#/.test(l)) return;
    const ref = m[1];
    if (ref.startsWith('./') || ref.startsWith('docker://') || !ref.includes('@')) return;
    const [name, version] = [ref.slice(0, ref.lastIndexOf('@')), ref.slice(ref.lastIndexOf('@') + 1)];
    const who = name.split('/')[0].toLowerCase();
    if (TRUSTED_OWNERS.has(who) || who === owner || SHA.test(version)) return;
    push('pin', ref, row);
  });
  return out;
};

// 전·후 워크플로 글 → 새로 생긴 것 중 막을 것 [{ kind, value }]. 쓰기 검사와 커밋 검사가 같이 쓴다.
// 허용 주석으로 넘긴 새 것은 report 에 적는다(file:줄). 같은 것이 허용한 줄과 안 한 줄에 다 있으면 막는다.
export const newWorkflowHits = (before, after, owner, report = null, file = '') => {
  if (after == null) return [];
  const key = (x) => `${x.kind}\0${x.value}`;
  const old = new Set(before == null ? [] : scanWorkflow(before, owner).map(key));
  const block = new Map();
  const pass = new Map();
  for (const x of scanWorkflow(after, owner)) {
    const k = key(x);
    if (old.has(k)) continue;
    if (report && x.allow?.reason) {
      if (!pass.has(k)) pass.set(k, x);
      continue;
    }
    if (report && x.allow?.noReason) report.noReason.add('gha-inject');
    if (!block.has(k)) block.set(k, { kind: x.kind, value: x.value });
  }
  for (const [k, x] of pass) if (!block.has(k)) recordAllow(report, 'gha-inject', file, x.row + 1, x.allow.reason);
  return [...block.values()];
};

export { ownOwner };

// 반환: 이번 쓰기로 새로 생긴 것 [{ kind, value }]. report 를 주면 허용 주석을 받는다.
export const findGhaInject = (ti, cwd, report = null) => {
  const file = targetFile(ti);
  if (!isWorkflow(file)) return [];
  const { before, after } = fileAfter(ti, cwd);
  return newWorkflowHits(before, after, ownOwner(cwd), report, file);
};
