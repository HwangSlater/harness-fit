// setup 때 Claude 가 「이미 있는 것과 겹치는지」 견주려고 읽는 짧은 목록(JSON).
// 같은 이름의 스킬·같은 일을 하는 훅은 스크립트가 알아서 뺀다(scripts/lib/existing.mjs). 여기 것은 판단이 필요한 것만:
//   - installed: 이미 깔린 스킬의 이름·설명 ↔ catalog: harness-fit 스킬의 쉬운 이름·쓰는 때 → 하는 일이 같으면 --similar "<id>=<이미 있는 이름>"
//   - rules: harness-fit 이 CLAUDE.md 에 넣는 규칙 줄(번호 붙임) ↔ 사용자가 쓴 CLAUDE.md 글 → 같은 말이면 --skip "<규칙 id>:<번호>"
//     견줄 글: 전역 CLAUDE.md 와 프로젝트 CLAUDE.md(이미 대화에 들어와 있음). 프로젝트 CLAUDE.md 에 관리 구역이 있으면 그것을 뺀 글을 projectClaudeMd 로 준다.
//     사용자가 쓴 .claude/rules/ 규칙 파일(프로젝트·~/.claude)은 userRules 로 준다.
// 사용: node scripts/overlap.mjs [프로젝트] [--lang ko|en]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from './lib/args.mjs';
import { loadAll, PLUGIN_ROOT } from './lib/catalog.mjs';
import { listSkills } from './lib/installed.mjs';
import { TAG, START, END, setBlock, fillCmd } from './lib/claude-md.mjs';
import { detectCommands } from './lib/commands.mjs';
import { listUserRules } from './lib/user-rules.mjs';

// 프로젝트 CLAUDE.md 에서 사용자가 쓴 글만(harness-fit 이 전에 넣은 관리 구역은 뺀다).
// 관리 구역까지 견주면 지난번에 넣은 줄이 모두 「이미 있음」으로 보여 다시 적용할 때 규칙이 통째로 빠진다.
// 관리 구역이 없으면 undefined — 대화에 들어와 있는 CLAUDE.md 가 곧 사용자 글이라 다시 보내지 않는다(토큰).
export const ownClaudeMd = (root) => {
  let text;
  try { text = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'); } catch { return undefined; }
  if (!text.includes(START) || !text.includes(END)) return undefined;
  const own = setBlock(text, '');
  return own === text ? undefined : own.trim();
};

// 규칙 파일의 「- 」 줄에 번호를 붙인다(번호는 renderRule 의 skip 과 같은 순서). 훅에 따라 바뀌는 줄은 언제 들어가는지 적는다.
// cmds: 이 저장소 명령(scripts/lib/commands.mjs) — {{cmd:종류}} 를 채우고, 명령이 없는 줄은 뺀다(번호는 그대로).
export const ruleLines = (lang, ids, cmds = {}) => Object.fromEntries(ids.map((id) => {
  const file = path.join(PLUGIN_ROOT, 'rules', `${id}.${lang}.md`);
  if (!fs.existsSync(file)) return [id, []];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => /^- /.test(l));
  return [id, lines.map((l, i) => {
    const m = l.match(TAG);
    const filled = fillCmd(l, cmds);
    if (filled == null) return null;
    const text = filled.replace(TAG, '').slice(2);
    return { n: i + 1, text, ...(m?.[2] ? { when: `${m[2]} ${m[1] ? 'off' : 'on'}:${m[3]}` } : {}) };
  }).filter(Boolean)];
}));

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { lang, root } = parseArgs(process.argv.slice(2));
  const all = loadAll();
  const titles = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'catalog', 'titles.json'), 'utf8'));
  const L = (o) => (o ? o[lang] || o.en : '');
  const installed = listSkills(root).map(({ id, name, description, scope, plugin }) => ({ name: name || id, description, scope, ...(plugin ? { plugin } : {}) }));
  const out = {
    installed,
    catalog: installed.length ? all.catalog.skills.map((s) => ({ id: s.id, title: L(titles[s.id]?.title) || s.id, when: L(titles[s.id]?.when) || L(s.summary) })) : [],
    rules: ruleLines(lang, [...all.packs.rules.map((r) => r.id), ...all.packs.flows.filter((f) => f.id !== 'none').map((f) => f.id)], detectCommands(root).commands),
  };
  const own = ownClaudeMd(root);
  if (own !== undefined) out.projectClaudeMd = own;
  // 사용자가 쓴 .claude/rules/ 규칙(프로젝트·~/.claude). paths 없는 것은 이미 대화에 들어와 있지만, paths 가 있는 것은 아니므로 글을 함께 준다.
  const rulesFiles = listUserRules(root);
  if (rulesFiles.length) out.userRules = rulesFiles;
  process.stdout.write(JSON.stringify(out) + '\n');
}
