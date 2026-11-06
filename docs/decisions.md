# 결정

> 최종 수정: 2026-11-06 · 무엇을 왜 그렇게 정했는지

## 2026-11-02 사용자 결정
- **고르기 화면**: 시안 1(조합 카드 + 스킬·훅·규칙 체크 목록)을 바탕으로 변주한다. 시안은 저장소 밖에 둔다.
- **배포 형태**: Claude Code 플러그인(`/plugin marketplace add` → `/harness-fit`).
- **언어**: 처음부터 한국어·영어 둘 다. 화면·훅 안내·규칙 조각의 문구는 언어별 파일로 나누고 코드에 직접 쓰지 않는다. 언어는 사용자 설정(`.claude/harness.json` 의 `lang`)을 따르고, 없으면 시스템 언어.
- **카탈로그 신선도**: 스냅샷 + 실시간 보충 검색(`docs/plan.md` 원칙 4). star 1000 이상은 키워드 검색(`--stars=">=1000"`)으로 찾는다.

- **고르기 화면 2차(사용자 선택: 2차 시안 a)**: 맨 위 요약 타일 4칸(스킬·훅·약속 개수, 매 대화 비용을 「Claude 기억 공간의 N%」로) → ① 조합(「이런 분께」·6단계 막대) ② 개발 단계 지도(쉬운 이름·「언제 쓰나」, 눌러서 빼기·더하기) ③ 막는 실수(「이렇게 하면 → 이렇게 막아요」) ④ 브랜치 그림 ⑤ CLAUDE.md 약속 ⑥ 요청 칸 ⑦ 생기는 것. 영어 id·전문 용어만 보이던 1차가 「무슨 뜻인지 모르겠다」는 지적을 받아 바꿈. 쉬운 이름은 `catalog/titles.json`.
- **요청 칸(사용자 요청)**: 「이렇게 해 줘」를 적으면 적용 결과와 함께 Claude 에게 넘어가고, Claude 가 훅 옵션이나 CLAUDE.md(관리 구역 밖)에 반영한 뒤 바꾼 것을 알린다. 파일에 바로 쓰지 않는 이유: 요청은 해석이 필요하다.

- **사용성 평가 반영(2026-11-02, 사용자 요청 「전부 고치기」)**: 사용자 역할 에이전트 2명(처음 쓰는 주니어·팀 리드)이 화면을 직접 눌러 평가했다. 원칙은 「화면이 약속한 것 = 실제 결과」.
  - 브랜치 방식은 훅을 실제로 켜고 끈다(`packs.json` flows 의 `hooksOn`/`hooksOff`, 서버 `applyFlow` 와 화면 `pickFlow` 가 같은 데이터를 쓴다). 정하지 않음 → 보호 브랜치·이름 규칙 끔, 트렁크 → 보호 브랜치는 강제 push 만.
  - CLAUDE.md 문장은 켠 훅에 맞춰 만든다: 규칙 조각의 줄 끝 `{{hook:id}}`(켜졌을 때만)·`{{!hook:id}}`(꺼졌을 때만). 렌더는 `scripts/lib/claude-md.mjs`.
  - 브랜치 이름 규칙은 시작 부분만 강제하고 대문자·숫자·하위 경로 허용(`feature/JIRA-123`).
  - 팀원 공유는 프로젝트 `.claude/settings.json` 의 `extraKnownMarketplaces`·`enabledPlugins` 로(팀원이 열면 설치를 권함). 기존 설정은 보존, 깨진 파일은 건드리지 않음. 팀 조합이면 기본 켬.
  - 팀원이 받는 플러그인은 태그로 고정한다(`config/sources.json` 의 `pluginRef`, 버전을 올릴 때 같이 바꾼다). 마켓 소스는 브랜치·태그(`ref`)만 받고 커밋 sha 고정은 지원하지 않는다(2026-11-02 문서 확인). 화면에 저장소와 버전을 보여 준다.
  - 조합을 바꾸면 직접 고친 내용이 사라지므로 「이전 선택으로 돌리기」를 띄운다. 브랜치 방식 때문에 바뀐 검사는 조합 기본값과 비교해 누적으로, 브랜치 구역 바로 아래에 알린다.
  - 요청 칸 내용은 `.claude/harness-request.md` 로도 남긴다(터미널 세션이 없어도 사라지지 않게).
  - 실행 파일이 든 스킬은 적용 전에 알린다(`scripts/scan-skill-files.mjs` 가 고정 커밋 기준 목록을 catalog 에 적음). 훅과 같은 일을 하는 스킬(`overlapsHook`)은 고를 목록에서 뺀다.
- **전체 검토 반영(2026-11-02, 사용자 요청 「고치고 재검토」)**: 보안·데이터 일치·화면 세 갈래 검토에서 나온 것을 고쳤다.
  - 되돌리기는 「적용한 뒤 사용자가 고친 것」을 지우지 않는다: 쓴 내용의 지문(sha256)을 백업 목록에 남기고, 달라졌으면 CLAUDE.md 는 관리 구역만·.gitignore 는 넣은 줄만 빼고 나머지는 두고 알린다. 백업 목록 경로는 프로젝트 안인지, 폴더 이름은 시각 꼴인지 확인한다(`scripts/lib/backup.mjs`).
  - 받지 못한 스킬은 「들어갔다」고 말하지 않고, `--retry` 로 그 스킬만 같은 백업에 더해 받는다(되돌리기는 여전히 처음 상태로).
  - 다시 적용해도 사용자가 harness.json 에 넣은 훅 옵션은 남긴다(Git 전략이 정하는 키만 새 값). 요청 칸 반영은 켜져 있는 훅의 옵션만 바꾸고, 꺼진 훅은 켜지 않는다.
  - 훅: 명령을 낱말 단위로 읽어 옵션 순서·대소문자·묶음(`-fu`)·`git -c` 앞붙임을 가리지 않고, 따옴표 속 글(커밋 메시지)은 옵션으로 보지 않는다. 비밀값 허용 주석은 그 줄의 모든 검사에, 커밋 검사는 파일마다(테스트 파일 예외가 쓰기와 같게).
  - 화면: 적용 중에는 선택을 잠그고 끝 화면은 확인한 순간의 사본으로 그린다. 미리보기는 마지막 요청의 답만 받는다.
