# 결정 — 훅

> 최종 수정: 2026-11-13 · 훅 원칙과 훅마다 지금 유효한 결정. 고르기 화면·지침·스킬·git 은 [decisions.md](decisions.md), 추천·감지는 [decisions-recommend.md](decisions-recommend.md), 옛 결정과 검토 회차 기록은 [decisions-archive.md](decisions-archive.md)

한 항목은 제목 줄 + 결정 · 이유 · 어디서. 「사용자 결정」·「사용자 승인」·「사용자 요청」 표시가 있는 것은 사용자가 정했으니 바꾸기 전에 묻는다. 여러 번 고친 결정은 지금 모양만 적는다 — 고쳐 온 차례는 git 기록과 archive 에 있다.

## 훅 원칙

### 훅은 약속한 것을 빠짐없이, 짐작하는 훅은 두지 않는다 (사용자 원칙, 2026-11-05·11-06)
- 결정: 판단이 필요 없는 규칙은 글이 아니라 훅으로 막는다. 짐작으로만 잡히는 hardcode·injection·log-secrets 훅은 뺐고, 그 줄은 지침(`{{judge}}`)·스킬 글로 남겼다.
- 이유: 글은 놓친다. 짐작하는 훅은 헛막음을 낸다.
- 어디서: `catalog/packs.json`, `rules/*.md`

### 훅은 모두 엄격하게 테스트한다 (2026-11-06)
- 결정: 훅마다 detail 의 꼴마다 막음·통과 사례를 Bash·PowerShell 로 실제 진입점에 넣어 본다. 사례가 3개씩 없으면 테스트가 실패한다. 꼴을 넓힐 때마다 헛막음을 다시 본다.
- 예: `SECRET_KEY` 꼴을 넓히자 `api_key_header = "X-Api-Key"` 가 걸려, 값을 가리키는 이름·켜고 끄는 값·JS·TS 따옴표 속 글은 뺐다.
- 어디서: `hooks/test/strict.test.mjs`, `node scripts/dev/fp-scan.mjs <폴더>`

### Node 하나, 때마다 진입점 하나
- 결정: 외부 패키지 없이 `node:` 내장만. 이벤트마다 스크립트 하나만 등록하고 켜진 규칙만 돌린다. `.claude/harness.json` 이 없으면 규칙 모듈도 안 불러온다. Stop 은 `stop_hook_active` 면 통과.
- 이유: 설치 단계·공급망 위험이 없다. 훅을 여럿 등록하면 도구 호출마다 Node 가 여러 번 떠서 느려진다.
- 어디서: `hooks/hooks.json`, `hooks/run.mjs`·`stop.mjs`·`session-start.mjs`·`prompt-submit.mjs`, 틀 `hooks/lib/entry.mjs`

### 훅 한 번의 낭비를 줄이고 테스트를 나눈다 (2026-11-09)
- 결정: 진입점이 읽은 설정을 판정에 넘긴다(전에는 두 번 읽음). PreToolUse 는 도구 종류(셸·쓰기·웹)에 켠 id 가 있는 규칙 모듈만 불러오고, 그 종류에 켠 규칙이 없으면 git 도 띄우지 않는다. 규칙을 돌리는 고리(옵션 읽기·터진 규칙 모으기·이유 없는 허용 주석 안내)는 PreToolUse·다른 때·git pre-commit 이 하나를 같이 쓴다. `evaluate.mjs` 는 모든 규칙을 불러 바로 판정하는 꼴로 남겨 테스트·scripts 가 쓴다. 훅 한 번 실행이 30~60ms 줄었다.
- 테스트: 진입점으로는 프로세스가 터지지 않는지를 대표 사례로, 모양·환경·ReDoS 수백 개는 판정을 일꾼 스레드에서 바로(규칙이 하나도 터지지 않아야 해 전보다 엄격), 10MB 이상은 `npm run test:stress`(`npm test` 에 든다), 고치는 중에는 `npm run test:quick`. 시간 한도는 넘으면 두 번 더 재고 같은 순간의 빈 호출을 빼서 본다 — 다른 테스트와 함께 돌면 0.3초 호출이 4초를 넘겨 헛실패했다.
- 어디서: `hooks/lib/pretool.mjs`(RULE_MODULES — 실제 모듈과 같은지 `hooks/test/pretool.test.mjs`), `hooks/lib/dispatch.mjs`, `hooks/lib/evaluate.mjs`, `hooks/test/stress/`

### git 은 판정에 꼭 필요할 때만 띄운다 (전체 검토, 2026-11-13)
- 결정: 저장소 맨 위·지금 브랜치·HEAD 가 있는지·원격 추적 브랜치·브랜치가 있는지는 `.git`·HEAD·ref 파일로 읽는다(`hooks/lib/repo-files.mjs`). 조금이라도 애매하면(GIT_DIR 같은 환경 변수, `.git` 폴더 안·bare, 깨진 `.git` 파일, 파일 시스템 경계, reftable, 이상한 ref 이름·내용, 같은 짧은 이름의 태그·원격 ref 가 있어 `symbolic-ref --short` 가 `heads/…` 로 줄일 때) 예전처럼 git 에게 묻는다. 맨 위는 git 처럼 실제 경로(정션·대소문자를 푼 것)다.
- 브랜치·HEAD 는 그것이 필요한 조각이 있을 때만 구한다: protect-branch 는 commit·cherry-pick·revert·am·push 가 있을 때, no-rewrite-pushed 는 amend 가 있을 때, squash-push 는 push 가 있을 때. 값은 도구 호출 하나에 한 번(`ctx.repo` = `core.mjs` repoState — 바깥 명령과 `bash -c` 속 명령이 나눠 쓰고, 커밋 계획의 HEAD 도 같은 값).
- 버전 꼴 이름 push(ask-cmd 의 tagPush)도 태그·브랜치를 ref 파일로 먼저 찾고, 애매할 때만 `for-each-ref` 한 번.
- Stop: 커밋 해시 알리기와 문서 검사가 이번 턴 커밋을 한 번만 읽고(`shared`), 커밋 제목을 reflog 에서 함께 받아 `git log` 를 따로 부르지 않는다. 문서 검사의 「저장소인가」도 파일로.
- 이유: 규칙 판정은 0.1~7ms 인데 git 한 번이 이 PC 에서 45~70ms 라, 읽기만 하는 `git status` 에도 git 을 네 번 띄워 350ms 쯤 걸렸다.
- 결과(e-approval 복사본, 15번 중앙값, 같은 때 번갈아 잼): 「팀」 조합 — `git status` 337→130ms(git 4→0), `git log | head` 339→133ms(4→0), `git commit -m` 482→240ms(7→2), `git push` 339→137ms(4→0). 모든 훅 — `git commit -m` 518→286ms(8→3), `git push` 508→188ms(8→1), Stop 600→331ms(11→5). `ls` 는 git 0번 그대로(약 130ms — Node 띄우기). 출력은 사례마다 전과 같다.
- 하지 않은 것: git pre-commit 훅이 도는지(`rev-parse --git-path hooks`)는 core.hooksPath 가 전역·시스템·include 설정에서 올 수 있어 git 에게 그대로 묻는다. 문서 검사의 `diff HEAD` + `ls-files --others` 를 `git status` 하나로 합치는 것은 경로 기준·색인 잠금이 달라 두었다.
- 알아 둘 점: git 이 「dubious ownership」으로 거절하는 저장소에서도 맨 위·브랜치는 파일로 읽힌다(전에는 맨 위를 못 찾아 규칙이 쉬었다). 그런 저장소에서는 git 명령 자체가 실패하므로 막는 쪽만 늘어난다.
- 어디서: `hooks/lib/repo-files.mjs`, `hooks/lib/core.mjs`(repoRoot·repoState), `hooks/lib/pretool.mjs`, `hooks/lib/turn-commits.mjs`, 테스트 `hooks/test/git-calls.test.mjs`(GIT_TRACE 로 git 수를 센다)

### 훅 명령은 exec 꼴 (2026-11-06)
- 결정: `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/run.mjs"]`. 기존 훅 겹침 테스트도 남의 exec 꼴 훅을 셸 없이 돌린다.
- 이유: 셸을 거치지 않아 띄어쓰기·한글 경로도 한 인자로 간다(code.claude.com/docs/en/hooks). `args` 는 Claude Code v2.1.139 부터 — 그래서 최소 버전.
- 어디서: `hooks/hooks.json`, `scripts/lib/existing-hooks.mjs`

### 훅이 오류로 멈추면 통과하고 알린다 (사용자 결정, 2026-11-06)
- 결정: 막지 않고 「○○ 훅이 오류로 멈춰서…」를 알린다(PreToolUse 는 systemMessage, pre-commit 은 stderr). 다른 훅이 막을 것은 그대로 막는다. 깨진 harness.json 도 조용히 끄지 않고 알린다. 모양이 틀린 입력은 오류가 아니라 빈 값으로 읽는다.
- 이유: 막으면 Claude 가 설정 파일조차 못 고치고, 사람의 커밋도 멈춘다.
- 어디서: `hooks/lib/entry.mjs`, `hooks/lib/core.mjs` 의 `normalizeInput`

### 기존 코드는 막지 않는다
- 결정: 파일 검사는 새로 들어간 줄만 본다(Edit 은 old_string 에 없던 줄, Write 는 원래 파일에 없던 줄).
- 어디서: `hooks/lib/lines.mjs`

### 명령은 낱말 단위로 읽는다 (2026-11-02 전체 검토)
- 결정: 옵션 순서·대소문자·묶음(`-fu`)·`git -c` 앞붙임을 가리지 않고, 따옴표 속 글(커밋 메시지)은 옵션으로 보지 않는다. 셸마다 따옴표 규칙이 달라 tool_name 으로 셸을 정한다.
- 어디서: `hooks/lib/cmdline.mjs`, `hooks/lib/quotes.mjs`

### 줄 하나는 `lint:allow` 로 넘긴다 (사용자 결정, 2026-11-06)
- 결정: 그 줄 끝이나 바로 위 주석만 있는 줄에 `lint:allow <id> <이유>`(이유 3자 이상). 쓸 때마다 id·file:줄·이유를 알리고 커밋은 막지 않는다. 받는 훅: unsafe-html·gha-inject·file-size(맨 위 10줄)·Swift·Python, secrets 는 옵션 `allowComment`(기본 꺼짐)일 때만.
- 이유: 훅 전체를 끄지 않게. secrets 는 진짜 키를 주석 하나로 넘기기 쉬워서. 옛 `harness:allow`·id `secret` 도 받는다(사용자 결정 — 이미 단 주석이 갑자기 막히지 않게).
- 어디서: `hooks/lib/allow.mjs`, `hooks/test/allow.test.mjs`

### 사람마다 답이 다른 설정은 사용자가 고른다 (사용자 원칙, 2026-11-06)
- 결정: 권장값을 기본으로 두고 맞바꾸는 것을 한 줄로 보여 준 뒤 사용자가 고른다. 훅 옵션은 훅 코드가 실제로 읽는 것만 보여 준다(테스트로 강제). 브랜치 전략이 넣는 옵션은 기본값이고, 사용자가 바꾼 값이 이긴다(다시 적용해도 남는다).
- 화면 목록 칸: 명령·경로는 쉼표·줄바꿈으로만 나눈다(띄어쓰기로 갈라 모든 python 명령을 묻게 됐다). 조합이 정한 옵션은 baseOpts 로 따로 두고 사용자 값 > 지난번 harness.json > 조합 값 차례(화면을 다시 열면 적어 둔 명령을 ROS 기본 목록으로 덮었다). `picker/hook-options.js` sentOpts.
- 어디서: `picker/hook-options.js`, `scripts/test/hook-options.test.mjs`

### 전역 훅에서 옮긴 훅 7개 (사용자 결정, 2026-11-06 · 기본값은 2026-11-09 사용자 승인으로 바뀜)
- 결정: 100% 잡는 것만 옮겼다 — squash-push, commit-hash, swift-unsafe·python-unsafe(그 스택일 때), work-checklist(막지 않음), docs-check. answer-lang 은 짐작이지만 놓쳐도 위험하지 않아 옵션(ko·en·ja·zh).
- 기본값: swift-unsafe·python-unsafe 만 그 스택일 때 켠다. squash-push·commit-hash·work-checklist·docs-check·answer-lang 은 모든 조합에서 기본 꺼짐(고를 수는 있음) — [decisions-recommend.md](decisions-recommend.md) 「조합 기본값을 저장소에 맞춘다」.
- 옮기지 않음: 테스트 안 돌림·기록 남길지 묻기·하드코딩·「바로잡는 말이면 묻기」 — 짐작이 필요해서. 「끝내기 전 확인」 실험(전역 Stop 훅)도 harness-fit 에 넣지 않았다.
- 어디서: `hooks/rules/`, `catalog/combos.json`(언어별 훅은 `stackAddons` 의 hooks)

