// git 훅 엄격 사례: git-add-all · protect-branch · branch-name · pr-merge.
// protect-branch·branch-name 의 기본 옵션은 GitHub Flow(packs.json flows), 다른 방식은 사례의 opts 로.
import { S, B, P, onBranch, both, keyed } from './helpers.mjs';

// feature/x 에 커밋 하나(README 를 고침), main 으로 돌아옴
const pickable = keyed('pickable', (r) => {
  r.git('switch', '-q', '-c', 'feature/x');
  r.commit('README.md', 'hello\nfrom x\n', 'feat: x');
  r.git('switch', '-q', 'main');
});
// main 에서 feature/x 를 cherry-pick 하다 충돌한 상태(noCommit 이면 -n 으로 두 커밋을 시작)
const conflicted = (noCommit) =>
  keyed(`conflicted\0${noCommit}`, (r) => {
    r.git('switch', '-q', '-c', 'feature/x');
    r.commit('README.md', 'hello\nfrom x\n', 'feat: x');
    r.commit('b.txt', '1\n', 'feat: b');
    r.git('switch', '-q', 'main');
    r.commit('README.md', 'hello\nfrom main\n', 'fix: main');
    try {
      r.git('cherry-pick', ...(noCommit ? ['-n'] : []), 'feature/x~1', 'feature/x');
    } catch {}
  });

const TRUNK = { branches: ['main', 'master'], allowCommit: true };
const GITFLOW_NAMES = { pattern: '^(feature|release|hotfix|bugfix|support)/[A-Za-z0-9][A-Za-z0-9._/-]*$' };
const unborn = (r) => r.git('update-ref', '-d', 'refs/heads/main');

