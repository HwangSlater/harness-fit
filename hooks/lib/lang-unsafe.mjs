// 언어별 위험한 꼴 찾기: Swift 의 try!·print(, Python 의 shell=True·eval(·exec(·Django mark_safe(값)·csrf_exempt. 적어 둔 꼴만 본다(packs.json detail 과 같은 목록).
// 주석·글자 속은 가린 뒤(code-mask.mjs) 찾고, 이번에 새로 들어가는 줄에 걸친 것만 낸다(이미 있던 코드는 막지 않는다).
// 패턴은 이 파일 자신과 맞지 않게 적는다(낱말 가운데를 [] 로 감싸 둔다).
import { maskSwift, maskPython } from './code-mask.mjs';
import { isTestFile } from './secrets.mjs';
import { extOf, normPath, OUTSIDE_CODE } from './lines.mjs';
import { wholeRows, NO_ROWS } from './allow.mjs';

// 시험 코드: 공통 꼴(tests/·test_*.py·_test.py …) + Swift 의 …Tests.swift, pytest 의 conftest.py
const LANG_TEST = /Tests?\.swift$|(^|\/)conftest\.py$/i;
// 받아 온 남의 코드(CocoaPods·Carthage·SwiftPM 빌드 폴더, 가상 환경·설치된 패키지)
const LANG_OUTSIDE = /(^|\/)(Pods|Carthage|\.build|\.venv|venv|site-packages)\//;

// x.eval( 처럼 다른 것의 것, def eval( 처럼 새로 만드는 줄
const pyNotBuiltin = (s, at) => s[at - 1] === '.' || /\bdef\s+$/.test(s.slice(Math.max(0, at - 40), at));
// 가린 글(글자 속은 띄어쓰기)에서 괄호 안이 고정 글자뿐인지: "…" · r'…' · """…""" · 이어 쓴 글자들, _("…")·gettext("…") 로 감싼 것.
// f-글자는 { } 안이 코드라 아니다. 정해진 꼴만 앞에서 한 번 맞춰 본다(되돌아 훑지 않게 글자 사이엔 띄어쓰기만).
const PY_LITERAL = String.raw`(?:[rRuUbB]{1,2})?(?:"""\s*"""|'''\s*'''|"[ \t]*"|'[ \t]*')`;
const LITERAL_ARG = new RegExp(String.raw`\s*(?:(?:_|gettext|gettext_lazy|ugettext)\s*\(\s*(?:${PY_LITERAL}\s*)+\)|(?:${PY_LITERAL}\s*)+)(?:,\s*)?\)`, 'y');
const literalArg = (s, from) => {
  LITERAL_ARG.lastIndex = from;
  return LITERAL_ARG.test(s);
};
// 그 자리가 가져오기(from x import csrf_exempt · from x import (\n    csrf_exempt,\n))인지
const importLine = (s, at) => {
  if (/^\s*(?:from\s+\S+\s+)?import\b/.test(s.slice(s.lastIndexOf('\n', at) + 1, at))) return true;
  const k = s.lastIndexOf('import', at);
  return k !== -1 && at - k < 4000 && /^import\s*\([^)]*$/.test(s.slice(k, at));
};