### 옮긴 훅의 세부 (2026-11-06)
- commit-hash: Stop 때 사람 턴 시작 뒤 reflog 의 커밋(최근 6개)마다 해시가 답에 있는지. 셸 명령이 없던 턴은 안 보고, 한 사람 턴에 한 번만 묻는다.
- swift·python: 주석·글자를 가린 뒤(`hooks/lib/code-mask.mjs`) 새 줄만. 테스트 코드·받아 온 코드는 뺀다. Python `exec(` 는 `eval(` 과 같은 위험이라 함께.
- work-checklist: `<설정 폴더>/harness-fit/checklists/<프로젝트 이름-경로 지문>/<세션>.md` — 설정 폴더는 `CLAUDE_CONFIG_DIR`, 없으면 `~/.claude`. 사용자 전역 `~/.claude/checklists/` 와 겹치지 않게.
- docs-check: 기계로 가릴 수 있는 것만 — docs/ 에는 .md·그림만, 바뀐 문서의 `# 제목`·날짜 줄·목차 링크(Stop 때).

### 훅 종류: block 과 notice (2026-11-06·11-09)
- 결정: 명령·쓰기를 막으면 block, 알리거나 끝낼 때 되묻기만 하면 notice(commit-hash·work-checklist·answer-lang·prefer-gh). 「차단하는 것만」은 block 훅 중 이 저장소에 맞는 것만 켠다 — 이미 있는 훅과 겹침·지금 브랜치 전략이 끄는 것·다른 스택 전용·어느 조합·브랜치 전략도 기본으로 켜지 않는 훅(docs-check·squash-push)은 뺀다.
- 어디서: `catalog/packs.json` 의 `kind`, `picker/stats.js` 의 `blockingHooks`

## 훅별 결정

### 실행 전에 묻는 훅 ask-cmd (역할극 2·3·6 회차, 2026-11-11)
- 결정: 훅 종류에 ask 를 더했다 — 막지 않고 Claude Code 확인 창(permissionDecision ask)을 띄운다. 사용자가 적은 명령 앞부분(commands: 「ros2 launch」, 「python scripts/train.py」)과, remote 를 켜면(기본) ssh·scp·원격 rsync·바꾸는 kubectl·helm install/upgrade·terraform apply/destroy·ansible-playbook. 막는 규칙이 같이 걸리면 막는 쪽이 앞선다.
- 이유: 실제 로봇·긴 학습·운영 서버처럼 「되돌릴 수 없지만 필요할 때는 해야 하는」 명령은 막으면 일이 멈추고, 그냥 두면 사고가 난다. 역할극 세션들이 이 훅을 매번 손으로 만들었다.
- 기본: 꼼꼼 조합과 인프라·운영 스택(Terraform·Kubernetes·Ansible·Claude API·MCP, ROS 2 는 ros2 명령 목록과 함께 — stackAddons). 팀 조합 기본에서는 뺐다 — 웹 앱 팀에는 볼 일이 드물고, 확인할 사람이 없는 claude -p·CI 에서는 문서상 막힌다(세 번째 검토). 사용자가 걱정을 말하면 auto 에서 commands 옵션으로 넣는다(SKILL.md).
- 권한 건너뛰기 모드에서도 확인 창이 뜬다(역할극 3 회차 2차 대화 기록: 결과에 source user_temporary·reasonCode hook:PreToolUse, 다른 도구는 mode 로 자동 허용). 확인 창은 Claude 에게 안 보여 세션이 「건너뛰었다」고 잘못 보고했다 — SKILL.md 에 적음. 도움말·버전(--help·-h·--version)은 묻지 않고, python -m 모듈 꼴도 같은 스크립트로 본다.
- 묻는 범위: ssh -V·-G 와 로컬 scp 는 묻지 않음, --dry-run·ansible-playbook --check 는 묻지 않음, kubectl run·expose·debug·autoscale 과 ansible 모듈 바로 실행은 물음. 패키지 스크립트는 「npm run X」 「pnpm X」 「yarn X」 를 같은 것으로 맞춘다. 겹침 시험(probe)에서 남의 훅이 묻기만 하면 막는 훅과 같은 것으로 보지 않는다(묻는 훅의 시험만 ask 를 걸림으로).
- 스택에 딸린 훅 옵션(stackAddons 의 hookOpts, 목록은 합침): ROS 2 → ask-cmd 에 ros2 launch·topic pub·service call·action send_goal. Claude API·MCP 도 ask-cmd 를 켠다(운영 에이전트 — 6 회차 2차, 묻기만 해서 비용이 작다). 로보틱스 판정: 실기 명령 묻기가 처음 추천에 없었다(2 회차 2차). 관절 한계·URDF 파일은 auto 에서 보호할지 한 번 묻는다(SKILL.md).
- `ros2 run` 은 ROS 2 기본 묻기 목록에 넣지 않는다(사용자 결정, 2026-11-13). rviz2·rqt 같은 보기용 도구도 `ros2 run` 으로 띄워 매번 묻게 된다. 실기를 움직이는 노드는 저장소 launch 파일·스크립트에서 찾은 명령이나 사용자가 적은 명령으로 묻는다.
- 그대로 둔 것: Claude API·MCP·ROS 2 의 ask-cmd 는 팀 조합에서도 켠다 — 운영 명령을 Claude 가 부를 수 있는 저장소라 묻는 비용보다 사고 비용이 크다(확인할 사람이 없는 claude -p 에서는 막힌다는 것은 같음). compose 서비스 이름(psql -h db)도 원격으로 보고 묻는다 — 이름만으로 구별할 수 없다. 보호 경로를 커밋 때 다시 보지 않는 것(사람 커밋을 막지 않으려는 결정).
- 막기 목록 block(13·14·15 회차, 2026-11-13): 세 사용자 모두 운영 명령을 「묻지 말고 아예 못 하게」 해 달라고 했고 세션은 permissions.deny 를 손으로 넣으라고만 할 수 있었다. deny 는 앞부분만 맞춰 `terraform -chdir=envs/prod apply`·`cd envs/prod && terraform apply`·`npx vercel --prod`·`--context prod` 를 뒤에 둔 꼴을 놓친다. 그래서 ask-cmd 에 `block`(목록, item command)을 두고 commands 와 같은 맞추기(ask-match segmentHit)로 deny 한다 — 같은 맞추기라 둘이 어긋나지 않고, harness.json 으로 팀원에게도 간다. 따로 block-cmd 훅을 두지 않은 까닭: 같은 옵션 칸·같은 맞추기를 두 훅에 나누면 사용자가 둘 다 켜야 한다. 막는 글이 묻는 글보다 먼저(run.mjs 그대로). 막는 글은 「다른 꼴로 바꿔 실행하지 말고 사람에게」. 고르기 화면은 옵션 칸을 packs.json 에서 그리므로 손대지 않았다. `hooks/rules/shell.mjs` blockCmd, 시험 `strict-cases/block-review.mjs`·`block-review2.mjs`(결정 꼴 deny·ask 까지 본다).
  - 막기는 시험 실행 표시(--dry-run·--plan·DRY_RUN=1·make -n)를 보지 않는다(독립 검토 2026-11-13): 적은 스크립트가 그 표시를 모르면 그대로 실행된다(`DRY_RUN=1 terraform apply -auto-approve`·`scripts/x.sh --dry-run` 이 지나갔다). 빼는 것은 도움말·버전 낱말(--help·-help·-h·--version·-version) 하나만 더 붙은 꼴뿐 — 인자가 더 있으면(`x.sh ip --version`) 막는다. 묻기는 그대로 시험 실행을 묻지 않는다. `hooks/lib/ask-match.mjs` blockHit.
  - 막기·묻기가 보는 꼴(같은 검토): exec·builtin·eval(따옴표 없이)·source·.·`{ …; }`·if/then/do 뒤, 백틱, `echo "X" | bash`·`printf … | sh`·`"X" | iex`, `bash <<<"X"`, `find … -exec X \;`, `xargs X`(아래 「xargs 뒤」 줄), `bash -x x.sh`·`sh x.sh`, gmake = make, PowerShell `Start-Process X -ArgumentList …`·따옴표 없는 `cmd /c X`·`& { X }`·`if (…) { X }`. 앞붙이는 `hooks/lib/run-prefix.mjs`(다른 셸 규칙도 함께 넓어진다), 숨은 실행은 `hooks/lib/hidden-runs.mjs`.
  - 다시 검토(2026-11-13)로 더 본다: `if`·`while`·`until` 조건 자리, `function 이름 {`, `coproc`, `time -p`·`command -p`(앞붙이마다 값 받는 옵션을 따로 — 한 목록이라 -p 가 명령을 값으로 먹었다), `command -v` 는 찾기만이라 아님, `setsid`, `stdbuf -o L`·`-oL`, `su -c "X"`·`env -S "X"`(따옴표 속을 다시 나눔), `wsl [-d 배포판] [--] X`(--list 같은 옵션은 아님), 큰따옴표 속 `$(X)`·`<(X)`, `printf '%s\n' X | bash`, `… | tee … | bash`, PowerShell `start X`·`Start-Process powershell -ArgumentList "-Command","X"`·`@('…')` 인자 목록·`ForEach-Object { X }`·`% { X }`·`Invoke-Command { X }`·`Start-Job { X }`·`.{X}`. 앞붙이를 32번 넘게 벗겨도 끝나지 않으면 막는다(지키는 쪽 — 전에는 12번에서 그대로 멈췄다). `bash -n`·`sh -n`(문법만)은 실행이 아니고, `<<\EOF` 는 `<<'EOF'` 처럼 치환이 없는 heredoc 이다(`hooks/lib/quotes.mjs`).
  - 도움말 낱말은 적은 명령의 낱말을 지운 뒤 남은 것만 센다(다시 검토 2026-11-13): 적은 `psql -h prod-db` 의 `-h`(호스트)를 도움말로 세어 `psql -h prod-db`·`echo "DROP …" | psql -h prod-db`·`echo FLUSHALL | redis-cli -h prod-cache` 가 지나가던 회귀(35bbd84). 남은 것이 도움말·버전 낱말 하나뿐일 때만 지나가고, 남은 `-h` 는 맨 끝 낱말일 때만 도움말이다 — `psql -h prod-db --help` 는 지나간다.
  - xargs 뒤(`ask-match.mjs` matches open): 앞 낱말이 모자란 채 끝나면(`echo apply | xargs terraform`) 적은 명령이 프로그램 낱말뿐일 때만 맞는다. 앞 낱말이 다 있으면 보통과 같이 적은 옵션·그 값·대상이 모두 있어야 한다 — 전에는 앞 낱말만 보아 「rm -rf build」 가 `git ls-files -d | xargs rm`·`xargs rm -f` 까지 막았다. 표준 입력으로 올 대상·옵션 값은 짐작하지 않으므로 `echo build | xargs rm -rf`·`echo -auto-approve | xargs terraform apply` 는 지나간다(받아들인 놓침 — 헛막음이 더 잦은 쪽이라).
  - 태그 올리기 막기: block 에 `git push --tags`·`git push --follow-tags` 꼴의 줄이 있으면 tagPush 가 태그 올리기로 보는 push 를 모두 막는다(이름 붙인 태그·refs/tags/…·`tag v…`·태그 지우기 — 역할극 16 회차 다시, 2026-11-13: tagPush 가 묻기에만 쓰여 막을 길이 없었다). 글롭 맞추기는 하지 않는다. 태그인지는 버전 꼴만이 아니라 모든 위치 인자를 같은 한 번의 for-each-ref(파일로 먼저)로 찾는다 — `release-1.3.0` 이 지나갔다. 버전 꼴이 아닌 이름은 로컬 태그일 때만. `hooks/lib/tag-push.mjs`(remote-cmd.mjs 400줄이라 나눔).
  - push.followTags: `git -c push.followTags=true push …`, 같은 명령 앞의 `git config push.followTags true`, 저장소 설정 파일(.git/config — 파일로만, git 을 띄우지 않는다)이 켜져 있으면 `git push` 를 `--follow-tags` 를 붙인 꼴로 견준다. `--no-follow-tags`·`-c push.followTags=false` 는 끔. 전역 설정(~/.gitconfig)·include 는 보지 않는다.
  - 알려진 한계(보지 않음 — 받아들임): `alias t=terraform; t apply`·`Set-Alias`, `$TF apply`·`"$tf" apply` 같은 변수 명령, `docker run 이미지 apply`(이미지 속 명령은 모른다), `te\rraform`·`t\erraform` 처럼 역슬래시로 쪼갠 낱말, `bash /dev/stdin`, `parallel`, `script -c`, helm get hooks·kubectl get -f 같은 읽기 꼴의 속. `deploy() { terraform apply; }` 처럼 함수를 정의만 해도 막힌다(받아들인 헛막음). 막기는 맞추기 위에 얹은 「힘닿는 데까지」다 — 마음먹고 피하면 피할 수 있다. 꼭 막아야 하는 명령은 permissions.deny 나 CI 관문(운영 자격 증명을 CI 에만 둠)이 진짜 벽이다. 막는 글이 「다른 꼴로 바꾸지 말라」고 한다.
  - 큰따옴표 속 백틱·`$(…)` 은 bash 가 실제로 실행한다 — `git commit -m "fix: \`x\`"` 의 x 가 막을·물을 명령이면 걸린다. 맞는 동작이다(메시지에 명령 이름을 쓰려면 작은따옴표나 `-F 파일`).
  - 설정 꼴: `"block": "terraform apply"`(글 하나)는 한 줄짜리 목록으로 받는다(목록으로 안 적어 막기가 조용히 꺼지던 일). commands 도 같다. 객체·숫자는 규칙이 오류를 내 「이 훅이 멈췄다」 알림이 뜬다(`ask-match.mjs` cmdList).
  - 막는 명령도 CLAUDE.md 「사람이 직접 실행하는 명령」 줄에 넣고 「그 밖의 명령」에서 뺀다(`scripts/lib/claude-md.mjs` withoutAsked·askedCmds). 막는 명령을 먼저 둔다 — 묻는 명령 23개 뒤에 이어 앞 5개만 보이니 막는 make release·release.sh 가 빠졌다(16 회차 다시, 2026-11-13).
