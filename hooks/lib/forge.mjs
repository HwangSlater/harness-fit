// 저장소가 GitLab 인지 — 안내 글을 「PR」 대신 「MR」 로 쓰려고만(역할극 14 회차 2026-11-13, 사용자 지적 2026-11-24). scripts/detect.mjs hostOf 와 같은 기준:
// origin 주소에 gitlab 이 들면, origin 이 없으면 .gitlab-ci.yml·.gitlab/ 이 있으면. .git/config 를 파일로 먼저 읽고, 애매하면 git config 한 번.
// 막거나 알릴 때만 부른다(통과하는 명령에는 들지 않는다). 규칙 여럿(git.mjs·review.mjs·flow.mjs)이 같이 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { git } from './core.mjs';
import { findRepo } from './repo-files.mjs';

// 줄마다 읽는다: [remote "origin"] 아래 첫 url. [include]·[includeIf] 가 있으면 다른 파일이 바꿀 수 있어 git 에게 묻는다
const urlInConfig = (text) => {
  let inOrigin = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      if (/^\[\s*include/i.test(line)) return null;
      inOrigin = /^\[\s*remote\s+"origin"\s*\]$/i.test(line);
    } else if (inOrigin && /^url\s*=/i.test(line)) return line.slice(line.indexOf('=') + 1).trim();
  }
  return '';
};
const originUrl = (root) => {
  const repo = findRepo(root);
  if (repo) {
    try {
      const url = urlInConfig(fs.readFileSync(path.join(repo.commonDir, 'config'), 'utf8').slice(0, 256 * 1024));
      if (url !== null) return url;
    } catch {}
  }
  return (git(root, ['config', '--get', 'remote.origin.url'], { okCodes: [1] }) || '').trim();
};
export const onGitlab = (root) => {
  const url = originUrl(root);
  if (url) return /gitlab/i.test(url);
  return ['.gitlab-ci.yml', '.gitlab'].some((f) => fs.existsSync(path.join(root, f)));
};
// 안내 글에 쓸 낱말: GitLab 저장소면 MR, 아니면 PR, 저장소 밖이면 둘 다. dir 은 저장소 맨 위가 아니어도 된다(명령이 도는 폴더)
// .gitlab-ci.yml 단서는 저장소 맨 위에서 본다(하위 폴더에서 부르면 못 찾던 것 — 검토 2026-11-26)
export const prWordOf = (dir) => {
  const repo = dir ? findRepo(dir) : null;
  if (!repo) return 'PR/MR';
  return onGitlab(repo.root || dir) ? 'MR' : 'PR';
};