- **`.harness-source.json` 은 「받아 온 외부 코드」 표시로도 쓰인다**: 사용자 전역 stop-gate 가 이 파일이 있는 스킬 폴더의 위반을 「고치지 말고 프로젝트 `.claude/lint.json` 의 external 에 이유와 함께 적으라」로 안내한다(2026-11-02 사용자 결정 — 훅에서 통째로 빼지 않고 프로젝트 예외로). 파일 이름·위치를 바꾸면 이 안내가 깨지므로 같이 바꾼다.
- **빈 저장소는 먼저 묻는다(사용자 요청)**: 스택을 알 파일이 없으면(`detect` 의 `thin`) Claude 가 화면을 열기 전에 「맞춤 추천을 할 수 없다, 기본 조합으로 갈지 / 무엇을 만드는지 알려 줄지」 묻는다(SKILL.md). 설명을 받으면 `--stack`·`--team` 으로 넘기고(`detect.mjs` 의 `KNOWN_STACKS` 에 있는 이름만), 화면 맨 위에 「알려 주신 내용으로 추천」, 인원은 커밋 기록처럼 쓰지 않는다. 그냥 진행해도 화면에 「기본 조합으로 시작」을 띄운다. 설명은 늘 받지 않는다 — 저장소에 있는 정보를 다시 묻지 않으려고.
- **무엇이 스킬·훅·규칙으로 들어가는지 늘 보이게(사용자 지적 「훅인지 규칙인지 안 적혀 있다」)**: 2~5번 구역 제목 옆에 「스킬 · .claude/skills/」「훅 · .claude/harness.json」「규칙 · CLAUDE.md」 표시. 끝 화면은 경로 목록 대신 확인 창과 같은 종류별 묶음(`parts.js` 의 `changeGroups`), 터미널 보고도 `labels` 로 종류별 한 줄씩. 한국어 「약속」은 영어판·업계 표현에 맞춰 「규칙」으로 통일. 훅처럼 들리던 스킬 이름 「커밋 전 자동 검사」 → 「커밋 전 검사 도구 설치」.
- **구조 · 재사용 규칙(2026-11-05 사용자 요청 「재활용을 생각해 독립적으로 짜게」)**: CLAUDE.md 규칙 묶음 `structure`(`rules/structure.{ko,en}.md`)를 새로 두고, 혼자 빠르게·팀 협업·꼼꼼하게에서 기본으로 켠다. 스킬 `code-simplification`(복잡한 코드 단순화)도 같은 세 조합의 기본에 넣었다. 가볍게는 「안전장치만」이라 넣지 않는다. 모든 줄이 판단이라 글로 둔다(값 바로 적기 훅 `hardcode` 는 2026-11-06 뺐다 — 아래 「훅은 약속한 것을 빠짐없이」).
- **검사로 막을 수 있으면 글로 두지 않는다(2026-11-05 사용자 지적 「정적 도구로 할 수 있는 걸 규칙에 넣어 놓치게 하면 곤란」)**: 규칙 줄은 모두 `{{hook:id}}`·`{{!hook:id}}`·`{{!skill:id}}`·`{{judge}}` 중 하나를 단다(`scripts/test/rules.test.mjs`). 훅이 켜졌을 때 「훅이 막는다」고 알리는 줄은 두지 않는다 — 훅이 막을 때 이유를 알려 주므로, 매 대화 읽히는 글로 또 적으면 겹친다.
- **이미 있는 것과 겹치면 넣지 않는다(2026-11-05 사용자 요청 「중복으로 적용하게 하면 안 된다」)**:
  - 훅: 기존 훅(전역·프로젝트 settings, 켜진 플러그인)에 `catalog/probes.json` 시험 입력을 실제로 넣어(사용자 선택 — 이름·코드를 읽어 짐작하는 것보다 정확), block 을 다 막고 pass 를 다 통과시키면 같은 훅으로 보고 끈다(`scripts/lib/existing-hooks.mjs`). pass 입력이 있어야 다른 이유로 다 막는 훅을 같은 훅으로 잘못 보지 않는다. 저장소 쪽 훅은 Claude Code 안에서만 돌린다(Claude Code 의 폴더 신뢰 확인을 건너뛰지 않게).
  - 스킬: 같은 이름은 스크립트가, 하는 일이 같은 다른 이름은 setup 때 Claude 가 `scripts/overlap.mjs` 를 보고 `--similar` 로. CLAUDE.md 줄은 Claude 가 프로젝트·전역 CLAUDE.md 와 견주어 `--skip`(파일에 적힌 줄 번호).
  - 이 PC 에만 있는 것(전역)은 팀원 공유를 켜면 겹침으로 보지 않는다 — 팀원에게는 없다. 겹침 판단은 서버와 화면이 같은 `picker/dup.js` 를 쓴다.
  - 기존 훅이 막아 주는 것은 규칙 글에서 「켜짐」으로 친다(꺼짐 전용 줄이 그 훅과 겹치지 않게).
  - 같은 훅으로 보는 것은 harness-fit 훅이 도는 때(PreToolUse, 2026-11-06 부터 Stop·SessionStart·UserPromptSubmit 도)뿐. PostToolUse 는 쓴 뒤에 알려 줄 뿐 막지 못해, 같은 것으로 보고 쓰기 전 차단을 끄면 더 약해진다(검토에서 이 PC 의 code-lint 때문에 실제로 꺼지던 일).
  - 시험 입력은 GitHub Flow 옵션 기준이라, 다른 브랜치 방식이 옵션을 넣는 훅(protect-branch·branch-name)은 그 방식에서 겹침으로 보지 않는다(`picker/dup.js` PROBE_FLOW) — 덜 막는 쪽으로 틀리지 않게.
- **약속대로 안 될 때는 적용하면서 알린다(2026-11-05 검토)**: 플러그인이 없으면(npx) 훅이 돌지 않으므로 CLAUDE.md 를 「훅 꺼짐」 글로 쓰고 알린다(글도 검사도 없는 상태를 막으려고). `.claude/` 를 git 이 무시하면 팀원 공유가 닿지 않는다고, settings.json 이 깨졌으면 공유를 못 적었다고 알린다. harness-fit 이 넣지 않은 같은 이름 스킬 폴더는 덮어쓰지 않는다(retry 와 같은 규칙). harness.json 이 깨지면 조용히 모두 끄지 않고 사용자에게 알린다(막지는 않음).
- **GitHub Flow 는 main 에 바로 push 도 막는다(2026-11-05)**: 「PR 로 합친다」를 글 대신 검사로. Git Flow 는 로컬에서 release 를 합쳐 push 하므로 켜지 않는다.
  - harness-fit 안의 같은 일을 하는 스킬은 `catalog/overlaps.json` 묶음으로, 조합 기본값엔 하나만(꼼꼼하게에서 differential-review 를 뺌 — find-bugs 와 같은 일). 화면에서 같은 묶음 스킬을 더하면 「비슷한 스킬이 이미 들어 있어요」.