- 하지 않은 것: 원격 묶음 전체를 막기(remote: "deny") — dev 클러스터에도 kubectl 을 써서 지나치다(15 회차). 명령마다 적는다.
- 읽기 하위 명령(kubectl get·helm get 등)을 묻지 않는 것은 적은 꼴이 컨텍스트 등을 대고 그 하위 명령을 대지 않았을 때만. 비밀값 읽기는 읽기로 치지 않는다 — kubectl get·describe 의 secret(s) 자원, `--raw` 경로의 /secrets, helm get values·all·manifest(독립 검토 2026-11-13: `kubectl --context prod get secret -o yaml` 이 묻지 않고 지나갔다). 도구 이름만 적은 꼴(`kubectl`)은 모두를 뜻하므로 읽기도 묻는다. `ask-match.mjs` readExempt.
- 어디서: `hooks/rules/shell.mjs` askCmd, `hooks/lib/run-prefix.mjs`(앞붙이 벗기기 — danger-cmd 의 DB 지우기와 같이), `hooks/lib/core.mjs` ask, `hooks/run.mjs`, `hooks/lib/pretool.mjs` asks

### ask-cmd: 적은 명령 맞추기와 시험 실행 (역할극 10·11·16 회차와 검토, 2026-11-11~13)
- ask-cmd 의 적은 명령은 앞 낱말과 옵션으로 나눠 맞춘다(`hooks/lib/ask-match.mjs`). 「dbt build --target prod」 를 적었는데 `dbt build --select x --target prod`·`dbt --target prod run`·`dbt run -t prod` 가 지나갔다(10 회차 — 앞부분 맞추기만 했다). 적은 명령의 앞 낱말 = 처음 `-` 로 시작하는 낱말 앞까지, 나머지는 옵션(`--target prod` 처럼 다음 낱말이 값, `--target=prod`). 실행한 명령은 앞 낱말이 차례대로 나와야 하고(첫 낱말은 맨 앞), 앞 낱말 사이에는 `-` 옵션과 그 값만 올 수 있다 — 전역 옵션을 하위 명령 앞에 두는 도구(dbt·terraform -chdir·kubectl -n·docker --context)가 흔해서. 옵션 아닌 다른 낱말이 끼면(`dbt --target prod test`) 다른 명령이다. 적은 옵션은 첫 낱말 뒤 어디에 있어도 맞고, 옵션 뒤에 적은 위치 인자는 앞 낱말 뒤 어디에든 있어야 한다. 짧은 별칭(-t)은 짐작하지 않는다 — 도구마다 뜻이 달라(-t 가 태그·스레드·대상) 헛물음이 나고, 쓰는 꼴마다 적으면 된다(화면 도움말·detail 에 적음). `--help`·`--version`·맨 끝 `-h` 는 그대로 보기로 친다.
- 적은 명령의 시험 실행은 묻지 않는다: 같은 조각의 `--dry-run`·`--dry-run=true·1·yes·on·client·server·all`(false·0·no·off·none 등 다른 값은 실제 실행 — 2026-11-11 검토)·`--plan`, make 의 `-n`·`--just-print`·`--dry-run`·`--recon`, 명령 앞 `DRY_RUN=1·true·yes·on`(env·sudo 뒤도). 앞 조각의 export·$env: 는 보지 않는다 — 그 사이에 값을 바꿀 수 있고 스크립트가 그 변수를 읽는지 모른다. 원격 목록의 --dry-run 은 전처럼.
- make 의 `-n` 은 `-kn` 처럼 값 없는 짧은 옵션 묶음 안에서도 본다. 적은 스크립트가 `--dry-run`·`--plan` 을 무시하면(그 옵션을 읽지 않는 스크립트) 그대로 실행된다 — 훅은 스크립트 속을 보지 않으므로 막을 수 없다.
- ask-cmd: `python src/churn/train.py` 도 설치 명령 churn-train(churn.train)과 같은 것으로(원래 낱말의 경로에서 모듈 이름을 만든다).
- python -m 모듈 꼴(`ask-match.mjs` variants)은 원래 낱말에서 -m 바로 뒤일 때만 만든다(적은 명령도 원래 낱말을 넘긴다). fd193d0 의 확장자 목록은 끝 마디가 cmd·go·r·ts·md·json 인 모듈(`python -m tools.cmd` ↔ `python tools/cmd.py`)을 놓치고 `./a.out`·`.ksh`·`.mts`·`.command` 는 모듈로 읽었다. 남은 넓음(예전부터): 적은 `python tools/cmd.py` 는 파일 이름 cmd.py 로 맞추므로 `python -m other.cmd` 도 묻는다.
- fastlane 플랫폼 낱말: Fastfile 이 레인을 `platform :ios do` 안에 두면 `fastlane ios beta` 로 부른다. 묻는 명령 맞추기(hooks/lib/ask-match.mjs)가 `fastlane` 바로 뒤의 ios·android·mac 을 건너뛰고 견준다 — 적은 명령에 플랫폼 낱말이 있으면 그대로(`fastlane ios release` 를 적으면 android release 는 묻지 않음). 다른 레인(`fastlane ios test`)은 그대로 통과.
- 읽기 전용 match 는 묻지 않는다(`ask-match.mjs` dryMarked): `--readonly`·`readonly:true`·명령 앞 `MATCH_READONLY=true`(nuke 는 물음). Matchfile 이 있어 「fastlane match」 를 묻는 명령에 넣어도 `fastlane match development --readonly` 는 지나간다(16 회차 정답지 M3 「readonly 는 묻지 않아도 됨」). 「이 저장소 명령」 걸러 내기(`claude-md.mjs` withoutAsked)도 같은 판정.
- 남은 것: npm run X 를 적었을 때 yarn 자체 명령 이름(deploy·build·start·test)과 같은 스크립트를 yarn X 로 부르면 맞추지 못한다. 묻기로 끝나면 알림 훅의 additionalContext 는 사라진다(셸 도구에는 알림 훅이 없어 지금은 영향 없음).
- xcrun 은 앞붙이로 벗긴다(`xcrun agvtool new-marketing-version`, `--sdk` 값 건너뜀 — -f·--find·--show-sdk-*·도움말은 도구를 돌리지 않아 그대로). `fastlane run <동작>` 은 같은 도구 명령으로도 맞춘다(upload_to_testflight → `fastlane pilot upload`, upload_to_app_store → `fastlane deliver`). 동작 목록은 추천과 같은 `hooks/lib/fastlane-actions.mjs` 하나. `fastlane run get_version_number`·`xcrun simctl list` 는 통과(16 회차 정답지 다시 매기기, 2026-11-13). 시험 `strict-cases/gaps.mjs`.
- xcrun 을 벗기기 전 꼴도 함께 맞춘다(두 번째 독립 검토 2026-11-13). 벗긴 뒤로 사용자가 「xcrun」·「xcrun --sdk iphoneos」 만 적은 묻는 명령이 `xcrun notarytool submit` 을 묻지 않고 지나갔다. 실행한 쪽과 적은 쪽 모두 같은 variants 를 거치므로 양쪽에 「xcrun 에서 멈춘 꼴」이 생긴다. 인자 속 xcrun(grep xcrun)은 아니다.
- `fastlane run` 앞의 전역 옵션(--verbose·--capture_output·--env 값)을 건너뛴다(두 번째 독립 검토 2026-11-13). `fastlane --verbose run upload_to_testflight` 는 지나가고 `fastlane --verbose pilot upload` 는 묻던 차이를 없앴다.
- make 의 `변수=값`(make DEPLOY=1 deploy-prod)은 앞 낱말 사이에서 옵션처럼 건너뛴다(14 회차, 2026-11-13).
- 적은 꼴이 하위 명령을 대지 않으면(「kubectl --context prod-payments」) kubectl get·describe·logs·diff·top·explain·version·api-resources·api-versions·cluster-info·events·wait, helm list·status·get·history·show·template·lint·search·version·diff·env, vercel alias ls·list 는 맞지 않는 것으로 본다(14 회차: 컨텍스트만 적었더니 get pods 도 물었다). 적은 꼴에 그 하위 명령이 있으면 그대로 견준다. 비밀값 찍기(get secret -o yaml)는 원격 묻기가 따로 묻는다.
- `fastlane match --readonly false·0·no·off`·`--readonly=false` 는 읽기 전용이 아니다(16 회차).
- 어디서: `hooks/lib/ask-match.mjs`(dryMarked·variants), 시험 `hooks/test/strict-cases/shell.mjs`·`followup.mjs`·`ask-review.mjs`

### ask-cmd 원격 범위 (`hooks/lib/remote-cmd.mjs`, 2026-11-11~13)
- ask-cmd 원격 범위에 aws·gcloud·az 의 바꾸는 명령(보기·이 PC 설정은 아님), 원격 호스트의 psql·mysql·mongosh·redis-cli(-h·주소), docker -H·--context·DOCKER_HOST 를 더했다(보기 명령 ps·logs 등은 아님). 원격 DB 연결은 읽기라도 묻는다 — 운영 DB 에 무엇을 보낼지 명령만 보고는 모른다.
- 원격 판정은 `hooks/lib/remote-cmd.mjs` 로 나눴다(shell.mjs 400줄). 원래 낱말에서 docker·DB 클라이언트를 찾는다 — 앞붙이를 벗기면 docker run·exec 의 이미지·컨테이너 뒤까지 잘려 `DOCKER_HOST=… docker exec …` 가 지나갔다. 앞 조각의 export·$env: 도 본다. PGHOST·MYSQL_HOST·DOCKER_CONTEXT, `--dbname=주소`, aws s3 mb·값 옵션 뒤 하위 명령, gcloud storage·gsutil, az 업로드. 묻지 않게: aws configure, az 의 --name 값, IPv6 로컬, docker compose logs·image ls 같은 보기, DB 클라이언트 --help.
- `-h` 는 맨 끝 낱말일 때만 도움말(psql -h localhost -c "DELETE …" 가 지나가던 aa5f618 회귀).
- 값이 있는 앞붙이(sudo -u root·timeout 30·npx·uv run) 뒤의 원격 docker·DB 클라이언트를 놓치던 회귀를 고쳤다 — 앞붙이를 벗긴 낱말로도 본다. PowerShell `$env:X="값"`(붙여 씀)도 읽는다.
- npx·npm exec·pnpm exec 의 -c "명령" 속 명령을 다시 나눠 본다(값으로 건너뛰어 놓쳤다).
- 그 밖: --help 는 따옴표 밖 낱말 하나일 때만, nice -n·ionice -c 값, pnpm -w 는 값 없음, docker run --tmpfs 등 값 옵션, ssh -G 는 묻지 않음, --dry-run=none 은 실제 적용, kubectl exec … -- 명령은 벗기기 전 낱말로도 원격 판정, playbooks/ 는 yml 이 있을 때만 Ansible.
- 원격 목록에 더함(`hooks/lib/remote-cmd.mjs`): terraform·tofu `state rm·mv·push`·`workspace delete`(-dry-run 은 아님), Kafka 관리 도구는 클러스터가 어디든(localhost 도 — 운영 클러스터를 이름으로 가를 수 없다) `kafka-topics --delete`, `kafka-consumer-groups --reset-offsets … --execute`·`--delete`·`--delete-offsets`, `kafka-configs --alter`. `--list`·`--describe`·`--execute` 없는 되돌리기(kafka 의 시험 실행)는 묻지 않는다. 그룹 지우기(--delete)는 요청 밖이지만 오프셋을 잃는 같은 종류라 넣었다. `aws s3 sync` 는 받는 쪽이 s3:// 일 때만(내려받기는 이 PC 만 바꾼다 — 검토), `aws s3 mv` 는 내려받아도 원래 객체를 지워 늘 묻는다.
- ask-cmd 원격에 argocd app sync·rollback·delete·set·terminate-op 등(get·list·diff·history 는 보기), terraform force-unlock·untaint·state replace-provider, vault write·delete·kv put·patch·delete·destroy.
- 버전 태그 올리기(`remote-cmd.mjs` tagPush, 원격 묻기·문구 ask.tag): `git push --tags`·`--mirror`, 위치 인자가 v1.3.0·1.3.0·refs/tags/… 이거나 `tag <이름>`(지우기 `--delete origin v1.0.0`·`:v1.0.0` 도). 버전 꼴 이름이 태그인지 브랜치인지는 아래 줄처럼 저장소를 한 번 찾아 가른다(유지보수 브랜치 2.0·3.12 가 물었다). `--follow-tags` 는 평소 push 마다 붙이는 사람이 있어 원격 묻기에 넣지 않고 iOS 스택 기본값에만(16 회차 release.sh 가 이 꼴). 브랜치 push(`release/1.3` 포함)·--dry-run 은 묻지 않는다.
- 버전 꼴 push(`remote-cmd.mjs` tagPush): 2.0·3.12·v2.0-dev·2024.11·1.2.3-hotfix 는 유지보수 브랜치 이름으로 흔해(CPython·Symfony) `git push origin 2.0-dev`·`-u origin 2.0`·`--delete v2.0-dev` 가 물었다. 이제 refs/tags/ 를 적지 않은 버전 꼴은 저장소에서 한 번 찾는다(`git for-each-ref` — refs/tags/·refs/heads/·refs/remotes/<원격>/ 를 한 번에, 명령의 cwd·`-C` 기준, push 이고 버전 꼴 이름이 있을 때만 한 번). 로컬 태그면 묻고, 브랜치(로컬·원격 추적)면 묻지 않는다. 어느 쪽도 없거나 못 찾으면(저장소 밖·git 없음·지운 뒤의 `:v1.0.0`) 출시 태그 꼴 `N.N.N`(앞 v 있어도 없어도, 뒤붙이 없음)만 묻는다 — 애매하면 묻지 않는다. show-ref --verify 대신 for-each-ref 를 쓴 까닭: 없는 이름이 섞여도 끝 코드 0 이라 한 번에 여럿을 볼 수 있다. `-u`·`--set-upstream` 은 브랜치 올리기라 버전 꼴을 보지 않는다(refs/tags/ 는 그래도 묻는다). `src:dst` 는 src 로(`HEAD:v2.1` 은 브랜치), 빈 src 지우기만 dst. `--tags`·`--mirror`·`tag <이름>`·refs/tags/ 는 그대로 묻는다.
- 이름이 운영인 환경 변수(`remote-cmd.mjs` prodTarget — `(^|_)PROD(UCTION)?(_|$)`, $·${}·$env:·%…%): DB 클라이언트(psql·pg_dump·mysql·mongosh·redis-cli …)는 인자나 앞 변수=값에 그런 참조가 있으면 원격으로, 마이그레이션 도구(goose·golang-migrate·dbmate·atlas·flyway·liquibase·sqlx·sql-migrate)는 그 참조로 스키마를 바꿀 때(up·down·apply·migrate…)만. `$DATABASE_URL`·`$DEV_*`·`$TEST_*`·`$STAGING_*`·`$PRODUCT_*` 는 묻지 않는다(어디인지 모름). 마이그레이션 도구의 글자 그대로 주소는 보지 않는다 — compose 안 호스트(db·postgres)가 원격처럼 보여 헛물음이 잦다. 앞 조각의 `export DATABASE_URL=$PROD_…` 뒤 `goose … "$DATABASE_URL" up` 은 놓친다(변수 따라가기는 DOCKER_HOST·PGHOST 만).
- 마이그레이션 도구의 글자 주소도 호스트 이름에 prod·production 마디(영문·숫자 아닌 글자로 나눔)가 들면 묻는다(14 회차: `goose … "postgres://…@payments-prod.db.internal/…" down` 이 지나갔다, 2026-11-13). 스킴 주소·MySQL `@tcp(…)`·key=value `host=`. product-db·db 같은 compose 호스트는 그대로 묻지 않는다.
- 이 Mac 의 `~/Library/MobileDevice/Provisioning Profiles` 를 지우는 rm·Remove-Item 은 원격 묻기와 함께 묻는다(16 회차 M3, 문구 ask.profiles). $HOME 이 든 경로·역슬래시 띄어쓰기도 글자로 본다.
- 운영 변수 DB(`remote-cmd.mjs` prodTarget → connArgs): 접속 자리만 본다 — 위치 인자, 접속 옵션 값(-d·--dbname=·--url·-database·-u·-h·붙여 쓴 -d$X), 도구 앞 변수=값. 글을 받는 옵션(-c·--command·-f·--file·-v·--set·--variable·-e·--execute·--eval·-o·-L·-P)의 값은 건너뛴다. `psql -c "… '$PROD'"`·`-v env=$PROD`·`mongosh --eval` 속 $PROD 가 운영 접속으로 읽혀 물었다.

