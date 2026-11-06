// 커밋 훅 엄격 사례: commit-msg · no-verify · no-rewrite-pushed.
import { S, B, P, onBranch, both, keyed } from './helpers.mjs';

const LONG = 'feat: ' + '가'.repeat(70);
const msgFile = (text) => (r) => r.put('msg.txt', text);
const hookFile = (r) => r.put('.git/hooks/pre-commit', '#!/bin/sh\nexit 0\n');
const husky = (r) => {
  r.put('.husky/pre-commit', 'npm test\n');
  r.git('config', 'core.hooksPath', '.husky');
};

// 올린 커밋 준비: main(a) 을 올리고 feature/x 에 b·c. pushed = 원격 feature/x 가 가리키는 커밋('b'·'c'·null)
const pushed = (upTo, mainAhead = false) =>
  keyed(`pushed\0${upTo}\0${mainAhead}`, (r) => {
    r.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    r.git('switch', '-q', '-c', 'feature/x');
    const b = r.commit('b.txt', '1', 'feat: b');
    const c = r.commit('c.txt', '1', 'feat: c');
    if (upTo) r.git('update-ref', 'refs/remotes/origin/feature/x', upTo === 'b' ? b : c);
    if (mainAhead) {
      r.git('switch', '-q', 'main');
      r.commit('d.txt', '1', 'feat: d');
      r.git('switch', '-q', 'feature/x');
    }
  });

