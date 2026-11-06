// 이 프로젝트에 이미 들어와 있는 것: 플러그인, 스킬. 중복으로 또 넣지 않으려고 본다(2026-11-05 사용자 요청).
// scope: user(이 PC 의 나만) · project(저장소에 있어 팀원도 받음) · project-local(이 PC 의 이 저장소만)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SELF = 'harness-fit@harness-fit';
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

// installed_plugins.json 에서 이 프로젝트에 켜진 플러그인(자기 자신은 뺌)
export const listPlugins = (root, home = os.homedir()) => {
  const j = readJson(path.join(home, '.claude', 'plugins', 'installed_plugins.json'));
  const out = [];
  for (const [id, installs] of Object.entries(j?.plugins || {})) {
    if (id === SELF) continue;
    for (const p of installs || []) {
      if (!p.installPath || !fs.existsSync(p.installPath)) continue;
      if (p.scope === 'user') out.push({ id, scope: 'user', dir: p.installPath });
      else if (p.projectPath && samePath(p.projectPath, root)) out.push({ id, scope: p.scope === 'project' ? 'project' : 'project-local', dir: p.installPath });
    }
  }
  return out;
};

// harness-fit 플러그인이 이 프로젝트에서 켜져 있는지 — 훅은 플러그인으로만 돈다. npx 로 적용하면 harness.json 은 써져도 아무것도 막지 않는다(2026-11-05 검토).
// 플러그인 안에서 돌고 있으면(CLAUDE_PLUGIN_ROOT) 켜진 것, 아니면 installed_plugins.json 에 이 프로젝트(또는 사용자 범위)로 깔렸는지 본다.
export const pluginActive = (root, home = os.homedir()) => {
  if (process.env.CLAUDE_PLUGIN_ROOT && /harness-fit/i.test(process.env.CLAUDE_PLUGIN_ROOT)) return true;
  const j = readJson(path.join(home, '.claude', 'plugins', 'installed_plugins.json'));
  return (j?.plugins?.[SELF] || []).some((p) => p.scope === 'user' || (p.projectPath && samePath(p.projectPath, root)));
};

// SKILL.md 머리말의 name·description 만 읽는다(본문은 안 읽음 — 문맥에 안 넣으려고)
const frontmatter = (file) => {
  let head = '';
  try { head = fs.readFileSync(file, 'utf8').slice(0, 4000); } catch { return null; }
  const m = head.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const get = (k) => (m[1].match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1] || '').trim().replace(/^["']|["']$/g, '');
  return { name: get('name'), description: get('description') };
};

const skillsIn = (dir) => {
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
  return names.map((n) => ({ folder: n, dir: path.join(dir, n) })).filter((s) => fs.existsSync(path.join(s.dir, 'SKILL.md')));
};

// 이미 있는 스킬. harness-fit 이 전에 넣은 것(.harness-source.json 이 있는 폴더)은 「이미 있음」이 아니라 다시 적용할 대상이라 뺀다.
// description 은 화면·Claude 비교용으로 짧게 자른다.
export const listSkills = (root, home = os.homedir(), plugins = listPlugins(root, home)) => {
  const DESC_MAX = 200;
  const places = [
    ['project', path.join(root, '.claude', 'skills'), null],
    ['user', path.join(home, '.claude', 'skills'), null],
    ...plugins.map((p) => [p.scope, path.join(p.dir, 'skills'), p.id]),
  ];
  const out = [];
  for (const [scope, dir, plugin] of places) {
    for (const s of skillsIn(dir)) {
      if (!plugin && scope === 'project' && fs.existsSync(path.join(s.dir, '.harness-source.json'))) continue;
      const fm = frontmatter(path.join(s.dir, 'SKILL.md')) || {};
      out.push({ id: s.folder, name: fm.name || s.folder, description: (fm.description || '').slice(0, DESC_MAX), scope, plugin });
    }
  }
  return out;
};
