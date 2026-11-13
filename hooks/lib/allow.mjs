// 허용 주석(사용자 결정 2026-11-06): 훅이 잘못 막는 줄 하나만 통과시킨다 — 훅 전체를 끄지 않게. 이유는 꼭 적고, 쓸 때마다 알린다.
//   꼴: 그 줄이나 바로 위 줄에 `lint:allow <훅 id> <이유>`. 주석 문법은 가리지 않는다(//·#·<!-- -->·/* */·{# #} 모두 줄 글에서 찾는다).
//   바로 위 줄은 주석만 있는 줄이어야 한다(토큰 앞에 글자·숫자가 없음) — 허용 주석을 단 코드 줄 아래 줄까지 덩달아 통과하지 않게.
//   이유가 MIN_REASON 자보다 짧으면 받지 않는다(그대로 막고, 막는 글에 「이유가 필요해요」를 붙인다).
//   0.2.x 의 `harness:allow` 와 그때의 id `secret` 도 같은 규칙으로 받는다(이미 달아 둔 주석이 갑자기 막히지 않게).
// 줄 단위로 보는 쓰기 훅(비밀값·위험한 HTML·워크플로)과 큰 새 파일(파일 맨 위 TOP_LINES 줄 안)만 받는다.
// 비밀값은 훅 옵션 allowComment 를 켜야 받는다(진짜 키에 주석을 달아 넘기기 쉬워서).
// 찾는 함수는 「막을 것을 찾은 줄」에서만 이 모듈을 부른다 — 보통 줄마다 돌지 않아 큰 파일에서도 느려지지 않는다.
import path from 'node:path';

export const MIN_REASON = 3;
export const TOP_LINES = 10;
const TOKEN = /(?:lint|harness):allow/;
const ALIAS = { secret: 'secrets' };
const ID_AND_REST = /^[ \t]+([\w-]+)([^]*)$/;
// 이유 뒤에 붙은 주석 닫기(`*/`, `-->`, 템플릿의 `#}`)와 그 뒤 코드는 이유가 아니다
const CLOSER = /\*\/|-->|#\}/;
const HAS_REASON = new RegExp(String.raw`^(?:\s*\S){${MIN_REASON}}`, 'u');
const ABOVE_ONLY = /^[^\p{L}\p{N}]*$/u;
// 알림에 넣을 때 줄바꿈·제어 글자·글 방향 바꾸는 글자는 띄어쓰기로(알림 한 줄이 엉뚱하게 보이지 않게)
const UNPRINTABLE = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;
const REASON_SHOWN = 80;

const hasToken = (line) => typeof line === 'string' && (line.includes('lint:allow') || line.includes('harness:allow'));

// 줄 하나의 허용 주석들 → { head: 첫 토큰 앞 글, list: [{ id, reason }] }. 이유가 짧으면 reason 은 ''.
export const allowsIn = (line) => {
  if (!hasToken(line)) return { head: '', list: [] };
  const parts = line.split(TOKEN);
  const list = [];
  for (let k = 1; k < parts.length; k++) {
    const m = parts[k].match(ID_AND_REST);
    if (!m) continue;
    const reason = m[2].split(CLOSER)[0].trim();
    list.push({ id: ALIAS[m[1]] || m[1], reason: HAS_REASON.test(reason) ? reason : '' });
  }
  return { head: parts[0], list };
};

// 이 줄(또는 바로 위 주석 줄)이 id 를 허용하는지 → { reason } · { noReason: true } · null
export const allowOf = (line, prev, id) => {
  let noReason = false;
  const pick = ({ list }) => {
    for (const a of list) {
      if (a.id !== id) continue;
      if (a.reason) return a.reason;
      noReason = true;
    }
    return null;
  };
  const here = pick(allowsIn(line));
  if (here) return { reason: here };
  if (hasToken(prev)) {
    const above = allowsIn(prev);
    const reason = ABOVE_ONLY.test(above.head) ? pick(above) : null;
    if (reason) return { reason };
  }
  return noReason ? { noReason: true } : null;
};