### 비밀값을 그대로 찍는 명령은 묻는다 (역할극 15 회차와 독립 검토 세 번, 2026-11-12)
- 비밀값을 그대로 찍는 명령도 묻는다(`hooks/lib/secret-read.mjs`, 문구 ask.secret — 찍은 값이 대화 기록에 남는다): aws secretsmanager get-secret-value, ssm get-parameter(s) --with-decryption, kubectl get secret -o yaml·json·jsonpath·go-template·custom-columns, kubectl view-secret, gcloud secrets versions access, az keyvault secret show·download, vault kv get·vault read. 값이 안 보이는 것은 묻지 않는다: kubectl get secrets 표·-o name·wide, kubectl describe secret(키 이름과 바이트 수만), list-secrets·describe-secret, 복호화 없는 get-parameter, kv list·metadata get.
- terraform output: 공식 문서상 그냥 `output` 은 sensitive 를 가리지만 이름을 주면(-raw 든 아니든) 가리지 않고, 이름 없는 -json 은 모두 찍는다. 이름 없는 -json 은 늘 묻고, 이름을 주면 그 폴더(-chdir 포함)의 .tf 에서 그 output 블록이 sensitive = true 일 때만 묻는다(.tf 200개·1MB 까지, 블록을 못 찾으면 모르니 묻는다) — vpc_id 같은 보통 값까지 물으면 헛물음이 잦다. `cd 폴더 && terraform output x` 는 cd 를 따라가지 않아 그 output 을 못 찾고 묻는다.
- 비밀값 출력은 「분명히 화면에 닿을 때만 묻기」로 — 프로젝트 원칙 「헛물음이 놓침보다 나쁘다」. 두 번째 검토의 「모르는 도구는 찍는다고 본다」는 `| kubeseal`·`mysql -p"$(…)"`·`docker run -e P="$(…)"`·`gh secret set --body "$(…)"`·`… 2>&1 | kubeseal > s.yaml` 처럼 값을 넘겨 쓰기만 하는 흔한 명령까지 물어, 사용자가 확인 창을 습관으로 누르게 만든다. 이제 찍는다고 알려진 것만 본다(`hooks/lib/secret-stage.mjs` 의 PASS·PS_PASS·echoes·READERS 목록): 표준 출력이 그대로 화면, 찍는 도구(cat·jq·yq·base64·grep·head·tail·less·tee·xxd·sed·awk·python -c·node -e·sh, PowerShell ConvertFrom-Json·Select-String·Format-*·Out-String·Out-Host·Write-Host·Write-Output)로 끝나는 파이프, 찍는 명령(echo·printf·Write-Host·Write-Output)의 `$( )`·백틱, 같은 줄에서 다시 찍는 변수(echo $X·printenv X·맨 env·set·PowerShell $x)·파일(cat·less·head·grep·Get-Content)·클립보드(pbpaste·Get-Clipboard). jq·yq 는 이름표 칸·키 이름·개수만 꺼내면 안 묻는다. `kubectl apply -f - -o yaml` 과 `Set-Content -PassThru` 는 다시 찍어 묻는다. 모르는 도구는 삼킨다고 본다 — 놓침(예: 목록에 없는 실행기로 찍기)은 받아들인다.
- `2>&1`·`&>`·`2>`·`>&2`·`|&` 는 넘겨쓰기로 읽는다(조각을 나누지 않는다). `2>&1` 만 붙이면 값은 그대로 화면이라 묻고, `&> 파일`·`> 파일 2>&1` 은 안 묻는다. bash `( … )` 묶음은 닫는 `)` 뒤의 넘겨쓰기·파이프를 따른다(`(cd x && kubectl get secret … ) > s.yaml` 는 예전부터 헛물음이었다).
- kubectl 종류는 get 바로 뒤 낱말(쉼표로 여럿)과 종류/이름 꼴만(`get configmap secrets`·`get pod secret` 은 이름). 틀 파일(-file)은 안을 못 보니 묻지 않는다. `vault read sys/…` 는 서버 상태라 묻지 않고 `sys/raw` 만 묻는다. vault 옵션은 `--address` 처럼 `--` 도(secret-read·remote-cmd 가 같은 목록).
- kubectl 틀: 꺼내는 칸이 모두 metadata·type·kind·apiVersion 아래일 때만(맨 앞 items 는 건너뜀, 점 없는 custom-columns 칸도) 안 묻는다. `{@}`·`{$}`·`{{.}}`·`{{index . "data"}}`·`custom-columns=V:data`·`{..data}` 는 묻는다.
- kubectl: metadata 는 name·namespace·labels·creationTimestamp·uid·resourceVersion 만 안전 — annotations 의 `kubectl.kubernetes.io/last-applied-configuration` 에 data 가 통째로 들고 `{.metadata}` 는 그것까지 찍는다. 종류 쓰는 법 `secret.v1`·`secrets.v1.`·`secrets.v1/이름`, `kubectl get --raw` 경로에 `/secrets` 가 들면 비밀값 명령.
- 남은 놓침(헛물음보다 낫다고 둠): `if …; then`·`for …; do`·`{ …; }` 안의 비밀값 명령은 보지 않는다(앞 낱말을 벗기면 `done > f`·`} > f` 넘겨쓰기도 따라가야 해서 이번엔 안 함). PowerShell `$s.Length` 같은 속성 읽기는 물음으로 둔다(드묾).
- 어디서: `hooks/lib/secret-read.mjs`·`secret-sink.mjs`·`secret-stage.mjs`, 시험 `hooks/test/strict-cases/infra.mjs`·`infra-review.mjs`·`infra-review2.mjs`·`infra-review3.mjs`(strict.test.mjs 가 이어 붙임)

