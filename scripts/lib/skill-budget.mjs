// 지금 이 프로젝트에서 Claude 가 늘 보는 스킬 목록의 크기(글자 수)와 예산. 셈은 picker/budget.js 와 같은 함수.
// 세는 곳(code.claude.com/docs/en/skills 「Where skills live」): 사용자 ~/.claude/skills·commands, 프로젝트 .claude/skills·commands,
// 이 프로젝트에서 켜진 플러그인의 skills·commands(이름은 「플러그인:스킬」). 명령(.md)은 스킬과 합쳐져 같은 목록에 든다.
// 가정(문서에 없음): 번들 스킬·MCP 는 세지 않는다. 하위 폴더의 .claude/skills(모노레포)는 그 폴더 파일을 열 때 들어오므로 세지 않는다.
// 읽지 못한 파일·폴더는 건너뛴다(목록이 조금 작게 나올 뿐 적용을 막지 않는다).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listPlugins } from './installed.mjs';
import { skillMeta } from './skill-meta.mjs';
import { entryChars, budgetOf, trimPlan, trimTier, DESC_CAP, DEFAULT_BUDGET } from '../../picker/budget.js';
import { PLUGIN_ROOT } from './catalog.mjs';

const HEAD_BYTES = 64 << 10; // 머리말 + 첫 문단이면 충분하다(본문 전체는 읽지 않는다)
const CHARS_PER_TOKEN = 4; // 가정: 문맥 창 1%(200k 토큰 → 2,000 토큰)가 기본 8,000자와 맞도록 토큰 하나를 4자로 본다

const readHead = (file) => {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    return buf.subarray(0, fs.readSync(fd, buf, 0, HEAD_BYTES, 0)).toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
};
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; } };
const dirs = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } };
// 스킬 폴더는 링크(심볼릭 링크·Windows 정션)로 둔 경우가 많다 — 이 PC 사용자 스킬 13개 중 6개. 링크면 가리키는 곳이 폴더인지 본다.
const isDir = (base, d) => d.isDirectory() || (d.isSymbolicLink() && (() => { try { return fs.statSync(path.join(base, d.name)).isDirectory(); } catch { return false; } })());

// 한 곳(skills 폴더 + commands 폴더)의 목록 줄. prefix: 플러그인 이름(「플러그인:」)
const entriesIn = (base, prefix, cap) => {
  const out = [];
  const add = (text, fallback) => {
    if (text == null) return;
    const m = skillMeta(text, fallback);
    if (m.hidden) return; // disable-model-invocation: true 는 목록에 안 든다
    const name = prefix ? `${prefix}:${m.name}` : m.name;
    out.push({ name, chars: entryChars(name, m.description, m.whenToUse, cap) });
  };
  for (const d of dirs(path.join(base, 'skills'))) if (isDir(path.join(base, 'skills'), d)) add(readHead(path.join(base, 'skills', d.name, 'SKILL.md')), d.name);
  for (const f of dirs(path.join(base, 'commands'))) if (f.isFile() && f.name.endsWith('.md')) add(readHead(path.join(base, 'commands', f.name)), f.name.slice(0, -3));
  return out;
};

// 사용자 → 프로젝트 → 로컬 설정을 겹친다(뒤가 이긴다). env·enabledPlugins 는 키마다 합친다.
const mergedSettings = (root, home) => {
  const files = [path.join(home, '.claude', 'settings.json'), path.join(root, '.claude', 'settings.json'), path.join(root, '.claude', 'settings.local.json')];
  const out = { env: {}, enabledPlugins: {} };
  for (const s of files.map(readJson)) {
    if (!s || typeof s !== 'object') continue;
    for (const [k, v] of Object.entries(s)) {
      if ((k === 'env' || k === 'enabledPlugins') && v && typeof v === 'object') Object.assign(out[k], v);
      else if (k !== 'env' && k !== 'enabledPlugins') out[k] = v;
    }
  }
  return out;
};

const posInt = (v) => (/^\d+$/.test(String(v ?? '').trim()) && Number(v) > 0 ? Number(v) : null);

