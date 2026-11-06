// 명령줄 인자: [프로젝트] [--lang ko|en] [--stack "Next.js,Supabase"] [--team] [--similar "<스킬 id>=<이미 있는 스킬>,…"] [--skip "<규칙 id>:<줄 번호>,…"]
// --stack·--team 은 저장소에서 읽을 게 없을 때(빈 저장소) 사용자가 말해 준 내용이다(SKILL.md 가 넘긴다).
// --similar·--skip 은 setup 때 Claude 가 이미 있는 스킬·CLAUDE.md 와 견주어 겹친다고 본 것이다(scripts/overlap.mjs 를 읽고 넘긴다).
import path from 'node:path';

const VALUE_FLAGS = new Set(['--lang', '--stack', '--selection', '--similar', '--skip']);

export const pickLang = (arg) => {
  if (arg === 'ko' || arg === 'en') return arg;
  const sys = process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale || '';
  return /^ko/i.test(sys) ? 'ko' : 'en';
};

const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
const pairs = (v, sep) => list(v).map((x) => x.split(sep).map((y) => y.trim())).filter(([a, b]) => a && b).map(([id, to]) => ({ id, to }));
// "structure:3,security:2" → { structure: [3], security: [2] } (규칙 글의 「- 」 줄 번호, 1부터)
const skipLines = (v) => {
  const out = {};
  for (const [id, n] of pairs(v, ':').map(({ id, to }) => [id, Number(to)])) if (/^[\w-]+$/.test(id) && Number.isInteger(n) && n > 0) (out[id] ||= []).push(n);
  return out;
};

export const parseArgs = (args) => {
  const value = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  const stack = (value('--stack') || '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    lang: pickLang(value('--lang')),
    root: path.resolve(args.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(args[i - 1])) || '.'),
    hints: { stack, team: args.includes('--team'), similar: pairs(value('--similar'), '='), skip: skipLines(value('--skip')) },
  };
};
