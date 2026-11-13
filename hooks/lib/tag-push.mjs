// git push 가 태그를 올리는지(ask-cmd 의 묻기·막기 — hooks/rules/shell.mjs). remote-cmd.mjs 가 400줄에 닿아 나눴다(2026-11-13).
import fs from 'node:fs';
import path from 'node:path';
import { git } from './core.mjs';
import { findRepo, refExists } from './repo-files.mjs';

// 출시 태그 올리기(역할극 16 회차 정답지 M2): git push 의 --tags·--mirror, 태그(refs/tags/…, 태그로 있는 버전 꼴 이름 — 아래, 지우기 :v1.0.0 도),
// `tag <이름>`. 태그가 CI 출시를 시작하는 저장소가 흔하고, 평소 push 에는 없는 꼴이라 헛물음이 드물다.
// --follow-tags 는 평소 push 마다 붙이는 사람이 있어 여기서는 보지 않는다 — iOS 스택 기본 묻는 명령(catalog/combos.json)으로만
// 버전 꼴 이름(2.0·3.12·v2.0-dev·2024.11)은 유지보수 브랜치에도 흔하다(CPython 3.12·Symfony 6.4 — 검토 2026-11-13: 이런 브랜치 push 가 물었다).
// 그래서 refs/tags/ 를 적지 않은 버전 꼴은 저장소에서 한 번 찾아본다(git for-each-ref 한 번 — push 이고 버전 꼴 이름이 있을 때만):
// 로컬 태그면 묻고, 브랜치(로컬·원격 추적)면 묻지 않는다. 어느 쪽도 없거나 찾지 못하면(저장소 밖·git 없음) 출시 태그 꼴
// N.N.N(앞 v 는 있어도 없어도, 뒤붙이 없음)만 묻는다 — 2.0-dev·2024.11·1.2.3-hotfix 처럼 애매한 것은 묻지 않는다(헛물음이 놓침보다 나쁘다).
// -u·--set-upstream 은 브랜치를 올리는 꼴이라 버전 꼴 이름을 보지 않는다. src:dst 는 src 로(HEAD:v2.1 은 브랜치 — 지우기 :v1.0.0 만 dst).
const GIT_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env']);
const PUSH_VALUE = /^(?:--repo|--receive-pack|--exec|-o|--push-option)$/;
const VERSION_REF = /^v?\d+\.\d+(?:\.\d+)*(?:[-+][\w.-]+)?$/i;
const RELEASE_REF = /^v?\d+\.\d+\.\d+$/i;
const LOOKUP_MAX = 50;
// 저장소에 그 이름의 태그·브랜치가 있는지 — Set(refname) 또는 null(찾지 못함)
// ref 파일로 먼저 찾고(lib/repo-files.mjs — git 0번), 하나라도 애매하면 for-each-ref 한 번.
const refsOf = (dir, names, remote) => {
  if (!dir) return null;
  const wanted = names.flatMap((x) => [`refs/tags/${x}`, `refs/heads/${x}`, ...(remote ? [`refs/remotes/${remote}/${x}`] : [])]);
  const repo = findRepo(dir);
  if (repo === false) return null;
  if (repo) {
    const has = wanted.map((r) => refExists(repo, r));
    if (has.every((h) => h !== undefined)) return new Set(wanted.filter((_, k) => has[k]));
  }
  const out = git(dir, ['for-each-ref', '--format=%(refname)', ...wanted]);
  return out === null ? null : new Set(out.split(/\r?\n/).filter(Boolean));
};
export const tagPush = (w, cwd = null) => {
  if (w[0] !== 'git') return false;
  let i = 1;
  let dir = cwd;
  while (i < w.length && w[i].startsWith('-')) {
    if (w[i] === '-C' && dir && w[i + 1]) dir = path.resolve(dir, w[i + 1]);
    i += GIT_VALUE.has(w[i]) ? 2 : 1;
  }
  if (w[i] !== 'push') return false;
  const rest = w.slice(i + 1);
  if (rest.some((x) => x === '-n' || x === '--dry-run' || x === '--help')) return false;
  if (rest.some((x) => x === '--tags' || x === '--mirror')) return true;
  const upstream = rest.some((x) => x === '-u' || x === '--set-upstream');
  const pos = [];
  for (let k = 0; k < rest.length; k++) {
    if (!rest[k].startsWith('-')) pos.push(rest[k]);
    else if (PUSH_VALUE.test(rest[k])) k++;
  }
  // 맨 앞 위치 인자는 원격 이름
  const [remote, ...refs] = pos;
  if (refs.some((x, k) => x === 'tag' && refs[k + 1])) return true;
  // 찾아볼 이름: 버전 꼴만이 아니라 모든 ref 이름 — release-1.3.0 같은 태그가 지나갔다(역할극 16 회차 다시, 2026-11-13). 찾는 것은 같은 한 번(refsOf)
  const names = [];
  for (const x of refs) {
    const spec = x.replace(/^\+/, '');
    const at = spec.indexOf(':');
    const src = at < 0 ? spec : spec.slice(0, at);
    const name = src || spec.slice(at + 1); // 빈 src(:v1.0.0)는 지우기 — 지울 이름
    // refs/tags/ 를 적으면 어느 쪽이든 태그(HEAD:refs/tags/v2 는 원격에 태그를 만든다)
    if (spec.split(':').some((p) => /^refs\/tags\/./.test(p))) return true;
    if (!upstream && name && !/^(?:HEAD|@)$/.test(name)) names.push(name);
  }
  if (!names.length) return false;
  // 이름이 아주 많으면(명령줄 길이 한도) 찾지 않고 N.N.N 꼴만 본다
  const found = names.length <= LOOKUP_MAX ? refsOf(dir, names, remote && /^[\w.-]+$/.test(remote) ? remote : '') : null;
  return names.some((x) => {
    if (found?.has(`refs/tags/${x}`)) return true;
    // 버전 꼴이 아닌 이름은 로컬 태그일 때만(브랜치 이름이 대부분이다)
    if (!VERSION_REF.test(x)) return false;
    if (found && [`refs/heads/${x}`, `refs/remotes/${remote}/${x}`].some((r) => found.has(r))) return false;
    return RELEASE_REF.test(x);
  });
};

