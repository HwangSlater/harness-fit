# 결정

> 최종 수정: 2026-11-09 · 지금 유효한 결정만, 분야별로. 옛 결정·원문은 [decisions-archive.md](decisions-archive.md)

한 항목은 제목 줄 + 결정 · 이유 · 어디서. 「사용자 결정」·「사용자 승인」·「사용자 요청」 표시가 있는 것은 사용자가 정했으니 바꾸기 전에 묻는다. 긴 근거·측정값·옛 이름은 archive 의 원문에 있다.

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
- 어디서: `picker/hook-options.js`, `scripts/test/hook-options.test.mjs`

### 전역 훅에서 옮긴 훅 7개 (사용자 결정, 2026-11-06 · 기본값은 2026-11-09 사용자 승인으로 바뀜)
- 결정: 100% 잡는 것만 옮겼다 — squash-push, commit-hash, swift-unsafe·python-unsafe(그 스택일 때), work-checklist(막지 않음), docs-check. answer-lang 은 짐작이지만 놓쳐도 위험하지 않아 옵션(ko·en·ja·zh).
- 기본값: swift-unsafe·python-unsafe 만 그 스택일 때 켠다. squash-push·commit-hash·work-checklist·docs-check·answer-lang 은 모든 조합에서 기본 꺼짐(고를 수는 있음) — 아래 「조합 기본값을 저장소에 맞춘다」.
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

### prefer-gh 는 막지 않고 알린다 (사용자 승인, 2026-11-09)
- 결정: WebFetch 로 github.com 을 열면 막지 않고 Claude 문맥에 「gh 로 읽는 편이 낫다」 한 줄(PreToolUse `additionalContext`). 규칙에 `notice: true` 를 달면 판정이 막는 글 대신 hints 로 모으고 run.mjs 가 additionalContext 로 낸다.
- 이유: 막으면 gh 가 없거나 로그인하지 않은 PC 에서 GitHub 를 아예 못 읽는다.
- 어디서: `hooks/run.mjs`, `catalog/packs.json`

### 정적 훅의 경계 (2026-11-05·11-06)
- pin-deps 는 peerDependencies 를 보지 않는다(같이 쓸 수 있는 범위를 밝히는 자리). `npm install <패키지>` 명령은 보지 않는다 — save-exact 는 .npmrc·환경 변수·yarn·pnpm·bun 설정 어디서든 켤 수 있어서. `npm install` 로 들어간 범위는 커밋 때 package.json 으로 본다.
- gha-inject: 워크플로는 쓴 뒤 파일 전체를 보되 쓰기 전에 있던 것은 막지 않는다.
- MultiEdit 는 matcher 에서 뺐다(지금 도구 목록에 없음). `edits` 가 든 입력은 `normalizeInput` 이 받아 준다.

### 이미 있는 훅과 겹치면 끈다 (사용자 요청·선택, 2026-11-05)
- 결정: 기존 훅(전역·프로젝트 settings, 켜진 플러그인)에 테스트 입력을 실제로 넣어, block 을 다 막고 pass 를 다 통과시키면 같은 훅으로 보고 harness-fit 쪽을 끈다. 같은 때(PreToolUse·Stop·SessionStart·UserPromptSubmit)끼리만 견주고 PostToolUse 는 셈하지 않는다.
- 이유: 이름·코드로 짐작하는 것보다 정확(사용자 선택). PostToolUse 를 같게 보면 쓰기 전 차단이 꺼져 더 약해진다. 테스트는 임시 저장소·임시 홈에서(사용자 설정 폴더에 아무것도 남기지 않게), 저장소 쪽 훅은 Claude Code 안에서만(폴더 신뢰 확인을 건너뛰지 않게).
- 어디서: `catalog/probes.json`, `scripts/lib/existing-hooks.mjs`, `scripts/lib/probe-run.mjs`, `scripts/test/probe-isolation.test.mjs`

### 겹침 판단의 예외
- 테스트 입력은 GitHub Flow 옵션 기준이라, 다른 브랜치 전략에서는 protect-branch·branch-name 을 겹침으로 보지 않는다(덜 막는 쪽으로 틀리지 않게, `PROBE_FLOW`).
- 팀원 공유를 켜면 이 PC 에만 있는 것(전역)은 겹침으로 보지 않는다. 서버와 화면이 같은 `picker/dup.js` 를 쓴다.
- 기존 훅이 막아 주는 것은 지침 글에서 「켜짐」으로 친다.

## 고르기 화면