// 예산: SLASH_COMMAND_TOOL_CHAR_BUDGET(지금 환경 → 설정 env) > skillListingBudgetFraction × 문맥 창 > 기본 8,000자.
// 문맥 창은 모델마다 달라 알 수 없으므로 config/picker.json 의 contextTokens(200k)로 본다 — 1M 모델이면 실제 예산은 더 크다.
export const budgetFrom = (settings, env, contextTokens) => {
  const e = posInt(env.SLASH_COMMAND_TOOL_CHAR_BUDGET) ?? posInt(settings.env?.SLASH_COMMAND_TOOL_CHAR_BUDGET);
  if (e) return { budget: e, budgetSource: 'env' };
  const f = Number(settings.skillListingBudgetFraction);
  if (Number.isFinite(f) && f > 0 && f <= 1 && Number.isFinite(contextTokens)) return { budget: Math.round(f * contextTokens * CHARS_PER_TOKEN), budgetSource: 'fraction' };
  return { budget: DEFAULT_BUDGET, budgetSource: 'default' };
};

// 지금 목록: { current, count, budget, budgetSource, maxDesc, places: [{ where, n, chars }], present: [프로젝트 .claude/skills 폴더 이름] }
// 플러그인은 installed_plugins.json 에 이 프로젝트(또는 사용자 범위)로 깔렸고 설정 enabledPlugins 에서 false 가 아닌 것.
// contextTokens 를 주지 않으면 config/picker.json 의 값(화면의 「기억 공간의 N%」와 같은 값)
const configTokens = () => readJson(path.join(PLUGIN_ROOT, 'config', 'picker.json'))?.contextTokens;
export const currentListing = (root, { home = os.homedir(), env = process.env, contextTokens = configTokens() } = {}) => {
  const settings = mergedSettings(root, home);
  const maxDesc = posInt(settings.skillListingMaxDescChars) ?? DESC_CAP;
  const places = [
    ['user', path.join(home, '.claude'), ''],
    ['project', path.join(root, '.claude'), ''],
    ...listPlugins(root, home).filter((p) => settings.enabledPlugins[p.id] !== false).map((p) => [`plugin:${p.id}`, p.dir, p.id.split('@')[0]]),
  ];
  const seen = new Set(); // 같은 플러그인이 두 범위로 깔렸으면 한 번만
  const rows = [];
  for (const [where, base, prefix] of places) {
    if (seen.has(where)) continue;
    seen.add(where);
    const list = entriesIn(base, prefix, maxDesc);
    rows.push({ where, n: list.length, chars: list.reduce((a, x) => a + x.chars, 0) });
  }
  const present = dirs(path.join(root, '.claude', 'skills')).filter((d) => isDir(path.join(root, '.claude', 'skills'), d)).map((d) => d.name);
  return {
    current: rows.reduce((a, r) => a + r.chars, 0),
    count: rows.reduce((a, r) => a + r.n, 0),
    ...budgetFrom(settings, env, contextTokens),
    maxDesc,
    places: rows.filter((r) => r.n),
    present,
  };
};

// 적용 계획의 예산 줄(apply.mjs plan → 결과 JSON skillBudget). fresh: 새로 들어갈 카탈로그 스킬 id(폴더가 아직 없는 것).
// trim: 「권장대로 줄이기」로 뺄 스킬(화면과 같은 차례 — 조합 목록은 combos.json 원래 목록, 스택 맞춤은 stackAddons 전부로 본다).
export const planBudget = (all, sel, fresh, listing) => {
  const added = fresh.map((id) => all.catalog.skills.find((k) => k.id === id)).filter(Boolean);
  const b = budgetOf(listing, added);
  if (b.level === 'ok') return { ...b, trim: [] };
  const combo = all.combos.combos.find((c) => c.id === sel.combo);
  const overlaps = readJson(path.join(PLUGIN_ROOT, 'catalog', 'overlaps.json'))?.groups?.map((g) => g.skills) || [];
  const byId = new Map(added.map((k) => [k.id, k]));
  const tierOf = trimTier({ comboSkills: new Set(combo?.skills || []), stackSkills: new Set((all.combos.stackAddons || []).flatMap((a) => a.skills)), overlaps }, fresh, (id) => byId.get(id)?.descChars ?? 0);
  return { ...b, trim: trimPlan(listing, added, tierOf) };
};
