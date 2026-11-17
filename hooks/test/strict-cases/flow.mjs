// 브랜치 전략 훅 엄격 사례: merge-flow(Git Flow 합치기 방향, 막음) · branch-age(오래 산 브랜치, 알림).
// 시험 저장소는 main 에 2020 년 커밋 하나. 브랜치 이름이 바뀌는 사례는 같은 명령의 git switch 로 준다(그 브랜치가 없어도 switch 는 옮긴다고 본다).
import { S, B, P, keyed } from './helpers.mjs';

const DAY_S = 86400;
const isoAgo = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();
// origin/feature/login 원격 추적 브랜치가 있는 저장소
const remoteFeature = keyed('remote-feature', (r) => r.git('update-ref', 'refs/remotes/origin/feature/login', 'HEAD'));
// 지금 브랜치 feature/old, 그 브랜치만의 커밋 하나를 agoS 초 전에 쓴 것으로
const agedBranch = (agoS) =>
  keyed(`aged\0${agoS}`, (r) => {
    r.git('switch', '-q', '-c', 'feature/old');
    r.put('src/old.js', 'export const old = 1;\n');
    r.git('add', 'src/old.js');
    r.git('commit', '-q', '-m', 'feat: old', '--date', isoAgo(agoS));
  });
const oldBranch = agedBranch(3 * DAY_S);
const freshBranch = agedBranch(60);
// 지금 브랜치 feature/x(오늘 커밋 하나), main 은 그 뒤로 빈 커밋 n 개 더
const behindBranch = (n, remoteOnly = false) =>
  keyed(`behind\0${n}\0${remoteOnly}`, (r) => {
    const start = r.git('rev-parse', 'HEAD');
    for (let i = 0; i < n; i++) r.git('commit', '-q', '--allow-empty', '-m', `chore: main ${i}`);
    r.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    r.git('switch', '-q', '-c', 'feature/x', start);
    r.put('src/x.js', 'export const x = 1;\n');
    r.git('add', 'src/x.js');
    r.git('commit', '-q', '-m', 'feat: x');
    // 원격 main 만 앞서 있게(로컬 main 은 오래 안 받아 온 것처럼 시작 커밋으로)
    if (remoteOnly) r.git('branch', '-f', 'main', start);
  });
// 로컬 main 만 n 커밋 앞서고 origin/main 은 시작 커밋에 머문 저장소(fork 의 옛 origin·아직 안 올린 커밋), 지금 브랜치 feature/x 는 시작 커밋에서
const staleOrigin = (n) =>
  keyed(`stale-origin\0${n}`, (r) => {
    const start = r.git('rev-parse', 'HEAD');
    r.git('update-ref', 'refs/remotes/origin/main', start);
    for (let i = 0; i < n; i++) r.git('commit', '-q', '--allow-empty', '-m', `chore: local ${i}`);
    r.git('switch', '-q', '-c', 'feature/x', start);
    r.commit('src/x.js', 'export const x = 1;\n', 'feat: x');
  });
// 로컬 main 에만 사흘 전 커밋(아직 안 올림), 그 위에서 오늘 만든 브랜치 — 옛 origin/main 과만 견주면 사흘 된 브랜치로 잘못 셌다
const unpushedTrunk = keyed('unpushed-trunk', (r) => {
  r.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  r.put('src/m.js', 'export const m = 1;\n');
  r.git('add', 'src/m.js');
  r.git('commit', '-q', '-m', 'feat: m', '--date', isoAgo(3 * DAY_S));
  r.git('switch', '-q', '-c', 'feature/today');
  r.commit('src/t.js', 'export const t = 1;\n', 'feat: t');
});
// 로컬 main 을 지우고 origin/main 만 남긴 저장소, 지금 브랜치는 사흘 된 feature/old
const originOnly = keyed('origin-only', (r) => {
  r.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  r.git('switch', '-q', '-c', 'feature/old');
  r.put('src/old.js', 'export const old = 1;\n');
  r.git('add', 'src/old.js');
  r.git('commit', '-q', '-m', 'feat: old', '--date', isoAgo(3 * DAY_S));
  r.git('branch', '-D', 'main');
});
// feature/x 라는 태그(브랜치는 없음). packed: 태그를 packed-refs 로 옮긴 것
const featureTag = (packed) =>
  keyed(`feature-tag\0${packed}`, (r) => {
    r.git('tag', 'feature/x');
    if (packed) r.git('pack-refs', '--all');
  });
