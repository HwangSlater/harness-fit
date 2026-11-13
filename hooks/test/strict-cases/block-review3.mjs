// 다시 한 독립 검토(2026-11-13)와 역할극 16 회차 다시 매기기가 찾은 빈틈: 적은 명령의 -h(호스트)를 도움말로 센 회귀, xargs 뒤 옵션·대상,
// 앞붙이(if·while·coproc·time -p·su -c·env -S·wsl…)와 숨은 실행(echo "$(X)"·printf | bash·tee | bash·PowerShell 블록), 보호 파일의 셸 앞붙이,
// danger-cmd 의 숨은 실행, CLAUDECODE 바꾸기, 태그 올리기 막기·push.followTags, 예시 파일, HEAD 에서 되돌리기.
// strict.test.mjs 가 같은 훅 사례에 이어 붙인다.
import { S, B, P, keyed } from './helpers.mjs';

const PSQL = { commands: [], block: ['psql -h prod-db', 'redis-cli -h prod-cache'], remote: false };
const RM = { commands: [], block: ['rm -rf build', 'terraform apply'], remote: false };
const TF = { commands: [], block: ['terraform apply', 'scripts/drain-node.sh'], remote: false };
const TAGS = { commands: [], block: ['git push --tags'], remote: false };
const FOLLOW = { commands: ['git push --follow-tags'], remote: false };
const DENY = { decision: 'deny', reason: /blocked from running/ };
const deny = (opts) => ({ opts, ...DENY });
const ask = (opts) => ({ opts, decision: 'ask' });
const RAW = { paths: ['data/raw'] };
const XC = { paths: ['*.xcconfig'] };
const XC_EXACT = { paths: ['*.xcconfig', 'Config/Keep.example.xcconfig'] };

// 태그·브랜치가 있는 저장소(이름 붙인 태그 찾기)
const TAGGED = keyed('br3-tags', (r) => {
  r.git('tag', 'release-1.3.0');
  r.git('tag', 'v1.3.0');
  r.git('branch', 'feature-x');
});
// 저장소 설정에 push.followTags = true
const FOLLOW_CFG = keyed('br3-follow', (r) => r.git('config', 'push.followTags', 'true'));
// 보호한 설정 파일을 커밋해 두고 고친 상태(되돌리기 시험)
const CHANGED = keyed('br3-changed', (r) => {
  r.commit('Config/Base.xcconfig', 'A = 1\n', 'chore: 설정');
  r.git('branch', 'old');
  r.put('Config/Base.xcconfig', 'A = 2\n');
});

