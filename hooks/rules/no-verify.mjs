// 커밋 전 검사(git 훅)를 건너뛰지 않는다. 막는 꼴(packs.json detail 과 같은 목록):
//   1. commit·push·merge·pull·rebase·am 의 --no-verify(git 이 받아 주는 줄임 --no-veri·--no-verif 포함), commit 의 -n
//      (push 의 -n 은 dry-run 이라 보지 않는다)
//   2. 같은 명령에서 훅 도구를 끄는 환경 변수: HUSKY=0, HUSKY_SKIP_HOOKS, SKIP(pre-commit), LEFTHOOK=0, SKIP_SIMPLE_GIT_HOOKS
//      — 앞붙임(`HUSKY=0 git commit`), export·set·env, PowerShell `$env:HUSKY=0`·Set-Item env:·[Environment]::SetEnvironmentVariable
//   3. git -c core.hooksPath=… · --config-env core.hooksPath=… 를 붙인 commit·push·merge·pull·rebase·am
//   4. git config 로 core.hooksPath 를 지금 훅 폴더가 아닌 곳으로 바꾸거나 지우기(지금 훅 폴더에 훅이 있을 때),
//      --global·--system 의 core.hooksPath 바꾸기
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { git } from '../lib/core.mjs';
import { gitSegments, shortFlags, stripQuoted, commandSegments } from '../lib/cmdline.mjs';
import { COMMIT_VALUE_FLAGS, gitWords, commandWords, GIT_WORD } from '../lib/staged.mjs';

const HOOKED = 'commit|push|merge|pull|rebase|am';
const NO_VERIFY = /^--no-veri(?:f|fy)?$/;

// 환경 변수 이름 → 이 값이면 검사를 끈다
const OFF_VALUE = /^(?:0|false)$/i;
const ANY_VALUE = (v) => v !== '' && !OFF_VALUE.test(v);
const BYPASS_ENV = {
  HUSKY: (v) => OFF_VALUE.test(v),
  HUSKY_SKIP_HOOKS: ANY_VALUE,
  SKIP: (v) => v !== '',
  LEFTHOOK: (v) => OFF_VALUE.test(v),
  SKIP_SIMPLE_GIT_HOOKS: ANY_VALUE,
};
const NAMES = Object.keys(BYPASS_ENV).join('|');
const HOOKS_PATH = /^core\.hookspath=/i;
const CONFIG_ENV = /^(?:GIT_CONFIG_PARAMETERS|GIT_CONFIG_KEY_\d+)$/;