// feature/x 가 태그이자 브랜치(짧은 이름은 git 이 태그를 고른다)
const tagAndBranch = keyed('tag-and-branch', (r) => {
  r.git('tag', 'feature/x');
  r.git('branch', 'feature/x');
});
// 윈도(NTFS)는 ref 이름 대소문자를 가리지 않아 FEATURE/a 도 feature/a 다 — 윈도에서만 막고, POSIX 에서는 다른 이름이라 통과
const WIN = process.platform === 'win32';
const caseCases = [
  S('git merge FEATURE/login', '대문자로 쓴 feature 이름(윈도는 같은 브랜치)'),
  S('git switch MAIN && git merge feature/login', '대문자로 쓴 main(윈도는 같은 브랜치)'),
];

export default {
  'merge-flow': {
    block: [
      S('git merge feature/login', 'main 에서 feature 합치기'),
      S('git switch main && git merge feature/login', '같은 명령에서 main 으로 옮긴 뒤'),
      S('git switch main && git merge --no-ff feature/login', '--no-ff'),
      S('git switch main && git merge --squash bugfix/empty-cart', '--squash · bugfix'),
      S('git switch main && git merge develop', 'develop 을 main 에 바로'),
      S('git switch master && git merge -m "merge it" feature/a', 'master · -m 값 건너뛰기'),
      S('git switch main && git merge -sort feature/a', '붙여 쓴 -s 값'),
      S('git switch main && git merge --no-commit feature/a', '--no-commit'),
      S('git switch release/1.2.0 && git merge feature/login', 'release 에 feature'),
      S('git switch hotfix/crash && git merge develop', 'hotfix 에 develop'),
      S('git switch hotfix/crash && git merge feature/x', 'hotfix 에 feature'),
      S('git -C . merge feature/login', 'git -C'),
      B('cd . && git merge feature/login', 'cd … &&'),
      P('Set-Location .; git merge feature/login', 'PowerShell Set-Location'),
      S('git switch main && git pull origin feature/login', '브랜치를 적은 pull'),
      S('git switch main && git pull --rebase origin develop', 'pull --rebase develop'),
      S('git merge refs/heads/feature/login', 'refs/heads/ 붙은 이름'),
      S('git merge origin/feature/login', '원격 추적 브랜치', { setup: remoteFeature }),
      S('git merge release/1.0 feature/a', '여럿 가운데 하나'),
      B('bash -c "git merge feature/x"', 'bash -c 안'),
      S('git merge refs/heads/feature/x', '같은 이름 태그가 있어도 refs/heads/ 로 적은 브랜치', { setup: tagAndBranch }),
      ...(WIN ? caseCases : []),
    ],
    pass: [
      S('git switch main && git merge --no-ff release/1.2.0', 'release 를 main 에'),
      S('git switch main && git merge hotfix/crash', 'hotfix 를 main 에'),
      S('git switch develop && git merge feature/login', 'feature 를 develop 에'),
      S('git switch develop && git merge main', 'hotfix 뒤 main 되합치기'),
      S('git switch develop && git merge release/1.2.0', 'release 를 develop 에'),
      S('git switch release/1.2.0 && git merge bugfix/x', 'release 에 bugfix'),
      S('git switch hotfix/crash && git merge main', 'hotfix 에 main'),
      S('git switch feature/a && git merge develop', 'feature 에 develop 받기'),
      S('git switch main && git merge -m "feature/x 합침" release/1.0', '-m 값 속 feature'),
      S('git merge v1.2.0', '태그(모르는 이름)'),
      S('git merge HEAD~1', 'HEAD~1'),
      S('git merge -', '직전 브랜치(모름)'),
      S('git merge --abort', '--abort'),
      S('git switch main && git merge staging', '다른 브랜치 이름'),
      S('git merge upstream/feature/login', '원격 추적 ref 가 없는 「원격/…」 꼴'),
      S('git pull', '브랜치 없는 pull'),
      S('git pull origin', '원격만 준 pull'),
      S('git merge-base main feature/x', 'merge-base'),
      S('git log --merges feature/x', '다른 하위 명령'),
      S('git commit -m "docs: git merge feature/x 설명"', '커밋 메시지 속'),
      S('git checkout --detach && git merge feature/x', '분리된 HEAD'),
      S('git merge feature/x', 'feature/x 는 태그(ref 파일)', { setup: featureTag(false) }),
      S('git merge feature/x', 'feature/x 는 태그(packed-refs)', { setup: featureTag(true) }),
      S('git merge feature/x', '태그와 브랜치가 같은 이름이면 git 은 태그를 고른다', { setup: tagAndBranch }),
      ...(WIN ? [] : caseCases),
    ],
  },

  'branch-age': {
    block: [
      S('git commit -m "feat: x"', '사흘 된 브랜치에서 커밋', { setup: oldBranch, reason: /feature\/old/ }),
      S('git push origin feature/old', '사흘 된 브랜치 푸시', { setup: oldBranch }),
      S('git push', '브랜치 안 적은 푸시', { setup: oldBranch }),
      S('git commit -m "feat: x"', 'main 보다 11커밋 뒤(10 넘음)', { setup: behindBranch(11), opts: { commits: 10 }, reason: /11/ }),
      S('git commit -m "feat: x"', '원격 origin/main 과 견줌', { setup: behindBranch(11, true), opts: { commits: 10 } }),
      S('git commit -m "feat: x"', '12시간 옵션 — 18시간 된 브랜치', { setup: agedBranch(18 * 3600), opts: { hours: 12 } }),
      B('git add src/a.js && git commit -m "feat: x"', '이은 명령', { setup: oldBranch }),
      S('git commit -m "feat: x"', '옛 origin/main 이 아니라 더 앞선 로컬 main 과 견줌', { setup: staleOrigin(11), opts: { commits: 10 }, reason: /11/ }),
      S('git push origin feature/old', '로컬 main 을 지우고 origin/main 만 있음', { setup: originOnly, reason: /feature\/old/ }),
    ],
    pass: [
      S('git commit -m "feat: x"', 'main 에서 커밋(트렁크)'),
      S('git push origin main', 'main 푸시'),
      S('git commit -m "feat: x"', '오늘 만든 브랜치', { setup: freshBranch }),
      S('git status', '커밋·푸시가 아님', { setup: oldBranch }),
      S('git log --oneline', '읽기', { setup: oldBranch }),
      S('git commit -m "feat: x"', '시간 옵션이 더 김(100시간)', { setup: oldBranch, opts: { hours: 100 } }),
      S('git commit -m "feat: x"', '11커밋 뒤지만 기본 20 안쪽', { setup: behindBranch(11) }),
      S('git switch -c feature/new && git commit -m "feat: x"', '아직 커밋이 없는 새 브랜치'),
      S('git checkout --detach && git commit -m "feat: x"', '분리된 HEAD', { setup: oldBranch }),
      S('git commit -m "feat: x"', '아직 안 올린 로컬 main 의 사흘 전 커밋은 브랜치 나이에 넣지 않음', { setup: unpushedTrunk }),
      S('git commit -m "feat: x"', '로컬 main 만 9커밋 앞섬(10 안쪽)', { setup: staleOrigin(9), opts: { commits: 10 } }),
    ],
  },
};
