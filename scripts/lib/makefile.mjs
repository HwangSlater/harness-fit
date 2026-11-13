// Makefile 읽기 — 대상 이름, 낱말 하나인 변수 값, 대상 하나의 레시피. commands.mjs(쓸 명령)·suggest.mjs(묻는 명령)가 함께 쓴다.
// 다 읽지 않는다: 조건문(ifeq)은 양쪽 줄을 모두 레시피로 보고, 함수($(shell …))·포함(include)은 보지 않는다.
import path from 'node:path';
import { readText } from './stack-scan.mjs';

export const makefileText = (root) => ['Makefile', 'makefile', 'GNUmakefile'].map((f) => readText(path.join(root, f))).find(Boolean) || '';

// 대상 머리줄: `test:` · `test::`(두 콜론 규칙) · `unit test:`(한 줄에 여럿) · `test.unit:`. 변수 대입(`x := …`·`x ::= …`)은 아니다.
// m[2] 는 콜론 뒤(의존 대상 · `; 레시피`). 아주 긴 줄은 보지 않는다(낱말 수백만 개 한 줄에서 정규식 스택이 넘쳤다 — 검토 2026-11-12)
const HEAD = /^([A-Za-z][\w.-]*(?:[ \t]+[A-Za-z][\w.-]*)*)[ \t]*::?(?![=:]|:=)(.*)$/;
const DIRECTIVE = /^\s*(?:export|override|define|endef|ifeq|ifneq|ifdef|ifndef|else|endif|include|-include|sinclude|vpath|unexport)\b/;
const COND = /^\s*(?:ifeq|ifneq|ifdef|ifndef|else|endif)\b/;
const HEAD_MAX = 1024;
const parseHead = (raw) => {
  if (raw.length > HEAD_MAX || DIRECTIVE.test(raw)) return null;
  const m = HEAD.exec(raw);
  if (!m) return null;
  const [deps, inline] = m[2].split(/;(.*)/s);
  // 대상별 변수(`test: GOFLAGS := -race`)는 의존 대상이 아니다
  const depList = /[:?+]?=/.test(deps) ? [] : deps.trim().split(/\s+/).filter((d) => /^[A-Za-z][\w.-]*$/.test(d));
  return { targets: m[1].split(/[ \t]+/), deps: depList, inline: inline?.trim() || '' };
};
export const headTargets = (raw) => parseHead(raw)?.targets || null;
export const makeTargets = (text) => [...new Set(text.split(/\r?\n/).flatMap((l) => headTargets(l) || []))];

// 낱말 하나인 변수 값(TF ?= terraform · export GO := go). make 처럼 뒤의 = · := 가 이기고 ?= 는 아직 없을 때만(검토 2026-11-12)
export const makeVars = (text) => {
  const vars = new Map();
  for (const m of text.matchAll(/^(?:(?:export|override)[ \t]+)?([A-Za-z_]\w*)[ \t]*(\?|:|::)?=[ \t]*([\w./-]+)[ \t]*$/gm)) {
    if (m[2] !== '?' || !vars.has(m[1])) vars.set(m[1], m[3]);
  }
  return vars;
};
// $(X)·${X} 를 아는 값으로, 모르면 unknown 으로(주지 않으면 원래 글 그대로)
export const expandVars = (line, vars, unknown) => line.replace(/\$[({]([^)}]*)[)}]/g, (m, n) => vars.get(n) ?? unknown ?? m);

// 대상마다 { lines, deps } → Map. 레시피 줄은 앞 탭·@·+·- 를 떼고, 끝이 \ 인 줄은 다음 줄과 잇고, 주석 줄(#)은 뺀다.
// 레시피 사이의 ifeq·else·endif 는 레시피를 끊지 않는다(양쪽 줄을 다 모은다 — `test:` 아래 ifeq 에서 레시피가 비던 일, 검토 2026-11-12)
export const makeRules = (text) => {
  const out = new Map();
  let cur = null; // 지금 레시피를 받는 대상 이름들(두 콜론 규칙은 같은 대상에 이어 붙는다)
  let carry = '';
  const push = (line) => {
    const l = line.trim();
    if (l && !l.startsWith('#')) for (const t of cur || []) out.get(t).lines.push(l);
  };
  for (const raw of text.split(/\r?\n/)) {
    if (carry) {
      carry += ' ' + raw.trim().replace(/\\$/, '').trim();
      if (!/\\$/.test(raw.trimEnd())) { push(carry); carry = ''; }
      continue;
    }
    const head = !/^\t/.test(raw) && parseHead(raw);
    if (head) {
      cur = head.targets;
      for (const t of cur) {
        if (!out.has(t)) out.set(t, { lines: [], deps: [] });
        out.get(t).deps.push(...head.deps);
      }
      if (head.inline) push(head.inline);
      continue;
    }
    if (!/^\t/.test(raw)) { if (raw.trim() && !raw.trim().startsWith('#') && !COND.test(raw)) cur = null; continue; }
    if (!cur) continue;
    const line = raw.replace(/^\t[@+-]*/, '');
    if (/\\$/.test(line.trimEnd())) carry = line.trimEnd().replace(/\\$/, '');
    else push(line);
  }
  return out;
};
// 대상 → 레시피 줄(Map). commands.mjs·suggest.mjs 가 대상마다 훑는다
export const makeRecipes = (text) => new Map([...makeRules(text)].map(([t, r]) => [t, r.lines]));
// 대상 하나가 실제로 돌리는 줄: 자기 레시피 + 의존 대상의 레시피(`test: test-unit test-race` 꼴, 세 단계까지)
export const recipeOf = (rules, target, depth = 3, seen = new Set()) => {
  const r = rules.get(target);
  if (!r || seen.has(target)) return [];
  seen.add(target);
  return [...(depth > 0 ? r.deps.flatMap((d) => recipeOf(rules, d, depth - 1, seen)) : []), ...r.lines];
};
