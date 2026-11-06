// 커밋 메시지 형식. 메시지를 명령에서 꺼낸다:
//   -m/--message 여러 개, -am 같은 묶음, bash heredoc(`-F - <<EOF`, `-m "$(cat <<'EOF' … EOF)"`),
//   PowerShell here-string(`-m @'…'@`), 파이프로 넘긴 글(`echo "…" | git commit -F -`, `@'…'@ | git commit -F -`),
//   `-F 파일`·`-m "$(cat 파일)"`(파일을 읽는다), 같은 명령에서 넣은 변수(`$msg = '…'; git commit -m $msg`).
// 메시지가 없으면(편집기·-C 다시 쓰기·--no-edit·--fixup) 보지 않는다.
// 메시지를 꺼낼 수 없으면(다른 명령의 결과, 같은 명령에서 만드는 파일) 형식을 확인할 수 없다고 막는다 — 못 본 채 통과시키지 않게.
import fs from 'node:fs';
import path from 'node:path';
import { BASH, POWERSHELL, gitSegments, stripQuoted, heredocs, commandSegments } from '../lib/cmdline.mjs';
import { COMMIT_VALUE_FLAGS, COMMIT_NEXT_VALUE, COMMIT_LONG_VALUE, GIT_WORD, commandWords } from '../lib/staged.mjs';

const MESSAGE_LONG = '--message';
const FILE_LONG = '--file';
const UNSEEN = Symbol('unseen');

// 낱말 목록 → { parts: -m 값들, file: -F 값 }. 다른 옵션의 값(--author 이름)은 건너뛴다.
// git 은 겹치지 않는 앞부분만 적은 긴 옵션도 받는다: --m·--mess = --message, --fil = --file(--fi 는 --fixup 과 겹쳐 거절).
const MESSAGE_MIN = 3;
const FILE_MIN = 5;
const longOf = (w, full, min) => {
  const at = w.indexOf('=');
  const name = at < 0 ? w : w.slice(0, at);
  if (name.length < min || !full.startsWith(name)) return null;
  return { inline: at >= 0, value: at < 0 ? null : w.slice(at + 1) };
};

const messageArgs = (words) => {
  const parts = [];
  let file;
  for (let i = 0; i < words.length && words[i] !== '--'; i++) {
    const w = words[i];
    const msg = w.startsWith('--') ? longOf(w, MESSAGE_LONG, MESSAGE_MIN) : null;
    const fil = w.startsWith('--') ? longOf(w, FILE_LONG, FILE_MIN) : null;
    if (msg) parts.push(msg.inline ? msg.value : (words[++i] ?? ''));
    else if (fil) file = fil.inline ? fil.value : words[++i];
    else if (COMMIT_LONG_VALUE.has(w)) i++;
    else if (/^-[A-Za-z]/.test(w)) {
      for (let k = 1; k < w.length; k++) {
        if (w[k] === 'm' || w[k] === 'F') {
          const value = k + 1 < w.length ? w.slice(k + 1) : (words[++i] ?? '');
          if (w[k] === 'm') parts.push(value);
          else file = value;
          break;
        }
        if (COMMIT_VALUE_FLAGS.includes(w[k])) {
          if (k + 1 === w.length && COMMIT_NEXT_VALUE.includes(w[k])) i++;
          break;
        }
      }
    }
  }
  return { parts, file };
};