### 비밀값 꼴 (`hooks/lib/secrets.mjs`, 역할극 2~14 회차와 검토, 2026-11-11~13)
- 비밀값 꼴: Slack 앱 토큰(xapp-)·설정 토큰(xoxe-), Voyage 키(pa- 뒤 대문자·숫자가 섞인 32~64자 — 소문자 낱말 이음은 아님), wandb.login(key=…) 의 40자리 키, os.environ["X_API_KEY"] = "…" 처럼 [" "] 안의 이름. `hooks/lib/secrets.mjs`.
- 설정 파일의 따옴표 없는 비밀값: .yml·.yaml·.properties·.toml·.ini·.conf 에서 키 이름이 password·passwd·secret·token·api_key·private_key·access_key·secret_key 로 **끝나고**(이름에 들기만 하면 token-expiry: 86400000 이 걸려서), 값이 띄어쓰기 없는 8자 이상 ASCII 이며 숫자나 기호가 섞일 때만(`password: required` 는 아님). 자리표시자·참조(`${…}`·`{{…}}`·`<…>`·`%(…)s`·`$VAR`·`ENV[…]`·`ENC(…)`·`!태그`·`*별칭`·vault: 등), 주석 줄, existingSecret·secret.name 처럼 이름을 가리키는 키, .example·.sample·.template 파일, 시험 폴더는 뺀다. 줄 맨 앞에서 한 번 맞추는 정규식이라 줄 길이에 비례한다. 설정 파일에서만 빠른 거르개에 token·api-key 를 더했다(JS 파일의 모든 token 줄을 보지 않게). compose 의 `- MYSQL_ROOT_PASSWORD=값` 도 막는다(따옴표를 친 같은 줄은 이미 막고 있었다). `hooks/lib/secrets.mjs` configHit, 겹침 시험에 application.yml 한 줄.
- 비밀값: 대문자 상수 이름이 _TOKEN·_KEY 로 끝나고 값이 무작위 글자처럼 보일 때(16자 넘고, 숫자 셋 넘거나 대소문자·숫자 섞임, 점·밑줄로 이은 소문자 낱말 아님). SIEM_API_TOKEN·REPUTATION_FEED_KEY 가 지나갔다(12 회차). CACHE_KEY = "user:profile"·I18N_KEY 같은 이름표 값은 아니다. apiToken 도. 공개 키·이름표 낱말이 든 이름과 경로·낱말 이음 값은 뺀다(아래 둘째 줄).
- 비밀값 속도: 대문자 상수 _KEY·_TOKEN 정규식이 이름 앞에서 맞추느라 `A_B_B_…_KEY` 한 줄에서 시작점마다 끝까지 훑었다(40KB 1.5초, 400KB 2분 넘게). `_KEY`·`_TOKEN` 자리에서 맞추고 이름은 거기서 뒤로 128자까지 걷는다(값은 256자까지). 이름 뒤 낱말(`SECRET_KEY_…`)도 8개·한 낱말 64자로 묶었다(`secret_secret_…` 같은 꼴). 400KB 한 줄 4~27ms(review4.test.mjs 가 100ms 안을 본다).
- 비밀값 헛막음: 대문자 _KEY·_TOKEN 꼴에서 이름에 공개 키·이름표 낱말(PUBLIC·PUBLISHABLE·SITE·SEARCH·…STORAGE·COOKIE·FLAG·SORT·CACHE·PATH·S3·OBJECT·BUCKET·PARTITION·ROUTING·PRIMARY·FOREIGN·I18N·LOCALE)이 든 것, `/` 가 든 값(S3 객체 경로), `pk_`·`pk.` 로 시작하는 공개 키(Stripe·Mapbox), 낱말을 이은 낙타 표기 + 4자리까지 숫자 꼬리(myAppAuthStateV2·enableNewCheckout2024 — 3자 못 되는 마디는 하나까지)는 뺀다. `password`·`api_key` 같은 이름은 전과 같다(NEXT_PUBLIC_…_API_KEY 는 여전히 걸린다). TEST_VECTOR_KEY·HMAC_TEST_KEY 같은 시험 값은 그대로 걸린다 — STRIPE_TEST_KEY 처럼 진짜 시험 모드 키와 이름으로 가를 수 없다.
- 비밀값: 공개 접두(NEXT_PUBLIC_·VITE_·REACT_APP_·EXPO_PUBLIC_·NUXT_PUBLIC_·GATSBY_·PUBLIC_)에 SECRET·PASSWORD·PRIVATE_KEY·SERVICE_ROLE 이 든 이름은 값이 없어도 막는다(쓰는 순간 번들에 실린다. ANON_KEY 는 공개용이라 둔다). Go `:=` 도 대입. 접속 주소 속 비밀번호는 무작위로 보이는 것만(postgres:postgres 같은 개발 기본값·${…} 는 둔다 — 헛막음이 놓침보다 나쁘다).
- 공개 접두 이름은 비밀 낱말(+ _KEY·_TOKEN)로 끝날 때만 막고, 시험 파일·문서는 보지 않는다(REACT_APP_PASSWORD_RESET_URL 을 막았다). 주소 속 비밀번호는 localhost·127.*·아이디가 든 값은 둔다(app12345@localhost 를 막았다).
- 낙타 이름이 Key·Token 으로 끝나는 무작위 값(webhookKey := "…" — 14 회차, 2026-11-13): 대문자 상수보다 좁게 — 값 24자 이상, 이름의 마디 하나라도 이름표 낱말(cache·sort·storage·page·cursor·public·primary·idempotency·route·event …)이면 아니다. Key·Token 자리에서 맞추고 이름은 뒤로 걷는다(제곱 시간 방지). 소문자 snake(webhook_key)는 아직 안 본다.
- 키 파일 이름에 .provisionprofile(16 회차). .cer·.certSigningRequest 는 넣지 않는다 — 공개 인증서·요청이라 SSL 고정용 .cer 커밋까지 막았다(독립 검토 2026-11-13). 16 회차의 무시 목록 .cer 를 add -f 한 커밋은 아래 「무시 파일 새로 넣기」 검사가 막는다.
- 미리 거르는 조각(MAY_HIT)에 띄어쓰기 묶음 둘을 바로 잇지 않는다: `[ \t]*:?=?[ \t]*` 가 「aKey」+ 띄어쓰기 30만 자에 84초(훅 시간 15초를 넘겨 뒤의 진짜 토큰이 지나갔다 — git 훅도 같은 검사). 둘 사이에 `:`·`=` 가 있어야 둘째 묶음을 본다. 7c9e4f8·ab1a918 이 더한 다른 정규식은 묶음 사이에 꼭 있는 글자가 있거나 길이를 묶어 같은 꼴이 없다. review4.test.mjs 가 30만 자 200ms 안을 본다.
- 새 터짐 시험(`python -m a.a.a…` 100KB)이 password-cli 의 주소 속 비밀번호 정규식 제곱 시간(11초)을 드러냈다 — 시작을 `\b` 대신 스킴 글자가 이어지는 첫 자리로(뒤보기) 바꿔 고쳤다(뜻은 같다).
- 어디서: `hooks/lib/git-writes.mjs`(isRef·wideSpec·askGit·wideTouched), `hooks/rules/shell.mjs` protectedShell, `hooks/rules/migration.mjs`(folderFromCommit), `hooks/lib/ask-match.mjs` dryMarked, `hooks/lib/secrets.mjs` upperAssigned·labelValue, 시험 `hooks/test/strict-cases/followup.mjs`(strict.test.mjs 가 같은 훅 사례에 이어 붙임)·`write.mjs`, `hooks/test/review4.test.mjs`, `hooks/test/crash-cases.mjs`

### 파일 보호 protected-files (역할극 2~4·8·11·15 회차와 검토, 2026-11-11~12)
- protected-files 는 셸로 바꾸거나 지우는 것도 막는다(> · >> · tee · sed -i · cp·mv 받는 쪽 · mv·rm·truncate · PowerShell Set-Content·Remove-Item 등, `hooks/lib/shell-writes.mjs`). 변수로 정한 경로는 못 본다. 사용자가 적은 경로는 앞 `./`·뒤 `/`·`\` 를 고르게 맞추고 경로 낱말 단위로 본다(`data` 는 `metadata.py` 를 막지 않음, `.hdf5` 처럼 점으로 시작하면 확장자). 역할극 2·3·4 회차(2026-11-11). 독립 검토(2026-11-11)로 고친 것: 따옴표 친 넘겨쓰기 대상, PowerShell 스위치(-Force·-Recurse) 뒤 경로, Copy-Item·Move-Item 의 둘째 위치 인자, 보호 경로를 품은 폴더 지우기. `cp .env.example .env` 는 .env 가 아직 없거나 `cp -n` 이면 허용(값을 쓰지 않는 첫 설정) — 이미 있으면 막는다(gitignore 된 진짜 값을 되살릴 수 없어서). 두 번째 검토: 경로는 프로젝트 맨 위 기준으로 맞춘다(절대 경로·cd 뒤 ../·끝 /* 글롭). 폴더째 지우기는 맨 위 기준 앞부분이 같을 때만(이름만 같은 다른 raw/ 는 아님). PowerShell 공통 매개변수(-ErrorAction 등)의 값, cp -t, ni 별칭. 「덮어쓰기」 문구는 받는 파일이 있을 때만. 옵션 목록은 항목마다 거르고(한 줄이 틀렸다고 전부 버리지 않음) 경로의 \ 는 / 로, 한글 경로도 받는다. 끝이 / 인 폴더 꼴(data/)은 프로젝트 맨 위 기준이다(소스 폴더 pick_policy/data/ 까지 막던 일 — 역할극 3 회차 2차). 사용자가 보호한 경로는 비밀값 안내(.gitignore 에 넣으라) 대신 「사용자에게 물어보라」고 알린다.
- 보호 경로는 Windows·macOS 에서 대소문자를 가리지 않는다(보호 경로를 품은 폴더 지우기도).
- git 이 바꾸는 경로를 한 곳에서 읽는다(`hooks/lib/git-writes.mjs`): rm·mv·checkout·restore·clean. 보호 경로(protectedShell)와 migration-edit 가 같이 쓴다 — migration.mjs 에 있던 git mv·rm 읽기를 옮겼다(역할극 8·11 회차: 보호 경로를 git rm·git mv·git checkout -- 로 바꿔도 지나갔다). 보호 경로: `git rm`(--cached 는 stage 만 — 허용), `git mv` 양쪽, `git checkout [커밋] -- 경로`·`git checkout <커밋> 경로`, `git restore 경로`(--staged 만이고 --source 가 없거나 HEAD 면 올린 것을 내릴 뿐 — 허용), `git clean -f 경로`(-n 은 보기만). `git checkout 낱말하나` 는 그 이름의 파일·폴더가 있거나 글롭일 때만 경로로 본다 — 없으면 브랜치(`git checkout main`), 있어도 같은 이름의 브랜치·태그·원격 브랜치가 있으면 브랜치(git 이 그렇게 한다), `-b·-B·--orphan`·`-` 은 브랜치. 넓은 pathspec 과 checkout·restore 의 폴더는 아래 둘째 줄. migration-edit 는 rm(--cached 도 — 커밋하면 HEAD 에서 빠진다)·mv 와, HEAD 가 아닌 커밋에서 가져오는 checkout·restore --source 만 — HEAD·stage 에서 되살리기는 커밋한 내용으로 돌아가는 것이다. 보기만(rm -n·mv -n·--dry-run)은 둘 다 뺀다(전에는 마이그레이션이 git rm -n 도 막았다). 보호 경로를 품은 폴더를 이름으로 막는 것은 지우기(rm·clean)만 — checkout·restore 의 폴더는 그 안의 보호 파일이 실제로 바뀔 때만(아래).
- 헛막음: 보호 경로 `main`(파일)이 있으면 `git checkout main`(-q·--recurse-submodules 도)을 막았다 — git 은 브랜치를 바꾼다. 낱말 하나인 checkout 이 있는 파일 이름일 때만 `git for-each-ref` 를 한 번 불러 `refs/heads/<x>`·`refs/tags/<x>`·`refs/remotes/<원격>/<x>` 와 통째로 같으면 브랜치로 본다(파일이 없으면 git 을 부르지 않는다). 커밋 해시만 같은 파일 이름은 보지 않는다(드물다).
- 넓은 pathspec(`.`·`..`·글롭·`:/` 같은 마법)은 이름으로 맞출 수 없어 git 에 푼다: `git rm` 은 `ls-files --full-name` 의 추적 파일(-r 없는 `git rm .` 은 지우지 않으니 뺌), `git checkout`·`git restore` 는 되돌릴 쪽(--source 커밋, `--staged --worktree` 면 HEAD, 아니면 stage)과 작업 트리가 다른 파일만(`git diff --name-only`). checkout·restore 의 폴더도 같은 길로 — 보호 파일이 실제로 바뀔 때만 막으니 헛막음이 없고, `git checkout -- .`·`git restore .` 도 보호 파일이 바뀌면 protected-files 가 막는다(전에는 danger-cmd 에만 맡겨 danger-cmd 를 끄면 지나갔다). `git rm -r .`·`git rm -r "*"`·`git rm "m*"`·`git rm "config/*.yml"` 이 지나가던 것. clean 은 전처럼(danger-cmd 와 품은 폴더 규칙).
- 클라우드에서 내려받기: 받는 쪽이 이 PC 경로면 그 경로에 쓰기, `--delete`·`gsutil rsync -d`·`rclone sync` 는 지우기로(aws s3 sync … data/raw/ --delete 가 지나가던 회귀 — 7 회차, 원격 묻기에서 내려받기를 뺀 뒤 생김). `hooks/lib/shell-writes.mjs` aws·gsutil·rclone.
- 보호 경로에 글롭 `*`·`**`: 끝 글자로만 맞춰 `*.tfstate*`·`kubeconfig*`·`*.tfplan`·`.vault_pass*` 를 적어도 terraform.tfstate.backup·kubeconfig-prod·prod.tfplan·ansible/.vault_pass 가 지나갔다. 꼴은 .gitignore 를 따른다 — `/` 가 없으면 어느 깊이의 이름에도, `/` 가 들면 맨 위부터, `*` 는 `/` 를 넘지 않고 마디 하나 전체인 `**` 는 마디 0개 이상, 이름이 맞은 폴더 안 파일도. 글롭 없는 꼴은 전처럼(경로 낱말 단위·끝이 `/` 인 폴더는 맨 위 기준·점으로 시작하면 확장자) — 바꾸면 이미 적어 둔 설정의 뜻이 바뀐다. 그래서 `.terraform/` 은 맨 위만, 어디서든은 `**/.terraform/`.
- 맞추기는 `hooks/lib/path-glob.mjs` 한곳(secrets.mjs protectedBy 가 부름) — Write·Edit, 셸 쓰기, git add·commit(protectedCommit), git rm 의 넓은 pathspec 이 모두 forbiddenFile 을 거쳐 같은 것을 쓴다. 정규식을 만들지 않는다(마디마다 두 손가락 맞추기 + 마디 단위 동적 계획, 꼴 256자 넘으면 글자 그대로). 화면 옵션은 `*` 를 받고, `*`·`/`·`.` 만으로 된 꼴(`**`·`*`)은 모든 파일이라 버린다(picker/hook-options.js — scripts/test/hook-options.test.mjs 의 「*.hdf5 는 버림」 기대도 바꿈).
- 글롭을 품을 수 있는 폴더 지우기(`rm -rf infra`·mv·Remove-Item -Recurse): 이름만으로는 안에 상태 파일이 있는지 모르니 실제 폴더를 5,000개까지 훑어 맞는 파일이 있을 때만 막는다(.git 은 건너뜀, 넘으면 거기서 그만 — 놓침). 맨 위 기준 꼴은 폴더가 꼴 앞부분에 맞을 때만 훑는다. 모든 지우기에 「어딘가에 있을지 모름」으로 막으면 헛막음이 너무 많다.
- 도구 폴더: 늘 건너뛰는 것은 이름이 분명한 것만(.terraform·node_modules·__pycache__·.next·.nuxt·.gradle·.pytest_cache·.mypy_cache·.tox — `TOOL_DIRS`). dist·build·target·out·coverage·venv·.venv 와 예전 목록의 나머지(.terragrunt-cache·cdk.out 등, `MAYBE_TOOL_DIRS`)는 안에 들어가 훑되(다른 것을 다 본 뒤), 그 폴더가 git 이 무시하는 폴더(`git check-ignore`, 폴더마다 한 번)이고 맞은 파일을 git 이 추적하지 않을 때(`git ls-files`, 무시된 폴더마다 한 번)만 건너뛴다. `rm -rf dist` 로 사람이 둔 dist/secret.key, `rm -rf build`·`rm -rf infra` 로 build/prod.tfstate·infra/target/terraform.tfstate 가 지워지던 일. git 을 못 부르면 친다(지키는 쪽).
- 도구 폴더를 건너뛰는 까닭: `*.tfstate*` 로 `rm -rf .terraform` 이 막혔다(terraform init 이 `.terraform/terraform.tfstate` 에 백엔드 정보를 쓴다), `dist/assets/kubeconfig-ABCD.js` 로 `rm -rf dist` 도. 꼴이 그 이름을 마디로 적었으면(`.terraform/*.tfstate`) 본다. 훑기는 너비 우선(readdir 순서에 따라 5,000개 안에 드는 것이 바뀌지 않게), 건너뛴 폴더는 세지 않는다. 화면 예시는 `*.tfstate`·`*.tfstate.*`.
- 흔한 이름 도구 폴더 가리기(gitKeep)를 한꺼번에: 후보 폴더를 모아 `git check-ignore --stdin -z` 한 번, 무시된 폴더의 후보 파일을 `git ls-files` 로(명령줄 길이 때문에 8,000자씩). packages/p0…p299/dist 를 품은 `rm -rf packages` 가 git 600번에 26.5초 → 진입점 0.4초 안팎. 훑기가 5,000개를 넘으면 그때까지 모은 후보로 판정한다(예전엔 놓침).
- 앞이 `/` 인 보호 경로는 .gitignore 처럼 맨 위 기준(`/kubeconfig*` 는 internal/kubeconfig.go 에 안 맞음, 글롭 없는 `/kubeconfig` 는 예전엔 아무것도 못 막았다). 감지가 .gitignore 의 `/kubeconfig*` 같은 줄을 그대로 넣기 시작해서. 화면은 앞의 `/` 하나를 받는다. 앞뒤 `/` 없는 꼴의 뜻은 그대로.
- 화면이 받는 글롭은 `*`·`/`·빈칸이 아닌 글자가 둘 이상(`*-*`·`*_*`·`**/*e*` 는 거의 모든 파일). 글롭 없는 경로는 전처럼.
- plist 도구도 쓰기로 본다(16 회차: 잠근 Info.plist·entitlements 를 PlistBuddy·plutil·defaults write 로 고쳐도 지나갔다, 2026-11-13): PlistBuddy -c 「Add·Set·Delete·Merge·Import·Clear·Copy」 의 마지막 인자, plutil -replace·-insert·-remove·-convert(-o 가 있으면 그 파일, `-o -` 는 화면), defaults write·delete·import·rename 의 경로 도메인(.plist 를 붙임), python -c·ruby -e 의 글자 경로 open(…,'w'|'a'|'x'|'+')·Path().write_text·File.write·File.open(…,'w'). Print·-lint·-p·읽기 open 은 아니다.
  - 독립 검토(2026-11-13)로 넓힘: plutil 파일 뒤 옵션(… Info.plist -s)·-create·-extract … -o 파일(-o 없거나 `-o -` 면 화면), python3.12·py -c, open(file=…, mode='w'), os.remove·shutil.rmtree·shutil.move·copy 의 글자 경로, ruby -i(제자리 고치기)·IO.write. `hooks/lib/shell-writes.mjs`.
- 마이그레이션 묻기의 글자 주소: `jdbc:postgresql://db.prod…`(flyway·liquibase)는 jdbc: 를 떼고 호스트를 본다. sqlite3://prod.db·file: 같은 파일 DB 는 호스트가 아니라 묻지 않는다(독립 검토 2026-11-13). `hooks/lib/remote-cmd.mjs` prodHost.
- 4KB 넘는 값은 경로 검사를 하지 않는다(4MB 값에서 스택이 넘쳐 통과). rclone --compare-dest·--copy-dest 는 값 옵션.
- 셸 쓰기도 막기·묻기와 같은 앞붙이 벗기기(runWords)와 숨은 실행(hidden-runs)을 거친다(다시 검토 2026-11-13): 따로 둔 앞붙이 목록이 `then rm .env`·`{ rm .env; }`·`exec`·`eval`·`try { Remove-Item .env } catch {}`·`if ($true) { … }`·`cmd /c del .env`·`echo "rm .env" | bash`·백틱을 놓쳤다. `find … -delete`·`-exec rm {}` 는 거르는 조건이 없으면 시작 경로를, `-name 낱말`(글롭 아님) 하나면 그 이름을 대상으로 본다(`find . -name "*.pyc" -delete` 는 모름 — 지나감). 컨테이너 안 명령(docker exec·compose run·kubectl exec·wsl)은 이 PC 파일이 아니라 벗기지 않는다(runWords hostOnly). PowerShell 블록을 닫는 `}` 뒤는 다른 명령으로 본다. 그대로 지나가는 것을 확인: `. venv/bin/activate && pytest`·`source ~/.bashrc`·`{ echo a; } > out.txt`·`exec "$@"`·`bash scripts/test.sh`·`sh -c 'npm test'`·`try { npm test } catch {}`.
- 글롭(`*.xcconfig`)·끝 글자 꼴(`.xcconfig`)의 보호 경로는 예시 파일(이름에 `.example.`·`.sample.`·`.template.` 이 들거나 그것으로 끝남)을 빼고 본다 — `Config/Secrets.example.xcconfig` 를 만들지 못했다(역할극 16 회차 다시, 2026-11-13). .env 와 같은 예외. 이름을 그대로 적은 파일과 꼴 자체가 예시 이름(`*.example.xcconfig`)이면 막는다. `secrets.mjs` protectedBy.
- HEAD·stage 에서 되돌리기(`git checkout -- 파일`·`git checkout HEAD -- 파일`·`git restore 파일`·`--source=HEAD`)는 막지 않고 묻는다(역할극 16 회차 다시: Xcode 가 바꾼 project.pbxproj 를 되돌리지 못했다). 판정은 「허용」을 제안했지만 8·11 회차의 「사용자가 손으로 고친 보호 파일 값을 버린다」 결정과 부딪혀 묻기로 낮췄다 — 확인 창에서 사용자가 고른다(문구 protected.restore). 다른 커밋·브랜치에서 가져오기와 --no-overlay 는 그대로 막는다. `git-writes.mjs` restoresCommitted, `rules/protected-shell.mjs`(shell.mjs 400줄이라 나눔).
- 어디서: `hooks/lib/ask-match.mjs`, `hooks/lib/remote-cmd.mjs`, `hooks/lib/git-writes.mjs`, `hooks/lib/shell-writes.mjs` install, `hooks/rules/shell.mjs`, `hooks/rules/migration.mjs`, `hooks/lib/staged.mjs` stageSources, `hooks/rules/commit.mjs` protectedCommit, 시험 `hooks/test/strict-cases/shell.mjs`·`write.mjs`·`migration.mjs`
- 시험: 글롭 훑기 `hooks/test/path-glob.test.mjs`, 큰 폴더 시간 `hooks/test/stress/glob-keep-big.test.mjs`

