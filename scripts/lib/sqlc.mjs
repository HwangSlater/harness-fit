// sqlc(SQL 쿼리 → Go 코드 생성) 설정과 다시 만드는 명령. 지침 「생성 코드」 줄({{cmd:sqlc}} — rules/commands.*.md)이 쓴다.
// 생성 파일(db/*.go)을 손으로 고치던 일, 「쿼리를 바꾸면 make sqlc」가 사용자 메모로만 들어가던 일(역할극 14 회차 M6, 2026-11-16)
import fs from 'node:fs';
import path from 'node:path';

const FILES = ['sqlc.yaml', 'sqlc.yml', 'sqlc.json'];
// 맨 위와 흔한 DB 폴더만 본다(설정은 보통 여기 — 저장소 전체를 훑지 않는다)
const DIRS = ['.', 'db', 'sql', 'database', 'internal/db', 'internal/database', 'pkg/db', 'sqlc'];

// → 설정 파일의 저장소 안 경로(posix, 맨 위면 'sqlc.yaml') 또는 null
export const sqlcConfig = (root) => {
  for (const d of DIRS) {
    for (const f of FILES) if (fs.existsSync(path.join(root, d, f))) return d === '.' ? f : `${d}/${f}`;
  }
  return null;
};

// 레시피 줄이 sqlc generate 를 부르는지(sqlc · $(SQLC) 를 펼친 꼴 · go run …/sqlc · docker 의 sqlc/sqlc 이미지)
// 정규식 하나로 쓰면(\bsqlc\S*\s+(?:\S+\s+)*?generate) 시작 자리마다 줄 끝까지 되짚어 'sqlc ' × 5만 줄에 743ms 가 걸렸다(검토 2026-11-16) — 낱말로 한 번 훑는다
const SQLC_WORD = /\bsqlc/;
const GENERATE_WORD = /^generate\b/;
export const callsGenerate = (line) => {
  let seen = false;
  for (const w of line.split(/\s+/)) {
    if (seen && GENERATE_WORD.test(w)) return true;
    if (!seen && SQLC_WORD.test(w)) seen = true;
  }
  return false;
};
const PREFER = ['sqlc', 'generate', 'gen', 'sqlc-generate', 'generate-sqlc'];

// rules: makefile.mjs makeRules, expand: 레시피 줄의 변수 펼치기. → ['make sqlc'] · ['sqlc generate'] · ['sqlc generate -f db/sqlc.yaml'] · null(설정 없음)
export const sqlcCommand = (root, rules = new Map(), expand = (l) => l) => {
  const conf = sqlcConfig(root);
  if (!conf) return null;
  const targets = [...rules].filter(([, r]) => r.lines.some((l) => callsGenerate(expand(l)))).map(([t]) => t);
  const rank = (t) => (PREFER.includes(t) ? PREFER.indexOf(t) : PREFER.length);
  const best = targets.sort((a, b) => rank(a) - rank(b) || a.length - b.length)[0];
  if (best) return [`make ${best}`];
  return [conf.includes('/') ? `sqlc generate -f ${conf}` : 'sqlc generate'];
};
