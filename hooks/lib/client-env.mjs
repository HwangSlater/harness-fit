// Next.js "use client" 파일에서 공개용이 아닌 환경 변수 읽기 — 역할극 13 회차(프론트엔드), 2026-11-16.
// 브라우저로 가는 코드에서는 NEXT_PUBLIC_ 이 아닌 process.env 값이 빌드 때 undefined 가 된다. 막지 않고 Claude 에게 알린다(unsafe-html 의 알림).
// 새로 들어가는 줄만 본다. 이번 호출로 "use client" 가 새로 붙었으면 파일 전체를 본다.
import { addedRows, fileAfter, extOf, normPath, OUTSIDE_CODE, commentOnly } from './lines.mjs';
import { isTestFile } from './secrets.mjs';
import { stripLineComment } from './unsafe-html.mjs';

const TARGET = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs']);
const MAX_TEXT = 2 * 1024 * 1024;
// 맨 앞 주석·빈 줄 뒤 첫 문장이 'use client'. 정규식 하나로 쓰면(\s 와 /*…*/ 의 [\s\S]*? 가 겹쳐) 앞 주석이 줄줄이 있을 때
// 되짚기가 기하급수로 늘어 .tsx 하나에 3.6초가 걸렸다(검토 2026-11-16) — 앞에서부터 한 번만 훑는다.
const HEAD = 4096;
const WS = /\s/;
export const isClientFile = (raw) => {
  if (typeof raw !== 'string') return false;
  const text = raw.slice(0, HEAD);
  let i = 0;
  while (i < text.length) {
    if (WS.test(text[i])) i++;
    else if (text.startsWith('//', i)) {
      const nl = text.indexOf('\n', i);
      if (nl < 0) return false;
      i = nl + 1;
    } else if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) return false;
      i = end + 2;
    } else break;
  }
  return text.startsWith("'use client'", i) || text.startsWith('"use client"', i);
};
// process.env.X · process.env["X"]. NODE_ENV 는 Next 가 클라이언트에도 넣어 준다
const ENV_READ = /\bprocess\.env(?:\.([A-Za-z_$][\w$]*)|\[\s*['"`]([A-Za-z_$][\w$]*)['"`]\s*\])/g;
const PUBLIC = /^(?:NEXT_PUBLIC_|NODE_ENV$)/;

export const privateEnvNames = (lines) => {
  const out = new Set();
  for (const raw of lines) {
    if (commentOnly(raw)) continue;
    for (const m of stripLineComment(raw).matchAll(ENV_READ)) {
      const name = m[1] || m[2];
      if (!PUBLIC.test(name)) out.add(name);
      if (out.size >= 8) return [...out];
    }
  }
  return [...out];
};

export const findClientEnv = (ti, cwd, file) => {
  if (!TARGET.has(extOf(file)) || isTestFile(file) || OUTSIDE_CODE.test(normPath(file))) return [];
  const { before, after } = fileAfter(ti, cwd);
  // 고치기에서 파일을 못 읽으면 새 글만으로 판단한다
  const text = after ?? (ti.edits || [ti]).map((e) => e.new_string || '').join('\n');
  if (text.length > MAX_TEXT || !isClientFile(text)) return [];
  const lines = before != null && !isClientFile(before) ? text.split('\n') : addedRows(ti, cwd).lines;
  return privateEnvNames(lines);
};