export default {
  'git-add-all': {
    block: [
      S('git add -A', '-A'),
      S('git add .', '.'),
      S('git add --all', '--all'),
      S('git add *', '*'),
      S('git add -- .', '-- .'),
      S('git add :/', ':/ (저장소 맨 위)'),
      S('git stage .', 'git stage'),
      P('git add "."', 'PowerShell 따옴표'),
      S('git -C sub add -A', 'git -C'),
      S('git add -Af', '묶음 -Af'),
      S('git commit -a -m "feat: x"', 'commit -a'),
      S('git commit -am "feat: x"', 'commit -am'),
      S('git commit --all -m "feat: x"', 'commit --all'),
      B('bash -c "git add -A"', 'bash -c 안'),
      S('git add -u', '경로 없는 -u(추적 중인 변경 모두)'),
      S('git add --update', '--update'),
      S('git add ./*', './*'),
    ],
    pass: [
      S('git add src/app.js', '파일 하나'),
      S('git add "*.md"', '패턴'),
      S('git add src/', '폴더'),
      S('git add -u src/', '-u 경로'),
      S('git commit -m "feat: add -A flag"', '메시지 속 -A'),
      S('git status', '다른 명령'),
      S('echo "git add ."', 'echo 글'),
    ],
  },

  'protect-branch': {
    block: [
      S('git commit -m "feat: x"', 'main 에 바로 커밋'),
      S('git -c a=b -C . commit -m "feat: x"', 'git -c·-C 앞붙임'),
      B('git commit \\\n  -m "feat: x"', '줄 이어 쓰기'),
      B('cd . && git commit --amend --no-edit', 'amend 도 main 에 커밋'),
      S('git push origin main', 'main 에 바로 push (GitHub Flow)'),
      S('git push', '지금 브랜치(main) push'),
      S('git push origin HEAD', 'HEAD = main'),
      S('git push origin feature/x:main', 'refspec 으로 main'),
      S('git push -f', '지금 브랜치(main) 강제 push'),
      S('git push --force-with-lease origin main', '--force-with-lease'),
      S('git push origin +main', '+refspec'),
      S('git push origin --delete main', '원격 main 지우기'),
      S('git push origin :main', ':main 지우기'),
      S('git push --all', '--all'),
      S('git push --mirror', '--mirror'),
      B('git switch main && git commit -m "feat: x"', '같은 명령에서 main 으로 옮긴 뒤 커밋', { setup: onBranch('feature/x') }),
      P('git checkout main; git commit -m "feat: x"', 'PowerShell 같은 꼴', { setup: onBranch('feature/x') }),
      B('git switch main && git push', '옮긴 뒤 push', { setup: onBranch('feature/x') }),
      S('git push -f origin main', '트렁크: 강제 push', { opts: TRUNK }),
      B('git push -f origin $(git branch --show-current)', '$(…) 로 구한 지금 브랜치(main)'),
      B('git push -u origin "$(git rev-parse --abbrev-ref HEAD)"', '따옴표 속 $(…)'),
      P('git push origin (git branch --show-current)', 'PowerShell (…)'),
      B('git checkout main && git pull && git checkout - && git checkout main && git commit -m "fix: x"', '- 로 돌아간 뒤 다시 main', { setup: onBranch('feature/x') }),
      S('git commit -m "feat: x"', 'Git Flow: develop 에 커밋', { opts: { branches: ['main', 'master', 'develop'] }, setup: onBranch('develop') }),
      // cherry-pick·revert·am 도 main 에 커밋을 만든다
      S('git cherry-pick feature/x', 'main 에 cherry-pick', { setup: pickable }),
      S('git -c core.editor=true cherry-pick -x feature/x', 'git -c 앞붙임·-x', { setup: pickable }),
      S('git cherry-pick -m 1 feature/x', '-m 값 뒤', { setup: pickable }),
      S('git revert HEAD', 'main 에 revert'),
      S('git revert --no-edit HEAD~0', 'revert --no-edit'),
      S('git am 0001-fix.patch', 'main 에 am'),
      B('git am < 0001-fix.patch', 'am 표준 입력'),
      S('git cherry-pick --continue', '충돌 뒤 이어 하기(커밋을 만든다)', { setup: conflicted(false) }),
      S('git cherry-pick --skip', '건너뛰고 남은 것 이어 하기', { setup: conflicted(false) }),
      B('git switch main && git cherry-pick feature/x', '같은 명령에서 main 으로 옮긴 뒤', { setup: both(pickable, onBranch('feature/y')) }),
      P('git checkout main; git revert HEAD', 'PowerShell 같은 꼴', { setup: onBranch('feature/y') }),
      S('git cherry-pick feature/x', 'Git Flow: develop 에 cherry-pick', { opts: { branches: ['main', 'master', 'develop'] }, setup: both(pickable, onBranch('develop')) }),
      S('git cherry-pick --no-commi feature/x --continue', '--continue 가 있으면 진행 상태로 본다', { setup: conflicted(false) }),
    ],
    pass: [
      S('git commit -m "feat: x"', '기능 브랜치에서 커밋', { setup: onBranch('feature/x') }),
      S('git push -u origin feature/x', '기능 브랜치 push', { setup: onBranch('feature/x') }),
      S('git push --force-with-lease origin feature/x', '기능 브랜치 강제 push', { setup: onBranch('feature/x') }),
      B('git switch -c feature/y && git commit -m "feat: y"', 'main 에서 새 브랜치를 만든 뒤 커밋'),
      P('git checkout -b fix/z; git commit -m "fix: z"', 'PowerShell 같은 꼴'),
      S('git checkout main -- README.md', '파일만 되돌리기(브랜치는 그대로)', { setup: onBranch('feature/x') }),
      S('git push origin :feature/old', '기능 브랜치 지우기'),
      S('git commit -m "feat: x"', '첫 커밋(커밋이 아직 없음)', { setup: unborn }),
      S('git commit -m "feat: x"', '트렁크: main 에 바로 커밋', { opts: TRUNK }),
      S('git push origin main', '트렁크: 보통 push', { opts: TRUNK }),
      S('git log --oneline main', '읽기'),
      S('git checkout main README.md && git commit -m "fix: x"'.replace('&&', ';'), 'checkout <브랜치> <파일> 은 브랜치를 안 옮긴다', { setup: onBranch('feature/x') }),
      B('git checkout main && git pull && git checkout - && git commit -m "fix: x"', 'main 갔다가 - 로 돌아와 커밋', { setup: onBranch('feature/x') }),
      P('git stash; git checkout main; git pull; git checkout -; git stash pop; git commit -m "fix: x"', 'PowerShell 같은 꼴', { setup: onBranch('feature/x') }),
      S('git push --tags', '태그만'),
      S('git push origin --tags', '원격 + 태그만'),
      S('git merge --no-ff feature/x', 'merge 가 만드는 커밋은 보지 않는다(detail 에 적음 — GitHub Flow 는 그 push 를 막는다)'),
      S('git push origin v1.2.0', '태그 하나'),
      // cherry-pick·revert·am 중 커밋을 만들지 않는 꼴
      S('git cherry-pick -n feature/x', 'cherry-pick -n', { setup: pickable }),
      S('git cherry-pick --no-commit feature/x', 'cherry-pick --no-commit', { setup: pickable }),
      S('git cherry-pick -xn feature/x', '묶음 -xn', { setup: pickable }),
      S('git revert --no-commit HEAD', 'revert --no-commit'),
      S('git revert -n HEAD', 'revert -n'),
      S('git cherry-pick --abort', '--abort'),
      S('git revert --quit', '--quit'),
      S('git am --abort', 'am --abort'),
      S('git am --show-current-patch=diff', 'am --show-current-patch'),
      S('git cherry-pick --continue', '진행 중인 것이 없으면 --continue 는 커밋을 못 만든다'),
      S('git cherry-pick --continue', '-n 으로 시작한 것을 이어 하기', { setup: conflicted(true) }),
      S('git cherry-pick feature/x', '기능 브랜치에서 cherry-pick', { setup: both(pickable, onBranch('feature/y')) }),
      S('git revert --no-edit HEAD', '트렁크: main 에서 revert', { opts: TRUNK }),
      S('git merge develop', 'Git Flow: develop 을 main 에 합치기', { opts: { branches: ['main', 'master', 'develop'] } }),
      S('git log --grep "cherry-pick"', '다른 명령'),
      S('git commit -m "fix: revert 되돌리기"', '기능 브랜치의 커밋 메시지 속 낱말', { setup: onBranch('feature/x') }),
    ],
  },

  'branch-name': {
    block: [
      S('git switch -c login_page', 'switch -c'),
      S('git checkout -b test123', 'checkout -b'),
      S('git checkout -q -b Feature/x', '옵션 사이·대문자 시작'),
      S('git checkout -bwip', '붙여 쓴 -b'),
      S('git switch --create wip', 'switch --create'),
      S('git switch -C wip2', 'switch -C'),
      S('git checkout -B hotfix-1', 'checkout -B'),
      S('git checkout --orphan gh-pages', '--orphan'),
      S('git branch tmp', 'branch <이름>'),
      S('git branch -f tmp HEAD', 'branch -f'),
      S('git branch -m feature/x wip', 'branch -m 옛 새'),
      S('git branch -M wip', 'branch -M 새'),
      S('git branch -c wip-copy', 'branch -c 복사'),
      S('git worktree add -b wip ../wt', 'worktree add -b'),
      S('git worktree add ../wip', '브랜치를 안 준 worktree add(경로 이름으로 새 브랜치)'),
      S('git stash branch wip3', 'stash branch'),
      P('git switch -c "login page"', 'PowerShell 따옴표'),
      B('bash -c "git switch -c wip"', 'bash -c 안'),
      S('git switch -c fix/x', 'Git Flow 에서 fix/', { opts: GITFLOW_NAMES }),
    ],
    pass: [
      S('git switch -c feature/login-page', '규칙에 맞음'),
      S('git checkout -b fix/JIRA-123', '대문자·숫자'),
      S('git branch feature/x', 'branch 로 만들기'),
      S('git switch -c develop', '기본 브랜치 이름'),
      S('git branch -d tmp', '지우기'),
      S('git branch --list "wip*"', '목록'),
      S('git branch -a', '모두 보기'),
      S('git switch main', '옮기기'),
      S('git worktree add ../wt feature/x', '있는 브랜치로 worktree', { setup: (r) => r.git('branch', 'feature/x') }),
      S('git worktree add --detach ../wt', '--detach'),
      S('git worktree add ../main', '경로 이름의 브랜치가 이미 있음'),
      S('git commit -m "docs: git branch foo 설명"', '메시지 속 글'),
      B('git switch -c "$BRANCH"', '변수(값을 알 수 없어 보지 않음)'),
      P('git switch -c "fix/$issue"', '변수가 든 이름'),
      B('git checkout -b "feature/${TICKET}"', '${변수}가 든 이름'),
      S('git switch -c release/1.2.0', 'Git Flow 의 release/', { opts: GITFLOW_NAMES }),
    ],
  },

  'pr-merge': {
    block: [
      S('gh pr merge 12', '옵션 없음'),
      S('gh pr merge 12 --merge --delete-branch', '--merge'),
      S('gh pr merge --squash', '--delete-branch 없음'),
      S('gh pr merge 3 --rebase -d', '--rebase'),
      P('& gh pr merge 12', 'PowerShell & 호출'),
      S('gh.exe pr merge 12 -s', 'gh.exe'),
      B('git fetch && gh pr merge 3 -s', '이은 명령'),
      B('bash -c "gh pr merge 12"', 'bash -c 안'),
      S('gh -R owner/repo pr merge 12', 'gh -R'),
      S('gh --repo owner/repo pr merge 12 --merge', 'gh --repo'),
      B('GH_TOKEN=$T gh pr merge 12', '환경 변수 앞붙임'),
      P('gh pr checks 12; if ($?) { gh pr merge 12 }', 'PowerShell if ($?) { }'),
      B('if gh pr checks 12; then gh pr merge 12; fi', 'bash if … then'),
    ],
    pass: [
      S('gh pr merge 12 --squash --delete-branch', '맞는 꼴'),
      S('gh pr merge 12 -s -d --auto', '짧은 옵션 + --auto'),
      S('gh pr merge -sd 12', '묶음'),
      S('gh pr view 12', '다른 하위 명령'),
      S('git commit -m "docs: gh pr merge 12"', '메시지'),
      S('echo "gh pr merge"', 'echo'),
      S('gh pr merge 12 --squash --delete-branch --subject "-m x"', '값 속 옵션 글'),
    ],
  },
};