// push.followTags 가 켜져 있나: git -c push.followTags=true push … · 같은 명령 앞의 git config push.followTags true ·
// 저장소 설정 파일(.git/config — 파일로만 읽는다, git 을 띄우지 않는다). 켜져 있으면 「git push」 가 --follow-tags 와 같다(역할극 16 회차 다시, 2026-11-13).
// --no-follow-tags 를 주면 꺼진다. 전역 설정(~/.gitconfig)·include 는 보지 않는다(decisions-hooks.md)
const ON = /^["']?(?:true|yes|on|1)["']?$/i;
const FOLLOW_KEY = /^push\.followtags=(.*)$/i;
const SET_IN_CMD = /\bgit\s+(?:-C\s+\S+\s+)?config\s+(?:--(?:local|global|system|add|replace-all)\s+)*push\.followTags\s+["']?(?:true|yes|on|1)\b/i;
// 폴더마다 한 번만 읽는다(push 조각이 많아도 — 한 도구 호출 안에서 설정 파일은 바뀌지 않는다)
const followMemo = new Map();
const configFollowTags = (dir) => {
  if (!dir) return false;
  if (!followMemo.has(dir)) followMemo.set(dir, readFollowTags(dir));
  return followMemo.get(dir);
};
const readFollowTags = (dir) => {
  const repo = findRepo(dir);
  if (!repo) return false;
  let text = '';
  try {
    text = fs.readFileSync(path.join(repo.commonDir, 'config'), 'utf8').slice(0, 256 * 1024);
  } catch {
    return false;
  }
  let inPush = false;
  let on = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[#;].*$/, '').trim();
    if (line.startsWith('[')) { inPush = /^\[\s*push\s*\]$/i.test(line); continue; }
    const m = inPush && /^followtags\s*(?:=\s*(.*))?$/i.exec(line);
    if (m) on = m[1] === undefined || ON.test(m[1].trim());
  }
  return on;
};
export const followTagsOn = (w, cwd = null, cmd = '') => {
  if (w[0] !== 'git') return false;
  let i = 1;
  let dir = cwd;
  let flag = null;
  while (i < w.length && w[i].startsWith('-')) {
    if (w[i] === '-C' && dir && w[i + 1]) dir = path.resolve(dir, w[i + 1]);
    if (w[i] === '-c' && FOLLOW_KEY.test(w[i + 1] || '')) flag = ON.test(FOLLOW_KEY.exec(w[i + 1])[1]);
    i += GIT_VALUE.has(w[i]) ? 2 : 1;
  }
  if (w[i] !== 'push') return false;
  const rest = w.slice(i + 1);
  if (rest.includes('--no-follow-tags') || rest.includes('--follow-tags')) return false;
  if (flag !== null) return flag;
  return SET_IN_CMD.test(cmd) || configFollowTags(dir);
};
// 켜져 있으면 낱말 끝에 --follow-tags 를 붙인 꼴(적은 「git push --follow-tags」 와 맞추려고), 아니면 그대로
export const withFollowTags = (line, cwd, cmd) => (followTagsOn(line, cwd, cmd) ? [...line, '--follow-tags'] : line);
