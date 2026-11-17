// 사용자 규칙과 반대 기록(lib/conflicts.mjs)의 file 칸: 받는 꼴만 표준 이름으로 맞추고, 그 파일 글은 실행마다 한 번만 읽는다.
// 받는 꼴(대소문자 무시, \ 와 ./ 는 맞춘다): CLAUDE.md(프로젝트 맨 위) · .claude/rules/**/*.md · ~/.claude/CLAUDE.md · ~/.claude/rules/**/*.md
// 그 밖(docs/·node_modules/·메모리·절대 경로·..·Windows 장치 이름)은 받지 않는다 — 「글이 아직 있나」 답으로 다른 파일 속을 떠볼 수 없게,
// 확인할 수 없는 꼴이 영영 남는 기록이 되지 않게(검토 2026-11-17).
import fs from 'node:fs';
import path from 'node:path';
import { claudeHome } from '../../hooks/lib/claude-home.mjs';
import { setBlock } from './claude-md.mjs';

// 파일 하나에서 읽는 한도(그 뒤 글은 없는 것으로 본다)
export const MAX_READ = 256 * 1024;
const MAX_NAME = 200;
// Windows 장치 이름(CON.md 도 장치로 열린다 — 읽기가 멈출 수 있다)
const DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$|clock\$)$/i;
// 이름에 쓸 수 없는 글자(: 는 드라이브·대체 스트림)
const BAD_CHAR = /[\u0000-\u001f\u007f<>:"|?*]/;

const okSeg = (s) => !BAD_CHAR.test(s) && !/[. ]$/.test(s) && !DEVICE.test(s.split('.')[0].trim());

// 표시용 이름 → 표준 이름(「CLAUDE.md」·「.claude/rules/git.md」·「~/.claude/CLAUDE.md」·「~/.claude/rules/a/b.md」) 또는 null(받지 않는 꼴)
export const normFile = (file) => {
  if (typeof file !== 'string' || !file || file.length > MAX_NAME) return null;
  const parts = file.replace(/\\/g, '/').split('/');
  const home = parts[0] === '~';
  if (!home && parts[0] === '') return null; // /로 시작(절대 경로·//server)
  const segs = (home ? parts.slice(1) : parts).filter((s) => s !== '' && s !== '.');
  if (!segs.length || segs.some((s) => s === '..' || !okSeg(s))) return null;
  const low = segs.map((s) => s.toLowerCase());
  const isMd = /\.md$/.test(low.at(-1));
  const rules = (pre) => (low[0] === '.claude' && low[1] === 'rules' && segs.length >= 3 && isMd ? `${pre}.claude/rules/${segs.slice(2).join('/')}` : null);
  if (home) return low[0] === '.claude' && segs.length === 2 && low[1] === 'claude.md' ? '~/.claude/CLAUDE.md' : rules('~/');
  return segs.length === 1 && low[0] === 'claude.md' ? 'CLAUDE.md' : rules('');
};

export const isGlobalFile = (file) => String(file).startsWith('~/');

// 정한 폴더(base) 안의 보통 파일만 앞 MAX_READ 바이트까지 읽는다(링크로 밖을 가리키면 읽지 않는다). 못 읽으면 ''
const readInside = (base, rel) => {
  try {
    const realBase = fs.realpathSync(base);
    const real = fs.realpathSync(path.join(base, rel));
    const r = path.relative(realBase, real);
    if (!r || r.startsWith('..') || path.isAbsolute(r) || !fs.statSync(real).isFile()) return '';
    const fd = fs.openSync(real, 'r');
    try {
      const buf = Buffer.alloc(Math.min(MAX_READ, fs.fstatSync(fd).size));
      return buf.toString('utf8', 0, fs.readSync(fd, buf, 0, buf.length, 0));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
};

// 읽기 함수(실행마다 하나): 표준 이름 → 맞춘 글(norm). 같은 파일은 다시 읽지 않는다.
// 프로젝트 CLAUDE.md 는 harness-fit 관리 구역을 뺀 글만(구역 안 글은 사용자 글이 아니다)
export const fileReader = (root, home, norm = (s) => s) => {
  const cache = new Map();
  const ch = claudeHome(home);
  return (file) => {
    const f = normFile(file);
    if (!f) return null;
    if (!cache.has(f)) {
      let text = isGlobalFile(f) ? readInside(ch, f.slice('~/.claude/'.length)) : readInside(root, f);
      if (f === 'CLAUDE.md') text = setBlock(text, '');
      cache.set(f, norm(text));
    }
    return cache.get(f);
  };
};