// 파일 맨 위 TOP_LINES 줄 안의 허용 주석(큰 새 파일처럼 줄 하나가 아니라 파일 전체를 보는 검사) → { reason, no } · { noReason } · null
export const allowAtTop = (text, id) => {
  if (typeof text !== 'string' || !hasToken(text.slice(0, 64 * 1024))) return null;
  const rows = text.slice(0, 64 * 1024).split('\n', TOP_LINES);
  let noReason = false;
  for (let i = 0; i < rows.length; i++) {
    const a = allowOf(rows[i], null, id);
    if (a?.reason) return { reason: a.reason, no: i + 1 };
    if (a?.noReason) noReason = true;
  }
  return noReason ? { noReason: true } : null;
};

// 한 번의 검사(도구 호출 하나, 커밋 하나)에서 쓴 허용 주석을 모은다.
export const allowReport = () => ({ used: [], seen: new Set(), noReason: new Set() });

export const recordAllow = (report, id, file, no, reason) => {
  if (!report) return;
  const key = `${id}\0${file}\0${no}`;
  if (report.seen.has(key)) return;
  report.seen.add(key);
  report.used.push({ id, file, no, reason });
};

// 줄 자리 정보: prev(i) = 실제 파일에서 그 줄 바로 위 줄(모르면 null), no(i) = 파일의 몇째 줄(모르면 null)
export const wholeRows = (lines) => ({ prev: (i) => (i > 0 ? lines[i - 1] : null), no: (i) => i + 1 });
export const NO_ROWS = { prev: () => null, no: () => null };

// 찾는 함수에 넘길 확인 함수 (i, 줄) → 통과시킬지. on 이 false 면(비밀값 옵션 꺼짐) 아무것도 통과시키지 않는다.
export const allowFor = (report, id, file, rows = NO_ROWS, on = true) => {
  if (!report || !on) return null;
  return (i, line) => {
    // 그 줄에 이유 있는 허용이 있으면 위 줄은 보지 않는다(줄마다 허용한 큰 파일에서 위 줄 찾기를 건너뛰게)
    let a = hasToken(line) ? allowOf(line, null, id) : null;
    if (!a?.reason) {
      const prev = rows.prev(i);
      if (!a && !hasToken(prev)) return false;
      a = allowOf(line, prev, id);
    }
    if (!a) return false;
    if (a.noReason) {
      report.noReason.add(id);
      return false;
    }
    recordAllow(report, id, file, rows.no(i), a.reason);
    return true;
  };
};

// 막는 글에 붙이는 안내: 그 훅이 막은 줄에 이유 없는 허용 주석이 있었으면 「이유가 필요해요」
export const withNoReason = (msg, report, id, t) =>
  msg && report?.noReason.has(id) ? `${msg} ${t('allow.noReason', { id, min: MIN_REASON })}` : msg;

// 막는 글 끝의 「이렇게 하면 통과시킬 수 있어요」. 비밀값은 옵션이 꺼져 있으면 옵션 안내.
export const allowHint = (id, t, { on = true, top = false } = {}) =>
  on ? t(top ? 'allow.hintTop' : 'allow.hint', { id, min: MIN_REASON, top: TOP_LINES }) : t('allow.secretsOff');

// 쓴 허용 주석 알림 한 줄. 없으면 null. base 안의 절대 경로는 base 기준으로 줄여 보인다(Write 의 file_path 는 절대 경로).
const MAX_SHOWN = 10;
const shortPath = (file, base) => {
  if (!base || !path.isAbsolute(file)) return file;
  const rel = path.relative(base, file);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : file;
};
export const allowNotice = (report, t, base = null) => {
  if (!report?.used.length) return null;
  const items = report.used.slice(0, MAX_SHOWN).map((u) => {
    const reason = u.reason.replace(UNPRINTABLE, ' ');
    const shown = reason.length > REASON_SHOWN ? `${reason.slice(0, REASON_SHOWN)}…` : reason;
    const file = shortPath(String(u.file || ''), base).replace(UNPRINTABLE, ' ');
    return t('allow.item', { id: u.id, where: u.no ? `${file}:${u.no}` : file, reason: shown });
  });
  const rest = report.used.length - items.length;
  const more = rest > 0 ? ` ${t('list.more', { n: rest })}` : '';
  return t('allow.used', { list: items.join('; ') + more });
};
