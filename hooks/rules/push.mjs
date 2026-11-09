// push 전에 커밋 묶기(squash-push): 올릴 브랜치에 원격 어디에도 없는 커밋이 둘 이상이면 push 를 막고 묶는 법을 알려 준다.
// 「원격에 없다」는 원격 추적 브랜치(refs/remotes, 마지막 fetch 기준) 어디에도 없는 것. 원격 기록이 하나도 없으면(처음 올리기) 보지 않는다.
// 같은 명령에서 push 앞의 git commit 은 아직 없는 커밋이라 하나씩 더해 센다(--amend·--dry-run 은 커밋 수를 늘리지 않는다).
import { git, gitSegments, shortFlags } from '../lib/core.mjs';
import { timelineOf } from '../lib/branches.mjs';

const MAX_LISTED = 6;
// push 에서 값을 받는 옵션(다음 낱말은 원격·refspec 이 아니다) — git.mjs parsePush 와 같은 목록
const PUSH_VALUE_OPTS = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
const PUSH_ALL = /^--(?:all|branches)$/;
const AMEND = /(?:^|\s)--am(?:e(?:nd?)?)?(?=\s|$)/;
const DRY_RUN = /(?:^|\s)--dry-run(?=\s|$)/;

// push 낱말 → { skip } · { all } · { sources: [브랜치 이름 | null(지금 브랜치)] }
export const pushSources = (words) => {
  const positional = [];
  const flags = [];
  for (let i = 0; i < words.length; i++) {
    if (words[i] === '--') {
      positional.push(...words.slice(i + 1));
      break;
    }
    if (PUSH_VALUE_OPTS.has(words[i])) i++;
    else if (words[i].startsWith('-')) flags.push(words[i]);
    else positional.push(words[i]);
  }
  const short = shortFlags(flags.filter((f) => !f.startsWith('--')).join(' '), 'o');
  // 지우기·미리 보기는 커밋을 올리는 push 가 아니다
  if (short.has('d') || short.has('n') || flags.some((f) => f === '--delete' || f === '--dry-run')) return { skip: true };
  if (flags.some((f) => PUSH_ALL.test(f) || f === '--mirror')) return { all: true };
  const specs = positional.slice(1);
  // --tags 만 주면 태그만 올린다(브랜치는 안 올림 — git.mjs parsePush 와 같다)
  if (!specs.length) return flags.includes('--tags') ? { sources: [] } : { sources: [null] };
  const sources = [];
  for (const spec of specs) {
    const raw = spec.replace(/^\+/, '');
    const src = raw.includes(':') ? raw.slice(0, raw.indexOf(':')) : raw;
    if (src === '') continue; // `:main` 은 원격 브랜치 지우기
    // HEAD·@, 명령으로 구한 이름($(git branch --show-current), PowerShell (git …))은 지금 브랜치
    if (src === 'HEAD' || src === '@' || /\$\(|`/.test(src) || src.startsWith('(')) sources.push(null);
    else sources.push(src.replace(/^refs\/heads\//, ''));
  }
  return { sources };
};

const lines = (out) => (out || '').split('\n').map((s) => s.trim()).filter(Boolean);
const hasRemoteRefs = (root) => lines(git(root, ['for-each-ref', '--count=1', 'refs/remotes'])).length > 0;
const localBranches = (root) => lines(git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']));
const isBranch = (root, name) => git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}^{commit}`]) !== null;
const unpushedCount = (root, name) => Number(lines(git(root, ['rev-list', '--count', `refs/heads/${name}`, '--not', '--remotes']))[0] || 0);

// 묶을 기준(올리지 않은 커밋 바로 앞)과 올리지 않은 커밋 목록
const squashPlan = (root, name) => {
  const firstParent = lines(git(root, ['rev-list', '--first-parent', `refs/heads/${name}`, '--not', '--remotes']));
  const oldest = firstParent[firstParent.length - 1];
  const base = oldest ? lines(git(root, ['rev-parse', '--short', `${oldest}^`]))[0] : lines(git(root, ['rev-parse', '--short', `refs/heads/${name}`]))[0];
  const listed = lines(git(root, ['log', `--format=%h %s`, '-n', String(MAX_LISTED), `refs/heads/${name}`, '--not', '--remotes']));
  return { base: base || 'HEAD', listed };
};

export const squashPush = {
  id: 'squash-push',
  on: 'shell',
  check({ cmd, shell, root, t }) {
    if (!root) return null;
    const pushes = gitSegments(cmd, 'push', shell);
    if (!pushes.length || !hasRemoteRefs(root)) return null;
    const branchAt = timelineOf(cmd, shell, root);
    const commits = gitSegments(cmd, 'commit', shell).filter((c) => !AMEND.test(c.bare) && !DRY_RUN.test(c.bare));
    // 브랜치마다 git 에 한 번만 묻는다(같은 명령에 push 가 여럿이어도)
    const counted = new Map();
    const countOf = (name) => {
      if (!counted.has(name)) counted.set(name, isBranch(root, name) ? unpushedCount(root, name) : null);
      return counted.get(name);
    };
    let all = null;
    for (const p of pushes) {
      const r = pushSources(p.words);
      if (r.skip) continue;
      const current = branchAt(p.start);
      const names = r.all ? (all ??= localBranches(root)) : r.sources.map((s) => s ?? current);
      for (const name of new Set(names)) {
        const have = name ? countOf(name) : null;
        if (have === null) continue; // 태그·커밋 해시·detached HEAD 는 브랜치가 아니다
        // 이 push 앞에서 같은 브랜치에 만들 커밋
        const pending = commits.filter((c) => c.start < p.start && branchAt(c.start) === name).length;
        const n = have + pending;
        if (n <= 1) continue;
        const { base, listed } = squashPlan(root, name);
        const list = listed.length ? `\n${listed.map((l) => `- ${l}`).join('\n')}` : '';
        return t(pending ? 'push.squashPending' : 'push.squash', { branch: name, n, base, pending, list });
      }
    }
    return null;
  },
};

export default [squashPush];
