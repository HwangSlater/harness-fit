// git 명령 낱말 읽기: commit·add 의 옵션과 경로, git 전역 옵션, 앞붙은 환경 변수·셸 흐름 낱말.
// 커밋 계획(staged.mjs)과 git 규칙(rules/git·message·no-verify·history)이 같이 쓴다. 낱말은 따옴표를 벗긴 것(cmdline.mjs gitSegments).
import { shortFlags } from './cmdline.mjs';

// stage 에 올리는 하위 명령. `git stage` 는 `git add` 의 다른 이름이다.
export const ADD_SUB = 'add|stage';

// commit 의 짧은 옵션 중 값을 받는 것(-m 메시지, -F 파일, -C/-c 커밋, -t 템플릿, -S 키, -u 모드).
export const COMMIT_VALUE_FLAGS = 'mFCctSu';
// 그중 다음 낱말을 값으로 가져가는 것(-S·-u 는 붙여 쓸 때만 값을 받는다).
export const COMMIT_NEXT_VALUE = 'mFCct';
export const COMMIT_LONG_VALUE = new Set([
  '--message', '--file', '--author', '--date', '--template', '--reuse-message', '--reedit-message',
  '--fixup', '--squash', '--cleanup', '--trailer', '--pathspec-from-file',
]);
const REDIRECT = /^\d*[<>]/;
const REDIRECT_ONLY = /^\d*(?:<<-?|<|>>?|>&)$/;

// commit 이 -a/--all 로 추적 중인 변경을 모두 넣는지. 인자는 따옴표를 비운 것.
export const commitStagesAll = (bare) => shortFlags(bare, COMMIT_VALUE_FLAGS).has('a') || /(?:^|\s)--all(?=\s|$)/.test(bare);

// `git commit <경로> -m …` 의 경로들(옵션 값·리다이렉션은 뺀다).
export const commitPaths = (words) => {
  const out = [];
  let opts = true;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (REDIRECT.test(w)) {
      if (REDIRECT_ONLY.test(w)) i++;
    } else if (opts && w === '--') opts = false;
    else if (opts && w.startsWith('--')) {
      if (COMMIT_LONG_VALUE.has(w)) i++;
    } else if (opts && /^-[A-Za-z]/.test(w)) {
      // 묶음(-am)에서 값을 받는 글자가 맨 끝이면 다음 낱말이 그 값이다.
      const at = [...w.slice(1)].findIndex((ch) => COMMIT_NEXT_VALUE.includes(ch));
      if (at === w.length - 2) i++;
    } else out.push(w);
  }
  return out;
};

// git add 인자 → { specs: 경로들, force, update: -u, all: -A }.
const ADD_UPDATE = /^--update$/;
const ADD_ALL = /^--(?:all|no-ignore-removal)$/;
export const parseAdd = (words) => {
  const opts = words.filter((w) => w.startsWith('-'));
  const specs = words.filter((w) => !w.startsWith('-'));
  const short = shortFlags(opts.filter((w) => !w.startsWith('--')).join(' '));
  const all = short.has('A') || opts.some((w) => ADD_ALL.test(w));
  const update = short.has('u') || opts.some((w) => ADD_UPDATE.test(w));
  return { specs, force: short.has('f') || opts.includes('--force'), update, all };
};

export const GIT_WORD = /^(?:.*[\\/])?git(?:\.exe|\.cmd)?$/i;
const GIT_GLOBAL_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env']);

// git 낱말들(첫 낱말이 git) → { sub, args, globals }. 전역 옵션(-C 경로, -c 키=값 …)은 globals 로.
export const gitWords = (words) => {
  let i = 1;
  while (i < words.length && words[i].startsWith('-')) i += GIT_GLOBAL_VALUE.has(words[i]) ? 2 : 1;
  return { sub: words[i] || '', args: words.slice(i + 1), globals: words.slice(1, i) };
};

// 조각 낱말에서 앞붙은 환경 변수(`A=1 git …`), PowerShell 호출 연산자(`& git …`), 셸 흐름 낱말(`then git …`, `{ git …`)을 뗀다.
const ENV_PREFIX = /^[A-Za-z_][A-Za-z0-9_]*=/;
const LEADING = new Set(['&', '{', '}', 'then', 'else', 'do', '!', 'time', 'command']);
export const commandWords = (words) => {
  let i = 0;
  while (i < words.length && (ENV_PREFIX.test(words[i]) || LEADING.has(words[i]))) i++;
  return words.slice(i);
};