export const LANGS = {
  'swift-unsafe': {
    exts: ['swift'],
    mask: maskSwift,
    may: /tr[y]!|prin[t]|debugPrin[t]|NSLo[g]/,
    patterns: [
      { label: 'try!', re: /\btr[y]!/g },
      // NSLog( 도 print 처럼 배포판 기기 로그에 남는다(역할극 16 회차 — 저장소 .swiftlint.yml no_print 에도 있었다, 2026-11-13). func NSLog( · x.NSLog( 는 아니다
      { label: 'NSLog(', re: /\bNSLo[g]\s*\(/g, skip: (s, at) => /[.$]/.test(s[at - 1] || '') || /\bfunc\s+$/.test(s.slice(Math.max(0, at - 40), at)) },
      // print( · debugPrint( · Swift.print( — x.print( 처럼 다른 것의 메서드, func print( 처럼 새로 만드는 줄은 아니다
      // (앞 글자 보기는 정규식 뒤보기 대신 skip 으로 — 긴 띄어쓰기에서 자리마다 뒤로 훑지 않게)
      { label: 'print(', re: /(?:\bSwift\s*\.\s*)?\b(?:debugPrin[t]|prin[t])\s*\(/g, skip: (s, at, m) => !m.startsWith('Swift') && (/[.$]/.test(s[at - 1] || '') || /\bfunc\s+$/.test(s.slice(Math.max(0, at - 40), at))) },
    ],
  },
  'python-unsafe': {
    exts: ['py', 'pyw'],
    mask: maskPython,
    may: /shel[l]|eva[l]|exe[c]|mark_saf[e]|csrf_exemp[t]/,
    patterns: [
      // Django: mark_safe(값) 은 이스케이프 없이 HTML 로 낸다(역할극 9 회차). 고정 글자만 넘기면(mark_safe("<br>"), _("…") 포함) 둔다.
      { label: 'mark_safe(', kind: 'django', re: /\bmark_saf[e]\s*\(/g, skip: (s, at, m) => /\bdef\s+$/.test(s.slice(Math.max(0, at - 40), at)) || literalArg(s, at + m.length) },
      // Django: CSRF 검사 끄기 — @csrf_exempt · csrf_exempt(view) · method_decorator(csrf_exempt, …). 가져오기 줄·def 는 아니다.
      { label: 'csrf_exempt', kind: 'django', re: /\bcsrf_exemp[t]\b/g, skip: (s, at) => importLine(s, at) || /\bdef\s+$/.test(s.slice(Math.max(0, at - 40), at)) },
      // shell=True · shell = True (비교 == 는 아니다)
      { label: 'shell=True', re: /\bshel[l]\s*=(?!=)\s*True\b/g },
      // 내장 eval( · exec( · builtins.eval( — ast.literal_eval( · df.eval( 같은 다른 것은 아니다, def eval( 도 아니다
      { label: 'eva' + 'l(', re: /(?:\bbuiltins\s*\.\s*)?\beva[l]\s*\(/g, skip: (s, at, m) => !m.startsWith('builtins') && pyNotBuiltin(s, at) },
      { label: 'exec(', re: /(?:\bbuiltins\s*\.\s*)?\bexe[c]\s*\(/g, skip: (s, at, m) => !m.startsWith('builtins') && pyNotBuiltin(s, at) },
    ],
  },
};

// 이 훅이 볼 파일인지: 확장자가 그 언어이고, 시험 코드·남의 코드가 아님
export const langTarget = (id, file) => {
  const p = normPath(file || '');
  return LANGS[id].exts.includes(extOf(p)) && !isTestFile(p) && !LANG_TEST.test(p) && !OUTSIDE_CODE.test(p) && !LANG_OUTSIDE.test(p);
};

// 줄 시작 자리들에서 글자 자리 → 몇째 줄(0부터)
const lineOf = (starts, at) => {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= at) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};

// text: 쓴 뒤 파일 전체(모르면 새로 들어가는 줄만 이은 글 — whole: false).
// fresh: 새로 들어가는 줄(앞뒤 공백 뺀 것)의 모음. null 이면 모든 줄이 새 줄.
// allowMaker(rows): 허용 주석 확인 함수를 만든다(allow.mjs allowFor). → [{ label, no }]
export const findLangUnsafe = (id, text, fresh, allowMaker = null, whole = true) => {
  const L = LANGS[id];
  if (typeof text !== 'string' || !L.may.test(text)) return [];
  const masked = L.mask(text);
  let lines = null;
  let starts = null;
  let allow;
  const hits = [];
  for (const p of L.patterns) {
    for (const m of masked.matchAll(p.re)) {
      if (p.skip?.(masked, m.index, m[0])) continue;
      if (!lines) {
        lines = text.split('\n');
        starts = [0];
        for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
        allow = allowMaker ? allowMaker(whole ? wholeRows(lines) : NO_ROWS) : null;
      }
      const a = lineOf(starts, m.index);
      const b = lineOf(starts, m.index + m[0].length - 1);
      let isNew = !fresh;
      for (let k = a; k <= b && !isNew; k++) isNew = fresh.has(lines[k].replace(/\r$/, '').trim());
      if (!isNew) continue;
      if (allow?.(a, lines[a].replace(/\r$/, ''))) continue;
      hits.push({ label: p.label, no: whole ? a + 1 : null });
    }
  }
  return hits.sort((x, y) => (x.no ?? 0) - (y.no ?? 0));
};