export default {
  'ask-cmd': {
    block: [
      // 1. 적은 명령의 -h 는 호스트다
      B('echo "DROP TABLE users" | psql -h prod-db', '파이프로 넘긴 SQL', deny(PSQL)),
      B('cat wipe.sql | psql -h prod-db', 'cat 으로 넘긴 SQL', deny(PSQL)),
      S('psql -h prod-db', '적은 그대로', deny(PSQL)),
      B('echo FLUSHALL | redis-cli -h prod-cache', 'redis-cli -h', deny(PSQL)),
      // 4. xargs 뒤: 적은 옵션·대상이 다 있으면 막는다, 프로그램 낱말뿐인 적은 명령은 모자라도
      B('echo build | xargs rm -rf build', 'xargs 뒤 적은 꼴 그대로', deny(RM)),
      B('echo apply | xargs terraform', 'xargs 가 앞 낱말을 붙임', deny(RM)),
      // 7. 앞붙이
      B('while terraform apply; do sleep 1; done', 'while 조건', deny(TF)),
      B('until terraform apply; do sleep 1; done', 'until 조건', deny(TF)),
      B('if terraform apply; then echo ok; fi', 'if 조건', deny(TF)),
      B('function deploy { terraform apply; }', 'function 이름 {', deny(TF)),
      B('coproc terraform apply', 'coproc', deny(TF)),
      B('time -p terraform apply', 'time -p', deny(TF)),
      B('command -p terraform apply', 'command -p', deny(TF)),
      B('setsid terraform apply', 'setsid', deny(TF)),
      B('stdbuf -o L terraform apply', 'stdbuf -o L', deny(TF)),
      B('stdbuf -oL terraform apply', 'stdbuf -oL', deny(TF)),
      B('su -c "terraform apply" ops', 'su -c', deny(TF)),
      B('env -S "terraform apply"', 'env -S', deny(TF)),
      S('wsl terraform apply', 'wsl', deny(TF)),
      S('wsl -d Ubuntu -- terraform apply', 'wsl -d … --', deny(TF)),
      // 8. 숨은 실행
      B('echo "$(terraform apply)"', '큰따옴표 속 $(…)', deny(TF)),
      B("printf '%s\\n' 'terraform apply' | bash", "printf '%s\\n' X | bash", deny(TF)),
      B('echo terraform apply | tee log.txt | bash', '… | tee … | bash', deny(TF)),
      P('start terraform apply', 'start(Start-Process 별칭)', deny(TF)),
      P('Start-Process powershell -ArgumentList "-Command","terraform apply"', 'Start-Process powershell -Command', deny(TF)),
      P("Start-Process terraform -ArgumentList @('apply')", '@(…) 인자 목록', deny(TF)),
      P('1..3 | ForEach-Object { terraform apply }', 'ForEach-Object { }', deny(TF)),
      P('1..3 | % { terraform apply }', '% { }', deny(TF)),
      P('Invoke-Command { terraform apply }', 'Invoke-Command { }', deny(TF)),
      P('Start-Job { terraform apply }', 'Start-Job { }', deny(TF)),
      P('.{terraform apply}', '.{ }', deny(TF)),
      // A·C. 태그 올리기를 막는 줄이 있으면 태그를 올리는 push 를 모두
      S('git push origin v1.3.0', '이름 붙인 버전 태그', { ...deny(TAGS), setup: TAGGED }),
      S('git push origin release-1.3.0', '버전 꼴이 아닌 태그', { ...deny(TAGS), setup: TAGGED }),
      S('git push origin refs/tags/v1.3.0', 'refs/tags/…', deny(TAGS)),
      S('git push origin tag v1.3.0', 'tag v…', deny(TAGS)),
      S('git push origin :v1.3.0', '태그 지우기', deny(TAGS)),
      // B. push.followTags
      S('git -c push.followTags=true push origin feat/x', '-c push.followTags=true', ask(FOLLOW)),
      S('git push origin feat/x', '저장소 설정 push.followTags', { ...ask(FOLLOW), setup: FOLLOW_CFG }),
      B('git config push.followTags true && git push origin feat/x', '같은 명령 앞에서 켬', ask(FOLLOW)),
    ],
    pass: [
      B('psql -h prod-db --help', '적은 명령 + --help 하나', { opts: PSQL }),
      S('psql --help', '도움말', { opts: PSQL }),
      B('psql -h staging-db', '다른 호스트', { opts: PSQL }),
      B('git ls-files -d | xargs rm', 'xargs rm(적은 -rf build 없음)', { opts: RM }),
      B('find . -name "*.pyc" | xargs rm -f', 'xargs rm -f', { opts: RM }),
      B('xargs -0 rm -f < list.txt', 'xargs -0 rm -f', { opts: RM }),
      B('command -v terraform', 'command -v 는 찾기만', { opts: TF }),
      S('wsl --list', 'wsl --list', { opts: TF }),
      B('bash -n scripts/drain-node.sh', 'bash -n 은 문법만', { opts: TF }),
      B('cat <<\\EOF\nrun `terraform apply` later\nEOF', '<<\\EOF 본문의 백틱은 글', { opts: TF }),
      B("echo 'terraform apply' > notes.txt", '작은따옴표 글', { opts: TF }),
      P('1..3 | ForEach-Object { terraform plan }', '블록 속 다른 명령', { opts: TF }),
      S('git push origin feature-x', '태그가 아닌 브랜치', { opts: TAGS, setup: TAGGED }),
      S('git -c push.followTags=false push origin feat/x', 'push.followTags=false', { opts: FOLLOW }),
      S('git push origin feat/x', 'push.followTags 없음', { opts: FOLLOW }),
      S('git push --no-follow-tags origin feat/x', '--no-follow-tags', { opts: FOLLOW, setup: FOLLOW_CFG }),
    ],
  },
  'protected-files': {
    block: [
      // 5. 셸 앞붙이·블록·숨은 실행
      B('if true; then rm .env; fi', 'then rm', {}),
      B('{ rm .env; }', '{ …; }', {}),
      B('exec rm .env', 'exec', {}),
      B('eval rm .env', '따옴표 없는 eval', {}),
      B('if [ -d data ]; then rm -rf data/raw; fi', 'then rm -rf 보호 폴더', { opts: RAW }),
      B('then cp x .env', 'then cp', {}),
      B('then tee .env < x', 'then tee', {}),
      B("then sed -i 's/a/b/' .env", 'then sed -i', {}),
      P('try { Remove-Item .env } catch {}', 'try { }', {}),
      P('if ($true) { Remove-Item .env }', 'if (…) { }', {}),
      P('cmd /c del .env', 'cmd /c del', {}),
      B('find . -name .env -delete', 'find -name -delete', {}),
      B('find . -name .env -exec rm {} \\;', 'find -exec rm {}', {}),
      B('echo "rm .env" | bash', 'echo … | bash', {}),
      B('echo `rm .env`', '백틱', {}),
      // 3. CLAUDECODE 바꾸기
      B('CLAUDECODE=0 git commit -m "fix: 고침"', 'CLAUDECODE=0 git', { reason: /CLAUDECODE/ }),
      B('CLAUDECODE=0 make release', 'CLAUDECODE=0 make', { reason: /CLAUDECODE/ }),
      B('unset CLAUDECODE; git commit -m "fix: 고침"', 'unset', { reason: /CLAUDECODE/ }),
      B('env -u CLAUDECODE git commit -m "fix: 고침"', 'env -u', { reason: /CLAUDECODE/ }),
      B('env -i PATH=/usr/bin git commit -m "fix: 고침"', 'env -i 로 git', { reason: /CLAUDECODE/ }),
      P('$env:CLAUDECODE = "0"; git commit -m "fix: 고침"', '$env: 대입', { reason: /CLAUDECODE/ }),
      P('Remove-Item Env:CLAUDECODE; git commit -m "fix: 고침"', 'Remove-Item Env:', { reason: /CLAUDECODE/ }),
      // D·F. 예시 파일·되돌리기
      B('echo A=1 > Config/Secrets.xcconfig', '글롭에 맞는 진짜 파일', { opts: XC }),
      B('echo A=1 > Config/Keep.example.xcconfig', '이름을 그대로 적은 예시 파일', { opts: XC_EXACT }),
      S('git checkout old -- Config/Base.xcconfig', '다른 브랜치에서 가져오기', { opts: XC, setup: CHANGED, decision: 'deny' }),
      S('git checkout HEAD~1 -- Config/Base.xcconfig', '다른 커밋에서', { opts: XC, setup: CHANGED, decision: 'deny' }),
      // F. HEAD·stage 에서 되돌리기는 막지 않고 묻는다(손으로 고친 값이 사라질 수 있다)
      S('git checkout -- Config/Base.xcconfig', 'stage 에서 되돌리기', { opts: XC, setup: CHANGED, decision: 'ask', reason: /restores/ }),
      S('git restore Config/Base.xcconfig', 'restore', { opts: XC, setup: CHANGED, decision: 'ask' }),
      S('git restore --source=HEAD Config/Base.xcconfig', 'restore --source=HEAD', { opts: XC, setup: CHANGED, decision: 'ask' }),
      S('git checkout HEAD -- Config/Base.xcconfig', 'checkout HEAD --', { opts: XC, setup: CHANGED, decision: 'ask' }),
    ],
    pass: [
      B('. venv/bin/activate && pytest', '점(.)으로 읽기', {}),
      B('source ~/.bashrc', 'source', {}),
      B('{ echo a; } > out.txt', '{ } 넘겨쓰기(보호 아님)', {}),
      B('exec "$@"', 'exec "$@"', {}),
      B('bash scripts/test.sh', 'bash 스크립트', {}),
      B("sh -c 'npm test'", 'sh -c', {}),
      P('try { npm test } catch {}', 'try { npm test }', {}),
      B('find . -name "*.pyc" -delete', 'find 글롭 -delete', {}),
      B('find . -type f -name "*.log" -exec rm {} \\;', 'find 거른 -exec rm', {}),
      B('echo $CLAUDECODE', 'CLAUDECODE 읽기', {}),
      B('env NODE_ENV=test node -i', 'env 뒤 명령의 -i', {}),
      B('env -i PATH=/usr/bin npm test', 'git·make 없는 env -i', {}),
      P('if ($env:CLAUDECODE -eq "1") { echo yes }', 'PowerShell 비교', {}),
      B('git commit -m "docs: CLAUDECODE=0 이면 사람으로 보던 것 고침"', '커밋 메시지 속 글', {}),
      B('echo A=1 > Config/Secrets.example.xcconfig', '글롭에 맞는 예시 파일', { opts: XC }),
    ],
  },
  'danger-cmd': {
    block: [
      B('echo `rm -rf ~`', '백틱 속 홈 지우기'),
      B('echo "$(rm -rf ~)"', '$(…) 속 홈 지우기'),
      B('find ~ -maxdepth 0 -exec rm -rf {} \\;', 'find -exec 로 홈 지우기'),
      B('find ~ -delete', 'find -delete 로 홈'),
      P('Start-Process cmd -ArgumentList "/c","rd","/s","/q","C:\\"', 'Start-Process cmd rd'), // lint:allow abs-path 막을 명령 시험 사례
      P("Start-Process cmd -ArgumentList @('/c','rd','/s','/q','C:\\')", 'Start-Process @(…)'), // lint:allow abs-path 막을 명령 시험 사례
    ],
    pass: [
      B('echo "rm -rf ~ is bad"', 'echo 글'),
      B('find . -name "*.tmp" -exec rm -f {} \\;', '거른 find -exec rm'),
      B('find build -delete', '하위 폴더 find -delete'),
      P('Start-Process notepad -ArgumentList "a.txt"', 'Start-Process 보통'),
    ],
  },
};