// 따옴표 밖에 있는 이름(bare 에서 찾고) → 값(원래 명령에서 낱말 하나 읽기)
// export·set 으로 넣으면 명령 끝까지 남는다. 앞붙임(`HUSKY=0 npm ci`, `env HUSKY=0 …`)은 그 명령 하나에만 간다.
const BASH_ASSIGN = new RegExp(String.raw`(?:^|[\s;&|(])(export\s+|set\s+)?(?:env\s+(?:-\S+\s+)*)?(${NAMES}|GIT_CONFIG_PARAMETERS|GIT_CONFIG_KEY_\d+)=`, 'g');
const PS_ASSIGN = new RegExp(String.raw`\$env:(${NAMES}|GIT_CONFIG_PARAMETERS|GIT_CONFIG_KEY_\d+)\s*=\s*|\bSet-Item\s+(?:-Path\s+)?env:(${NAMES})\s+(?:-Value\s+)?|\bNew-Item\s+(?:-Path\s+)?env:(${NAMES})\s+(?:-Value\s+)?`, 'gi');
const HOOKED_SUB = /^(?:commit|push|merge|pull|rebase|am)$/;
// 자리 at 가 든 명령 조각이 검사를 돌리는 git 명령(commit·push …)인지
const onHookedGit = (cmd, shell, at) => {
  const seg = commandSegments(cmd, shell).find((s) => s.start <= at && at < s.start + s.raw.length);
  if (!seg) return false;
  const w = commandWords(seg.words.filter((x) => x !== 'env' && !/^-[iu]$/.test(x)));
  return GIT_WORD.test(w[0] || '') && HOOKED_SUB.test(gitWords(w).sub);
};
const SET_ENV_VAR = /\[(?:System\.)?Environment\]::SetEnvironmentVariable\(\s*["'](\w+)["']\s*,\s*["']?([^"',)]*)/gi;

// 옵션 낱말만(값은 뺀다). 따옴표 친 옵션(`"--no-verify"`)도 git 에는 옵션이라 따옴표를 벗긴 낱말로 본다.
// 다음 낱말을 값으로 받는 옵션(-m 메시지, -o push 옵션 …)의 값은 옵션이 아니다.
const VALUE_LONG = new Set(['--message', '--file', '--author', '--date', '--template', '--reuse-message', '--reedit-message', '--fixup', '--squash', '--cleanup', '--trailer', '--push-option', '--repo', '--receive-pack', '--exec', '--onto', '--strategy', '--strategy-option', '--into-name']);
// 하위 명령마다 다음 낱말을 값으로 받는 짧은 옵션(commit 의 -s 는 서명 줄, merge 의 -s 는 전략이라 다르다)
const VALUE_SHORT = { commit: 'mFCct', push: 'o', merge: 'mFsX', pull: 'sX', rebase: 'sXxC', am: '' };
const optionWords = (sub, words) => {
  const short = VALUE_SHORT[sub] || '';
  const out = [];
  for (let i = 0; i < words.length && words[i] !== '--'; i++) {
    const w = words[i];
    if (!w.startsWith('-') || w === '-') continue;
    out.push(w);
    if (VALUE_LONG.has(w)) i++;
    else if (/^-[A-Za-z]+$/.test(w)) {
      // 묶음에서 값을 받는 글자가 나오면 거기서 끝난다. 맨 끝 글자면 다음 낱말이 값이다.
      const at = [...w.slice(1)].findIndex((c) => short.includes(c));
      if (at === w.length - 2) i++;
    }
  }
  return out;
};

const valueAt = (cmd, i) => {
  const q = cmd[i];
  if (q === '"' || q === "'") {
    const end = cmd.indexOf(q, i + 1);
    return cmd.slice(i + 1, end === -1 ? cmd.length : end);
  }
  return (cmd.slice(i).match(/^[^\s;&|)]*/) || [''])[0];
};

const envBypass = (cmd, shell) => {
  const bare = stripQuoted(cmd, shell);
  const hits = [];
  for (const m of bare.matchAll(BASH_ASSIGN)) {
    if (!m[1] && !onHookedGit(cmd, shell, m.index + m[0].length - 1)) continue;
    hits.push([m[2].toUpperCase(), valueAt(cmd, m.index + m[0].length)]);
  }
  for (const m of bare.matchAll(PS_ASSIGN)) hits.push([(m[1] || m[2] || m[3]).toUpperCase(), valueAt(cmd, m.index + m[0].length)]);
  for (const m of cmd.matchAll(SET_ENV_VAR)) if (bare.slice(m.index, m.index + 5) === cmd.slice(m.index, m.index + 5)) hits.push([m[1].toUpperCase(), m[2]]);
  return hits.find(([name, value]) => (BYPASS_ENV[name] ? BYPASS_ENV[name](value) : CONFIG_ENV.test(name) && /core\.hookspath/i.test(value)));
};

// git -c core.hooksPath=… <하위 명령>
const configOverride = (globals) =>
  globals.some((g, i) => ((g === '-c' || g === '--config-env') && HOOKS_PATH.test(globals[i + 1] || '')) || /^--config-env=core\.hookspath=/i.test(g));

// git config 로 core.hooksPath 바꾸기·지우기 → 막아야 하면 true
const CONFIG_SCOPE = /^--(?:global|system)$/;
const CONFIG_VALUE_OPTS = new Set(['--file', '-f', '--blob', '--type', '--default', '--comment', '--value']);
const hasHooks = (dir) => {
  try {
    return fs.readdirSync(dir).some((f) => !f.endsWith('.sample') && fs.statSync(path.join(dir, f)).isFile());
  } catch {
    return false;
  }
};
const expandHome = (p) => (p.startsWith('~/') || p === '~' ? path.join(os.homedir(), p.slice(1)) : p);
const configChange = (args, root) => {
  let unset = false;
  let scope = false;
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--unset' || a === '--unset-all') unset = true;
    else if (CONFIG_SCOPE.test(a)) scope = true;
    else if (CONFIG_VALUE_OPTS.has(a)) i++;
    else if (!a.startsWith('-')) pos.push(a);
  }
  if (pos[0] === 'set' || pos[0] === 'unset') {
    if (pos[0] === 'unset') unset = true;
    pos.shift();
  }
  if (!/^core\.hookspath$/i.test(pos[0] || '')) return false;
  if (!unset && pos.length < 2) return false; // 읽기
  if (scope) return true;
  if (!root) return false;
  const current = path.resolve(root, (git(root, ['rev-parse', '--git-path', 'hooks']) || '').trim() || '.git/hooks');
  if (!hasHooks(current)) return false;
  const common = (git(root, ['rev-parse', '--git-common-dir']) || '.git').trim();
  const next = unset ? path.resolve(root, common, 'hooks') : path.resolve(root, expandHome(pos[1]));
  return path.relative(current, next) !== '';
};

export const noVerify = {
  id: 'no-verify',
  on: 'shell',
  check({ cmd, shell, root, t }) {
    const hooked = HOOKED.split('|').flatMap((sub) => gitSegments(cmd, sub, shell).map((s) => ({ ...s, sub })));
    const skipFlag = hooked.some((s) => {
      const opts = optionWords(s.sub, s.words);
      return opts.some((w) => NO_VERIFY.test(w)) || (s.sub === 'commit' && shortFlags(opts.join(' '), COMMIT_VALUE_FLAGS).has('n'));
    });
    if (skipFlag) return t('git.noVerify');
    if (hooked.length) {
      const env = envBypass(cmd, shell);
      if (env) return t('git.noVerifyEnv', { name: env[0] });
    }
    for (const seg of commandSegments(cmd, shell)) {
      const w = commandWords(seg.words);
      if (!GIT_WORD.test(w[0] || '')) continue;
      const { sub, args, globals } = gitWords(w);
      if (new RegExp(`^(?:${HOOKED})$`).test(sub) && configOverride(globals)) return t('git.hooksPath');
      if (sub === 'config' && configChange(args, root)) return t('git.hooksPath');
    }
    return null;
  },
};

export default [noVerify];
