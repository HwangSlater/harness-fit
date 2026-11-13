// 역할극 세션 점검: 시험 세션(harness-fit 있음)의 대화 기록을 읽어 skills/setup/SKILL.md 의 auto 절차를
// 빠짐없이·순서대로 따랐는지, 하면 안 되는 일을 했는지, 마지막 보고가 적용 결과의 경고를 다 말했는지 본다.
// 사용: node scripts/dev/roleplay-audit.mjs <저장소 폴더> [--json]
//   대화 기록은 ~/.claude/projects/<폴더 이름을 바꾼 것>/ 에서 첫 사용자 글에 「/harness-fit:setup」 이 든 가장 최근 것.
// 기대하는 일은 STEPS 한 곳에만 적는다(SKILL.md 가 바뀌면 여기도).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STEPS = [
  // 경로는 변수로 줄여 쓰기도 해서(S=…/scripts; node "$S/recommend.mjs") 파일 이름만 본다. 한 명령에 여러 단계를 이어 쓰기도 한다.
  { id: 'detect', re: /detect\.mjs"?\s+\.?\s*--brief/, need: true },
  { id: 'overlap', re: /overlap\.mjs/, need: true },
  { id: 'recommend', re: /recommend\.mjs/, need: true },
  { id: 'dry-run', re: /apply\.mjs[^\n&;|]*--dry-run/, need: true },
  { id: 'apply', re: /apply\.mjs(?![^\n&;|]*--(dry-run|undo|retry))[^\n&;|]*--selection/, need: true },
];
// 하면 안 되는 일
// 플러그인 자리: 개발 폴더(find-your-skill), 역할극 사본(_plugin/<커밋>), 설치 캐시(plugins/cache/…harness-fit…/<판>).
// 읽기 도구(Read·Grep·Glob)로 그 아래 hooks·scripts·picker·rules·config 를 열면 센다(역할극 8 회차: 2건만 세고 4건 넘게 놓침)
const PLUGIN_SRC = /(?:find-your-skill(?!-역할극)|[\\/]_plugin[\\/][^\\/\s"']+|[\\/]plugins[\\/]cache[\\/][^\s"']*harness-fit[^\\/\s"']*(?:[\\/][^\\/\s"']+)?)[\\/](?:hooks|scripts|picker|rules|config)[\\/]/i;
// 셸: 읽는 명령(cat·grep·sed …, node -e 로 파일 읽기)이 플러그인 자리의 소스를 가리킬 때. node <스크립트> 실행은 아님
// 조각마다(; & | 줄바꿈) 그 조각이 읽는 명령이고 같은 조각에 플러그인 소스 경로가 있을 때만(S=… 대입·node 실행 뒤 | head 는 아님)
const SH_READ = /^\s*(?:cat|grep|rg|sed|head|tail|less|awk|type|Get-Content|Select-String|gc)\b|readFileSync/i;
const PLUGIN_SRC_SH = { test: (s) => s.split(/[;&|\n]+/).some((part) => SH_READ.test(part) && PLUGIN_SRC.test(part)) };
const BANNED = [
  { id: 'catalog-read', why: 'SKILL.md: 카탈로그 파일을 직접 읽지 않는다', test: (c) => /catalog[\\/](catalog|packs|combos)\.json/.test(c.text) },
  { id: 'gh-write', why: 'GitHub 쓰기 API 를 직접 부름', test: (c) => /gh\s+api\b.*(-X\s*(POST|PUT|PATCH|DELETE)|--method\s+(POST|PUT|PATCH|DELETE))/i.test(c.text) },
  // 플러그인 소스를 읽어 동작을 알아내려 함 — SKILL.md·--catalog 글로 답할 수 있어야 한다(역할극 2 회차 2차). 스크립트 실행(node …)은 아님
  { id: 'plugin-source-read', why: '플러그인 소스(훅 규칙·lib·화면)를 직접 읽음 — 설명 글이 모자란 곳', test: (c) => (c.kind === 'Bash' ? PLUGIN_SRC_SH : PLUGIN_SRC).test(`${c.text} ${c.path}`) },
  // 조각마다(; & | 줄바꿈): dry-run 조각 뒤에 이어 쓴 적용 조각을 한 줄로 보아 놓치지 않게
  { id: 'github-settings-unasked', why: '사용자가 고르지 않았는데 --github-settings=… 로 적용', test: (c, ctx) => c.kind === 'Bash' && c.text.split(/[;&|\n]+/).some((p) => /apply\.mjs/.test(p) && !/--dry-run/.test(p) && /--github-settings=/.test(p)) && !ctx.userPickedGithub },
];

// 같은 명령 안에서 앞서 담은 셸 변수(NAME="…"·NAME='…'·NAME=…)를 뒤의 "$NAME"·$NAME·${NAME} 자리에 펼친다 —
// P=".../apply.mjs"; node "$P" … --dry-run 을 「dry-run 빠짐」으로 읽던 일(역할극 14·15 회차, 2026-11-13).
// 대입은 조각 맨 앞(명령 처음, ; & | 줄바꿈 뒤, export 뒤)에 있을 때만 — 명령 인자 속 a=b 는 아니다. 펼친 글은 따옴표를 남기지 않는다
const ASSIGN = /(^|[;&|\n]\s*|\bexport\s+)([A-Za-z_]\w*)=(?:"([^"]*)"|'([^']*)'|([^\s;&|"']*))/g;
const USE = /"\$\{?([A-Za-z_]\w*)\}?"|\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g;
// 펼친 값이 거듭 두 배가 되는 꼴(A1="$A0$A0"; A2="$A1$A1" …)에 길이가 지수로 늘었다(검토 2026-11-13) — 값 하나·결과 모두 이 길이에서 자르고, 대입은 이만큼만 본다
const EXPAND_MAX = 10000;
const ASSIGN_MAX = 200;
// 펼쳐서 늘어나는 길이를 EXPAND_MAX 까지만 — 넘으면 남은 자리는 그대로 둔다(원래 글은 자르지 않는다)
const fill = (s, vars) => {
  let grown = 0;
  return s.replace(USE, (all, a, b, c) => {
    const v = vars.get(a || b || c);
    if (v === undefined || grown + v.length > EXPAND_MAX) return all;
    grown += v.length;
    return v;
  });
};
export const expandShellVars = (cmd) => {
  const vars = new Map();
  let n = 0;
  // 앞서 담은 변수를 값 안에서도 펼친다(S=…/scripts; P="$S/apply.mjs")
  for (const m of String(cmd).matchAll(ASSIGN)) {
    if (++n > ASSIGN_MAX) break;
    vars.set(m[2], fill(m[3] ?? m[4] ?? m[5] ?? '', vars).slice(0, EXPAND_MAX));
  }
  return vars.size ? fill(String(cmd), vars) : cmd;
};

const encode = (dir) => path.resolve(dir).replace(/[^A-Za-z0-9]/g, '-');

function findLog(repo) {
  const d = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects', encode(repo));
  const files = fs.readdirSync(d).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(d, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    if (text.includes('/harness-fit:setup')) return f;
  }
  throw new Error(`「/harness-fit:setup」 이 든 대화 기록이 없음: ${d}`);
}

const textOf = (content) => (typeof content === 'string' ? content : (content || []).map((x) => x.text || (typeof x.content === 'string' ? x.content : textOf(x.content)) || '').join('\n'));

export function audit(lines) {
  const calls = []; // { kind: 'bash'|'read', text, out }
  const byId = new Map();
  const users = [];
  const texts = []; // { text, at } — at: 그때까지의 도구 호출 수
  for (const e of lines) {
    const m = e.message;
    if (!m || e.isSidechain) continue;
    if (e.type === 'assistant') {
      for (const c of m.content || []) {
        if (c.type === 'tool_use') {
          const raw = c.input?.command || c.input?.file_path || c.input?.pattern || '';
          const text = c.name === 'Bash' && c.input?.command ? expandShellVars(raw) : raw;
          const call = { kind: c.name, text, path: c.input?.path || '', out: '', at: calls.length };
          calls.push(call);
          byId.set(c.id, call);
        } else if (c.type === 'text' && c.text.trim()) texts.push({ text: c.text, at: calls.length });
      }
    } else if (e.type === 'user') {
      if (Array.isArray(m.content) && m.content.some((c) => c.type === 'tool_result')) {
        for (const c of m.content) if (c.type === 'tool_result' && byId.has(c.tool_use_id)) byId.get(c.tool_use_id).out = textOf(c.content);
      } else if (!e.isMeta && !/^\s*(<(task-notification|system-reminder|local-command|command-)|\[Request interrupted)/.test(textOf(m.content))) users.push({ text: textOf(m.content), at: calls.length });
    }
  }
  const ctx = { userPickedGithub: users.some((u) => /squash|autodelete|pr:|approvals|noforce|nodelete|GitHub\s*설정.*(바꿔|켜)/i.test(u.text) && !/바꾸지\s*말/.test(u.text)) };
  const found = STEPS.map((s) => ({ ...s, at: calls.findIndex((c) => c.kind === 'Bash' && s.re.test(c.text)) }));
  const missing = found.filter((s) => s.need && s.at < 0).map((s) => s.id);
  const order = [];
  for (let i = 1; i < found.length; i++) {
    const prev = found.slice(0, i).filter((s) => s.at >= 0);
    if (found[i].at >= 0 && prev.some((p) => p.at > found[i].at)) order.push(`${found[i].id} 가 앞 단계보다 먼저`);
  }
  // 적용은 사용자가 「적용」 이라고 한 뒤에만
  const applyAt = found.find((s) => s.id === 'apply').at;
  // 적용 바로 앞의 사용자 글이 「적용해 주세요」 꼴이어야 한다 — 앞서 「적용하기 전에 문서로」 같은 글이 있어도 동의가 아니다(역할극 11·12 회차: 선택지 답만 듣고 적용)
  const lastBefore = users.filter((u) => u.at <= applyAt).at(-1);
  const consent = (s) => /적용해\s*(?:주|줘|요)|적용하(?:자|세요)|그대로\s*(?:해|진행)|\bapply\b|go ahead|^\s*(?:네|예|yes|ok)\b/i.test(s) && !/적용하기\s*전/.test(s);
  if (applyAt >= 0 && !(lastBefore && consent(lastBefore.text))) order.push('사용자 동의 전에 적용');
  const violations = calls.flatMap((c) => BANNED.filter((b) => b.test(c, ctx)).map((b) => `${b.id}: ${b.why} — ${c.text.slice(0, 120)}`));
  // 적용 보고(적용 뒤 다음 사용자 글 전까지의 글)가 적용 결과의 경고·실패를 말했는가 — 마지막 인사가 아니라
  const applyOut = applyAt >= 0 ? calls[applyAt].out : '';
  let result = null;
  try { result = JSON.parse(applyOut.slice(applyOut.indexOf('{'))); } catch {}
  const report = [];
  const nextUser = users.find((u) => u.at > applyAt)?.at ?? Infinity;
  const lastAssistant = texts.filter((x) => x.at > applyAt && x.at <= nextUser).map((x) => x.text).join('\n');
  const WARN_WORDS = { 'plugin-missing': /플러그인|plugin/i, 'skill-budget': /예산|budget|한도|용량|목록.*(넘|가까)|d+s*%/i, 'claude-ignored': /gitignore|무시/i, 'git-hook-exists': /pre-commit|커밋 훅/i };
  for (const w of result?.warnings || []) {
    const code = typeof w === 'string' ? w : w.code;
    if (WARN_WORDS[code] && !WARN_WORDS[code].test(lastAssistant)) report.push(`경고 ${code} 를 보고에서 말하지 않음`);
  }
  if ((result?.failed || []).length && !/실패|failed|retry/i.test(lastAssistant)) report.push('실패한 스킬을 보고에서 말하지 않음');
  if (result && !/undo/.test(lastAssistant)) report.push('되돌리기(/harness-fit:setup undo)를 말하지 않음');
  return { missing, order, violations, report, steps: found.map((s) => `${s.id}:${s.at}`), users: users.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) { // pathname 은 한글 폴더를 %EC… 로 남겨 직접 실행을 못 알아봤다(2026-11-13)
  const repo = process.argv[2];
  if (!repo) { console.error('사용: node scripts/dev/roleplay-audit.mjs <저장소 폴더> [--json]'); process.exit(2); }
  const file = findLog(repo);
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
  const r = audit(lines);
  if (process.argv.includes('--json')) console.log(JSON.stringify({ file, ...r }, null, 2));
  else {
    console.log(`기록: ${file}`);
    console.log(`빠진 일 ${r.missing.length}: ${r.missing.join(', ') || '-'}`);
    console.log(`순서 ${r.order.length}: ${r.order.join(' / ') || '-'}`);
    console.log(`어긴 일 ${r.violations.length}: ${r.violations.join(' / ') || '-'}`);
    console.log(`보고 빠짐 ${r.report.length}: ${r.report.join(' / ') || '-'}`);
  }
  process.exit(r.missing.length + r.order.length + r.violations.length + r.report.length ? 1 : 0);
}
