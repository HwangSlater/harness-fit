// 글자를 HTML 로 넣거나 문자열을 코드로 실행하는 줄 찾기(XSS·코드 주입). 적어 둔 꼴만 본다(packs.json detail 과 같은 목록).
// 패턴은 이 파일 자신과 맞지 않게 적는다(낱말 가운데를 [] 로 감싸 둔다).
import { isTestFile } from './secrets.mjs';
import { commentOnly, extOf, normPath, OUTSIDE_CODE } from './lines.mjs';

const TARGET = new Set(['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts', 'vue', 'svelte', 'astro', 'html', 'htm']);
export const unsafeHtmlTarget = (file) => TARGET.has(extOf(file)) && !isTestFile(file) && !OUTSIDE_CODE.test(normPath(file));

// 정화·이스케이프를 거친 줄은 넣는 쪽 검사에서 뺀다(eval·new Function 은 정화로 안전해지지 않으므로 그대로 본다).
const SANITIZED = /\bsanitize\w*\s*\(|DOMPurify|\bescape(?:Html|HTML)\s*\(/;
// 따옴표 하나로 끝나는 고정 글자(`= ''`, `= '<br>'`)는 사용자 입력이 섞이지 않는다.
const LITERAL_ONLY = /^\s*(?:'[^'\\]*'|"[^"\\]*"|`[^`$\\]*`)\s*(?:;|$)/;

const SINKS = [
  { id: 'innerHTML', re: /\.(?:inner|outer)HT[M]L\s*\+?=(?!=)|\[\s*['"`](?:inner|outer)HT[M]L['"`]\s*\]\s*\+?=(?!=)/, literalOk: true },
  { id: 'insertAdjacentHTML', re: /\.insertAdjacentHT[M]L\s*\(/ },
  { id: 'document.write', re: /\bdocument\.writ[e](?:ln)?\s*\(/ },
  { id: 'dangerouslySet' + 'InnerHTML', re: /\bdangerouslySetInnerHT[M]L\b/ },
  { id: 'v-html', re: /(?:^|\s)v-ht[m]l\s*=/ },
  { id: '{@html}', re: /\{@ht[m]l\s/ },
  { id: 'set:html', re: /(?:^|\s)set:ht[m]l\s*=/ },
  { id: '[innerHTML]', re: /\[(?:inner|outer)HT[M]L\]\s*=/ },
  { id: 'bypassSecurityTrustHtml', re: /\.bypassSecurityTrus[t]Html\s*\(/ },
  { id: 'createContextualFragment', re: /\.createContextualFragmen[t]\s*\(/ },
];
const EXEC = [
  // eval( · window.eval( · globalThis.eval( · (0, eval)(  — redis.eval·page.$eval 같은 다른 함수는 아니다
  { id: 'eval', re: /(?:(?<![\w$.])|(?<=\b(?:window|globalThis|self|global)\.))eva[l]\s*\(|\(\s*0\s*,\s*eva[l]\s*\)/ },
  // new Function( · Function( (new 없이도 함수를 만든다)
  { id: 'new Function', re: /\bnew\s+Functio[n]\s*\(|(?<![\w$.])Functio[n]\s*\(/ },
];

// 위 SINKS·EXEC 가 맞으려면 줄에 꼭 있어야 하는 글자 조각. 없으면 그 줄은 더 보지 않는다(큰 파일을 빨리 넘기려고).
// SINKS·EXEC 를 고치면 여기도 함께 고친다(엄격 사례의 막음 꼴이 모두 이 조각을 지나야 막힌다 — strict-cases/code.mjs).
export const MAY_HIT = /HT[M]L|ht[m]l|Ht[m]l|writ[e]|Fragmen[t]|eva[l]|Functio[n]/;

// 줄 끝 `// 설명` 을 떼어 낸다. 따옴표·템플릿 속 `//`(주소 등)는 남긴다.
export const stripLineComment = (line) => {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '\\') i++;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'" || c === '`') q = c;
    else if (c === '/' && line[i + 1] === '/') return line.slice(0, i);
  }
  return line;
};

// 정화 함수로 감싼 값인지(`escapeHtml(x)` 로 시작)
const WRAPPED = /^(?:DOMPurify\.sanitize|sanitize\w*|escape(?:Html|HTML))\s*\(/;
// innerHTML 오른쪽 값의 모든 조각(템플릿 ${…}, + 로 이은 값)이 정화 함수를 거치는지. 하나라도 그냥 값이면 false.
const allWrapped = (rhs) => {
  const exprs = [...rhs.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1].trim());
  const outside = rhs.replace(/`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, ' ').replace(/;\s*$/, '');
  const operands = outside.split('+').map((x) => x.trim()).filter(Boolean);
  return [...exprs, ...operands].every((x) => WRAPPED.test(x));
};

// 여러 줄에 걸친 고정 템플릿(`el.innerHTML = \`` + 고정 줄들 + 닫는 백틱): ${ 가 없으면 고정 글자다.
const literalTemplateFrom = (lines, i, after) => {
  if (!/^\s*`[^`]*$/.test(after)) return false;
  let body = after;
  for (let k = i + 1; k < lines.length; k++) {
    body += '\n' + lines[k];
    if (lines[k].includes('`')) return !body.includes('${') && /`\s*;?\s*$/.test(lines[k]);
  }
  return false;
};

// 글자 속 자리(따옴표 안·템플릿의 고정 부분)를 표시한다. 템플릿 속 ${…} 는 코드다.
// JS·TS 파일만 쓴다 — HTML·Vue 의 속성 값(onclick="…", v-html="…")은 따옴표 안이어도 코드라서.
const JS_FAMILY = new Set(['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts']);
const stringSpans = (line) => {
  const inStr = new Array(line.length).fill(false);
  let q = null;
  let depth = 0; // 템플릿 ${ 안의 { 깊이
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q && depth === 0) {
      if (c === '\\') {
        inStr[i] = true;
        inStr[i + 1] = true;
        i++;
      } else if (c === q) q = null;
      else if (q === '`' && c === '$' && line[i + 1] === '{') {
        depth = 1;
        i++;
      } else inStr[i] = true;
    } else if (q && depth > 0) {
      if (c === '{') depth++;
      else if (c === '}') depth--;
    } else if (c === '"' || c === "'" || c === '`') q = c;
  }
  return inStr;
};
// 정규식이 글자 밖(코드)에서 맞는 첫 자리
const matchInCode = (line, re, inStr) => {
  if (!inStr) return line.match(re);
  for (const m of line.matchAll(new RegExp(re.source, re.flags + 'g'))) if (!inStr[m.index]) return m;
  return null;
};

// lines: 새로 들어가는 줄들. allow(줄 번호, 줄): 허용 주석으로 통과시킬 줄인지(찾은 것이 있는 줄만 묻는다). 반환: 찾은 것의 이름 목록(중복 없이).
export const findUnsafeHtml = (lines, file, allow = null) => {
  if (!unsafeHtmlTarget(file)) return [];
  const jsFile = JS_FAMILY.has(extOf(file));
  const hits = new Set();
  lines.forEach((raw, i) => {
    if (!MAY_HIT.test(raw) || commentOnly(raw)) return;
    const found = [];
    const line = stripLineComment(raw);
    const inStr = jsFile ? stringSpans(line) : null;
    const clean = SANITIZED.test(line);
    for (const s of SINKS) {
      const m = matchInCode(line, s.re, inStr);
      if (!m) continue;
      const after = line.slice(m.index + m[0].length);
      if (s.literalOk) {
        // innerHTML: 고정 글자, 여러 줄 고정 템플릿, 모든 값이 정화 함수를 거친 대입은 둔다
        if (LITERAL_ONLY.test(after) || literalTemplateFrom(lines, i, after) || (clean && allWrapped(after))) continue;
      } else if (clean) continue;
      found.push(s.id);
    }
    for (const s of EXEC) if (matchInCode(line, s.re, inStr)) found.push(s.id);
    if (found.length && !allow?.(i, raw)) found.forEach((id) => hits.add(id));
  });
  return [...hits];
};