### GitHub 바탕, 한 화면에 질문 하나 (사용자 결정, 2026-11-06)
- 결정: 바탕은 시안 A(GitHub Marketplace). 6단계, 단계마다 주소(#)·뒤로 가기, 위쪽 단계 탭 + 오른쪽 요약 카드로 아무 단계로나 간다. 스킬·훅은 칩으로 바로 켜고 끄고, 넓은 「전체 보기」 창 하나(약 1040px, 휴대폰은 아래에서 올라오는 판)를 같이 쓴다.
- 이유: 긴 한 쪽은 오가기 불편했다(「왔다갔다 편하게」).
- 어디서: `picker/steps.js`, 디자인 정본 `Downloads/find-your-skill-시안/리뉴얼/DESIGN.md`(승인 시안 A2-6)

### 글꼴은 Spoqa Han Sans Neo (사용자 결정, 2026-11-06)
- 이유: 국내 서비스에서 널리 쓰고 AI 화면에 흔하지 않다. SIL OFL.
- 어디서: `picker/fonts/`(한글 2,350자 woff2 3벌, 서버가 바이트로 낸다)

### 화면이 약속한 것 = 실제 결과 (사용자 요청 「전부 고치기」, 2026-11-02)
- 결정: 브랜치 전략은 flows 의 `hooksOn`/`hooksOff` 로 훅을 실제로 켜고 끈다(서버 `applyFlow`·화면 `pickFlow` 가 같은 데이터). 정하지 않음 → protect-branch·branch-name·pr-merge 끔. Git Flow → pr-merge 끔. 트렁크 → branch-name·pr-merge 끔, protect-branch 는 `allowCommit`(바로 커밋 허용, 강제 푸시·원격 지우기는 막음).
- 지침 미리 보기는 적용과 같은 기준(플러그인이 없으면 「훅 꺼짐」 글).
- 어디서: `catalog/packs.json` flows, `scripts/lib/catalog.mjs`, `picker/steps.js`

### 브랜치 전략 카드는 git 그래프 그림 (사용자가 시안 1안 고름, 2026-11-09)
- 결정: GitHub 네트워크 그래프처럼 채운 점 + 3px 선 + 갈래 색(main 파랑·develop 보라·feature 초록·release 노랑, `--branch-*` 토큰). 범례 대신 갈래마다 작은 이름(main·develop·feature·release·v1.0)을 그림 안에, hotfix 는 뺐다. Git Flow 의 release 는 develop 에서 나와 한 점에서 main(v1.0)과 develop 으로 갈라져 들어간다. 비율을 지켜 최대 280px, 고름은 카드 테두리로만. release 노랑은 흰 바탕 글자 대비를 위해 #9a6700.
- 어디서: `picker/flow-art.js`

### 쉬운 이름과 「언제 쓰나」 (2026-11-02)
- 결정: 영어 id·전문 용어 대신 쉬운 이름을 보인다.
- 이유: 1차 화면이 「무슨 뜻인지 모르겠다」는 지적을 받았다.
- 어디서: `catalog/titles.json`

### 스킬·훅마다 쉬운 한 줄과 「알아 둘 점」 (사용자 요청, 2026-11-09)
- 결정: 스킬 81개 모두 `effect`(무엇이 달라지나, 한 문장)를, 실제 대가가 있을 때만 `downside`(알아 둘 점)를 한·영으로 둔다(76개, 근거 있는 대가가 없는 5개는 비움 — 지어내지 않는다). 훅 23개 모두 `downside`(헛막음·늘어나는 단계·알림 훅의 토큰)를 두고, 넘기는 방법(옵션·`lint:allow`)을 같이 적는다. 기술 낱말만 늘어놓던 훅 `desc` 12개를 풀어 썼다.
- 꼴: 해요체, 홍보 낱말 없음, 피할 수 없는 기술 낱말은 같은 문장에 괄호로 풀이. 토큰 수는 글에 적지 않고 `{onUse}` 자리로 두어 화면이 catalog.json 값으로 채운다. 글 속에서 가리킨 「이름」은 실제로 있어야 한다(테스트).
- 화면: 전체 보기 창의 스킬 줄은 effect → 「쓰는 때」 → 토큰·출처 → 「알아 둘 점」, 훅 줄은 설명 → 차단하는 때 → 「알아 둘 점」. 알아 둘 점은 흐린 글 + 작은 이름표(경고 색 아님 — 위험 알림이 아니라 고를 때 볼 사실). 칩의 풍선 글도 effect.
- 이유: 「용어가 어려워 못 알아들을 것 같다, 이런 효과가 있다고 짧게, 단점이 있으면 그것도」.
- 어디서: `catalog/titles.json`, `catalog/packs.json`, `scripts/test/explain.test.mjs`

### 무엇이 스킬·훅·지침으로 들어가는지 늘 보이게 (사용자 지적, 2026-11-02)
- 결정: 단계 머리에 들어가는 곳(`.claude/skills/`·`.claude/harness.json`·`CLAUDE.md`)을 적고, 확인 창·끝 화면·터미널 보고를 종류별 묶음으로 낸다. 훅처럼 들리던 스킬 이름은 「커밋 전 검사 도구 설치」로.
- 어디서: `picker/changes.js` 의 `changeGroups`, `picker/steps.js`

### 조합은 일하는 방식 4개, 스택은 자동
- 결정: 가볍게·혼자 빠르게·팀 협업·꼼꼼하게. 스택별 스킬·언어별 훅은 감지 결과로 더한다. 가볍게는 「안전장치만」.
- 이유: 스택마다 조합을 만들면 고를 것이 너무 많아진다.
- 어디서: `catalog/combos.json` 의 `stackAddons`, `expandCombo`

### 조합 기본값을 저장소에 맞춘다 (검토 뒤 사용자 승인, 2026-11-09)
- 개인 습관 훅은 기본 꺼짐: commit-hash·work-checklist·docs-check 를 모든 조합에서 뺐다(고를 수는 있음). 커밋 해시·체크리스트는 업계 관례가 아니라 개인 습관이고 체크리스트는 Claude Code 할 일 목록과 겹친다. 문서 형식 검사는 제목·날짜 줄·목차까지 막아 엄격하다.
- 형식 훅은 저장소가 이미 그 꼴일 때만: `scripts/detect.mjs` 가 merge 아닌 최근 커밋 제목 30개와 로컬·원격 브랜치 이름을 읽고(`history`), `fitOff` 가 commit-msg 훅과 같은 정규식으로 70% 미만이면 commit-msg 를, 브랜치 전략마다 그 꼴로 main·master·develop·기본 브랜치를 뺀 이름이 70% 미만이면 branch-name 을 기본에서 뺀다. 커밋 5개·브랜치 3개 미만이면 새 저장소로 보고 켠다. 훅 단계·auto 보고에 뺀 이유 한 줄. 사용자가 켜면 그대로 켜진다.
- pin-deps 는 꼼꼼하게에서만, 라이브러리 패키지는 뺀다: `main`·`exports`·`types`·`typings` 가 있고 `private: true` 가 아니면 라이브러리. 라이브러리가 정확한 버전으로 고정하면 쓰는 쪽에 같은 패키지가 여러 벌 깔리고 보안 패치도 못 받는다. 앱도 고정은 팀 취향이라 팀 협업 기본에서 뺐다.
- 이유: 안 따르는 저장소에 켜면 첫 커밋·첫 브랜치부터 막혀 「도구가 고장 났다」로 읽힌다.
- 어디서: `scripts/lib/catalog.mjs` 의 `fitOff`·`fitDropped`, `scripts/detect.mjs`, `hooks/rules/message.mjs` 의 `CONVENTIONAL`, `scripts/test/defaults.test.mjs`

### 권장 기준 (2026-11-02, 일부 사용자 결정 2026-11-06)
- 결정: 최근 6개월 커밋한 사람이 2명 이상이면 팀 협업 + GitHub Flow, 아니면 혼자 빠르게. develop 브랜치가 있으면 Git Flow. 혼자 쓰는 저장소는 브랜치 전략 「정하지 않음」(사용자 결정).
- 이유: 「커밋 3개 미만 → 가볍게」는 뺐다 — 새 사용자는 새 저장소에서 시작하는 경우가 많다.
- 어디서: `catalog/combos.json` 의 `recommend`, `scripts/lib/catalog.mjs`, `scripts/detect.mjs`

### 빈 저장소는 먼저 묻는다 (사용자 요청, 2026-11-02)
- 결정: 스택을 알 파일이 없으면(`thin`) 화면을 열기 전에 기본 조합으로 갈지·무엇을 만드는지 묻는다. 답은 `--stack`(`KNOWN_STACKS` 에 있는 이름만)·`--team` 으로 넘긴다. 설명은 늘 받지 않는다.
- 이유: 저장소에 있는 정보를 다시 묻지 않으려고.
- 어디서: `skills/setup/SKILL.md`, `scripts/detect.mjs`

### 다시 열면 지난번 선택에서 시작 (사용자 결정, 2026-11-06)
- 결정: harness.json 에 `selection`·`known` 을 남기고 다음에 그것에서 시작한다. 켠 훅과 옵션은 `rules` 가 정본. 새로 생긴 것은 꺼진 채 「새로 생김」. auto 도 같고 `--fresh` 면 새 권장. v0.2.2 이하 파일은 조합 기본값으로 채운다.
- 어디서: `scripts/lib/picker-state.mjs`, `scripts/apply.mjs`

### 조합을 바꾸면 「이전 선택으로 돌리기」 (2026-11-02)
- 결정: 조합·권장으로 되돌리기를 누르면 직접 고친 것이 사라지므로 되살릴 단추를 띄운다. 브랜치 전략 때문에 바뀐 훅은 조합 기본값과 견주어 누적으로, 1단계 브랜치 전략 카드 바로 아래에 알린다.
- 어디서: `picker/steps.js` 의 `flowNote`, `picker/app.js`

### 적용은 확인 단계에서만, 브랜치 전략이면 팀원 공유를 묻는다 (사용자 결정, 2026-11-06)
- 결정: 요약 카드의 단추는 확인 단계로 데려갈 뿐이다. 브랜치 전략을 정했으면 「팀원도 같은 훅을 쓰게 할까요?」에 답해야 적용 단추가 풀린다. 「네」면 팀원이 할 일을 적용 전·후와 결과 JSON(`teammates`)에 낸다.
- 이유: 브랜치 전략은 팀이 함께 지켜야 뜻이 있다.
- 어디서: `picker/review.js`·`picker/team.js`(문구 `teamQ`), 결과 JSON 은 `scripts/picker.mjs`

### 확인 단계 알림은 한 줄 + 「자세히」 (사용자 승인, 2026-11-09)
- 결정: 확인 단계 알림(git 훅이 이미 있음·플러그인 없음·.claude 가 무시됨·settings 깨짐·스킬 목록 한도·팀원 안내)은 제목 한 줄(한도는 「한도의 n%」와 「권장대로 줄이기」 단추까지)만 보이고 나머지는 「자세히」(aria-expanded, 펼친 상태는 `ui.open` 이라 다시 그려도 유지)로 편다. 지운 정보는 없다.
- 이유: 알림이 여럿 겹치면 설명 글이 화면을 덮었다.
- 어디서: `picker/review-notes.js`

### 지침 줄은 눌러서 작은 창 (사용자 요청, 2026-11-09)
- 결정: 지침 단계 줄의 제목·설명 칸을 단추로, 누르거나 Enter·Space 로 md 넓이(`--dlg-md-w` 560px, 좁은 화면은 아래에서 올라오는 판) 창을 연다 — 설명 전체(「이 저장소 명령」은 찾은 명령), CLAUDE.md 에 넣을 줄과 훅·스킬이 맡아 뺀 줄(미리 보기와 같은 /api/preview 글), 줄 수·토큰, 켜고 끄기 스위치. 줄의 스위치는 창을 열지 않는다. 꺼진 지침은 넣을 줄을 서버가 만들지 않으므로 「켜면 여기에 보여 줘요」.
- 이유: 「지침 설명이 …로 잘려 못 읽는다, 누르면 작은 창으로」.
- 어디서: `picker/rule-dialog.js`

### 겹침 이름표를 눌러 그 대상을 본다 (사용자 요청, 2026-11-09)
- 결정: 같은 묶음 스킬(overlaps.json, 이미 넣음)은 이름마다 링크 — 전체 스킬 보기 창에서 그 묶음을 열고 그 줄을 가운데로 민 뒤 1.6초 밝히고 초점은 그 줄의 스위치에. 이미 깔린 스킬(harness-fit 밖)·기존 훅은 큰 창 위에 겹쳐 뜨는 둘째 `<dialog id="info">` — 스킬은 이름·자리·설명(SKILL.md 머리말 200자)·왜 같은지, 훅은 짧은 이름·적힌 곳·테스트 결과 한 줄·기본으로 켜지 않는다는 것. 이 PC 에만 있는 것이면 팀원 공유를 켤 때의 동작을 적는다. 아래에 harness-fit 쪽 켜고 끄기 스위치.
- 데이터: 기존 훅 결과에 `from: [{ label, scope, plugin }]`(명령 전체·파일 경로는 보내지 않는다 — 명령에 토큰이 들 수 있어서), `dupSkills` 에 `found`, 테스트 한 줄은 `catalog/probes.json` 훅마다 `said`. 글은 모두 textContent.
- 링크는 이름표 크기 그대로, 누르는 넓이만 44px(`.lk`). 닫으면 연 링크로 초점이 돌아온다.
- 이유: 「비슷한 스킬이 이미 들어 있어요 · 계획 캐묻기」가 무엇과 겹치는지 따라가 볼 수 없었고, 훅 이름표는 스크립트 파일 이름만 보였다.
- 어디서: `picker/panel.js` 의 `browseTo`, `picker/info-dialog.js`, `scripts/test/dup-links.test.mjs`

### 요청 칸 (사용자 요청, 2026-11-02)
- 결정: 5단계에 적은 요청은 적용 결과와 함께 Claude 에게 넘기고 `.claude/harness-request.md` 에도 남긴다. Claude 는 켜진 훅의 옵션이나 CLAUDE.md(관리 구역 밖)에만 반영하고, 꺼진 훅은 켜지 않는다.
- 이유: 요청은 해석이 필요해 파일에 바로 쓰지 않는다. 파일은 터미널 세션이 없어도 남게.

### 적용 중에는 잠근다 (2026-11-02 전체 검토)
- 결정: 적용 중에는 선택을 잠그고, 끝 화면은 확인한 순간의 사본으로 그린다. 미리 보기는 마지막 요청의 답만 받는다.

### 화면 보안
- 결정: 127.0.0.1·임의 포트, 데이터·적용 요청은 `X-Harness-Token` 헤더의 일회용 토큰, Host 검사(DNS 리바인딩), CSP, 외부 글은 textContent 로만. 화면이 보낸 선택은 카탈로그에 있는 id 만 남긴다. 저장소 명령은 서버가 읽은 값만 쓴다.
- 어디서: `scripts/picker.mjs`, CSP 는 `picker/index.html`

### 한국어·영어, 문구는 언어별 파일 (사용자 결정, 2026-11-02)
- 결정: 화면·훅 안내·지침 조각의 문구는 코드에 쓰지 않고 언어별 파일로. 언어는 harness.json 의 `lang`, 없으면 시스템 언어. 영어 수 문구는 `{n|one|other}`(Intl.PluralRules).
- 어디서: `picker/i18n/<lang>/*.json`(파일 400줄 한도로 나눔), `hooks/messages/{ko,en}.json`, `rules/*.{ko,en}.md`

### 화면·알림 용어 (사용자 승인, 2026-11-06 · 2026-11-09 사용자 결정으로 더함)
- 결정: 같은 분야가 쓰는 말로 — 훅, CLAUDE.md 지침(`.claude/rules/` 는 「규칙」), 브랜치 전략, 차단, 주입 차단, 병합(스쿼시 병합), 푸시, 켜짐·꺼짐, 권장, 말투는 훅 알림까지 해요체. 2026-11-09: 사용자에게 보이는 한국어(화면·훅 알림·카탈로그·CLAUDE.md 에 들어가는 지침·README)는 시험→테스트(「테스트 하나만」), 린트→검사(다른 검사·훅과 헷갈릴 자리는 「코드 검사(lint)」 한 번), 스킬 목록 예산→스킬 목록 한도(「Claude가 스킬 목록을 기억하는 자리의 한도」로 풀어 씀). 그대로: 스킬·플러그인·커밋·브랜치·저장소·토큰·되돌리기·적용(설정 전체)/설치(스킬)·PR·조합.
- 이유: Claude Code·GitHub 한국어 문서, VS Code 한국어 언어 팩 확인.
- 정본: `Downloads/find-your-skill-시안/리뉴얼/DESIGN.md` § Voice and terminology

## CLAUDE.md 지침

### 줄마다 누가 맡는지 표시한다 (사용자 지적, 2026-11-05)
- 결정: 지침 줄은 모두 `{{hook:id}}`·`{{!hook:id}}`·`{{!skill:id}}`·`{{judge}}` 중 하나를 단다. 「훅이 막는다」고 알리는 줄은 두지 않는다.
- 이유: 정적 도구로 막을 수 있는 걸 글로 두면 놓친다. 훅이 막을 때 이유를 알려 주므로 매 대화 글로 또 적으면 겹친다.
- 어디서: `scripts/test/rules.test.mjs`, 렌더 `scripts/lib/claude-md.mjs`

### 훅이 줄을 통째로 막을 때만 줄을 지운다 (2026-11-06)
- 결정: 다 막으면 `{{!hook:id}}`(꺼졌을 때만). 일부만 막는 훅(secrets·danger-cmd·password-cli)은 줄을 지우지 않는다. 나머지는 `{{hook:id}}` 줄로 나눈다 — 예: reset·filter-branch 로 고친 강제 푸시, package.json 밖 의존성, 브랜치 이름(branch-name 몫).

### 공식 권장에 맞춘다 (사용자가 세부를 맡김, 2026-11-07)
- 결정: 200줄 아래, 짧은 줄, 확인할 수 있게 구체적으로(「커밋 전에 `npm test`」), 저장소를 읽어 알 수 없는 것만. 말하지 않아도 Claude 가 하는 줄은 뺀다. 줄마다 판단한 표는 archive.
- 이유: code.claude.com/docs/en/memory·best-practices.
- 어디서: `rules/*.{ko,en}.md`

### 「이 저장소 명령」 (사용자 결정, 2026-11-06, 시안 1안)
- 결정: package.json scripts(npm·pnpm·yarn·bun)·Makefile·pyproject(tox·hatch·pytest·ruff·mypy, uv·poetry·pdm)·Cargo·go.mod 에서 읽은 테스트·검사·빌드 명령만. 찾은 게 없거나 사용자 CLAUDE.md 에 이미 있으면 뺀다.
- 구조 묶음의 뻔한 3줄(화면·상태 섞지 않기, 외부 라이브러리 감싸기, 미리 추상화하지 않기)은 뺐다 — 「지워도 Claude 가 실수하지 않을 줄이면 지운다」.
- 어디서: `scripts/lib/commands.mjs`, `rules/commands.*.md`

### 「테스트 하나만」은 도구를 확실히 알 때만 (2026-11-07)
- 결정: test 스크립트가 도구를 그대로 부를 때만(`&&`·파이프·환경 변수·`--config` 등이 있으면 뺀다). vitest·jest·playwright·bun·node --test·pytest·cargo·go 만.
- 넣지 않음: mocha(.mocharc 의 spec 에 더해져 다른 테스트도 돈다), tox·hatch·make(인자 꼴이 설정마다 다름), `go test <파일>.go`.
- 어디서: `scripts/lib/commands.mjs` 의 `testOne`, `fillCmd`

### 구조 · 재사용 지침 (사용자 요청, 2026-11-05)
- 결정: `rules/structure.{ko,en}.md` 를 혼자 빠르게·팀 협업·꼼꼼하게에서 기본으로 켠다. 가볍게는 「안전장치만」이라 뺀다. 모든 줄이 판단이라 글로 둔다. 같은 요청으로 넣었던 스킬 `code-simplification` 은 지금 어느 조합의 기본에도 없다(카탈로그에서 고를 수만 있음).
- 어디서: `catalog/combos.json` 의 rules

### 겹침은 사용자 글하고만 견준다 (2026-11-06·11-07)
- 결정: 관리 구역(`harness-fit:start`~`end`)을 뺀 프로젝트 CLAUDE.md(`projectClaudeMd`)와, 사용자가 쓴 `.claude/rules/**/*.md`(프로젝트·`~/.claude`)와 견준다.
- 이유: 구역까지 견주면 지난번에 넣은 줄이 모두 「이미 있음」으로 빠진다. 블록 HTML 주석은 문맥에 들기 전에 지워져 Claude 가 구역을 볼 수 없다.
- 어디서: `scripts/overlap.mjs`, `scripts/lib/user-rules.mjs`

### `.claude/rules/` 로 옮기지 않는다 (사용자 결정, 2026-11-07)
- 결정: 지침은 CLAUDE.md 표시 구역에 그대로 둔다.
- 이유: `paths` 규칙은 Read·Write·Edit·`cat` 때만 읽히고 압축하면 빠진다(2.1.318 테스트) — 보안 지침이 빠지는 구간이 생기는데 아끼는 양은 약 250토큰. 파일로만 옮기면 `.claude/` 를 git 에서 뺀 저장소는 팀원에게 안 간다.
- 다시 볼 때: Claude Code 가 `paths` 규칙을 압축 뒤에도 남기게 바뀌면.

### 사람만 아는 것은 사람이 적게 안내한다 (2026-11-07)
- 결정: 지침 단계 미리 보기 아래와 끝 화면(지침을 넣었을 때만)에 같은 한 줄 + 예 「`src/legacy/` 는 아직 쓰지만…」. setup 보고 끝에 한 줄, 대신 써 주지 않는다. 확인 단계에는 넣지 않는다.
- 어디서: 문구 `ownNotes`(`picker/rules.js`·`picker/review.js`)

### 약속대로 안 될 때는 적용하면서 알린다 (2026-11-05)
- 결정: 플러그인이 없으면(npx) CLAUDE.md 를 「훅 꺼짐」 글로 쓰고 알린다. `.claude/` 를 git 이 무시하면 팀원 공유가 닿지 않는다고, settings.json 이 깨졌으면 공유를 못 적었다고 알린다.
- 이유: 글도 검사도 없는 상태를 막으려고.

## 스킬

### 설치 방식은 라이선스로 나눈다
- 결정: MIT·Apache-2.0·BSD·ISC·MPL·CC-BY(-SA) 는 그 스킬 폴더만 커밋 해시로 고정해 복사. 라이선스가 없거나 불분명하면 원 저장소 설치 명령을 안내. 받은 스킬은 실행하지 않는다.
- 이유: 상시 토큰이 가장 적다(플러그인 전체를 깔면 안 쓰는 스킬 설명까지 들어간다).
- 어디서: `scripts/lib/install-skill.mjs`

### 카탈로그는 스냅샷 + 실시간 보충 검색 (사용자 결정, 2026-11-02)
- 결정: 저장한 목록에 더해, 화면을 열 때 같은 검색어로 목록 기준일 뒤 새로 나오거나 바뀐 저장소를 찾는다. star 1000 이상은 `--stars=">=1000"` 로.
- 어디서: `config/sources.json`(`minStars`), `catalog/queries.json`, `scripts/fresh.mjs`

### 실행 파일이 든 스킬은 적용 전에 알린다 (2026-11-02)
- 결정: 고정 커밋 기준 실행 파일 목록을 catalog 에 적는다. 훅과 같은 일을 하는 스킬(`overlapsHook`)은 고를 목록에서 뺀다.
- 어디서: `scripts/dev/scan-skill-files.mjs`

### 같은 일을 하는 스킬은 조합에 하나만 (사용자 요청, 2026-11-05)
- 결정: `catalog/overlaps.json` 묶음마다 조합 기본값엔 하나만(꼼꼼하게에서 differential-review 를 뺐다 — find-bugs 와 같은 일). 화면에서 같은 묶음을 더하면 「비슷한 스킬이 이미 들어 있어요」(이름을 누르면 그 스킬로 — 위 「겹침 이름표」).
- 이미 있는 스킬: 같은 이름은 스크립트가, 하는 일이 같은 다른 이름은 setup 때 Claude 가 `scripts/overlap.mjs` 를 보고 `--similar` 로.

### 받은 스킬 이름은 카탈로그 id 로 (2026-11-06)
- 결정: SKILL.md 의 `name` 만 카탈로그 id 로 바꾸고 원래 이름은 `.harness-source.json` 의 `renamedFrom`. id 가 예약 이름이면 받지 않는다.
- 이유: sentry 스킬의 `name: security-review` 가 `/security-review` 를 가렸다.
- 어디서: `config/reserved-skill-names.json`, `scripts/lib/install-skill.mjs`

### 다시 받기와 덮어쓰지 않기 (2026-11-02·11-05)
- 결정: 받지 못한 스킬은 「들어갔다」고 말하지 않고 `--retry` 로 그 스킬만 같은 백업에 더해 받는다. harness-fit 이 넣지 않은 같은 이름 폴더는 덮어쓰지 않는다.
- 어디서: `scripts/apply.mjs`

### `.harness-source.json` 은 「받아 온 외부 코드」 표시 (사용자 결정, 2026-11-02)
- 결정: 사용자 전역 stop-gate 가 이 파일이 있는 폴더의 위반을 「고치지 말고 `.claude/lint.json` 의 external 에 적으라」로 안내한다. 파일 이름·위치를 바꾸면 그 안내도 같이 바꾼다.

### 스킬 목록 한도를 적용 전에 알린다 (사용자 승인, 2026-11-07 · 화면 말은 2026-11-09 「한도」로)
- 결정: 이 PC 의 사용자·프로젝트 스킬·명령과 켜진 플러그인 스킬에 새 스킬을 더해 한도의 80% 이상이면 확인 단계·요약 카드에 알리고 「권장대로 줄이기」를 보인다. 한도 늘리기는 안내만 한다.
- 이유: 넘으면 덜 쓴 스킬부터 설명이 빠지고, 새로 넣은 스킬이 먼저다(code.claude.com/docs/en/skills). 셈 방식은 문서에 없어 「넘을 수 있어요」로만 말한다.
- 어디서: `scripts/lib/skill-budget.mjs`, `picker/budget.js`(서버·화면 같은 함수, 기본 8,000자)

### 「권장대로 줄이기」 차례 (사용자 승인, 2026-11-07)
- 결정: 같은 일을 하는 스킬 → 직접 더한 것 → 조합 스킬 → 스택 맞춤 순, 같은 차례면 설명이 긴 것부터, 80% 아래까지. 지금 있는 것만으로 이미 80% 이상이면 앞의 두 차례만 뺀다. 뺀 것은 되돌릴 수 있다.

### 카탈로그 설명은 재기만 하고 고치지 않는다 (2026-11-07, 설명 꼴은 사용자 결정 2026-11-06)
- 결정: 고정 커밋 SKILL.md 에서 `descChars`·`saysWhen` 을 재어 보고만 한다. 늘 드는 토큰 상위 10% 는 「설명이 길어 목록 한도를 많이 써요」. 스킬 설명(catalog.json)은 「~한다」 꼴 그대로.
- 어디서: `scripts/dev/check-descriptions.mjs`, `scripts/dev/build-catalog.mjs`

### 스킬에 모델을 정하지 않는다 (2026-11-07)
- 결정: 외부 스킬에 `model`·`effort` 를 끼워 넣지 않는다(적혀 있으면 그대로). `/harness-fit:setup` 도 사용자 모델 그대로.
- 이유: 그 턴에만 걸리고, 필요한 모델은 만든 사람이 안다. setup 은 판단이 섞여 있고 보고 턴엔 어차피 원래 모델로 돌아온다.

### setup 스킬 머리말 (2026-11-06)
- 결정: description 에 하는 일과 쓰는 때, `argument-hint: "[auto|undo]"`, `disable-model-invocation: true`(실행 전에는 설명도 문맥에 안 든다). `allowed-tools` 는 넣지 않는다.
- 이유: `allowed-tools` 는 막는 기능이 아니라 그 턴에만 미리 허락하는 기능이고, `Bash(node *)` 는 아무 node 코드나 허락하게 된다.
- 어디서: `skills/setup/SKILL.md`. 적용은 화면에서 하고 Claude 는 결과 JSON 한 덩어리만 읽는다.

## GitHub·git

### 커밋 내용은 git pre-commit 으로 본다 (사용자 결정, 2026-11-06)
- 결정: 적용할 때 `.git/hooks/pre-commit` 에 넣어 실제로 올라가는 내용을 같은 함수로 본다. 사람이 한 커밋도 본다. 이미 다른 pre-commit·`core.hooksPath` 가 있으면 건드리지 않고 이어 붙일 한 줄을 알리며, PreToolUse 커밋 검사를 그대로 둔다.
- 이유: PreToolUse 는 명령이 돌기 전에 봐서, 앞 명령이 파일을 쓰면 커밋 내용을 미리 알 수 없다(그때는 나눠 실행하게 한다). `--no-verify` 로 건너뛰는 것은 git 의 약속.
- 어디서: `hooks/git-pre-commit.mjs`, `hooks/lib/git-hook.mjs`, `hooks/rules/commit.mjs`

### GitHub 저장소 설정은 사용자가 켤 때만, 항목마다 (사용자 결정, 2026-11-06)
- 결정: 기본 꺼짐. 켜면 항목마다 고른다. Git Flow 의 PR 요구는 기본 꺼짐(release 를 로컬에서 병합해 푸시), 관리자에게도 적용은 기본 켜짐, 승인 수 0·1·2. 되돌리기는 이전 값으로.
- 이유: 웹 화면·`gh api`·다른 사람이 병합하는 길은 훅이 못 본다. 설정은 모두에게 영향을 준다.
- 어디서: `catalog/packs.json` flows 의 `github`, `scripts/lib/github-settings.mjs`, `picker/github-plan.js`

### GitHub Flow 는 main 바로 푸시도 막는다 (2026-11-05)
- 결정: 「PR 로 병합한다」를 글 대신 검사로(`noDirectPush`). Git Flow 는 로컬에서 release 를 병합해 푸시하므로 켜지 않는다.

### 보호 브랜치는 cherry-pick·revert·am 도 막는다 (2026-11-06)
- 결정: Git Flow 의 main·develop 바로 커밋을 다 막으려고 넓혔다. merge 가 main 에 만드는 커밋은 약속 밖으로 detail 에 적는다(GitHub Flow 는 그 푸시를 막는다). 강제 푸시는 보호 브랜치 훅에 둔다.
- 어디서: `hooks/rules/git.mjs`, `catalog/packs.json` 의 detail

### 브랜치 이름 규칙은 시작만 본다 (2026-11-02)
- 결정: 시작 부분만 강제하고 대문자·숫자·하위 경로는 허용(`feature/JIRA-123`).
- 어디서: `catalog/packs.json` flows 의 `branch-name.pattern`

### pr-merge 는 브랜치 전략에 딸린 훅 (2026-11-06)
- 결정: GitHub Flow 에만 있어 조합 목록이 아니라 브랜치 전략(`hooksOn`)으로 들어간다. 조합을 펼칠 때 그 조합의 브랜치 전략 hooksOn/hooksOff 도 맞춘다(화면 `defaultsFor` 와 같은 범위).
- 어디서: `scripts/lib/catalog.mjs` 의 `expandCombo`

### 올린 커밋 다시 쓰기·스쿼시 안 한 푸시 (2026-11-06)
- no-rewrite-pushed: 원격에 있는 커밋을 amend·rebase 하면 막는다(`git pull --rebase` 허용).
- squash-push: 원격 추적 브랜치 어디에도 없는 커밋이 2개 이상이면 막는다. 같은 명령의 앞선 `git commit` 도 센다. 첫 푸시·태그·지우기는 보지 않는다. 팀마다 달라 모든 조합에서 기본 꺼짐.

### 팀원 공유는 프로젝트 settings.json 으로 (2026-11-02)
- 결정: `.claude/settings.json` 의 `extraKnownMarketplaces`·`enabledPlugins` 두 항목만 더한다. 기존 설정은 두고, 깨진 파일은 건드리지 않는다. 팀 조합(팀 협업·꼼꼼하게)이면 기본 켬.
- 어디서: `scripts/apply.mjs`, `catalog/combos.json` 의 `share`

### 되돌리기는 사용자가 고친 것을 지우지 않는다 (2026-11-02 전체 검토)
- 결정: 쓴 내용의 지문(sha256)을 백업 목록에 남기고, 달라졌으면 CLAUDE.md 는 관리 구역만·.gitignore 는 넣은 줄만 빼고 나머지는 두고 알린다. 백업 목록 경로가 프로젝트 안인지, 폴더 이름이 시각 꼴인지 확인한다.
- 어디서: `scripts/lib/backup.mjs`

## 배포·버전

### Claude Code 플러그인으로 낸다 (사용자 결정, 2026-11-02)
- 결정: `/plugin marketplace add` → `/harness-fit:setup`. 설정 파일은 `.claude/harness.json`.
- 이름은 find-your-skill → harness-fit (사용자 결정, 2026-11-02): 스킬만 찾는 도구처럼 들리고 영어로 「적성 찾기」로 읽혀서. harness-kit 은 같은 분야 저장소와 겹쳐 뺐다.

### 실행 파일은 `cli/` (2026-11-06)
- 결정: npx 진입점은 `cli/harness-fit.js`(package.json `bin` 이 가리킴).
- 이유: 플러그인 맨 위 `bin/` 은 Bash PATH 에 들어가고, claude.ai·Cowork 는 `bin/` 이 있는 플러그인을 설치하지 않는다.

### 개발용 스크립트는 `scripts/dev/` (2026-11-09)
- 결정: 카탈로그 만들기·실행 파일 훑기·설명 재기·헛막음 훑기(`build-catalog`·`scan-skill-files`·`check-descriptions`·`fp-scan`)는 `scripts/dev/` 에 둔다. 사용자가 돌리는 `scripts/*.mjs` 와 섞지 않으려고.

### 팀원이 받는 플러그인은 태그로 고정 (2026-11-02)
- 결정: `config/sources.json` 의 `pluginRef`(지금 v0.3.1). 버전을 올릴 때 `.claude-plugin/plugin.json`·`package.json` 의 version 과 같이 바꾼다(세 곳이 같은지 테스트가 본다).
- 이유: 마켓 소스는 브랜치·태그(`ref`)만 받고 커밋 sha 고정은 지원하지 않는다(2026-11-02 문서 확인).

### 버전 태그에 바뀐 점, GitHub 릴리스도 (사용자 결정, 2026-11-07)
- 결정: 주석 태그 메시지는 「vX.Y.Z: 요약」 + 바뀐 점 + 최소 Claude Code 버전. 릴리스 글은 태그보다 자세히, 항목마다 「바꾼 이유 · 바뀐 점」과 하지 않은 것의 이유까지(사용자 요청 「이런 이유로 수정했고 추가했다」).
- 이유: 저장소 첫 화면에 최신 버전이 보이고 구독한 사람에게 알림이 간다. v0.1.0~v0.2.2 는 한 줄뿐이라 릴리스를 만들지 않았다. 이미 올린 태그는 v0.3.0·v0.3.1 만 같은 커밋에 메시지를 넣어 다시 올렸다.

### 시안은 저장소 밖에 둔다 (사용자 결정, 2026-11-02)
- 어디서: `Downloads/find-your-skill-시안/`

## 바뀐 이력
버전별 자세한 내용은 GitHub 릴리스(v0.3.0 부터)나 태그 메시지에 있다. 날짜별 옛 이력은 [decisions-archive.md](decisions-archive.md#바뀐-이력).

- v0.1.0 (2026-11-02): 첫 공개. 태그 메시지만.
- v0.2.0 (2026-11-02): 이름을 harness-fit 로. 태그 메시지만.
- v0.2.1 (2026-11-02): 스킬·훅·규칙 구분 표시. 태그 메시지만.
- v0.2.2 (2026-11-02): 빈 저장소 질문, 전체 검토 1~3차 반영. 태그 메시지만.
- v0.3.0 (2026-11-06): 새 고르기 화면, 훅 23개, git 커밋 전 훅, GitHub 저장소 설정, 용어 통일 — [릴리스](https://github.com/HwangSlater/harness-fit/releases/tag/v0.3.0)
- v0.3.1 (2026-11-07): 스킬 목록 예산 경고, CLAUDE.md 지침 손질, 사용자 rules 도 겹침 견주기 — [릴리스](https://github.com/HwangSlater/harness-fit/releases/tag/v0.3.1)
- v0.3.2 (2026-11-09, https://github.com/HwangSlater/harness-fit/releases/tag/v0.3.2): 조합 기본값을 저장소에 맞춤, prefer-gh 알림, 확인 단계 알림 한 줄, 스킬·훅 쉬운 한 줄과 알아 둘 점, 지침 창, 겹침 이름표, git 그래프 그림, 훅 한 번 30~60ms 줄임·테스트 나누기, 용어(테스트·코드 검사·한도), README·결정 문서 줄이기.
- 2026-11-09: 지금 유효한 결정만 분야별로 다시 정리, 옛 원문은 decisions-archive.md 로.