### migration-edit (역할극 8·9·11·14 회차와 검토, 2026-11-11~12)
- 결정(역할극 8 Flyway·9 Django): 이미 커밋한(git HEAD 에 있는) 마이그레이션 파일을 Write·Edit·셸 쓰기·mv·rm·git mv·git rm 으로 고치거나 지우는 것, Claude 의 git commit 이 그런 파일을 고치거나 지우는 것을 막는다. 새 마이그레이션·아직 커밋 안 한 것·Flyway R__ 은 둔다. 마이그레이션은 경로로만 안다(Flyway db/migration V…__, Django migrations/<숫자>_, Alembic versions/, Prisma migrations/<폴더>/migration.sql, Rails db/migrate/<숫자>_) — protected-files 는 파일을 하나씩 적어야 해 새 V3 를 손으로 더해야 했고 git mv·rm 도 못 봤다. Liquibase 는 체인지로그 고치기가 흔해 경로로 가를 수 없어 뺐다. 쓰기·셸 검사의 git 은 경로가 마이그레이션처럼 보일 때만 부른다(ls-tree 한 번). 폴더는 폴더째 지우거나 옮길 때(rm -r·git rm -r·mv·Remove-Item -Recurse)만 안을 다 보고, 폴더 「안으로」 복사·옮기기는 생길 파일 이름이 커밋한 마이그레이션과 같을 때만 막는다(덮어쓰기). 글롭은 커밋한 마이그레이션 이름에 맞춰 본다(`rm migrations/*.pyc` 는 통과, `*.py`·`V*` 는 막음) — 처음엔 폴더·글롭을 「안의 마이그레이션 전부」로 보아 `cp helper.py migrations/` 까지 막았다(독립 검토 2026-11-11). git add·commit 은 이 명령이 올리는 것만 이름으로 본다(작업 트리 이름 목록 한 번 — [decisions.md](decisions.md) 「보호 경로·마이그레이션 커밋 검사는 이 명령이 올리는 것만」), 있는 보통 파일만 이름으로 준 add 는 git 을 부르지 않는다. git pre-commit 훅에는 넣지 않는다 — 마이그레이션 합치기는 사람이 한다. `hooks/rules/migration.mjs`.
- migration-edit: 보내는 쪽 글롭은 지금 디스크에서 풀어 폴더 안에 생길 이름을 맞춘다(`cp -r tmp/* shop/migrations/` 가 커밋한 0001 을 덮어써도 지나가던 회귀 — 끝 낱말만, 한 폴더 4000개까지). `install` 은 cp 처럼 받는 쪽 폴더 안 이름으로(-m·-o·-g·-S 값은 빼고 -d 는 폴더 만들기). 마이그레이션 폴더를 품은 폴더째 지우기·옮기기(`rm -rf shop`·`git rm -r shop`·`Remove-Item -Recurse shop`)도 막는다 — 보호 경로와 같게. 있는 폴더를 -r 로 지울 때만 git ls-tree 를 한 번 더 부른다(rm -rf node_modules 도 한 번, 이 PC 에서 약 45ms).
- migration-edit: git 이 푸는 글롭(* 가 / 를 넘음)은 폴더 이름으로 거르지 않고, 앞부분이 빈 폴더·글롭(`git rm -r .`·`git rm "*"`)은 저장소 전체로 본다. 다른 커밋에서 폴더째 가져오기(`git checkout HEAD~1 -- shop/migrations`·`git restore --source HEAD~1 shop/migrations`·`git restore -s HEAD~1 -- shop`)는 `git diff --name-only <커밋> HEAD -- 폴더` 로 그 커밋과 HEAD 가 다른 커밋한 마이그레이션이 있을 때만 막는다 — checkout 은 그 커밋에 없는 파일을 두므로 내용이 다른 것(M)만, restore·`checkout --no-overlay` 는 지우는 것(HEAD 에만 있음, A)도. 파일 하나를 주는 꼴은 전처럼 커밋한 마이그레이션이면 막는다.
- 마이그레이션: migrations/<숫자>_<이름>.sql·.go(goose·golang-migrate·dbmate)를 migration-edit 이 본다. 감지는 go.mod 의 goose·golang-migrate 와 그 꼴의 파일(CLI 로만 쓰면 go.mod 에 없다) → 스택 「SQL migrations」. go.mod 의 pgx·lib/pq → PostgreSQL, go-redis → Redis.

### danger-cmd 의 DB 지우기 (역할극 1·4·5·8·9 회차, 2026-11-11)
- danger-cmd 는 DB 데이터를 통째로 지우는 명령도 막는다(compose down -v, docker volume rm, prisma migrate reset, db push --accept-data-loss, alembic downgrade base, manage.py flush, rails db:drop, dropdb, redis FLUSHALL, SQL 클라이언트에 넘긴 DROP·TRUNCATE). heredoc 으로 넘긴 SQL 은 못 본다. 역할극 1·4·5 회차에서 모두 통과했던 꼴(2026-11-11). 명령 조각마다 실제로 실행되는 도구일 때만 본다(npx·uv run·docker compose exec 같은 앞붙이는 벗김) — 처음엔 줄 전체에서 찾아 `grep "prisma migrate reset"` 같은 검색도 막았다(독립 검토 2026-11-11). 세 번째 검토로 timeout·xargs·watch, python -u·-X 값, bash 스크립트, docker run --gpus 같은 값, pnpm --filter·yarn workspace 도 벗긴다. 「--help」 만 도움말로 본다(-h 는 psql·dropdb·redis-cli 의 호스트). 두 번째 검토(2026-11-11)로: 앞붙이 벗기기를 `hooks/lib/run-prefix.mjs` 한 곳으로 — sudo -u 값, npx -y, pnpm·yarn·bun <도구>, bun x, npm exec --, docker run 이미지, compose run·exec(앞 -f 값 건너뜀), python -m django. 도움말(--help)은 막지 않는다.
- danger-cmd DB 지우기에 더함: `manage.py migrate <앱> zero`(·`migrate zero`, --plan·--fake 는 허용), `manage.py sqlflush` 를 파이프로 dbshell·psql·mysql·sqlite3 에 넘기기(| less·> 파일 은 보기만), `flyway clean`·`gradle(w) flywayClean`·`mvn(w) flyway:clean`, `celery purge -f·--force`. celery 는 -f 일 때만 — -f 없는 purge 는 확인을 묻고 Claude 의 셸은 답할 수 없어 그만두므로 막을 일이 아니다. `migrate <앱> 0003` 처럼 한 단계씩 되돌리기는 막지 않는다(alembic downgrade -1 과 같은 기준). 하지 않은 것: liquibase dropAll(이번 역할극에 나오지 않음).
- danger-cmd 의 통째 지우기·권한·디스크 꼴도 숨은 실행을 본다(다시 검토 2026-11-13: `` `rm -rf ~` ``·`find ~ -maxdepth 0 -exec rm -rf {} \;`·`Start-Process cmd -ArgumentList "/c","rd","/s","/q","C:\"` 가 지나갔다). 숨은 글(백틱·$(…)·파이프로 셸에 넘김)은 그대로, 앞붙이를 벗긴 낱말·find -exec·-delete 는 첫 낱말이 지우기·chmod·dd·mkfs·format 일 때만 이어 붙여 본다(echo 인자 속 글을 명령으로 읽지 않게). 숨은 실행은 맨 바깥 치환만 꺼내 한 겹씩 내려가고 결과를 기억한다 — 겹친 `$(echo $(echo …))` 에서 겹마다 다시 세어 100초가 걸렸다.

