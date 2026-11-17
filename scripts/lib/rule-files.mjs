// 규칙 조각 파일(rules/<id>.<lang>.md) 읽기와 줄 끝 표시. CLAUDE.md 문장 만들기(claude-md.mjs)와 토큰 어림(tokens.mjs)이 같이 쓴다.
// 줄 끝 표시: {{hook:id}} 켜졌을 때만 · {{!hook:id}} 꺼졌을 때만 · {{!skill:a|b}} 그 스킬이 없을 때만 · {{judge}} 늘(claude-md.mjs 머리 설명).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PLUGIN_ROOT } from './paths.mjs';

// m[1] = '!'(꺼졌을 때만) 또는 '', m[2] = hook|skill(judge 면 비어 있음), m[3] = id 들(| 로 이음)
// m[4] = 저장소 종류 조건(뒤에 덧붙임): `… {{judge}} {{kind:web|backend}}` 는 그 종류(detect.mjs KIND) 저장소에서만 넣는다.
//   화면 없는 로봇·연구 저장소에 웹 보안 줄이 들어가던 일(역할극 2·3 회차, 2026-11-11). 종류를 모르면(옛 선택 파일) 넣는다.
// m[5]·m[6] = 감지한 형식 조건(맨 뒤): `… {{!fmt:commit}}` 은 커밋 형식을 감지해 「커밋·PR 형식」 지침이 그 형식을 적을 때 뺀다
//   (협업 지침의 「타입: 설명」 과 저장소 꼴 줄이 함께 들어가지 않게, 2026-11-17). 형식 글은 claude-md.mjs 가 rules/vcs-format 이 들어갈 때만 넘긴다.
export const TAG = /\s*\{\{(?:(!?)(hook|skill):([\w|-]+)|judge)\}\}(?:\s*\{\{kind:([\w|-]+)\}\})?(?:\s*\{\{(!?)fmt:([\w|-]+)\}\})?\s*$/;
// 형식 조건이 맞는지. fmt: 채울 형식 글({ commit: '…' } — 없으면 감지하지 못한 것)
export const fmtFits = (m, fmt) => {
  if (!m?.[6]) return true;
  const has = m[6].split('|').some((k) => !!fmt?.[k]);
  return m[5] === '!' ? !has : has;
};
// 종류를 모르는 저장소(general — KIND 표에 없는 Fastify·Rails·PHP 등)도 넣는다: 보안 줄이 조용히 빠지지 않게(검토 2026-11-11)
// 앱 코드가 없는 저장소(인프라만)와 모바일 앱에는 detect 가 general 을 두지 않는다 — 웹·서버 줄(로그인 검사)이 빠진다(역할극 15·16 회차, 2026-11-13).
// 다만 html·js 는 저장소 파일로 확인한 것이라 general 이어도 넣지 않는다(HTML 없는 저장소에 「HTML 이스케이프」 줄 — 역할극 12 회차, 2026-11-11)
// pinned(의존성을 범위로 두지 않음)·helm(차트 있음)·argocd(Argo CD 앱 정의 있음)·terraform(.tf 있음)도 같다. auth(로그인 단서)는 아니다 — {{kind:backend|auth}} 는 종류를 모르는 서버(Fastify·PHP)에도 넣는다
const EVIDENCE = new Set(['html', 'js', 'pinned', 'helm', 'argocd', 'terraform', 'ansible']);
export const kindFits = (m, kinds) => {
  if (!m?.[4] || !Array.isArray(kinds)) return true;
  const tags = m[4].split('|');
  if (tags.some((k) => kinds.includes(k))) return true;
  return kinds.includes('general') && !tags.some((k) => EVIDENCE.has(k));
};

const FILE = /^(.+)\.(ko|en)\.md$/;

// 규칙 하나의 줄들. 파일이 없으면 null.
export const ruleFileLines = (id, lang, root = PLUGIN_ROOT) => {
  const file = path.join(root, 'rules', `${id}.${lang}.md`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : null;
};

// 규칙 하나의 「- 」 줄들(번호 = 이 배열 자리 + 1 — overlap.mjs ruleLines·renderRuleDetail 과 같은 번호)
export const bulletLines = (id, lang) => (ruleFileLines(id, lang) || []).filter((l) => /^- /.test(l));

// 줄 글의 지문: 「- 」·줄 끝 표시·{{cmd:…}} 를 빼고 공백을 모은 글의 sha256 앞 12자.
// 사용자 규칙과 반대 기록(lib/conflicts.mjs)이 줄 번호 대신 이것으로 줄을 다시 찾는다 — 플러그인 업데이트로 줄이 끼어들어도 엉뚱한 줄을 빼지 않게
export const lineHash = (line) => crypto.createHash('sha256')
  .update(String(line).replace(/^- /, '').replace(TAG, '').replace(/\{\{cmd:[^}]*\}\}/g, '').replace(/\s+/g, ' ').trim())
  .digest('hex').slice(0, 12);
// 지문이 같은 줄의 지금 번호(없으면 null — 그 줄이 바뀌었거나 없어졌다)
export const lineByHash = (id, lang, hash) => {
  const i = bulletLines(id, lang).findIndex((l) => lineHash(l) === hash);
  return i < 0 ? null : i + 1;
};

// 그 언어의 규칙 파일 모두 → [[id, 줄들]](폴더에 있는 순서)
export const ruleFiles = (lang, root = PLUGIN_ROOT) => {
  const out = [];
  for (const f of fs.readdirSync(path.join(root, 'rules'))) {
    const m = f.match(FILE);
    if (m && m[2] === lang) out.push([m[1], fs.readFileSync(path.join(root, 'rules', f), 'utf8').split(/\r?\n/)]);
  }
  return out;
};
