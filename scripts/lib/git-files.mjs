// git 이 아는 파일(추적 중 + 무시 목록에 없는 새 파일) 가운데 글롭에 맞는 것. git 저장소가 아니면 빈 목록.
// 감지(scripts/detect.mjs)가 여러 글롭 무리를 따로 물으면 무리마다 git 을 띄운다 — Windows 에서 한 번에 50~100ms(2026-11-19).
// 그래서 무리를 합쳐 한 번만 부르고 무리별로는 여기서 나눈다.
import { execFileSync } from 'node:child_process';

const LIST_BUFFER = 64 * 1024 * 1024;

// -z: 한글 등 ASCII 밖 경로도 따옴표·8진수 없이 그대로 온다. .claude/ 는 이 도구가 넣는 파일이라 뺀다
export const lsFiles = (root, globs) => {
  try {
    return execFileSync('git', ['-C', root, 'ls-files', '-z', '-co', '--exclude-standard', '--', ...globs, ':(exclude).claude/**'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: LIST_BUFFER }).split('\0').filter(Boolean);
  } catch {
    return [];
  }
};

// git 경로 글롭의 기본 꼴(magic 없음): * 는 / 도 넘고, 대소문자를 가리며, 경로 전체가 맞아야 한다 → 같은 뜻의 정규식.
// ?·[…] 도 git 에서는 와일드카드인데 여기서는 옮기지 않는다 — 쓰면 git 이 낸 파일을 조용히 버리게 되니 바로 멈춘다(검토 2026-11-19)
const part = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
export const globRe = (globs) => {
  const odd = globs.find((g) => /[?[\]]/.test(g));
  if (odd) throw new Error(`globRe 는 * 만 안다: ${odd}`);
  return new RegExp(`^(?:${globs.map((g) => g.split('*').map(part).join('.*')).join('|')})$`);
};

// { 이름: 글롭[] } → { 이름: 경로[] }(git 은 한 번, 경로 차례는 git 이 낸 차례)
export const filesByGlobs = (root, groups) => {
  const files = lsFiles(root, [...new Set(Object.values(groups).flat())]);
  return Object.fromEntries(Object.entries(groups).map(([name, globs]) => {
    const re = globRe(globs);
    return [name, files.filter((p) => re.test(p))];
  }));
};
