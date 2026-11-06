// 대화 기록(transcript JSONL) 읽기 — Stop 훅(커밋 해시·답 언어·문서)이 함께 쓴다.
// 「사람 턴」 = 사람이 마지막으로 보낸 메시지 다음부터. 「답 하나」 = 마지막으로 답을 연 기록(사람 메시지·작업 알림·Stop 훅 되먹임) 다음부터.
// 기록이 수백 MB 여도 끝에서부터 조금씩 읽는다(끝 4MB, 시작 기록이 없으면 네 배씩, 최대 MAX_BYTES). 훅 한 번에 한 번만 읽는다(readTurnTail).
import fs from 'node:fs';

const FIRST_BYTES = 4 << 20;
const MAX_BYTES = 64 << 20;

const contentText = (r) => {
  const c = r?.message?.content;
  if (typeof c === 'string') return c;
  return Array.isArray(c) ? c.map((b) => (typeof b?.text === 'string' ? b.text : typeof b?.content === 'string' ? b.content : '')).join('\n') : '';
};
const hasToolResult = (r) => Array.isArray(r?.message?.content) && r.message.content.some((b) => b?.type === 'tool_result');

// 사람이 보낸 메시지(도구 결과·알림·훅이 넣은 글이 아님)
export const isHumanPrompt = (r) => {
  if (r?.type !== 'user' || r.isSidechain || r.isMeta) return false;
  if (r.origin?.kind) return r.origin.kind === 'human';
  const c = r.message?.content;
  if (typeof c === 'string') return !/^\s*</.test(c);
  return Array.isArray(c) && c.some((b) => b?.type === 'text') && !hasToolResult(r);
};
const isStopFeedback = (r) => r?.type === 'user' && !r.isSidechain && r.isMeta && contentText(r).startsWith('Stop hook feedback');
// 새 답을 여는 기록: 사람 메시지, 백그라운드 작업 알림, Stop 훅 되먹임
export const opensResponse = (r) => {
  if (r?.type !== 'user' || r.isSidechain) return false;
  if (r.isMeta) return isStopFeedback(r);
  if (r.origin?.kind) return r.origin.kind === 'human' || r.origin.kind === 'task-notification';
  return isHumanPrompt(r);
};

// 이 규칙들이 보는 기록은 user · assistant 뿐 — 그 낱말이 없는 줄(첨부·요약 등)은 JSON 으로 풀지 않는다
const WANTED = [Buffer.from('"user"'), Buffer.from('"assistant"')];
const parseLines = (buf, from) => {
  const recs = [];
  let pos = from;
  while (pos < buf.length) {
    let end = buf.indexOf(10, pos);
    if (end < 0) end = buf.length;
    if (end > pos) {
      const lineBuf = buf.subarray(pos, end);
      if (WANTED.some((w) => lineBuf.includes(w))) {
        try {
          const r = JSON.parse(lineBuf.toString('utf8'));
          if (r && typeof r === 'object') recs.push(r);
        } catch {}
      }
    }
    pos = end + 1;
  }
  return recs;
};

// 끝에서부터 읽어 { recs, start } — start 는 isStart 에 맞는 마지막 기록 자리(없으면 -1).
// 덩이(끝 4MB, 그 앞으로 네 배씩, 합쳐 MAX_BYTES 까지)를 한 번씩만 읽고 푼다. 덩이 경계에 걸친 줄은 앞 덩이와 이어 붙인다.
export const readTail = (file, isStart) => {
  if (typeof file !== 'string' || !file || file.includes('\0')) return null;
  let fd;
  try {
    const size = fs.statSync(file).size;
    fd = fs.openSync(file, 'r');
    let recs = [];
    let end = size; // 아직 안 읽은 앞부분의 끝
    let carry = Buffer.alloc(0); // 뒤 덩이 맨 앞의 잘린 줄 조각
    for (let n = FIRST_BYTES; ; n *= 4) {
      const from = Math.max(0, size - Math.min(n, MAX_BYTES));
      const buf = Buffer.alloc(end - from);
      fs.readSync(fd, buf, 0, buf.length, from);
      const data = carry.length ? Buffer.concat([buf, carry]) : buf;
      let pos = 0;
      if (from > 0) {
        // 중간부터 읽었으면 잘린 첫 줄은 다음(앞) 덩이로 넘긴다
        const nl = data.indexOf(10);
        carry = nl < 0 ? data : data.subarray(0, nl);
        pos = nl < 0 ? data.length : nl + 1;
      }
      const fresh = parseLines(data, pos);
      for (let i = fresh.length - 1; i >= 0; i--) if (isStart(fresh[i])) return { recs: fresh.concat(recs), start: i };
      recs = fresh.concat(recs);
      if (from === 0 || n >= MAX_BYTES) return { recs, start: -1 };
      end = from;
    }
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
};

// 끝낼 때 규칙들이 함께 쓰는 한 번 읽기: 마지막 사람 메시지까지(사람 메시지는 답을 여는 기록이기도 하므로 finalTexts 도 이것으로 된다)
export const readTurnTail = (file) => readTail(file, isHumanPrompt);
const tailOf = (x) => (typeof x === 'string' ? readTurnTail(x) : x);

const timeOf = (r) => {
  const ms = Date.parse(r?.timestamp);
  return Number.isFinite(ms) ? ms : null;
};

// 사람 턴: { since(ms), texts: [{ text, at }], commands: [명령], asked(표시) } — 사람 메시지가 없으면 null
// x: 기록 경로 또는 readTurnTail 결과(여러 규칙이 한 번 읽은 것을 나눠 쓴다)
export const humanTurn = (x) => {
  const tail = tailOf(x);
  if (!tail || tail.start < 0) return null;
  const { recs, start } = tail;
  const texts = [];
  const commands = [];
  const userTexts = []; // 훅 되먹임 등 사람 턴 안의 user 기록 글(같은 것을 거듭 묻지 않으려고)
  for (const r of recs.slice(start + 1)) {
    if (r.isSidechain) continue;
    if (r.type === 'user') {
      userTexts.push(contentText(r));
      continue;
    }
    if (r.type !== 'assistant') continue;
    for (const b of Array.isArray(r.message?.content) ? r.message.content : []) {
      if (b?.type === 'text' && typeof b.text === 'string') texts.push({ text: b.text, at: timeOf(r) });
      else if (b?.type === 'tool_use' && /^(Bash|PowerShell)$/.test(b.name) && typeof b.input?.command === 'string') commands.push(b.input.command);
    }
  }
  return { since: timeOf(recs[start]), texts, commands, asked: (mark) => userTexts.some((s) => s.includes(mark)) };
};

// 마지막 답: 마지막으로 답을 연 기록 뒤, 마지막 도구 호출 뒤에 쓴 글들(중간 안내는 뺀다)
export const finalTexts = (x) => {
  const tail = tailOf(x);
  if (!tail) return [];
  let start = -1;
  for (let i = tail.recs.length - 1; i >= Math.max(0, tail.start); i--) if (opensResponse(tail.recs[i])) { start = i; break; }
  let texts = [];
  for (const r of tail.recs.slice(start + 1)) {
    if (r.type !== 'assistant' || r.isSidechain) continue;
    for (const b of Array.isArray(r.message?.content) ? r.message.content : []) {
      if (b?.type === 'tool_use') texts = [];
      else if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) texts.push(b.text);
    }
  }
  return texts;
};