### 위험한 HTML·코드 실행: unsafe-html·python-unsafe (역할극 6·8·9 회차, 2026-11-11)
- unsafe-html 문구를 나눴다: eval·new Function 만 걸리면 코드 실행 안내(JSON.parse·이름→함수 표), HTML 만이면 textContent·DOMPurify, 섞이면 둘 다. 이름도 「위험한 HTML·코드 실행 차단」 — 서버 코드의 eval 에 화면 안내가 나와 화면 규칙으로 오해했다(6 회차 2차).
- 서버 템플릿 XSS 는 unsafe-html 이 본다: .html·.htm·.jinja·.jinja2·.j2·.njk 의 `{{ … }}`·`{% … %}` 안에 새로 넣는 `|safe`·`|safeseq`, `{% autoescape off %}`·`{% autoescape false %}`. `{# #}`·`{% comment %}` 속은 빼고(여러 줄도), HTML 주석 `<!-- -->` 속은 본다(서버가 그 안도 그린다). `||`(Vue·Angular 의 「또는」)·`|safeguard` 같은 비슷한 이름은 아니다. 찾은 것이 템플릿 꼴뿐이면 문구를 따로(format_html·escape·`{{ name }}`) — textContent·DOMPurify 는 브라우저 코드에만 맞는다. 허용 주석 `{# lint:allow unsafe-html 이유 #}` 의 `#}` 는 이유에서 뺀다. `hooks/lib/unsafe-html.mjs` templateHits, `hooks/lib/messages.mjs`.
- Python 쪽 `mark_safe(값)`·`csrf_exempt` 는 unsafe-html 이 아니라 python-unsafe 에 넣었다: 주석·글자를 가리는 Python 마스크(code-mask.mjs)가 그쪽에 있어 「괄호 안이 고정 글자뿐인가」를 정확히 본다(unsafe-html 은 JS 기준 줄 단위). python-unsafe 는 Python 스택이면 기본으로 켜지고, unsafe-html 은 JS·HTML 파일이 있을 때만 켜져 템플릿 없는 Django API 저장소에서 빠진다. 고정 글자만(`mark_safe("<br>")`, `_("…")` 로 감싼 것)은 허용, `mark_safe(escape(x))` 처럼 함수를 거친 값은 막는다(값이 섞였는지 정적으로 알 수 없음 — format_html 을 쓰거나 허용 주석). csrf_exempt 는 데코레이터·`csrf_exempt(view)`·`method_decorator(csrf_exempt, …)` 모두, 가져오기 줄(여러 줄 괄호 포함)은 아니다. 문구는 Django 꼴뿐이면 Django 안내(format_html·`{% csrf_token %}`), 섞이면 기본 문구 + 한 줄. 하지 않은 것: Flask·Jinja 의 `Markup(값)`(다른 라이브러리의 같은 이름 클래스와 구별이 안 됨).

