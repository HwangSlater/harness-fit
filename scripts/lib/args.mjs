// 명령줄 인자: [프로젝트] [--lang ko|en] [--stack "Next.js,Supabase"] [--team]
// --stack·--team 은 저장소에서 읽을 게 없을 때(빈 저장소) 사용자가 말해 준 내용이다(SKILL.md 가 넘긴다).
import path from 'node:path';

const VALUE_FLAGS = new Set(['--lang', '--stack', '--selection']);

export const pickLang = (arg) => {
  if (arg === 'ko' || arg === 'en') return arg;
  const sys = process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale || '';
  return /^ko/i.test(sys) ? 'ko' : 'en';
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
    hints: { stack, team: args.includes('--team') },
  };
};