// PowerShell 큰따옴표 속 백틱 이스케이프(`n `t), bash $'…' 의 역슬래시 이스케이프
const PS_ESCAPES = { n: '\n', r: '', t: '\t', '`': '`', '"': '"', 0: '' };
const psUnescape = (s) => s.replace(/`([nrt`"0])/g, (_, c) => PS_ESCAPES[c]);
const BASH_ESCAPES = { n: '\n', t: '\t', r: '', '\\': '\\', "'": "'", '"': '"' };
const ansiUnescape = (s) => s.replace(/\\([ntr\\'"])/g, (_, c) => BASH_ESCAPES[c]);

const readFile = (cwd, f) => {
  try {
    return fs.readFileSync(path.resolve(cwd, f), 'utf8');
  } catch {
    return null;
  }
};

// 명령 안에서 변수에 넣은 글: bash `NAME='…'`·`export NAME=…`, PowerShell `$name = '…'`(here-string 포함)
const assigned = (cmd, shell, name, before) => {
  let value = null;
  for (const seg of commandSegments(cmd, shell)) {
    if (seg.start >= before) break;
    const w = seg.words[0] === 'export' ? seg.words.slice(1) : seg.words;
    if (shell === POWERSHELL) {
      if (w[0]?.toLowerCase() === `$${name}`.toLowerCase() && w[1] === '=' && w.length === 3) value = w[2];
      else if (w[0]?.toLowerCase().startsWith(`$${name}=`.toLowerCase()) && w.length === 1) value = w[0].slice(name.length + 2);
    } else if (w.length === 1 && w[0].startsWith(`${name}=`)) value = w[0].slice(name.length + 1);
  }
  return value;
};

// -m 값 하나 → 메시지 글 또는 UNSEEN
const SUBST_CAT = /^\$\(\s*(?:cat|Get-Content|gc|type)\s+(?:-Raw\s+)?(['"]?)([^'"\s)]+)\1(?:\s+-Raw)?\s*\)$/i;
// `$(printf 'feat: x\n\n본문')` — 형식 글자(%)가 없는 printf 만
const SUBST_PRINTF = /^\$\(\s*printf\s+(['"])([^%]*?)\1\s*\)$/s;
const VAR_ONLY = { [BASH]: /^\$\{?([A-Za-z_]\w*)\}?$/, [POWERSHELL]: /^\$([A-Za-z_]\w*)$/ };
const resolvePart = (part, ctx) => {
  const { cmd, shell, cwd, at, raw } = ctx;
  // 작은따옴표 속은 셸이 아무것도 실행하지 않는다(`--json`·$(pwd)·$msg 도 글자 그대로)
  if (raw.includes(`'${part}'`) && !raw.includes(`$'${part}'`)) return part;
  if (shell === BASH && part.startsWith('$') && raw.includes(`$'${part.slice(1, 12)}`)) return ansiUnescape(part.slice(1));
  const cat = part.match(SUBST_CAT);
  if (cat) return readFile(cwd, cat[2]) ?? UNSEEN;
  const pf = shell === BASH && part.match(SUBST_PRINTF);
  if (pf) return ansiUnescape(pf[2]);
  const v = part.match(VAR_ONLY[shell] || VAR_ONLY[BASH]);
  if (v) {
    const value = assigned(cmd, shell, v[1], at);
    return value === null ? UNSEEN : resolvePart(value, ctx);
  }
  if (shell === POWERSHELL) return /(?<!`)\$\(/.test(part) ? UNSEEN : psUnescape(part);
  // bash 큰따옴표: 역슬래시로 막지 않은 ` 와 $( 만 실행된다
  if (/(?<!\\)`|(?<!\\)\$\(/.test(part)) return UNSEEN;
  return part.replace(/\\([`$"\\])/g, '$1');
};

// 파이프 앞 명령이 내보내는 글(`echo "…" |`, `'…' |`, `@'…'@ |`). 알 수 없으면 UNSEEN.
const ECHO = new Set(['echo', 'write-output', 'printf']);
const piped = (cmd, shell, seg) => {
  const segs = commandSegments(cmd, shell);
  const idx = segs.findIndex((s) => s.start <= seg.start && seg.start < s.start + s.raw.length + 1);
  const prev = segs[idx - 1];
  if (!prev || cmd.slice(prev.start + prev.raw.length, segs[idx].start) !== '|') return UNSEEN;
  const w = prev.words;
  // cat <<'EOF' | git commit -F -
  const doc = shell === BASH && heredocs(cmd).find((h) => h.op >= prev.start && h.op < prev.start + prev.raw.length);
  if (doc && (w[0] || '') === 'cat') return doc.body.trim();
  if (w.length === 1) return shell === POWERSHELL ? psUnescape(w[0]) : w[0];
  if (ECHO.has((w[0] || '').toLowerCase())) {
    const text = w.slice(1).filter((x) => !/^-[neE]$/.test(x)).join(' ');
    return w[0] === 'printf' ? ansiUnescape(text) : shell === POWERSHELL ? psUnescape(text) : text;
  }
  return UNSEEN;
};

// 커밋 앞 조각에 파일을 쓸 수 있는 명령이 있는지(-F 파일을 같은 명령에서 만들면 지금 내용은 다르다)
const writesBefore = (cmd, shell, at) =>
  commandSegments(cmd, shell).some((s) => {
    if (s.start >= at) return false;
    const w = commandWords(s.words);
    return w.length && !/^(?:cd|set-location|sl|pushd|popd)$/i.test(w[0]) && !GIT_WORD.test(w[0]);
  });

// commit 조각 하나 → 메시지 글, null(메시지를 명령에서 주지 않음), UNSEEN
const segmentMessage = (cmd, shell, cwd, seg) => {
  const end = seg.start + seg.raw.length;
  const doc = shell === BASH && heredocs(cmd).find((h) => h.op >= seg.start && h.op < end);
  const { parts, file } = messageArgs(seg.words);
  if (doc && (file === '-' || parts.some((p) => /\$\(\s*cat\s*<</.test(p)))) {
    const rest = parts.filter((p) => !/\$\(\s*cat\s*<</.test(p)).map((p) => resolvePart(p, { cmd, shell, cwd, at: seg.start, raw: seg.raw }));
    return rest.includes(UNSEEN) ? UNSEEN : [doc.body, ...rest].join('\n\n').trim();
  }
  if (file !== undefined) {
    if (file === '-') return piped(cmd, shell, seg);
    if (writesBefore(cmd, shell, seg.start)) return UNSEEN;
    return readFile(cwd, file);
  }
  if (!parts.length) return null;
  const resolved = parts.map((p) => resolvePart(p, { cmd, shell, cwd, at: seg.start, raw: seg.raw }));
  return resolved.includes(UNSEEN) ? UNSEEN : resolved.join('\n\n').trim();
};

// git 이 제목을 만드는 커밋(fixup!·squash!). 나머지(--no-edit·-C 등)는 -m·-F 를 같이 주면 그 메시지를 본다.
const REUSES = /(?:^|\s)(?:--fixup(?:=\S*)?|--squash(?:=\S*)?)(?=\s|$)/;

// 반환: [{ msg } | { unseen: true }] — 메시지를 명령에서 준 commit 마다
export const commitMessages = (cmd, shell = BASH, cwd = process.cwd()) =>
  gitSegments(cmd, 'commit', shell)
    .filter((seg) => !REUSES.test(seg.bare))
    .map((seg) => segmentMessage(cmd, shell, cwd, seg))
    .filter((m) => m !== null)
    .map((m) => (m === UNSEEN ? { unseen: true } : { msg: m }));

// 첫 commit 의 메시지(시험·다른 규칙용). 꺼낼 수 없으면 null.
export const commitMessage = (cmd, shell = BASH, cwd = process.cwd()) => {
  const [first] = commitMessages(cmd, shell, cwd);
  return first?.msg ?? null;
};

const CONVENTIONAL = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([\w\-./ ]+\))?!?: \S/;
const HANGUL = /[가-힣]/;
export const DEFAULT_MAX_SUBJECT = 72;

export const commitMsg = {
  id: 'commit-msg',
  on: 'shell',
  check({ cmd, shell, cwd, opts, t }) {
    if (!/\bcommit\b/.test(stripQuoted(cmd, shell))) return null;
    for (const m of commitMessages(cmd, shell, cwd)) {
      if (m.unseen) return t('git.msgUnseen');
      const subject = m.msg.split(/\r?\n/)[0];
      const style = opts.style || 'conventional';
      if (style === 'conventional' && !CONVENTIONAL.test(subject)) return t('git.msgConventional', { subject });
      if (opts.lang === 'ko' && !HANGUL.test(m.msg)) return t('git.msgKorean');
      if (opts.lang === 'en' && HANGUL.test(m.msg)) return t('git.msgEnglish');
      const max = opts.maxSubject || DEFAULT_MAX_SUBJECT;
      if (subject.length > max) return t('git.msgLong', { len: subject.length, max });
    }
    return null;
  },
};

export default [commitMsg];