- **훅은 약속한 것을 빠짐없이, 글은 핵심만(2026-11-06 사용자 원칙)**: 규칙 글·스킬은 판단이 필요한 핵심만 짧게(길면 잊는다). 훅은 늘 지켜야 하는 것을 막고, 줄 하나를 통째로 다 막을 때만 그 줄을 지운다(`{{!hook:id}}`). 짐작으로만 잡을 수 있는 훅은 두지 않는다 — `hardcode`·`injection`·`log-secrets` 를 뺐고 그 줄은 판단(`{{judge}}`)·스킬(`{{!skill:…}}`) 글로 남겼다. 일부만 막는 훅(secrets·danger-cmd·password-cli)은 detail 에 「적어 둔 꼴만」이라 밝히고 규칙 줄은 지우지 않는다. 쓰기 훅은 셸로 쓴 파일을 못 보므로 `git commit` 때 같은 함수로 다시 보고(`hooks/rules/commit.mjs`), 같은 명령 앞부분이 파일을 쓰면 미리 볼 수 없어 나눠 실행하게 한다. 「훅은 모두 엄격하게 시험한다」: packs.json 의 훅마다 detail 의 꼴마다 막음·통과 사례를 Bash·PowerShell 로 실제 진입점(`hooks/run.mjs`)에 넣어 보고(`hooks/test/strict.test.mjs`), 사례가 3개씩 없으면 시험이 실패한다. 실제 프로젝트에서 헛막음은 `node scripts/dev/fp-scan.mjs <폴더>` 로 본다. 꼴을 넓힐 때마다 헛막음을 다시 본다 — `SECRET_KEY` 꼴을 넓히자 `api_key_header = "X-Api-Key"` 가 걸려, 값을 가리키는 이름(_header·_name·_env·_url …)·켜고 끄는 값(`=yes`·`=1`)·JS·TS 따옴표 속 글은 뺐다. 약속 밖으로 남긴 것은 detail 에 적는다: merge·cherry-pick·revert 가 main 에 만드는 커밋(Git Flow 는 main 에서 합친다. GitHub Flow 는 그 push 를 막는다). 훅이 줄의 일부만 막으면 그 나머지를 훅이 켜졌을 때 남는 줄(`{{hook:id}}`)로 나눈다 — 올린 커밋을 reset·filter-branch 로 고쳐 강제 push(no-rewrite-pushed 는 amend·rebase 만), package.json 밖 의존성(pin-deps), 브랜치 이름(protect-branch 가 아니라 branch-name 몫).
- **커밋 내용 검사는 git 의 pre-commit 으로, 막을 수 있는 건 GitHub 서버 설정으로(2026-11-06 사용자 결정)**: PreToolUse 는 명령이 돌기 전에 보므로 `python test_shop.py; git add .; git commit …` 처럼 앞 명령이 파일을 쓸 수 있으면 커밋 내용을 미리 알 수 없어 나눠 실행하게 막았다(헛막음). git 의 pre-commit 은 실제로 올라간 내용을 보므로 짐작이 없다 — 적용할 때 저장소 hooks 폴더에 설치하고, 이미 다른 pre-commit·`core.hooksPath`(husky 등)가 있으면 건드리지 않고 PreToolUse 검사를 그대로 둔다(알림). 규칙 줄이 훅으로 다 막히지 않는 두 곳은 「글을 늘릴지」만 따지지 않고 대안을 찾았다: Git Flow 의 main·develop 직접 커밋은 protect-branch 가 cherry-pick·revert 도 막게 넓히고, GitHub Flow 의 「squash 로 합치고 브랜치 지우기」·「PR 로만 합치기」는 GitHub 저장소 설정(squash 만 허용·합친 브랜치 자동 삭제·브랜치 보호)으로 서버에서 막는다 — 웹 화면·`gh api`·사람이 합쳐도 걸린다. 저장소 설정은 모두에게 영향을 주므로 적용 때 사용자가 켜야만 하고(기본 끔), 되돌리기는 이전 값으로 되돌린다.
- **사람마다 답이 다른 설정은 사용자가 고른다(2026-11-06 사용자 원칙)**: 우리가 하나로 정하지 않는다. 권장값을 기본으로 두고, 무엇이 달라지는지(맞바꾸는 것) 한 줄로 보여 준 뒤 사용자가 고른다. 예: GitHub 저장소 설정은 한 스위치로 몰지 않고 항목마다(Git Flow 의 main PR 요구는 로컬에서 release 를 합쳐 push 하는 흐름과 부딪혀 기본 끔, 관리자에게도 적용은 기본 켬 — 관리자인 나도 바로 push 못 함, 리뷰 승인 수 0·1·2), 훅 옵션은 고르기 화면에서 훅마다(커밋 메시지 언어, 큰 파일 줄 수, 보호할 브랜치 등 — 훅 코드가 실제로 읽는 옵션만 보여 준다, 시험으로 강제). 브랜치 방식이 넣는 옵션은 기본값이고, 사용자가 바꾼 값이 이긴다.
- **사용자 전역 훅에서 옮길 것, 답 언어는 옵션(2026-11-06 사용자 결정)**: 100% 잡는 것만 옮긴다 — push 전 커밋 묶기(팀마다 달라 기본 끔), 커밋 해시 알리기(끝낼 때), Swift `try!`·`print(`, Python `shell=True`·`eval(`(언어별), 작업 체크리스트(막지 않고 보여 주기만), docs 문서 형식 검사. 답 언어 검사(korean-check)는 낱말 수로 판단해 100%가 아니지만 놓쳐도 위험하지 않아 「사용자가 고른 언어로 답하게」 하는 옵션으로 둔다(기본 끔, 다국어 사용자를 위해 언어를 고른다). 시험 안 돌림·기록 남길지 묻기·하드코딩처럼 짐작이 필요한 것은 옮기지 않는다. 훅이 많아져 고르기 화면은 묶음(비밀·위험 / git 기록 / 코드 / 언어·도구별 / 일하는 방식 / 토큰 아끼기)으로 고르게 한다 — 시안 3개(`Downloads/find-your-skill-시안/훅-고르기/`)를 보여 주고 고른 것으로 만든다.
- **전역 훅에서 옮긴 훅 7개(2026-11-06, 위 결정을 만듦)**: 때마다 진입점 하나(`hooks/stop.mjs`·`session-start.mjs`·`prompt-submit.mjs`, 틀은 `hooks/lib/entry.mjs` — run.mjs 와 같이 설정 없으면 규칙 모듈도 안 불러오고, 오류면 통과하고 알림, Stop 은 `stop_hook_active` 면 통과). 기존 훅 겹침 시험도 같은 때로 넓혔다(`catalog/probes.json` 의 event·setup·transcript·checklist·expect, `scripts/lib/probe-run.mjs`) — 그 시험은 임시 저장소·임시 홈에서 돌려 사용자 홈을 건드리지 않고, PostToolUse 는 여전히 셈하지 않는다.
  - `squash-push`(git, 모든 조합 기본 꺼짐): push 할 브랜치에 원격 추적 브랜치 어디에도 없는 커밋이 2개 이상이면 막는다. 같은 명령의 앞선 `git commit` 도 센다. 원격 기록이 없는 첫 push·태그·지우기는 보지 않는다.
  - `commit-hash`(work, 혼자·팀·꼼꼼 기본): Stop 때 사람 턴 시작 뒤 reflog 의 커밋(브랜치에 남은 것, 최근 6개)마다 해시가 커밋 뒤 답에 있는지. 셸 명령이 없던 턴은 안 보고, 같은 사람 턴에서 한 번만 묻는다(되먹임의 `[harness-fit · commit-hash]` 표시).
  - `swift-unsafe`·`python-unsafe`(lang, 그 스택이 감지되면 혼자·팀·꼼꼼 기본 — combos.json stackAddons 의 hooks): 주석·글자를 가린 뒤(`hooks/lib/code-mask.mjs`, 글자 속 `\( )`·f-글자 `{ }` 는 코드) 새 줄의 `try!`·`print(`·`debugPrint(` / `shell=True`·`eval(`·`exec(`. 시험 코드·받아 온 코드는 뺀다(시험은 앱을 죽여도 시험 실패일 뿐이라). 커밋 때 다시 보고 lint:allow 를 받는다. Python 의 exec( 는 eval( 과 같은 위험이라 함께 넣었다.
  - `work-checklist`(work, 혼자·팀·꼼꼼 기본, 막지 않음): `~/.claude/harness-fit/checklists/<프로젝트 이름-경로 지문>/<세션>.md` — 사용자 전역 `~/.claude/checklists/` 와 겹치지 않게.
  - `docs-check`(work, 꼼꼼 기본, 옵션 dateLine): 기계로 가릴 수 있는 것만 — docs/ 에는 .md·그림만(쓰기 때), 바뀐 문서의 `# 제목`·날짜 줄(날짜 = 파일을 고친 날)·목차 링크·목차의 끊긴 링크(Stop 때, 커밋 안 한 변경 + 이번 턴 커밋). 전역 docs-reminder 의 「바로잡는 말이면 묻기」는 짐작이라 옮기지 않았다.
  - `answer-lang`(work, 모든 조합 기본 꺼짐, 옵션 lang: ko·en·ja·zh): 전역 korean-check 의 낱말 수 기준을 글자 모양별로 넓혔다. 짐작이라 detail 에 밝혔다.
- **고르기 화면은 GitHub 바탕, 토스처럼 단계별로(2026-11-06 사용자 결정)**: 바탕 시안 A(GitHub Marketplace)·B(Vercel)·D(Notion) 중 A. 긴 한 쪽 대신 한 화면에 질문 하나(큰 제목 + 아래 「다음」), 마지막 확인 화면에서 항목마다 「바꾸기」로 돌아간다. 단계마다 주소(#)가 있어 뒤로 가기가 되고, 아무 단계로나 바로 갈 수 있어야 한다(「왔다갔다 편하게」). 훅 구획은 시안 3b(묶음 칩 + 오른쪽 자세히 판). A의 머리 막대·왼쪽 차례는 엉성하다는 지적으로 다시 짰고, 오가는 방식은 위쪽 단계 탭 + 오른쪽 요약 카드(A2-2)로 정했다. 이어서: 브랜치 방식은 조합 화면 아래로 합친다. 조합 카드마다 「켜지는 것 보기」를 둔다. 스킬·훅은 칩을 누르면 바로 켜고 끄며, 묶음마다 「자세히 보기」를 두되 따로 창을 만들지 않고, 넓은 「전체 보기」 창 하나(왼쪽 묶음 목록 + 오른쪽 항목, 검색)를 그 묶음에서 연다 — 스킬·자동 검사·「켜지는 것 보기」 모두 같은 창 꼴. 창은 가운데 띄우되 넓게(약 1040px, 휴대폰은 아래에서 올라오는 판). 스위치는 Primer ToggleSwitch 처럼 작게. 단추·칩·카드·줄·간격은 한 벌로 통일한다. 「고른 것」 요약은 조합과 브랜치 방식을 한 줄로 묶는다. 스킬은 조합이 켠 것과 「추가로 추천」을 나누고 전체 보기도 둔다. CLAUDE.md 규칙은 작은 줄로 두고, 실제로 적힐 글을 미리 보여 준다(줄여 보기/전체 보기). 글꼴은 Spoqa Han Sans Neo(국내 서비스에서 널리 쓰고 AI 화면에 흔하지 않은 것, SIL OFL — 한글 2,350자 묶음 woff2 3벌을 화면 파일과 함께 둔다), 스위치는 작게 길 안에 쏙 들어가게. 한 화면에 더 많이 보이게 촘촘히 — 시안 `Downloads/find-your-skill-시안/리뉴얼/mockups/`.
- **혼자 쓰는 저장소는 브랜치 방식을 권하지 않고, git 커밋 전 검사는 사람이 한 커밋도 본다(2026-11-06 사용자 결정)**: 혼자 쓰는 저장소의 기본 브랜치 방식은 지금처럼 「정하지 않음」. 저장소의 git pre-commit 은 누가 커밋하든(사람·Claude) 돈다 — 지금 동작 그대로 기본으로 둔다(git 의 `--no-verify` 로 건너뛸 수 있는 것은 git 의 약속).
- **훅이 오류로 멈추면 통과하고 알린다(2026-11-06 사용자 결정)**: 막으면 그 프로젝트에서 Claude 가 명령도 수정도 못 해 설정 파일조차 고칠 수 없고, git 커밋 전 검사라면 사람의 커밋도 멈춘다. 그래서 막지 않되, 조용히 꺼지지 않게 「○○ 검사가 오류로 멈춰서 이번 작업은 그 검사 없이 진행돼요」를 알린다(PreToolUse 는 systemMessage, pre-commit 은 stderr). 다른 검사가 막을 것을 찾으면 그대로 막는다. 모양이 틀린 입력(숫자 file_path 등)은 오류가 아니라 빈 값으로 읽는다(`hooks/lib/core.mjs normalizeInput`).
- **다시 열면 지난번 선택에서 시작(2026-11-06 사용자 결정)**: 이미 적용한 프로젝트에서 고르기 화면을 열면 새 추천이 아니라 지난번에 적용한 것(끈 훅은 꺼진 채)에서 시작한다. 적용할 때 `.claude/harness.json` 에 `selection`(조합·브랜치 방식·스킬·CLAUDE.md 규칙·팀 공유·날짜)과 `known`(그때 카탈로그 id)을 남기고, 켠 훅과 옵션은 `rules` 가 정본(훅은 lang·rules 만 읽는다). 그 뒤 새로 생긴 것은 꺼진 채 「새로 생김」 표시(더하기 목록 맨 앞), 「추천으로 되돌리기」는 「이전 선택으로 돌리기」로 되살릴 수 있다. auto 도 지난번 선택을 지키고 새것은 이름만 알린다(`--fresh` 면 새 추천). v0.2.2 이하 파일(selection 없음)은 CLAUDE.md 규칙·공유를 조합 기본값으로 채운다.
- **훅이 잘못 막은 줄 하나는 허용 주석으로 넘긴다(2026-11-06 사용자 결정)**: 훅 전체를 끄지 않게, 그 줄이나 바로 위 주석 줄에 `lint:allow <훅 id> <이유>`(이유 3자 이상, 없으면 그대로 막고 「이유가 필요해요」). 쓸 때마다 훅 id·file:줄·이유를 알린다(PreToolUse 는 systemMessage, pre-commit 은 stderr — 커밋은 막지 않음). 받는 훅은 줄을 보는 쓰기 검사와 그 커밋 때 검사뿐: unsafe-html·gha-inject·file-size(파일 맨 위 10줄 안)는 기본으로 받고, secrets 는 옵션 `allowComment`(기본 꺼짐)를 켜야 받는다 — 진짜 키에 주석 하나 달아 넘기기 쉬워서. pin-deps 는 package.json 에 주석을 못 달아, protected-files 는 줄이 아니라 파일을 봐서, 명령 훅은 줄 글이 없어 받지 않는다. 바로 위 줄은 주석만 있는 줄이어야 한다(코드 줄 끝 허용이 아래 줄까지 번지지 않게). 0.2.x 의 `harness:allow`·id `secret` 도 같은 규칙으로 받는다. 코드는 `hooks/lib/allow.mjs`, 시험은 `hooks/test/allow.test.mjs`. 옛 꼴 `harness:allow`(v0.2.0부터)도 계속 받는다(사용자 결정 — 이미 달린 주석이 갑자기 막히지 않게).
- **화면·알림 용어(2026-11-06 사용자 승인)**: 같은 분야가 쓰는 말로 맞춘다(Claude Code 한국어 문서·GitHub 한국어 문서·VS Code 한국어 언어 팩 확인). 자동 검사→훅, CLAUDE.md 규칙→CLAUDE.md 지침(Claude Code 는 CLAUDE.md 내용을 「지침」, `.claude/rules/` 를 「규칙」이라 부른다), 브랜치 방식·Git 전략→브랜치 전략, 막는 훅 이름은 「차단」(금지·막기 대신), GitHub Actions 구멍 막기→주입 차단, 합치기→병합(스쿼시 병합), 글 속 push→푸시, 켬·끔→켜짐·꺼짐, 추천→권장, 말투는 훅 알림까지 모두 해요체. 그대로: 스킬·플러그인·커밋·브랜치·저장소·토큰·되돌리기·적용(설정 전체)/설치(스킬)·PR·조합.
- **브랜치 전략을 고르면 팀원 공유를 적용 전에 묻고, 「이대로 적용」은 확인 단계를 거친다(2026-11-06 사용자 결정)**: 브랜치 전략은 팀이 함께 지켜야 뜻이 있으므로 「팀원도 같은 검사를 쓰게 할까요?」를 확인 단계에서 꼭 묻는다(답하기 전엔 적용 단추가 잠김). 「네」면 팀원이 할 일(커밋·푸시할 파일, Claude Code 에서 저장소를 열면 뜨는 설치 안내, git 커밋 전 검사는 공유되지 않는 점)을 적용 전·후에 보여 준다. 요약 카드의 「이대로 적용」은 바로 적용하지 않고 확인 단계로 간다.
- **CLAUDE.md 지침에 저장소 명령을 넣고 뻔한 줄은 뺀다(2026-11-06 사용자 결정, 시안 1안)**: package.json·Makefile·pyproject 에서 읽은 이 저장소의 시험·검사·빌드 명령을 「이 저장소 명령」 묶음으로 넣고, 구조 묶음에서 Claude 가 적지 않아도 하는 일반론 3줄(화면·상태 섞지 않기, 외부 라이브러리 감싸기, 미리 추상화하지 않기)을 뺀다 — 공식 권장 「지워도 Claude 가 실수하지 않을 줄이면 지운다」. 스킬 설명(catalog.json)은 「~한다」 꼴 그대로 둔다(사용자 결정).

## 설계 결정 (Claude)
- **훅은 Node 하나로**: 사용자 PC 에 Claude Code 가 있으면 Node 가 있다. 외부 패키지 없이 `node:` 내장 모듈만 쓴다(설치 단계 없음, 공급망 위험 없음).
- **훅 디스패처 하나**: 이벤트마다 스크립트 하나만 등록하고, 켜진 규칙만 돌린다. 규칙을 켜고 끄는 것은 프로젝트 `.claude/harness.json`. 훅을 여러 개 등록하면 도구 호출마다 Node 가 여러 번 떠서 느려진다.
- **기존 코드는 막지 않는다**: 파일 검사 규칙은 새로 들어간 줄만 본다(전역 훅 `~/.claude/hooks/lib/rules.mjs` 와 같은 원칙).
- **정적 검사로 지킬 수 있는 규칙은 글이 아니라 훅으로(2026-11-05 사용자 원칙 「글은 놓친다」)**: (2026-11-06: 이 중 hardcode 는 짐작이라 뺐고, `npm install` 로 들어간 범위는 이제 커밋 때 package.json 으로 본다 — 위 「훅은 약속한 것을 빠짐없이」) `hardcode`(코드에 바로 적은 색·주소·사용자 경로), `unsafe-html`(innerHTML·eval 류), `pin-deps`(package.json 범위 버전)를 훅으로 옮기고, 규칙 글은 `{{hook:id}}`/`{{!hook:id}}` 로 나눴다. 「새로 들어간 줄」은 Edit 이면 old_string 에 없던 줄, Write 면 원래 파일에 없던 줄(`hooks/lib/lines.mjs`). 잘못 막지 않으려고 설정·상수·토큰·테스트·빌드 결과 파일, CSS 변수 정의, localhost·example.com·이름 공간 주소, 고정 글자 innerHTML 대입, 정화 함수를 거친 줄은 뺀다. 허용 주석은 (2026-11-06: `lint:allow <id> <이유>` 로 바뀜 — 위 「허용 주석으로 넘긴다」) `harness:allow <id> <이유>`(비밀값과 같은 꼴). `pin-deps` 는 peerDependencies 를 보지 않는다(같이 쓸 수 있는 범위를 밝히는 자리라 범위가 맞다). `npm install <패키지>` 명령 검사는 넣지 않았다 — save-exact 는 프로젝트·사용자 .npmrc, 환경 변수, yarn·pnpm·bun 설정 어디서든 켤 수 있어 명령만 보고는 잘못 막는다. 혼자 빠르게·팀 협업·꼼꼼하게에 hardcode·unsafe-html, 팀 협업·꼼꼼하게에 pin-deps(가볍게는 그대로). 구조 규칙의 「정리는 따로 커밋」 줄은 협업 규칙과 겹쳐 뺐다.
- **훅 5개 더(2026-11-06)**: (같은 날 injection·log-secrets 는 짐작이라 뺐다) 글로만 두던 규칙을 검사로 — `injection`(값을 이어 붙인 SQL·셸 명령), `log-secrets`(로그에 비밀값·환경 변수·헤더 통째로), `gha-inject`(워크플로 run: 의 바깥 값, pull_request_target + PR 코드 checkout, 해시로 고정 안 한 남의 액션), `no-rewrite-pushed`(원격에 있는 커밋을 amend·rebase), `pr-merge`(squash·브랜치 지우기 없는 gh pr merge). 코드 쪽은 정규식 하나로 짐작하지 않고 따옴표·주석을 가려 읽은 뒤(`hooks/lib/code-scan.mjs`) 「호출 인자에 글자와 값이 함께 있는 꼴」만 본다 — SQL 은 글자에 SQL 낱말이 있을 때만, 미리 만든 변수·`token` 하나·참거짓·길이는 보지 않는다(덜 잡더라도 잘못 막지 않게). 워크플로는 쓴 뒤 파일 전체를 보되 쓰기 전에 있던 것은 막지 않는다. pr-merge 는 GitHub Flow 에만 딸린 훅이라 조합 목록이 아니라 브랜치 방식으로 들어가고, 조합을 펼칠 때 그 조합의 브랜치 방식 hooksOn/hooksOff 도 맞춘다(`expandCombo`, 화면 `defaultsFor` 와 같은 범위). 강제 push 는 보호 브랜치 검사에 둔다.
- **설치 방식은 라이선스로 나눈다**: MIT·Apache-2.0·BSD·ISC·MPL·CC-BY(-SA) 는 그 스킬 폴더만 커밋 해시로 고정해 복사(상시 토큰이 가장 적음 — 플러그인 전체를 깔면 안 쓰는 스킬 설명까지 들어간다). 라이선스 표기가 없거나 불분명하면 복사하지 않고 원 저장소 설치 명령을 안내한다.
- **조합은 '일하는 방식'으로, 스택은 자동으로**: 가볍게·혼자 빠르게·팀 협업·꼼꼼하게 4개. 스택별 스킬(React→react-best-practices 등)은 감지 결과로 더한다. 스택마다 조합을 만들면 고를 것이 너무 많아진다.
- **추천 기준**: 최근 6개월 커밋한 사람이 2명 이상이면 팀 협업 + GitHub Flow, 아니면 혼자 빠르게. develop 브랜치가 있으면 Git Flow. (처음엔 「커밋 3개 미만 → 가볍게」도 있었으나, 새 사용자는 새 저장소에서 시작하는 경우가 많아 뺐다.)
- **고르기 화면 보안**: 127.0.0.1·임의 포트, 데이터·적용 요청은 사용자 지정 헤더의 일회용 토큰(다른 사이트는 CORS 때문에 못 붙임), Host 검사(DNS 리바인딩), CSP, 외부 글은 textContent 로만. 화면이 보낸 선택은 카탈로그에 있는 id 만 남긴다.
- **토큰**: 진입 스킬은 `disable-model-invocation: true` 라 실행 전에는 설명도 문맥에 안 들어간다. 적용은 화면에서 바로 하고 Claude 는 결과 JSON 한 덩어리만 읽는다.
- **CLAUDE.md 겹침은 사용자 글하고만 견준다(2026-11-06)**: 다시 적용할 때 관리 구역(`harness-fit:start`~`end`)까지 견주면 지난번에 넣은 줄이 모두 「이미 있음」으로 빠진다. `scripts/overlap.mjs` 가 관리 구역을 뺀 프로젝트 CLAUDE.md 를 `projectClaudeMd` 로 주고(구역이 없으면 주지 않음 — 대화에 든 글과 같아서), setup 은 그것과 견준다. 근거: code.claude.com/docs/en/memory — CLAUDE.md 의 블록 HTML 주석은 문맥에 넣기 전에 지워진다. 그래서 대화에 든 CLAUDE.md 에서는 구역 표시가 안 보여 Claude 가 「구역 안은 빼라」를 지킬 수 없다.
- **실행 파일은 `cli/`(2026-11-06)**: 플러그인 맨 위 `bin/` 은 켜져 있는 동안 Bash 의 PATH 에 들어가고, claude.ai·Cowork 는 `bin/` 이 있는 플러그인을 설치하지 않는다(code.claude.com/docs/en/plugins-reference 「Standard layout」 Executables). harness-fit 의 npx 진입점은 Claude 가 부를 명령이 아니라서 `cli/harness-fit.js` 로 옮겼다(package.json `bin` 이 가리킴).
- **훅 명령은 exec 꼴(2026-11-06)**: `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/run.mjs"]`. 셸을 거치지 않아 띄어쓰기·한글이 든 경로도 따옴표 없이 한 인자로 간다(code.claude.com/docs/en/hooks 「Exec form and shell form」 — 경로 자리표시가 있으면 args 를 쓰라고 권함). `args` 는 Claude Code v2.1.139 부터(changelog). 기존 훅 겹침 시험(`existing-hooks.mjs`)도 남의 exec 꼴 훅을 셸 없이 돌린다.
- **받은 스킬 이름은 폴더 이름으로 맞춘다(2026-11-06)**: 명령 이름은 SKILL.md 의 `name` 이 정하고, 프로젝트 스킬이 번들 스킬·기본 명령과 같은 이름이면 그 명령을 대신한다(code.claude.com/docs/en/skills 「How a skill gets its command name」·이름 겹침 표). 실제로 sentry 스킬의 `name: security-review` 가 `/security-review` 를 가렸다. 받을 때 `name` 만 카탈로그 id 로 바꾸고(원래 이름은 `.harness-source.json` 의 `renamedFrom`), id 가 `config/reserved-skill-names.json`(code.claude.com/docs/en/commands 의 명령·번들 스킬·별칭) 에 있으면 받지 않는다. 카탈로그 id 가 목록과 겹치지 않는지 시험이 본다.
- **setup 스킬 머리말(2026-11-06)**: description 에 하는 일과 쓰는 때를 함께, `argument-hint: "[auto|undo]"`(code.claude.com/docs/en/skills 「Frontmatter reference」). `disable-model-invocation: true` 는 그대로(파일을 바꾸는 일이라 사용자가 부를 때만). `allowed-tools` 는 넣지 않는다 — 막는 기능이 아니라 미리 허락하는 기능이고 그 턴에만 유효해, 묻고 난 뒤 적용하는 흐름에는 도움이 없고 `Bash(node *)` 는 아무 node 코드나 허락하게 된다. 스킬이 안 보이면 `/reload-skills`(code.claude.com/docs/en/commands) 또는 새 세션.
- **MultiEdit 는 matcher·종류 표에서 뺐다(2026-11-06)**: 지금 도구 목록에 없다(code.claude.com/docs/en/tools-reference). `edits` 가 든 입력은 `normalizeInput` 이 그대로 받아 준다.
- **저장소 명령은 있는 것만, 지침 미리 보기는 적용과 같은 기준(2026-11-06)**: 「이 저장소 명령」(`rules/commands.*.md` 의 `{{cmd:종류}}`)은 `scripts/lib/commands.mjs` 가 package.json scripts(packageManager·잠금 파일로 npm·pnpm·yarn·bun — bun 은 `bun test` 가 스크립트가 아니라 늘 `bun run`)·Makefile 대상·pyproject(tox·hatch 스크립트·pytest·ruff·mypy, uv·poetry·pdm 잠금 파일이면 그 도구로)·Cargo(clippy·rustfmt 는 설정 파일이 있을 때만)·go.mod 에서 읽는다. 사용자 CLAUDE.md(관리 구역 밖)에 이미 적힌 명령은 뺀다. 명령은 서버가 읽은 값만 쓰고 화면이 보낸 값은 받지 않는다(CLAUDE.md 에 들어갈 글이라). 찾은 것이 없으면 지침 목록·조합 기본값에서 숨긴다. 「뺀 줄 보기」·「줄을 대신 맡는 훅」은 `renderRuleDetail` 의 뺀 줄(훅·스킬·이미 있음)과 `{{!hook:id}}` 에서 내고, `/api/preview` 의 지침 글은 적용과 같이 플러그인이 없으면 「훅 꺼짐」 글로 낸다(전에는 미리 보기만 훅 켜짐 기준이었다). 훅 종류 `kind`: 명령·쓰기를 막으면 block, 알리거나 끝낼 때 되묻기만 하면 notice(커밋 해시 알리기·작업 체크리스트·답 언어 맞추기). 「차단하는 것만」은 block 훅 중 이 저장소에 맞는 것만 켠다(이미 있는 훅과 겹침·지금 브랜치 전략이 끄는 것·다른 스택 전용·어느 조합도 기본으로 켜지 않는 것은 뺌). 화면 문구는 `picker/i18n/<lang>/*.json` 로 나눴고(파일 400줄 한도), 영어 수 문구는 `{n|one|other}` 로 단·복수를 고른다(Intl.PluralRules).

## 바뀐 이력
- 2026-11-06: 전역 훅에서 옮긴 훅 7개(squash-push·commit-hash·swift-unsafe·python-unsafe·work-checklist·docs-check·answer-lang), Stop·SessionStart·UserPromptSubmit 진입점, 그 때의 기존 훅 겹침 시험.
- 2026-11-06: 전역 훅에서 옮길 것·답 언어 옵션·훅 고르기 화면 묶음(사용자 결정).
- 2026-11-06: 사람마다 답이 다른 설정은 사용자가 고른다(사용자 원칙).
- 2026-11-06: 커밋 내용 검사를 git pre-commit 으로, Git Flow cherry-pick·revert, GitHub 저장소 설정(사용자 결정).
- 2026-11-06: 레드팀 25건 확인·엄격 사례로 남김, 헛막음 3꼴(값을 가리키는 이름·켜고 끄는 값·따옴표 속 글)과 --message 줄임·checkout <커밋> . 빈틈 고침, merge 커밋은 약속 밖이라 detail 에 적음, 훅이 일부만 막던 규칙 줄 3개를 나눔.
- 2026-11-06: 짐작하는 훅 3개(hardcode·injection·log-secrets) 뺌, 남은 훅의 빈틈을 막고 커밋 때 다시 보기, 규칙 글을 핵심만, 엄격 시험·fp-scan 추가.
- 2026-11-06: 훅 5개(injection·log-secrets·gha-inject·no-rewrite-pushed·pr-merge) 추가, 겹치는 규칙 줄은 훅이 꺼졌을 때만.
- 2026-11-05: 4차 검토 반영(겹침 판정은 PreToolUse 만·브랜치 방식별, 약속대로 안 될 때 알리기, GitHub Flow main push 막기).
- 2026-11-05: 이미 있는 훅·스킬·CLAUDE.md 와 겹치면 넣지 않기, 규칙 줄마다 훅·스킬·판단 표시, 「훅이 막는다」 줄 없앰, 겹침 묶음.
- 2026-11-05: 정적 검사 훅 3개(hardcode·unsafe-html·pin-deps) 추가, 겹치는 규칙 글은 훅이 꺼졌을 때만 넣음.
- 2026-11-05: 구조 · 재사용 규칙 묶음과 code-simplification 기본 스킬 추가.
- 2026-11-02: 처음 작성.
- 2026-11-02: 설치 방식·조합·추천 기준·화면 보안·토큰 결정 추가.
- 2026-11-02: 고르기 화면 2차와 요청 칸 결정 추가.
- 2026-11-02: 사용성 평가 반영 결정(브랜치↔훅, 조건부 문장, 팀 공유, 요청 파일, 실행 파일 공개) 추가.
- 2026-11-02: 재평가 반영(플러그인 버전 태그 고정, 조합 전환 되돌리기, 누적 알림) 추가.
- 2026-11-02: 스킬·훅·규칙 종류 표시, 약속 → 규칙 통일. 2차 화면 설명의 「약속」은 당시 표현 그대로 둠.
- 2026-11-02: v0.2.1. README 그림을 연한 바탕 + 창 틀로 다시 찍음(사용자 선택: 시안 1), 막는 실수·끝 화면 그림 추가.
- 2026-11-02: 빈 저장소일 때 먼저 묻고, 알려 준 스택·인원을 추천에 넣는 결정 추가.
- 2026-11-02: 전체 검토 반영(되돌리기 안전, 재시도, 훅 낱말 단위 읽기, 화면 잠금) 추가.
- 2026-11-02: `.harness-source.json` 을 외부 코드 표시로 쓰는 약속 추가.
- 2026-11-02: v0.2.2(빈 저장소 질문, 1~3차 검토 반영). 「끝내기 전 확인」은 실험 갈래에만 두고 전역 훅으로 기록을 모은 뒤 합칠지 정한다.
- 2026-11-02: 이름을 find-your-skill → harness-fit 로 바꿈(사용자 결정). 스킬만 찾는 도구처럼 들리고 영어로는 「적성 찾기」로 읽혀서. harness-kit 은 같은 분야 저장소(RealZST/HarnessKit ★478 등)와 겹쳐 뺐다. 명령은 /harness-fit:setup, 설정 파일은 .claude/harness.json.
- 2026-11-06: 고르기 화면 바탕 A(GitHub)·단계별 진행 결정 추가.
- 2026-11-06: 혼자 쓰는 저장소 브랜치 방식 기본값·사람 커밋 검사 결정 추가.
- 2026-11-06: 훅 오류 때 통과 + 알림 결정 추가.
- 2026-11-06: 다시 열면 지난번 선택에서 시작하는 결정(harness.json selection·known, 새로 생김, 추천으로 되돌리기) 추가.
- 2026-11-06: 허용 주석 `lint:allow`(이유 필수, 쓸 때마다 알림, 비밀값은 옵션) 결정 추가.
- 2026-11-06: 공식 문서 대조(CLAUDE.md 사용자 글만 견주기, cli/ 로 옮김, 훅 exec 꼴, 받은 스킬 name 맞추기·명령 이름 겹침, setup 머리말, MultiEdit 뺌) 결정 추가.
- 2026-11-06: 화면·알림 용어표 결정 추가.
- 2026-11-06: 팀원 공유 묻기·확인 단계 거치기 결정 추가.
- 2026-11-06: 고르기 화면을 승인 시안 A2-6 대로 다시 지음(6단계 주소 #, 요약 카드, 훅 묶음은 `hookGroups` 데이터로·빈 묶음 숨김, 넓은 전체 보기 창 하나, Spoqa 글꼴은 `picker/fonts/` 에서 바이트로). 디자인 정본은 `Downloads/find-your-skill-시안/리뉴얼/DESIGN.md`. 시안의 「줄을 대신 맡는 훅」·「뺀 줄 보기」·훅 「막는 것만」은 서버 데이터가 없어 뺐다. 적용은 확인 단계의 단추만 하고(요약 카드는 확인 단계로), 브랜치 전략을 정했으면 「팀원도 같은 훅을 쓰게 할까요?」를 답해야 적용된다(사용자 요청) — 「네」면 올릴 파일·설치 안내·git 커밋 전 훅은 팀원 PC 에 따로 깔아야 함(그 PC 에서 /harness-fit:setup 적용)을 화면과 결과 JSON(teammates)에 낸다.
- 2026-11-06: 고르기 화면 디자인 일관성 점검(정적 FLOOR 0, 390·1280 한·영 렌더, 대비 계산, 바탕 수치 대조 — 결과와 이유는 DESIGN.md 결정 기록·§ 바탕에서 바꾼 곳). README 두 벌을 6단계·훅 23개·최소 Claude Code v2.1.139 로 고치고 그림을 실제 화면에서 다시 찍음(연한 바탕 + 창 틀 그대로).
- 2026-11-06: 지침 1안(저장소 명령·뻔한 줄 빼기), 스킬 설명 꼴 결정 추가.
- 2026-11-06: 지침 1안·A2-6 빠진 기능 구현 — 「이 저장소 명령」 지침(npm·pnpm·yarn·bun·Makefile·pyproject·Cargo·go), 구조 지침 뻔한 3줄 삭제, 「줄을 대신 맡는 훅」 칩·「뺀 줄 보기」, 훅 kind(block·notice)와 「차단하는 것만」, 끝 화면 「들어간 것」을 「생기는 것」과 같은 목록 줄로, 영어 단·복수, 화면 문구 파일 나눔. README 두 벌·그림 다시 찍음.
- 2026-11-06: v0.3.0(새 고르기 화면, 훅 23개·4개 진입점, git 커밋 전 훅, GitHub 저장소 설정, 지난번 선택 이어 쓰기, lint:allow, 용어 통일, 지침에 저장소 명령).