### 그 밖의 정적 훅 경계 (2026-11-05·11-06·11-11)
- pin-deps 는 peerDependencies 를 보지 않는다(같이 쓸 수 있는 범위를 밝히는 자리). `npm install <패키지>` 명령은 보지 않는다 — save-exact 는 .npmrc·환경 변수·yarn·pnpm·bun 설정 어디서든 켤 수 있어서. `npm install` 로 들어간 범위는 커밋 때 package.json 으로 본다.
- gha-inject: 워크플로는 쓴 뒤 파일 전체를 보되 쓰기 전에 있던 것은 막지 않는다.
- MultiEdit 는 matcher 에서 뺐다(지금 도구 목록에 없음). `edits` 가 든 입력은 `normalizeInput` 이 받아 준다.
- protect-branch 글: origin 이 GitLab 이면(주소에 gitlab, origin 이 없으면 .gitlab-ci.yml·.gitlab/ — detect hostOf 와 같은 기준) 「PR」 대신 「MR(머지 리퀘스트)」(14 회차). .git/config 를 파일로 읽고, include 가 있거나 애매하면 git config 한 번. 막을 때만 본다. `hooks/rules/git.mjs` onGitlab.
- swift-unsafe 에 `NSLog(`(16 회차 — print 처럼 배포판 기기 로그에 남는다). func NSLog(·x.NSLog( 는 아니다.
- 커밋 형식 훅에 옵션 types(목록, 소문자 낱말): 저장소 기록이 쓰는 표준 밖 타입(bench: 등)을 기본으로 채운다 — 기록이 그 꼴인데 막았다(11 회차). 혼자 쓰는 조합도 기록이 70% 넘게 conventional 이면(5개 넘게) 커밋 형식 검사를 켜고 기록의 언어·타입을 따른다. `hooks/rules/message.mjs`, `scripts/detect.mjs` historyOf, `scripts/lib/catalog.mjs`.

### prefer-gh 는 막지 않고 알린다 (사용자 승인, 2026-11-09)
- 결정: WebFetch 로 github.com 을 열면 막지 않고 Claude 문맥에 「gh 로 읽는 편이 낫다」 한 줄(PreToolUse `additionalContext`). 규칙에 `notice: true` 를 달면 판정이 막는 글 대신 hints 로 모으고 run.mjs 가 additionalContext 로 낸다.
- 이유: 막으면 gh 가 없거나 로그인하지 않은 PC 에서 GitHub 를 아예 못 읽는다.
- 어디서: `hooks/run.mjs`, `catalog/packs.json`

### 지난 세션 작업 폴더 쌓임은 세션 시작 때 하루 한 번 알린다 (사용자가 고르기를 맡김, 2026-11-10)
- 사례: 세션들이 Temp\claude 에 남긴 venv·캡처 프레임·브라우저 프로필이 112만 개·156GB가 됐다. 윈도는 로그인 때 사용자 프로필 서비스가 Temp 를 끝까지 훑어서 로그인이 6분 걸렸다(Procmon 으로 확인, naver-fa 세션 조사).
- 결정: notice 훅 stale-scratch. SessionStart 때 하루 한 번 `<os.tmpdir()>/claude` 의 지난 세션 폴더(프로젝트 지문 폴더 아래 세션 폴더, 그 밖의 바로 아래 폴더)를 보고, 3일 넘게 손대지 않은 것이 20개 넘거나 그중 venv(pyvenv.cfg)·node_modules·브라우저 프로필(Local State)·캡처(한 폴더에 그림 500개 이상)가 든 것이 있으면 Claude 에게 알려 사용자에게 지울지 묻게 한다. 지우지는 않는다. 지금 세션 폴더는 뺀다. 「venv 는 Temp 말고 고정 위치에 하나」 조언은 알림 글에 넣는다. 어느 조합도 기본으로 켜지 않는다(개인 습관 훅).
- 크기를 재지 않는 이유: 이 PC 에서 1만 개를 세는 데 1.75초. 100만 개면 몇 분이라 세션 시작을 막는다. 이름·날짜와 깊이 2까지만, 0.4초 한도 안에서 본다(이 PC 진짜 Temp 에서 34ms).
- 하지 않은 것: Stop 때 되묻기(답마다 돌아 세션이 끝났는지 모르고, 아직 쓰는 venv 를 지우게 할 수 있다) · 자동 삭제(결과물이 스크래치에 있을 수 있고, 지우기는 사람이 정한다) · CLAUDE.md 지침 줄(모든 세션에 토큰이 들고 필요한 사람은 일부 — 쌓였을 때 알림이 같은 말을 한다. 구조 지침은 3줄로 줄여 둔 결정도 있다).
- 어디서: `hooks/rules/scratch.mjs`, `catalog/packs.json`, 시험 `hooks/test/strict-cases/events.mjs`·`hooks/test/scratch.test.mjs`

### 받아 넣은 스킬 파일과 사람이 올린 보호 경로 (역할극 2·5 회차와 검토, 2026-11-11)
- 받아 넣은 스킬의 파일은 받을 때 해시를 .harness-source.json files 에 남기고, 받은 그대로인 파일은 커밋 때 코드 검사(unsafe-html·file-size·언어별·pin-deps)에서 뺀다 — brainstorming 의 helper.js 를 자기 훅이 막아 적용 결과를 커밋하지 못했다(5 회차 2차). 비밀값·.env 검사는 그대로, 받은 뒤 고친 파일은 다시 본다. `scripts/lib/install-skill.mjs`, `hooks/rules/commit.mjs` withoutVendored.
- 받아 넣은 스킬 건너뛰기는 harness.json selection.skills 에 있고 출처 기록의 저장소·커밋이 카탈로그와 같을 때만(아무 폴더에 출처 기록을 써서 코드 검사를 피할 수 있었다). 줄 끝(autocrlf)만 다른 것도 같은 파일로 본다. 좁혔을 뿐 닫지는 않았다 — 고른 스킬의 출처 기록에 파일 해시를 일부러 꾸며 넣으면 여전히 빠진다(받은 파일 목록을 확인할 길이 커밋 때는 없다, 여섯 번째 검토). 이 검사는 Claude 의 실수를 잡는 것이고 일부러 피하는 것까지 막는 장치는 아니다.
- 사용자가 보호한 경로(옵션 paths)는 커밋 때 보지 않는다 — Claude 가 쓰는 것은 쓰는 순간에 막고, git 훅은 사람이 고친 값을 커밋하는 것과 구별하지 못해 사람의 커밋까지 막았다(2 회차 2차, -n 필요). 커밋 때는 .env·키 파일만.
- 다만 Claude 가 만드는 커밋이 새로 넣는 .gitignore 파일은 막는다(16 회차, 2026-11-13 — 보고 틀림으로 회차 실패): git add -f 로 올린 Config/Secrets.xcconfig·.cer·.provisionprofile 이 git 훅을 지나 커밋됐고, 화면 문구는 「커밋하지 못해요」라고 했다. Claude 의 커밋인지: PreToolUse 는 늘, git 훅은 Claude Code 가 셸에 붙이는 CLAUDECODE 환경 변수로. 무시 여부는 `git check-ignore --no-index`(새 파일이 있는 커밋에서 한 번 — git-calls 시험 한도를 4→5). 이미 추적 중인 파일을 고친 커밋, 사람의 커밋은 그대로라 2 회차 헛막음과 부딪히지 않는다. 사람이 미리 -f 로 올린 무시 파일도 Claude 가 커밋하면 막는다(-f 로 억지로 넣은 것이라). 지정 경로는 여기서 보지 않는다 — add 때 이미 막고, 사람이 stage 한 보호 경로는 두기로 한 결정 그대로. add 때 지정 경로 맞추기는 protectedBy 로 바꿨다(.cer 이 먼저 file.key 로 잡혀 `*.cer` 을 적어도 add 가 지나가던 일). 화면 옵션 문구도 이에 맞춤. `hooks/rules/commit.mjs` claudeNewFiles, 시험 `hooks/test/commit-new.test.mjs`·`strict-cases/ios-review.mjs`.
  - 새 파일은 모두 본다(독립 검토 2026-11-13: 앞 2000개만 보아 새 파일 2100개 뒤에 숨긴 무시 파일이 지나갔다). check-ignore --stdin 한 번이라 3만 개에 5초 남짓 — 한도를 두지 않았다. CLAUDECODE 는 있기만 하면(0·false·빈 값도) Claude 다 — 0·false 를 사람으로 보니 `CLAUDECODE=0 git commit`·`CLAUDECODE=0 make release` 가 검사를 피했다(다시 검토 2026-11-13). PreToolUse 는 늘 Claude 라, 명령줄에서 CLAUDECODE 를 바꾸거나 지우는 꼴(`CLAUDECODE=…`·`unset`·`env -u`·`$env:CLAUDECODE =`·`Remove-Item Env:`, 같은 명령이 커밋하는 `env -i` — git commit 이나 ask-cmd 묻기·막기 목록의 make 목표)은 값과 상관없이 막는다(`commit.mjs` claudeTamper, 문구 commit.claudeEnv). 새 파일 이름이 `:!x`·`:(glob)y` 같은 pathspec 마법 꼴이면 check-ignore 가 128 로 끝나 결과가 비어 `git add -f` 한 Config/Secrets.xcconfig 가 지나갔다 — 경로 앞에 `./` 를 붙여 마법으로 읽지 않게 하고(`--literal-pathspecs` 는 check-ignore 가 받지 않는다 — git 2.55 에서 확인), 그래도 실패하면 파일마다, 그것도 실패하면 Claude 의 커밋은 막는다(문구 protected.commitNewUnchecked). 문구는 「.gitignore 나 exclude 파일」(info/exclude·core.excludesFile 도 무시 목록이다).
- 되돌리기: 적용 뒤 .git/hooks/pre-commit 에 우리 표시가 없으면(팀원의 pre-commit install·Husky) 지우지 않고 `kept` 로 알린다 — 전에도 지우지 않았지만 「믿을 수 없는 백업」(skipped)과 같은 칸이라 세션이 이유를 잘못 말했다. pre-commit 프레임워크가 옮긴 `pre-commit.legacy`(우리 실행기)도 kept 에 적는다(설정이 사라지면 아무것도 막지 않는다). `scripts/lib/backup.mjs` undoGitHook(15 회차).

### 평소 명령 1,002개로 찾은 헛막음 (다섯째 검토, 2026-11-13)
옛(b0d178b)·새 훅에 같은 명령 묶음을 넣어 견줬다. 결정이 바뀐 24건은 모두 아래 고친 것이고, 나머지는 글만 바뀌었다(아래 알림·git clean 수).
- 있는지 확인한 .env 처음 만들기는 둔다: `if [ ! -f .env ]; then cp …; fi`·`if [ -f .env ]; then …; else cp …; fi`·`[ -f .env ] || cp …`·`test -e .env || …`·`[ -f .env ] && … || cp …`·`if (-not (Test-Path .env)) { Copy-Item … }`·`if (!(Test-Path .env)) { … }`. 같은 경로를 확인하고 그 쓰기가 「없을 때만」 구간 안일 때만 예시 파일 처음 만들기(이미 있던 결정)로 친다 — 앞 명령 결과가 섞인 꼴(`x && [ -f .env ] || …`)·겹친 if·숨은 실행 속은 아니다. 빈 `New-Item .env`(-Value 없음)는 .env 일 때 확인 구간 안에서만. 막는 글이 권하던 「Test-Path 로 먼저 확인」 이 막혀 글과 동작이 어긋났다. `hooks/lib/exist-guard.mjs`, `rules/protected-shell.mjs`, 문구 protected.overwrite.
- `env -i` 는 같은 명령이 커밋할 때만 막는다: git commit(`git -c … commit`·`bash -c "…"` 속도) 또는 ask-cmd 묻기·막기 목록의 make 목표. `env -i PATH="$PATH" make test` 는 둔다. 규칙이 다른 규칙의 옵션을 보려고 판정 문맥에 `rules`(켠 규칙 전체)를 더했다. `rules/commit.mjs` commitsHere, `lib/pretool.mjs`.
- `kubectl rollout status·history` 는 보기라 묻지 않는다(restart·undo·pause·resume 은 묻는다). 원격 묻기도 도움말 보기(`--help`·`-help`·`-h`·`--version`)는 묻지 않는다 — 묻기 목록과 같은 justLooking 에 terraform 의 `-help` 를 더해 함께 쓴다. ssh 계열과 `--` 뒤(kubectl exec … -- x --help)는 그 도움말이 원격 명령의 것이라 뺀다. `lib/remote-cmd.mjs`, `lib/ask-match.mjs`.
- 명령줄 비밀번호의 접속 주소: 이 PC 주소(localhost·127.*·[::1]·0.0.0.0·host.docker.internal)는 두고, 점 없는 호스트(compose 서비스 db·postgres)는 아이디가 든 개발 기본값일 때만 둔다 — 비밀값 훅과 같은 기준(`lib/secrets.mjs` devUrlLogin). 밖의 주소는 값이 무엇이든 막는다.
- PowerShell `@'…'@` 메시지는 글자 그대로 읽는다(`$(pwd)` 가 들어도). `@"…"@` 는 그대로 「못 읽음」. `rules/message.mjs`.
- `git clean` 은 같은 인자로 `git clean -n` 을 시켜 실제로 지울 것만 센다(-i 는 뺌). 저장소 전체 status 를 세어 `git clean -fd dist` 가 「2개를 버린다」 고 막혔다(추적 중인 파일의 변경은 clean 이 건드리지 않는다). `-fdx` 의 수는 git 이 지울 항목 수로 바뀐다(5 → 8). git 을 못 부르면 예전처럼 status 로. `rules/shell.mjs` discardChanges.
- 백틱·`$( )`·따옴표 없는 heredoc 속 치환에서 걸리면 막는 글·묻는 글에 「셸이 실제로 실행한다, 글로 남기려면 '…'·<<'EOF'(PowerShell 은 @'…'@)」 를 덧붙인다(문구 hidden.subst·hidden.substPs) — 커밋 메시지 자체가 막힌 줄 알았다. 막기·묻기·danger-cmd·파일 보호·못 읽은 커밋 메시지. 파이프로 넘긴 글(echo … | bash)에는 붙이지 않는다. `lib/hidden-runs.mjs` substNote.
- 시험: `hooks/test/review5.test.mjs`, `strict-cases/block-review4.mjs`.

### Vercel 운영 배포 묻기 (역할극 13 회차 4차, 2026-11-13)
- `vercel --target production`(`=production` 도, deploy 앞뒤 상관없이)과 `vercel redeploy` 를 Vercel 기본 묻는 명령에 더했다. `--target preview` 는 묻지 않는다. `catalog/combos.json`, 시험 `strict-cases/gaps.mjs`.
- unsafe-html 설명은 「정화 함수를 거치면 통과」 를 맨 앞과 알아 둘 점에 둔다 — 긴 글 끝에 묻혀 세션이 「새로 넣으면 어디서나 막힌다」 고 적었다. 실제 동작: innerHTML 은 넣는 값이 모두 감싸일 때, dangerouslySetInnerHTML 등은 같은 줄에 정화 함수가 있을 때(미리 정화한 변수만 넣으면 막힘).

## 이미 있는 훅과의 겹침

### 이미 있는 훅과 겹치면 끈다 (사용자 요청·선택, 2026-11-05)
- 결정: 기존 훅(전역·프로젝트 settings, 켜진 플러그인)에 테스트 입력을 실제로 넣어, block 을 다 막고 pass 를 다 통과시키면 같은 훅으로 보고 harness-fit 쪽을 끈다. 같은 때(PreToolUse·Stop·SessionStart·UserPromptSubmit)끼리만 견주고 PostToolUse 는 셈하지 않는다.
- 이유: 이름·코드로 짐작하는 것보다 정확(사용자 선택). PostToolUse 를 같게 보면 쓰기 전 차단이 꺼져 더 약해진다. 테스트는 임시 저장소·임시 홈에서(사용자 설정 폴더에 아무것도 남기지 않게), 저장소 쪽 훅은 Claude Code 안에서만(폴더 신뢰 확인을 건너뛰지 않게).
- 어디서: `catalog/probes.json`, `scripts/lib/existing-hooks.mjs`, `scripts/lib/probe-run.mjs`, `scripts/test/probe-isolation.test.mjs`

### 겹침 시험 결과는 캐시하고, 첫 시험은 함께 돌린다 (전체 검토, 2026-11-13)
- 결정: 결과를 `<설정 폴더>/harness-fit/probe-cache.json`(CLAUDE_CONFIG_DIR → ~/.claude)에 둔다. 열쇠는 시험한 훅마다 범위·때·matcher·명령·args·timeout·플러그인과 명령에 적힌 절대 경로 파일의 내용(JS 는 상대 import·require 를 따라간 파일까지, 1MB 넘는 실행 파일은 크기·시각), probes.json 내용, 플러그인 버전, 시험 코드, Node·OS 의 해시 — 하나라도 바뀌면 다시 시험한다. 7일이 지나도 다시(훅이 따로 읽는 설정 파일은 못 따라가서). 최근 8개만, 임시 파일에 쓰고 이름을 바꿔 한 번에, 깨진 파일·꼴이 틀린 항목은 빈 캐시로. 시간이 넘은 훅이 있던 시험은 담지 않는다. 첫 시험은 한 자리의 훅들을 함께 돌리고(훅 프로세스는 전체에서 코어 수만큼, 2~8), 자리마다 git 을 열 번 부르는 대신 한 번 만든 저장소를 복사한다. 시간이 넘어 끝내는 중인 훅이 시험 폴더를 쥐고 있으면 Windows 에서 지우기가 EPERM 으로 터져 시험 전체가 「확인 못 함」이 되던 것도 고쳤다(몇 번 다시 해 보고 남겨 둠, `removeDir`).
- 이유: `/harness-fit:setup auto` 가 이 PC 의 전역 훅 13개 × 시험 입력 68개를 차례로 돌려 15~46초 기다렸다. clickstream-pipeline 복사본에서 `recommend.mjs` 가 26.7초 → 첫 실행 15.5초, 두 번째부터 1.8초(감지만 남음 — 다른 작업이 함께 도는 PC 에서 번갈아 세 번씩 잰 가운데값). 출력 JSON 은 전과 같다. 담는 것은 겹침 결과(스크립트 이름·범위·플러그인 id)뿐 — 시험 입력은 만든 값이고 명령·경로도 담지 않는다.
- 하지 않은 것: 훅마다 따로 캐시(체크리스트 시험은 세션 시작 훅에 따라 달라 열쇠가 얽힌다 — 훅 하나를 고치면 전부 다시 시험한다). 훅이 읽는 설정·로그 폴더 전체를 지문에 넣기(전역 hooks/logs 처럼 돌 때마다 바뀌는 폴더가 있어 캐시가 늘 빗나간다).
- 어디서: `scripts/lib/probe-cache.mjs`, `scripts/lib/existing-hooks.mjs`, 시험 `scripts/test/probe-cache.test.mjs`

### 겹침 판단의 예외
- 테스트 입력은 GitHub Flow 옵션 기준이라, 다른 브랜치 전략에서는 protect-branch·branch-name 을 겹침으로 보지 않는다(덜 막는 쪽으로 틀리지 않게, `PROBE_FLOW`).
- 팀원 공유를 켜면 이 PC 에만 있는 것(전역)은 겹침으로 보지 않는다. 서버와 화면이 같은 `picker/dup.js` 를 쓴다.
- 기존 훅이 막아 주는 것은 지침 글에서 「켜짐」으로 친다.
- 팀원 공유면 목록에서 못 찾은 이름(Claude 가 --similar 로 짚은 이 PC 의 스킬)도 겹침으로 치지 않는다. `picker/dup.js`.

## 바뀐 이력
- 2026-11-13: 다섯째 검토(평소 명령 1,002개) 헛막음 — 확인한 .env 처음 만들기, 커밋 없는 env -i, rollout status·history, 원격 도움말, 이 PC 주소 비밀번호, @'…'@ 메시지, git clean 경로, 숨은 실행 알림. 역할극 13 회차 4차 — Vercel --target production·redeploy 묻기, unsafe-html 설명 앞에 예외.
- 2026-11-13: 다시 한 독립 검토와 역할극 16 회차 다시 매기기 — 적은 명령의 -h 를 도움말로 센 회귀, xargs 뒤 옵션·대상, 무시 파일 검사의 pathspec 마법 이름(못 보면 막음), CLAUDECODE 는 있으면 Claude·명령줄에서 바꾸면 막음, 셸 쓰기·danger-cmd 도 앞붙이·숨은 실행, 앞붙이·숨은 실행 더함, 태그 올리기 막기·이름 붙인 태그·push.followTags, 예시 파일, HEAD 에서 되돌리기는 묻기, 알려진 한계 정리.
- 2026-11-13: 독립 검토 반영 — 비밀값 거르개 제곱 시간, 막기는 시험 실행 표시 무시·숨은 실행(백틱·파이프·find -exec·Start-Process…)·글 하나 block, 비밀값 읽기·도구 이름만 적은 묻기, 무시 파일 검사는 새 파일 전부·CLAUDECODE=0, .cer 빼기, JDBC·파일 DB, plist·python·ruby 쓰기 꼴.
- 2026-11-13: 역할극 13~16 회차 훅 쪽 — ask-cmd 막기(block), 읽기 kubectl·helm, make 변수=값, 운영 마디 주소 goose, vercel alias, GitLab MR 글, 낙타 …Key 비밀값, Claude 커밋의 무시 파일·.cer·.provisionprofile, plist 도구 쓰기, 빌드 번호 올리기·match --readonly false·프로필 폴더 지우기 묻기, NSLog, 되돌리기 kept.
- 2026-11-13: 「xcrun」 만 적은 묻는 명령이 다시 맞게, fastlane 전역 옵션 뒤의 run 도 맞춤(두 번째 독립 검토).
- 2026-11-13: ask-cmd 맞추기에 xcrun 앞붙이·fastlane run <동작>.
- 2026-11-13: decisions.md 에서 훅 원칙·훅별 결정을 떼어 만듦. 역할극·검토 회차별 목록을 훅마다 묶고, 뒤집히거나 합쳐진 줄은 decisions-archive.md 「2026-11-13 정리 때 옮긴 것」으로.
- 2026-11-13: ROS 2 의 `ros2 run` 은 묻지 않기로(사용자 결정).