export default {
  'commit-msg': {
    block: [
      S('git commit -m "로그인 화면 추가"', '타입 없음'),
      S('git commit -m "update"', '영어 한 낱말'),
      S('git commit -m "Feat: x"', '대문자 타입'),
      S('git commit -m "feat:x"', '콜론 뒤 공백 없음'),
      S(`git commit -m "${LONG}"`, '제목 72자 넘음'),
      S('git commit --amend -m "oops"', 'amend 로 새 메시지'),
      S('git commit -am "update stuff"', '-am 묶음'),
      S('git -c user.name=x commit -m "update stuff"', 'git -c 앞붙임'),
      B("git commit -F - <<'EOF'\nupdate stuff\nEOF", 'heredoc -F -'),
      B("git commit -m \"$(cat <<'EOF'\nupdate stuff\n\nbody\nEOF\n)\"", '$(cat <<EOF)'),
      P("git commit -m @'\nupdate stuff\n'@", 'PowerShell here-string'),
      P("@'\nupdate stuff\n'@ | git commit -F -", 'PowerShell here-string 파이프'),
      B('echo "update stuff" | git commit -F -', 'echo 파이프'),
      S('git commit -F msg.txt', '-F 파일', { setup: msgFile('update stuff\n') }),
      B('git commit -m "$(cat msg.txt)"', '$(cat 파일)', { setup: msgFile('update stuff\n') }),
      P("$msg = 'update stuff'; git commit -m $msg", 'PowerShell 변수'),
      B("MSG='update stuff'; git commit -m \"$MSG\"", 'bash 변수'),
      B('git commit -m "$(git log -1 --format=%s)"', '다른 명령의 결과(읽을 수 없어 막음)'),
      B("cat > m.txt <<'EOF'\nfeat: x\nEOF\ngit commit -F m.txt", '같은 명령에서 만든 메시지 파일(읽을 수 없어 막음)'),
      S('git commit -m "feat: x" && git commit -m "update"'.replace('&&', ';'), '두 번째 커밋'),
      B('bash -c "git commit -m update"', 'bash -c 안'),
      B('git commit \\\n  -m "update"', '줄 이어 쓰기'),
      B("git commit -m \"$(printf 'update\\n\\nbody')\"", '$(printf …)'),
      S('git commit --amend --no-edit -m "update"', '--no-edit 와 -m 을 같이 주면 -m 을 본다'),
      S('git commit --message="update"', '--message='),
      S('git commit --mess "update"', 'git 이 받아 주는 줄임 --mess'),
      S('git commit --m=update', '줄임 --m='),
      S('git commit --fil msg.txt', '줄임 --fil', { setup: msgFile('update stuff\n') }),
    ],
    pass: [
      S('git commit -m "feat: 로그인 화면 추가"', '맞는 꼴'),
      S('git commit -m "fix(api): 빈 응답 처리"', '범위'),
      S('git commit -m "feat!: 큰 변경"', '!'),
      S('git commit --amend --no-edit', '--no-edit'),
      S('git commit --fixup HEAD', '--fixup'),
      S('git commit -C HEAD', '-C 다시 쓰기'),
      S('git commit', '편집기(메시지를 명령에서 주지 않음)'),
      B("git commit -F - <<'EOF'\nfeat: x\n\nbody\nEOF", 'heredoc'),
      B("git commit -m \"$(cat <<'EOF'\nfeat: x\n\nbody\nEOF\n)\"", '$(cat <<EOF)'),
      P('git commit -m "feat: x`n`nbody line"', 'PowerShell `n'),
      P("git commit -m @'\nfeat: x\n\nbody\n'@", 'PowerShell here-string'),
      P("@'\nfeat: x\n'@ | git commit -F -", 'here-string 파이프'),
      S('git commit -F msg.txt', '-F 파일', { setup: msgFile('feat: x\n') }),
      P("$msg = 'feat: x'; git commit -m $msg", 'PowerShell 변수'),
      B("MSG='feat: x'; git commit -m \"$MSG\"", 'bash 변수'),
      S('git log --grep "update"', '커밋이 아님'),
      S('echo "git commit -m update"', 'echo 글'),
      S('git commit -m "feat: x" -m "자세한 내용"', '본문 -m'),
      B("git commit -m \"$(printf 'feat: x\\n\\nbody')\"", '$(printf …)'),
      S("git commit -m 'feat: add `--json` flag'", '작은따옴표 속 백틱'),
      B('git commit -m "feat: add \\`--json\\` flag"', '큰따옴표 속 막은 백틱'),
      B("git commit -m \"feat: x\" -m 'Run `npm test` first.'", '두 번째 -m 의 백틱'),
      P("git commit -m 'feat: use $(pwd) in docs'", 'PowerShell 작은따옴표 속 $( )'),
      B("cat <<'EOF' | git commit -F -\nfeat: x\n\nbody\nEOF", 'cat heredoc 파이프'),
      S('git commit --mess "feat: x"', '줄임 --mess'),
      S('git commit -m "feat: x" --author="A <a@example.com>"', '--author 값'),
    ],
  },

  'no-verify': {
    block: [
      S('git commit --no-verify -m "feat: x"', 'commit --no-verify'),
      S('git commit -n -m "feat: x"', 'commit -n'),
      S('git commit -nm "feat: x"', '묶음 -nm'),
      S('git commit -s -n -m "feat: x"', '-s 뒤 -n'),
      S('git push --no-verify', 'push'),
      S('git merge --no-verify feature/x', 'merge'),
      S('git pull --no-verify', 'pull'),
      S('git rebase --no-verify main', 'rebase'),
      S('git am --no-verify x.patch', 'am'),
      S('git commit --no-veri -m "feat: x"', '줄여 쓴 옵션'),
      P('git commit "--no-verify" -m "feat: x"', '따옴표 친 옵션'),
      B('HUSKY=0 git commit -m "feat: x"', 'HUSKY=0 앞붙임'),
      B('export HUSKY=0 && git commit -m "feat: x"', 'export'),
      B('env HUSKY=0 git push', 'env'),
      P('$env:HUSKY=0; git commit -m "feat: x"', 'PowerShell $env:'),
      P('$env:HUSKY = "0"; git push', 'PowerShell $env: = "0"'),
      P('Set-Item env:HUSKY 0; git commit -m "feat: x"', 'Set-Item env:'),
      P("[Environment]::SetEnvironmentVariable('HUSKY', '0'); git commit -m \"feat: x\"", 'SetEnvironmentVariable'),
      B('HUSKY_SKIP_HOOKS=1 git commit -m "feat: x"', 'HUSKY_SKIP_HOOKS'),
      B('SKIP=eslint git commit -m "feat: x"', 'pre-commit SKIP'),
      B('LEFTHOOK=0 git push', 'LEFTHOOK=0'),
      B('SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "feat: x"', 'SKIP_SIMPLE_GIT_HOOKS'),
      S('git -c core.hooksPath=/dev/null commit -m "feat: x"', 'git -c core.hooksPath'),
      P('git -c core.hooksPath=NUL commit -m "feat: x"', 'PowerShell 같은 꼴'),
      S('git --config-env=core.hooksPath=X push', '--config-env'),
      S('git config core.hooksPath /tmp/nohooks', '훅이 있는데 다른 폴더로', { setup: hookFile }),
      S('git config --unset core.hooksPath', '.husky 를 지워 .git/hooks 로', { setup: husky }),
      S('git config --global core.hooksPath ~/nohooks', '--global'),
      B('bash -c "git commit --no-verify -m x"', 'bash -c 안'),
      B('git commit \\\n  --no-verify -m "feat: x"', '줄 이어 쓰기(\\)'),
      P('git commit `\n  --no-verify -m "feat: x"', 'PowerShell 줄 이어 쓰기(`)'),
      P('pwsh -Command "git push --no-verify"', 'pwsh -Command 안'),
    ],
    pass: [
      S('git commit -m "feat: x"', '보통 커밋'),
      S('git commit -m "docs: --no-verify 와 -n 설명"', '메시지 속 글'),
      S('git commit -s -m "feat: x"', '-s 서명'),
      S('git push -n', 'push -n(dry-run)'),
      S('git merge -n feature/x', 'merge -n(--no-stat)'),
      S('git log -n 5', 'log -n'),
      B('HUSKY=0 npm ci', '커밋 없는 설치'),
      B('HUSKY=1 git commit -m "feat: x"', 'HUSKY=1'),
      S('echo "HUSKY=0 git commit"', 'echo 글'),
      S('git config core.hooksPath', '읽기'),
      S('git config core.hooksPath .husky', '이미 .husky', { setup: husky }),
      S('git config core.hooksPath .husky', '지금 훅 폴더에 훅이 없음(처음 설정)'),
      B('HUSKY=0 npm ci && git commit -m "feat: x"', '앞붙임은 npm ci 에만 간다'),
      B('SKIP=1 npm test && git commit -m "feat: x"', '앞붙임은 npm test 에만 간다'),
    ],
  },

  'no-rewrite-pushed': {
    block: [
      S('git commit --amend --no-edit', 'HEAD 가 원격에 있음', { setup: pushed('c') }),
      S('git commit --amend -m "feat: c2"', 'amend -m', { setup: pushed('c') }),
      S('git commit --amen --no-edit', 'git 이 받아 주는 줄임 --amen', { setup: pushed('c') }),
      S('git rebase -i HEAD~2', 'rebase -i 가 올린 b 를 다시 씀', { setup: pushed('b') }),
      S('git rebase --onto main HEAD~2', '--onto', { setup: pushed('b', true) }),
      S('git rebase -i --root', '--root', { setup: pushed('b') }),
      S('git rebase main', 'main 이 앞서 있어 b 를 다시 씀', { setup: pushed('b', true) }),
      S('git rebase --force-rebase main', '--force-rebase', { setup: pushed('b') }),
      B('git switch feature/x && git commit --amend --no-edit', '같은 명령에서 옮긴 뒤 amend', {
        setup: both(pushed('c'), (r) => r.git('switch', '-q', 'main')),
      }),
    ],
    pass: [
      S('git commit --amend --no-edit', '아직 안 올린 HEAD', { setup: pushed('b') }),
      S('git rebase -i HEAD~1', '안 올린 c 만', { setup: pushed('b') }),
      S('git rebase main', 'main 이 이미 조상(아무것도 다시 쓰지 않음)', { setup: pushed('b') }),
      S('git rebase --continue', '진행 중 rebase', { setup: pushed('c') }),
      S('git rebase --abort', 'abort', { setup: pushed('c') }),
      S('git pull --rebase', 'pull --rebase', { setup: pushed('c') }),
      S('git commit -m "fix: --amend 설명"', '메시지 속 글', { setup: pushed('c') }),
      S('git commit --amend --no-edit', '원격 없음', { setup: onBranch('feature/y') }),
    ],
  },
};
