# 결정

> 최종 수정: 2026-11-13 · 지금 유효한 결정 — 고르기 화면·CLAUDE.md 지침·스킬·GitHub·배포. 훅은 [decisions-hooks.md](decisions-hooks.md), 추천·감지는 [decisions-recommend.md](decisions-recommend.md), 옛 결정·원문은 [decisions-archive.md](decisions-archive.md)

한 항목은 제목 줄 + 결정 · 이유 · 어디서. 「사용자 결정」·「사용자 승인」·「사용자 요청」 표시가 있는 것은 사용자가 정했으니 바꾸기 전에 묻는다. 긴 근거·측정값·옛 이름은 archive 의 원문에 있다. 훅 원칙과 훅별 결정은 [decisions-hooks.md](decisions-hooks.md), 저장소를 읽어 조합·스택·묻는 명령·보호 경로를 정하는 결정은 [decisions-recommend.md](decisions-recommend.md) 에 있다.

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

### 「켜지는 것 보기」는 전체 보기와 같은 틀에 다 넣는다 (사용자 결정, 2026-11-10)
- 결정: 조합 미리 보기 창을 크기 고정(tall) 큰 창으로, 왼쪽 구획 목록(전체·스킬·훅·CLAUDE.md 지침·브랜치 전략) + 오른쪽 항목 줄. 스킬·훅은 전체 보기와 같은 줄(skillItem·hookItem)이되 스위치·옵션은 뺀다 — 미리 보기에서 켜면 고르려던 조합이 아니라 지금 선택이 바뀐다. CLAUDE.md 지침은 그 조합으로 골랐을 때 실제로 들어갈 줄을 처음부터 상자로 보여 준다(뺀 줄도). 브랜치 전략은 이름·설명·같이 켜는 훅. 구획마다 끝에 「다른 조합에는 있고 여기엔 없는 것」을 흐리게 — 가볍게처럼 적게 켜는 조합에서 빈 곳이 「무엇이 빠졌는지」를 알려 주는 자리가 되게. 스킬이 없으면 「스킬 단계에서 따로 고를 수 있어요」.
- 원칙(사용자 결정, 2026-11-11): 같은 꼴의 큰 창(전체 스킬 보기·전체 훅 보기·켜지는 것 보기)은 하나를 고치면 나머지도 함께 고친다 — 모양·배치를 창마다 따로 두지 않는다.
- 같은 GitHub 저장소 스킬은 묶는다(사용자가 시안 B2 + 왼쪽 목록 고름, 2026-11-11): 머리줄 = GitHub 아이콘 + 주인/**이름**(누르면 그 저장소가 새 탭으로 열림, 주소 앞부분은 `config/sources.json` webBase) · 노란 별(`--star`, Octicons star-fill) 수 · 개수, 아래 스킬들은 왼쪽 줄기로 잇는다. 줄마다 되풀이하던 저장소·별은 뺐다(「더 보기」에는 그대로). 왼쪽 목록은 단계(기획·설계…)가 큰 항목이고, 고른 단계만 그 안 저장소를 들여 펼친다 — 저장소를 따로 한 칸에 모으면 23개라 너무 길었다(단계/저장소 바꾸기·접는 칸도 찍어 봤다). 켜지는 것 보기는 「스킬」 아래 그 조합의 저장소. 저장소 이름은 주인/이름 전체(여러 주인의 skills 가 겹친다). 아이콘은 GitHub Octicons(MIT).
- 거쳐 온 것: 이름을 누르면 창 안 오른쪽에서 칸이 들어오는 꼴 → 「차라리 전체를 다 넣자」로 바꿈. 머리 탭(밑줄 탭·붙은 단추·바로가기)도 찍어 봤으나 「창마다 디자인 통일」로 전체 보기와 같은 왼쪽 목록을 골랐다(전체 보기는 묶음이 9개라 탭이면 넘친다).
- 같이 바뀐 것(사용자 요청): 스킬 「쓰는 때」·훅 「차단하는 때」(알림 훅은 「알리는 때」)를 「알아 둘 점」과 같은 굵은 머리말 꼴로. 색은 「알아 둘 점」 낱말만 `--warn-ink` — ✕·✓·⚠ 아이콘·색 이름표는 억지스럽다고 해 뺐다(lessons 「화면에 색을 더하라는 말」). 꺼진 지침 창도 켰을 때 들어갈 줄을 보여 준다(`act.ruleAlt` 가 /api/preview 를 그 선택으로 한 번 더 부름, 선택이 바뀌면 비움 — 체험판 서버도 이 길을 받는다). 고르기 칸(select)은 기본 화살표 대신 화면 아이콘(`selectField`). 전체 보기 왼쪽 목록의 지금 묶음에 붙던 둥근 파란 세로선은 뺐다(요약 카드의 지금 단계 선은 그대로). 찾기 칸은 한 번 만든 칸을 다시 써서 윈도 한글 조합이 끊기지 않게, 낱말 순서·띄어쓰기가 달라도 찾는다.
- 적용 뒤 화면: `C:\Users\doorc\Downloads\find-your-skill-시안\` 의 `조합-창\적용\`·`창-색\적용\`·`차단하는-때\적용\`·`고침\`(고르지 않은 시안은 지웠다)
- 어디서: `picker/combo-panel.js`, `picker/rule-dialog.js`(ruleLinesBox·altLines), `itemRow`(스위치·더 보기 없이도 그린다)

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

### 프로젝트 플로우 사이트의 체험판은 사본으로 돈다 (사용자 요청, 2026-11-10, ai-test 세션이 만듦)
- 결정: https://project-flows-seven.vercel.app/demo/harness-fit/ 에 고르기 화면 체험판. `picker/` 사본 + Vercel 함수(`project-flows/api/hf.mjs`)가 이 저장소 5f94970 사본으로 예시 저장소(sample-shop: Next.js·TS·Supabase)를 빈 임시 홈에서 계산한다. state·preview·스킬 원문은 실제로 돌고, apply·cancel·fresh·github 는 막는다.
- 지킬 것: 화면·서버 코드를 바꾸면 project-flows 에서 `node sync.mjs` → `npx vercel deploy --prod` 로 다시 맞춘다. 서버 경로(/api/state 등)나 응답 모양이 바뀌면 `api/hf.mjs` 도 고쳐야 한다. 사본은 `apply-flow.js` 의 실패 안내 한 줄을 바꾸고, 빌드가 그 자리를 못 찾으면 멈춘다.
- 어디서: `C:\Users\doorc\orca\projects\project-flows\`(sync.mjs·hf-build.mjs·api/hf.mjs)

### 목록 옵션은 칩, 확인 단계에 옵션 표 (사용자 결정 2안 + B안, 2026-11-12)
- 결정: 목록 옵션 칸(실행 전에 물을 명령·더 지킬 경로·보호 브랜치·커밋 타입)은 값마다 칩 하나. Enter 로 더하고 × 나 빈 칸 Backspace 로 뺀다. 쉼표·줄바꿈이 든 글을 붙여 넣으면 나눠 넣는다. 받지 않는 값은 빨간 칩으로 남기고 까닭을 칸 바로 아래 적는다. 저장소에서 찾은 값에는 저장소 표시를 하고, 칸 아래에 찾은 까닭을 한 줄씩 적는다. 확인 단계에는 켠 훅 가운데 기본값에서 바뀐 옵션만 「훅 · 옵션 · 값 · 바꾸기」 표로 보이고, 바꾸기를 누르면 그 훅의 옵션 칸으로 간다.
- 이유: 한 줄 글칸에 쉼표로 이어 적으면 긴 명령이 잘려 보이고, 어느 값이 저장소에서 왔는지, 무엇이 왜 빠졌는지 알 수 없었다. 거절 까닭은 모두 「셸 기호」로만 나왔다(화면 역할 평가, 2026-11-12). 적용 전에 무엇을 묻고 무엇을 지키는지는 훅 창 안에서만 보였다.
- 검토·화면 평가 반영(같은 날): 기본값이 있는 칸(지킬 브랜치)을 비우면 「아무것도 막지 않아요」 경고, 확인 표에 빠진 값과 빈 칸 경고, 20개를 넘는 값은 빨간 칩(말없이 버리지 않음), 꽉 찬 칸은 disabled 대신 읽기 전용(초점이 창 밖으로 빠졌다), 칸을 떠날 때 넣는 글은 누른 조작이 끝난 뒤에, 붙여 넣으면 적던 글과 합쳐서, 경로·명령의 \ 는 /, 브랜치는 쉼표·줄바꿈으로만 나눔, 찾은 까닭이 같은 값은 한 줄로 묶고 줄 앞 아이콘은 뺌(빈 체크 상자로 보였다), 같은 이유로 뺀 훅 안내는 한 줄로.
- 하지 않은 것(검토에서 나왔지만): 지침 문장의 「PR(GitLab 은 MR)」을 GitLab 저장소에서 「MR」로만 바꾸기 — 지침 조각에 저장소별 낱말 바꾸기 장치가 없고, 지금 문장도 뜻이 통한다. 비밀값 명령 1000개가 넘게 든 40KB 넘는 한 줄에서 판정이 제곱으로 느려지는 것 — 실제로 나오지 않는 입력이라 판정 구조를 다시 짜지 않았다(1000개 0.5초).
- 하지 않은 것: 1안(여러 줄 글칸)은 값마다 까닭을 붙일 수 없어 고르지 않았다. 3안(줄 목록)은 칸이 길어진다. A안(펼쳐 보기)은 확인 단계에서 한 번 더 눌러야 보인다.
- 화면 역할 평가 반영(2026-11-13): 미리 넣지 않고 제안만 한 값(커밋한 결과·논문 폴더)은 칸 아래 「+ 값」 단추로 넣는다. 화면에 아무 표시가 없어 정확한 글을 직접 쳐야 했다. 같은 까닭으로 묶인 값이 4개를 넘으면 앞 셋 + 「외 N개」로 줄이고 전체는 title 에 둔다. iOS 기본값 17개가 한 문단으로 이어졌다. 팀원 공유 질문에 「아니요」를 골라도 저장소에서 찾은 보호 경로가 있으면 파일 보호를 겹침으로 빼지 않는다(서버 추천 revived 와 같은 규칙). 적용 실패 안내는 파일 오류 코드별(권한·공간·사용 중)로, 연결이 끊기면 「적용 결과를 받지 못했어요」와 되돌리기 명령을 코드 꼴로 보인다. 스킬 받기가 호출 한도로 막히면 그 제목을 따로 보인다.
- 어디서: `picker/opt-list.js`(칩 칸), `picker/option-table.js`(확인 표), `picker/options.css`, `scripts/lib/suggest.mjs` 의 `why`(값마다 `{ k, at, ref }`, 화면 문구 `srcWhy_<k>`). 화면에 쓰는 글은 textContent 로만 넣는다.

### 옵션은 한 줄에 하나, 고르기는 설명 달린 메뉴 (사용자 결정 A안 + 드롭다운 4안, 2026-11-12)
- 결정: 훅 옵션은 옵션마다 한 줄 — 이름, 4px 아래 칸, 그 아래 설명이 같은 왼쪽 선에 선다. 칸은 제 폭(고르기는 내용만큼, 칩 칸 480px 까지), 설명만 줄 끝까지. 고르기는 브라우저 select 대신 직접 만든 메뉴: 버튼엔 짧은 이름, 메뉴엔 선택지마다 이름 + 설명 한 줄, 고른 줄 맨 앞에 체크(Primer ActionMenu). 선택지 데이터는 packs.json choices[].label(짧게)·desc. 긴 옵션 설명 셋은 한 줄로 줄이고 나머지는 「더 보기」로.
- 이유: 두 칸 격자에서 설명이 330px 에서 꺾이고 오른쪽이 비었다. 이름 길이마다 칸 시작이 들쭉날쭉했다. select 의 펼친 목록은 꾸밀 수 없고 긴 선택지(브랜치 규칙)가 칸 안에서 잘렸다. 설명이 8줄이라 읽히지 않았다.
- 하지 않은 것: 이름 열 맞춤(B안)은 칩 칸과 모양이 갈렸다. 짧은 선택지만 버튼 묶음(5안)·라디오 카드(6안)는 사용자가 4안을 골랐다. 입력칸을 줄 끝까지 늘리는 것 — docs/lessons.md.
- 어디서: `picker/menu-select.js`(키보드 ↑↓·Home·End·Enter·Esc, 밖을 누르면 닫힘, 열린 상태는 모듈에 두어 앱 전체를 다시 그려도 유지), `picker/options.js`, `picker/options.css`. GitHub 설정의 승인 수 고르기(github.js)는 아직 기본 select.

### 화면 부품은 공통 부품 하나로 (사용자 결정, 2026-11-12)
- 결정: 같은 역할의 화면 부품은 parts.js(또는 menu-select.js 같은 부품 파일)의 공통 부품 하나만 쓴다. 화면마다 button·select·checkbox 를 직접 만들지 않는다. 지금 공통 부품: btn(단추) · btnLink(주소로 가는 단추) · link(따로 서는 글자 단추) · lk(문장 속 글자 링크) · field(이름 + 칸) · navItem(창 왼쪽 목록) · segmented(붙은 단추 묶음) · checkRow(체크 줄) · toggleSwitch(스위치) · chip(칩) · menuSelect(고르기 메뉴) · listField(목록 칩 칸). 모양을 바꾸면 부품 한 곳만 고치고, 옛 부품(selectField·.selectw)은 지운다.
- 이유: 고르기를 메뉴로 바꾸고 GitHub 승인 수 칸만 옛 select 로 남긴 것을 사용자가 짚었다. 둘러보니 panel.js·combo-panel.js 가 각자 btn 을 두고, 화면 열두 곳이 단추를 직접 만들고, 훅 옵션만 날것의 체크 상자를 썼다.
- 지킬 것: 새 화면 요소를 만들기 전에 parts.js 에 같은 역할이 있는지 먼저 본다. 없으면 부품으로 만들어 넣는다.

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
- 묻는 명령·배포 대상은 적지 않는다(전체 검토 2026-11-13, 역할극 10·15·16): 「실행 전에 묻기」(ask-cmd)에 든 명령은 훅과 같은 맞추기(`hooks/lib/ask-match.mjs`)로 걸러 평소 명령에서 뺀다 — make backfill 을 물어도 make backfill-dry 는 남고, 화면에서 묻는 명령을 고치면 이 줄도 따라간다(`claude-md.mjs` withoutAsked). Makefile 대상은 이름의 운영 낱말에 더해 레시피가 fastlane 출시·서명(출시 레인 beta·release·upload_testflight…, 올리기 동작 deliver·pilot·upload_to_*, 인증서를 만드는 cert·sigh·produce, readonly 없는 match·match nuke)·xcrun altool·notarytool·agvtool new 를 부르면 뺀다. 시험·빌드·준비 레인(unit_tests·gym·setup_tools·release_notes)과 match --readonly 는 남긴다 — 처음엔 낱말 몇 개(test·build…)만 남겨 이것들이 다 빠졌다(검토 2026-11-13). Fastfile 이 있으면 레인 본문도 본다(읽기 전용 match 만 하는 certs 는 남고, 이름이 평범해도 upload_to_testflight 를 부르는 레인은 뺀다). 레인 판정은 묻는 명령과 같은 `scripts/lib/fastlane.mjs` 하나(검토 2026-11-13 — 묻는 make 대상과 여기서 빼는 대상이 같다). 맨 앞 마디가 plan·check·validate·lint·diff·template·verify 이거나 어느 마디가 dry 면 운영 낱말이 있어도 남긴다(make plan-prod·backfill-dry) — apply-plan·test-deploy 는 그대로 뺀다.
  - 「사람이 실행」으로 표시하지 않고 뺐다: 표시하려면 지침 조각(rules/commands.*.md)에 새 줄 꼴이 필요하고, 묻는 명령은 이미 훅이 확인 창으로 알린다. 매 대화 읽히는 글에 「쓰지 말 명령」 목록을 더하면 오히려 그 명령을 떠올리게 한다.
- 「그 밖의 명령」이 한도(10)를 넘으면 시험·검사·빌드·dry·plan 이름을 먼저, 개발 고리(up·down·dev·serve·watch·*-local)를 맨 나중에 뺀다 — 앞에서부터 자르니 make up·down 이 자리를 먹고 dbt-build·dbt-test 가 빠졌다(10 회차). 한도 안이면 순서를 바꾸지 않는다.
  - 개발 고리 낱말은 대상 이름 전체이거나 끝 마디일 때만 보고, 마이그레이션·시드(migrate·db·schema·seed 마디)는 개발 고리로 보지 않는다 — 아무 마디나 보아 make migrate-up 이 빠지고 make up·down·run 은 남았다(14 회차, 검토 2026-11-13). 서버 띄우기 하나(up·start·dev·serve·run 가운데 처음 것)는 보통 명령과 같은 차례로 남긴다(10 회차 정답지 M7 의 make up).
  - 한도 8 → 10: dbt 대상이 자리를 채워 make up 이(10 회차), 마이그레이션 대상이 make run 이(14 회차) 빠졌다. 늘어난 양은 이 지침 묶음 기준 10 회차 147 → 156, 14 회차 138 → 144, 16 회차 87 → 92 토큰(scripts/lib/tokens.mjs 어림값).
- Cargo 는 CI(.github/workflows·.gitlab-ci.yml)·Makefile 의 cargo 줄 옵션을 따른다: --workspace·--all·--all-targets·--all-features·--locked, clippy 는 -- 뒤의 -D/-W/-F lint 까지(cargo clippy --workspace --all-targets -- -D warnings — 11 회차). 그 하위 명령이 CI 에 없으면 [workspace] 저장소일 때만 다른 줄의 --workspace 를 따른다. -p·--release·출력 옵션은 따르지 않는다(한 패키지만·느린 빌드). clippy·fmt 는 설정 파일이 없어도 CI 가 돌리면 적는다. 하지 않은 것: CI 의 env RUSTFLAGS=-D warnings 를 명령 앞에 붙이기(PowerShell·cmd 에서 그 꼴이 안 된다).
- 감지 세부(pyproject scripts·이미 적힌 명령·Gradle 래퍼·Makefile 읽기·package.json 의 그 밖의 스크립트)는 [decisions-recommend.md](decisions-recommend.md) 「「이 저장소 명령」 감지 세부」.
- 어디서: `scripts/lib/commands.mjs`, `scripts/lib/claude-md.mjs`, `rules/commands.*.md`

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
- 팀 저장소(작성자 둘 이상)는 겹침을 프로젝트 안의 글·스킬과만 견준다 — 팀원에게 없는 전역 CLAUDE.md 때문에 보안 줄·스킬이 빠졌다(4·5 회차 2차). `skills/setup/SKILL.md`.
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
- 플러그인이 켜졌는지는 ① setup 스킬이 부른 명령의 `--in-plugin`(스킬은 플러그인이 켜져야만 있다) ② `CLAUDE_PLUGIN_ROOT` 가 이 플러그인 자리 ③ installed_plugins.json 차례로 본다. 폴더 이름으로 보지 않는다 — Bash 도구 환경엔 `CLAUDE_PLUGIN_ROOT` 가 없고 `--plugin-dir` 로 단 플러그인은 설치 목록에 안 남아, 역할극 2~6 회차 모두 훅이 도는데 「플러그인 없음」으로 잘못 알렸다(2026-11-11).
- 이유: 글도 검사도 없는 상태를 막으려고. 거꾸로 켜졌는데 꺼졌다고 하면 보고가 틀리고 지침에 훅이 하는 일이 글로 겹친다.
- 어디서: `scripts/lib/installed.mjs` `pluginActive`, `skills/setup/SKILL.md`

### 분야 지침 묶음: 머신러닝 실험·dbt·인프라 코드·iOS 앱·Rust (전체 검토, 2026-11-13)
- 결정: 스택에 딸린 지침 묶음 다섯을 더한다(llm·django·spring 과 같은 길 — `combos.json` stackAddons 의 rules, 혼자·팀·꼼꼼에서만, 가볍게는 빼고). ml ← PyTorch·scikit-learn·XGBoost·MLflow·Optuna·Hydra·wandb(시드·하이퍼파라미터는 설정에서, 실행마다 설정·커밋 해시·데이터 버전 기록, 기준과 견준 숫자, 체크포인트 덮어쓰지 않기, 표본으로 먼저). dbt ← dbt(`--select <모델>+` 로 하위(downstream) 모델까지 테스트, `--target prod`·`--full-refresh` 는 묻기, schema.yml 테스트 약하게 하지 않기·설명 달기, seeds·snapshots 행 안 고치기, profiles.yml 안 만들기). iac ← Terraform(OpenTofu 포함)·Ansible(독립 검토 2026-11-13: Kubernetes 만 있는 앱 저장소에 prevent_destroy·publicly_accessible·required_providers 같은 Terraform 줄이 들어가 묶음에서 뺐다. Ansible 은 ansible.cfg 나 playbooks/ 의 yml 이 있을 때만 — 장애 대응 Markdown 폴더 playbooks/ 는 아님. plan·diff·--check 요약, apply 는 시킬 때만, prevent_destroy·deletion_protection 유지, 0.0.0.0/0·공개 버킷은 이유가 있을 때만, state·tfvars·kubeconfig 커밋 안 함, 버전 고정). ios ← iOS(권한 문구·ATS 예외, Core Data 는 새 모델 버전, 서명 설정은 묻기, 강제 언래핑·as!·토큰은 키체인, xcodebuild test). rust ← Rust(unsafe 는 묻고 SAFETY 주석, clippy·test 를 CI 와 같은 옵션으로, 라이브러리엔 unwrap 대신 ?).
- rust 줄에 옵션을 박지 않는다(검토 2026-11-13): 처음엔 `cargo clippy --workspace --all-targets -- -D warnings`·`cargo test --workspace` 를 적어 「이 저장소 명령」과 같은 명령이 두 번 들어갔고(11 회차), CI 옵션이 다른 저장소에서는 두 줄이 어긋났다. 지금은 「CI 와 같은 옵션으로(「이 저장소 명령」에 있으면 그대로)」. 같은 검토에서 고친 말: 「아래 모델까지」 → 「하위(downstream) 모델까지」, 서명 설정 「묻지 않고 바꾸지 않는다」 → 「바꾸기 전에 묻는다」, Core Data 「새 모델 버전을 더해 그 버전을 현재 버전으로 정한다」, dbt 「그 모델을 쓰는 곳을 사용자에게 알린다」. ios 의 `xcodebuild test`(또는 `fastlane scan`) 줄은 그대로 — 옵션이 없고 시뮬레이터에서 돌린다는 뜻이 핵심이라.
- 이유: 역할극 15 개 분야 정답지 중 8 개의 꼭 있어야 할 것(M)이 카탈로그에 그 분야 지침이 없어 빠졌다(3·7 재현성·기준 비교, 10 dbt 테스트·prevent_destroy, 11 unsafe·clippy --workspace, 12 prevent_destroy, 15 plan 요약·공개 범위·보호 장치, 16 Info.plist·Core Data·서명).
- 줄은 모두 `{{judge}}`: ask-cmd(apply·운영 명령 묻기)·protected-files(.gitignore 의 tfstate·profiles.yml)·swift-unsafe(try!·print)는 줄의 일부만 맡아 줄을 지우지 않는다(「훅이 줄을 통째로 막을 때만 줄을 지운다」). swift-unsafe 가 맡는 try!·print 는 iOS 줄에 다시 적지 않았다.
- 하지 않은 것: ios 를 Fastlane 에 묶기(Fastlane 은 Android·React Native 저장소에도 있어 Info.plist·Core Data 줄이 맞지 않는다 — iOS 앱은 iOS 로 감지된다). 노트북 출력 지우기 줄(줄을 스택별로 거르는 표시가 없어 Jupyter 없는 ML 저장소에도 들어간다). Kubernetes 만 있는 저장소에 Terraform 낱말이 든 줄을 빼는 장치(줄을 넓게 써서 plan·diff·--check 를 같이 적었다).
- 크기: 한국어 126~239 토큰, 3~6 줄(llm 230·spring 201 과 같은 크기). 시험이 8줄 넘지 않는지 본다.
- 어디서: `rules/{ml,dbt,iac,ios,rust}.{ko,en}.md`, `catalog/packs.json` rules, `catalog/combos.json` stackAddons, 시험 `scripts/test/rules.test.mjs`

### 결제·돈 계산 지침 (사용자 결정 「결제 지침 새로 넣기」, 2026-11-13)
- 결정: 분야 지침 묶음 payments(「결제·돈 계산」)를 더하고 스택 Payments 에만 묶는다(위 묶음들과 같은 길 — 혼자·팀·꼼꼼, 가볍게는 빼고). 여섯 줄, 모두 `{{judge}}`: 금액은 통화 코드와 함께 최소 단위 정수(float 금지), 반올림·절사·수수료 계산은 코드대로 따르고 바꿀 일이면 묻기, 결제·환불 엔드포인트는 멱등성 키로 같은 결과(재시도해도 두 번 청구 없음), 웹훅은 서명 확인·이벤트 id 로 중복 거르기, 원장·결제 기록은 고치지 않고 반대 기록, 카드·계좌 번호 전체·CVC 는 로그·오류·테스트 자료에 남기지 않기.
- 이유: 14 회차 M5(금액 int64 최소 단위·반올림 규칙·원장 반대 분개)·M7(멱등성)이 카탈로그에 그 분야 지침이 없어 빠졌다.
- 감지(`scripts/lib/payments.mjs`): ① 결제 SDK 의존성 — package.json(stripe·@stripe/*·@tosspayments/*·@portone/*·iamport·braintree·@paypal/*·square·@adyen/*·@paddle/*·razorpay 등)·go.mod(stripe-go·adyen-go·braintree-go·plutov/paypal·square-go-sdk 등)·Python 의존성 이름(stripe·dj-stripe·adyen·braintree·paypal SDK·squareup·포트원·razorpay·django-payments)·Gemfile·build.gradle·pom.xml(com.stripe·com.adyen·com.braintreepayments·com.paypal.sdk·`com.squareup:square:` — okhttp·retrofit 의 com.squareup 는 아님)·composer.json. 이름을 통째로 맞춘다(설명·주석 글은 안 봄). 브라우저 전용 SDK(@stripe/stripe-js·@tosspayments/payment-widget-sdk·@portone/browser-sdk·braintree-web 등)는 세지 않는다([decisions-recommend.md](decisions-recommend.md) 「전체 검토 1-A」). ② 돈 도메인 코드 — git 이 아는 소스 파일의 폴더·파일 이름 마디에 ledger·payment·payout·settlement·refund·chargeback 가운데 둘 이상(14 회차는 SDK 없이 직접 처리 — internal/ledger·payment·settlement). 하나만으로는 아니다: 13 회차 shop-web 의 lib/payment.ts(결제사 승인만 부름)·checkout 화면. checkout·billing·charge·wallet·transaction 은 보지 않는다(장바구니·구독 안내·충전·DB 트랜잭션에 흔하다). 시험·예제·testdata·vendor·docs 폴더는 뺀다.
- 크기: 한국어 245·영어 172 토큰(llm 250 과 같은 크기).
- 하지 않은 것: 금액 float 변환을 막는 훅(언어마다 꼴이 달라 짐작하는 훅이 된다 — 「짐작하는 훅은 두지 않는다」. 14 회차 저장소는 golangci-lint forbidigo 로 이미 막는다). Redis 오류 때 fail closed(14 회차 M7 뒷부분)·「/v1 아래 미들웨어를 거치게」는 저장소마다 달라 지침에 적지 않았다. 결제 점검 스킬은 카탈로그에 맞는 것이 없다.
- 어디서: `rules/payments.{ko,en}.md`, `catalog/packs.json` rules, `catalog/combos.json` stackAddons, `scripts/detect.mjs`(스택 Payments), 시험 `scripts/test/record-payments.test.mjs`·`rules.test.mjs`

## 스킬

### 설치 방식은 라이선스로 나눈다
- 결정: MIT·Apache-2.0·BSD·ISC·MPL·CC-BY(-SA) 는 그 스킬 폴더만 커밋 해시로 고정해 복사. 라이선스가 없거나 불분명하면 원 저장소 설치 명령을 안내. 받은 스킬은 실행하지 않는다.
- 저장소 전체 라이선스가 없어도 스킬 폴더에 Apache-2.0·MIT 라이선스 파일이 있으면 복사 설치(anthropics/skills 의 mcp-builder·webapp-testing·frontend-design·skill-creator). docx·pdf 등은 독점이라 그대로 안내. 카탈로그 스킬 항목의 `license`, `scripts/dev/build-catalog.mjs` skillLicense.
- 이유: 상시 토큰이 가장 적다(플러그인 전체를 깔면 안 쓰는 스킬 설명까지 들어간다).
- 어디서: `scripts/lib/install-skill.mjs`

### 카탈로그는 스냅샷 + 실시간 보충 검색 (사용자 결정, 2026-11-02)
- 결정: 저장한 목록에 더해, 화면을 열 때 같은 검색어로 목록 기준일 뒤 새로 나오거나 바뀐 저장소를 찾는다. star 1000 이상은 `--stars=">=1000"` 로.
- 어디서: `config/sources.json`(`minStars`), `catalog/queries.json`, `scripts/fresh.mjs`

### 실행 파일이 든 스킬은 적용 전에 알린다 (2026-11-02)
- 결정: 고정 커밋 기준 실행 파일 목록을 catalog 에 적는다. 훅과 같은 일을 하는 스킬(`overlapsHook`)은 고를 목록에서 뺀다.
- 어디서: `scripts/dev/scan-skill-files.mjs`

### 스킬은 카탈로그의 파일 목록으로, 함께 받는다 — 호출 한도는 그대로 알린다 (전체 검토, 2026-11-13)
- 증상: 적용할 때 저장소마다 GitHub 트리 API(`/git/trees/<sha>?recursive=1`)를 토큰 없이 불렀다. 익명 한도는 60회/시간이라 검토 중 0 이 되어 모든 스킬이 HTTP 403 으로 실패했고, 화면에는 「받지 못한 스킬 … Claude가 다시 받아 볼게요」만 나왔다. 파일은 하나씩 받아 적용에 5~19초.
- 결정: 커밋이 고정이라 파일 목록도 바뀌지 않는다. `scan-skill-files.mjs` 가 복사 설치 스킬마다 `fileList`(스킬 폴더 기준 경로·크기)를 카탈로그에 적고(받을 때와 같은 `skillFiles` 기준 — 맨 위 스킬 humanizer 의 `files` 가 0 이던 것도 1), 적용은 API 없이 raw 파일만 받는다. 목록이 없는 항목(옛 카탈로그·잘린 트리)만 트리 API 로 — 이때 `gh auth token` 이 있으면 API 호출에만 붙인다(raw 에는 안 붙임, 토큰은 찍지 않음, 머리글을 깨는 값은 버림). 받기는 한 적용 안에서 동시 6개(`config/sources.json` downloadConcurrency, 여러 스킬이 나눠 씀), 본문까지 읽은 뒤 자리를 비운다. 파일 하나 시간 한도는 전처럼 20초(downloadTimeoutMs). 같은 스킬의 파일 하나가 실패하면 아직 차례를 기다리는 파일은 부르지 않는다. 받은 실제 크기로도 2MB 한도를 다시 본다.
- 호출 한도: 403 + `x-ratelimit-remaining: 0`·`retry-after`, 또는 429 면 「GitHub 호출 한도 — 약 N분 뒤 다시」(영어 「GitHub rate limit — try again in about N min」, N 은 retry-after 또는 x-ratelimit-reset 에서)로 실패시키고 `failed[]` 에 `reason: "rate-limit"`·`waitMin`·`retryAt` 을 붙인다. 걸린 뒤로는 그 적용 안에서 같은 호스트를 다시 부르지 않는다. 끝 화면은 받지 못한 스킬 아래에 그 까닭(한도면 몇 분 뒤, 아니면 오류 글)을, setup 스킬은 한도면 그 시각 전에는 다시 받지 말고 `gh auth login` 을 안내한다. 권한 없음 같은 보통 403 은 그대로 「HTTP 403」.
- 숫자(빅데이터 역할극 저장소 사본, 스킬 10개·저장소 4개·파일 56개, 3번 가운데 값): 전 API 4회·raw 56회·동시 1개, 적용 2.5초(두 묶음 2.49·2.55초, 첫 회 16.7초) → 뒤 API 0회·raw 56회·동시 6개, 1.58초(첫 회 3.5초). 스킬 없는 적용이 0.67초라 받기만 보면 약 1.9초 → 0.9초. 검토 때의 5~19초는 연결이 느릴 때라 파일 하나씩 기다리는 몫이 더 컸다.
- 하지 않은 것: raw 받기에 토큰 붙이기(raw 는 API 한도와 따로이고, 토큰을 퍼뜨릴 곳을 늘리지 않는다). 받기를 다시 시도하기(한도·오류는 바로 알리고 `--retry` 로 — 기다리는 동안 화면이 멈춘 것처럼 보인다). 카탈로그에 파일 해시까지 적기(커밋 고정으로 충분, 카탈로그만 커진다). 2MB 를 넘는 스킬(ui-ux-pro-max·react-native-best-practices 등)은 전처럼 받지 않는다.
- 어디서: `scripts/lib/net.mjs`, `scripts/lib/install-skill.mjs`, `scripts/lib/apply-run.mjs` installAll, `scripts/dev/scan-skill-files.mjs`, `picker/review.js`, `scripts/test/install-net.test.mjs`

### 같은 일을 하는 스킬은 조합에 하나만 (사용자 요청, 2026-11-05)
- 결정: `catalog/overlaps.json` 묶음마다 조합 기본값엔 하나만(꼼꼼하게에서 differential-review 를 뺐다 — find-bugs 와 같은 일). 화면에서 같은 묶음을 더하면 「비슷한 스킬이 이미 들어 있어요」(이름을 누르면 그 스킬로 — 위 「겹침 이름표」).
- 이미 있는 스킬: 같은 이름은 스크립트가, 하는 일이 같은 다른 이름은 setup 때 Claude 가 `scripts/overlap.mjs` 를 보고 `--similar` 로.

### 받은 스킬 이름은 카탈로그 id 로 (2026-11-06)
- 결정: SKILL.md 의 `name` 만 카탈로그 id 로 바꾸고 원래 이름은 `.harness-source.json` 의 `renamedFrom`. id 가 예약 이름이면 받지 않는다.
- 이유: sentry 스킬의 `name: security-review` 가 `/security-review` 를 가렸다.
- 어디서: `config/reserved-skill-names.json`, `scripts/lib/install-skill.mjs`

### 다시 받기와 덮어쓰지 않기 (2026-11-02·11-05)
- 결정: 받지 못한 스킬은 「들어갔다」고 말하지 않고 `--retry` 로 그 스킬만 같은 백업에 더해 받는다. harness-fit 이 넣지 않은 같은 이름 폴더는 덮어쓰지 않는다.
- 적용 실패 표시(`apply-run.mjs`): 쓰기 실패 뒤 자동 되돌리기가 `{ error: 'no-backup' }` 을 돌려주거나(던지지 않는다) 스킬 받기 자체가 터지면 partial — 화면·명령줄이 「바뀐 것 없음」이라 하지 않고 되돌리기를 권한다. 시험용으로 apply 에 undoRun·install 을 넣을 수 있다.
- 어디서: `scripts/apply.mjs`

### `.harness-source.json` 은 「받아 온 외부 코드」 표시 (사용자 결정, 2026-11-02)
- 결정: 사용자 전역 stop-gate 가 이 파일이 있는 폴더의 위반을 「고치지 말고 `.claude/lint.json` 의 external 에 적으라」로 안내한다. 파일 이름·위치를 바꾸면 그 안내도 같이 바꾼다.

### 스킬 목록 한도를 적용 전에 알린다 (사용자 승인, 2026-11-07 · 화면 말은 2026-11-09 「한도」로)
- 결정: 이 PC 의 사용자·프로젝트 스킬·명령과 켜진 플러그인 스킬에 새 스킬을 더해 한도의 80% 이상이면 확인 단계·요약 카드에 알리고 「권장대로 줄이기」를 보인다. 한도 늘리기는 안내만 한다.
- 이유: 넘으면 덜 쓴 스킬부터 설명이 빠지고, 새로 넣은 스킬이 먼저다(code.claude.com/docs/en/skills). 셈 방식은 문서에 없어 「넘을 수 있어요」로만 말한다.
- 남은 것: disable-model-invocation 스킬(handoff 등)도 목록 한도에 세는지 — 카탈로그에 그 표시가 없어 원문을 다시 읽어야 한다(scripts/dev/scan-skill-files.mjs).
- 어디서: `scripts/lib/skill-budget.mjs`, `picker/budget.js`(서버·화면 같은 함수, 기본 8,000자)

### 「권장대로 줄이기」 차례 (사용자 승인, 2026-11-07)
- 결정: 같은 일을 하는 스킬(겹침) → 직접 더한 것 → 조합·스택이 켜는 것은 첫 stage(주된 일)의 중요도 순 — git·ci·deploy·meta·docs·files < plan < review·security < impl·refactor·perf·design·ui < test·debug, 같으면 스택 맞춤을 조금 더 오래. 같은 차례면 설명이 긴 것부터 빼고, 다 뺀 뒤 중요한 것부터 다시 넣어 보아 목표 아래에 머물면 되살린다(겹침은 되살리지 않음). 뺀 것은 되돌릴 수 있다.
- 목표: 80% 선과 「지금 목록과 한도의 가운데」 가운데 큰 쪽(새 스킬 묶음과 상관없이 정해 다시 눌러도 더 빠지지 않는다). 지금 있는 것만으로 이미 80% 이상이면 한도(100%) 아래까지. 뺀 뒤 합계(skillBudget.trimTotal)를 내고, 세션은 그 숫자로만 말한다. 팀 저장소면 지금 목록이 이 PC 의 개인 스킬이라는 점과 「팀에는 다 넣기」 선택지를 말한다(SKILL.md).
- 이유: 설명 길이로만 줄이다가 「끝내기 전 확인」 이 먼저 빠졌다. 목표를 새 스킬 합계로 정하자 다시 누를 때마다 절반씩 빠졌고, 6,313/6,400자에서 11개를 다 빼라고 나왔다(역할극 8 회차).
- 어디서: `picker/budget.js` trimTier·trimPlan(차례표에 카탈로그 stage 가 다 있는지 시험이 본다)

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

### 보호 경로·마이그레이션 커밋 검사는 이 명령이 올리는 것만, 이름만 (독립 검토, 2026-11-11)
- 사례: Claude 의 아무 `git commit -m …` 이나 사용자가 손으로 stage 해 둔 보호 파일·마이그레이션 고침 때문에 막혔다(Claude 가 고칠 수 없는 막힘). 또 두 검사가 git 훅이 다른 검사를 맡을 때도 늘 commitPlan(stage 한 내용까지 읽음)을 불러 커밋마다 0.5초가 들었다.
- 결정: protected-files(사용자 보호 경로)·migration-edit 의 커밋 검사는 이 명령 자신이 올리는 것만 본다 — 같은 명령의 git add(파일·폴더·글롭·-u·-A)·`commit -a`·`commit <경로>` 가 올릴 작업 트리의 고침·지움·새 파일. 이미 stage 돼 있던 것은 보지 않는다. Claude 가 앞 명령에서 올린 길은 그 git add 를 볼 때 같은 검사로 막는다(`git add .`·`-A`·폴더 add 도, `git rm --cached` 는 마이그레이션 지우기로). 그래서 「앞에서 올리고 따로 커밋」도 막히고, 사용자가 올린 것만 지나간다.
- 하지 않은 것: 「stage 됐고 Claude 가 쓴 것 같으면」 막기 — 누가 stage 했는지 git 은 모르고 대화 기록으로 짐작하면 헛막음이 난다. 막고 「사용자가 올렸으면 직접 커밋하라」 문구만 바꾸기 — Claude 는 그 커밋을 끝내지 못하고 사용자가 매번 손을 써야 한다.
- 앞 명령에서 올리는 다른 꼴(검토 2026-11-11): `git add :/`·`":(top)"`(나머지 없음)과 빼는 pathspec 만 준 add(`":!src"`)는 저장소 전체(-A 와 같게), `:/경로` 는 저장소 맨 위 기준 그 경로. 대상을 낱말로 알 수 없는 add — `$(…)`·`` `…` ``·`$F`·`@(…)`·`--pathspec-from-file`·`xargs git add`·`git update-index --stdin·--index-info·--cacheinfo` — 는 「작업 트리의 바뀐 것 전부」로 본다(바뀐 보호 경로·마이그레이션이 실제로 있을 때만 걸려 헛막음이 작다). `git update-index [--add] 경로` 는 그 경로로(--assume-unchanged·--skip-worktree·--refresh 처럼 표시만 바꾸는 것은 아님). `git checkout <커밋> -- 경로`·`git restore --source … 경로` 는 그 명령을 볼 때 쓰기로 막는다(`hooks/lib/git-writes.mjs` — 보호 경로는 늘, 마이그레이션은 HEAD 가 아닌 커밋에서 가져올 때).
- 이름으로 준 보호 경로(`git add 경로`·`git commit 경로`)는 그 경로에 내용을 더하거나 고치는 변경이 있을 때만 막는다(git status 한 번). 바뀌지 않았거나 지운 것뿐이면 둔다 — 사용자가 지운 보호 파일을 `git commit config/limits.yaml -m …` 으로 커밋하던 것까지 막던 회귀(a8d8bfe 는 통과, `git add -u` 는 이미 통과).
- 남은 빈틈(놓치는 쪽): 스크립트·별칭 속에서 stage 하는 것(`npm run stage`, git alias), `git -C 다른폴더 add …`(경로를 지금 폴더 기준으로 읽는다), `git apply --cached`·`git read-tree`·`git stash pop`·`git cherry-pick -n`·`git merge --no-commit` 처럼 다른 내용을 stage 에 바로 올리는 명령, `git update-index --index-info` 로 지금 작업 트리에 없는 내용을 올리는 것(작업 트리의 바뀐 것만 본다). commitPlan(비밀값·코드 검사의 커밋 내용)은 `:/` pathspec 을 따로 맞추지 않는다.
- 이름만 읽는다: `hooks/lib/staged.mjs` commandStages — `git diff --name-status` 한 번(+ 새 파일을 올리는 add 일 때만 `ls-files --others` 한 번), 한 명령 안에서 두 검사가 `shared` 로 나눠 쓴다. 이름만 준 add(`git add src/a.js`)는 git 을 부르지 않는다. 26MB 를 stage 한 저장소(1MB 파일 26개, 이 PC, 5번 중앙값): `git commit -m` 보호 경로 457→0ms · 마이그레이션 504→0ms · 둘 다 499→0ms, `git add -u && git commit` 둘 다 568→44ms, `git add . && git commit` 둘 다 607→87ms(git 한 번이 이 PC 에서 약 45ms).
- 어디서: `hooks/rules/commit.mjs` protectedCommit, `hooks/rules/migration.mjs`, `hooks/lib/staged.mjs`, 시험 `hooks/test/strict-cases/write.mjs`·`migration.mjs`

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
- 되돌리기: 팀원 공유 settings.json 을 적용 뒤 사용자가 고쳤으면 우리가 더한 마켓·플러그인 칸만 뺀다(사용자가 더한 훅은 남김). 적용 전에 그 칸이 있었으면 그 값으로 되살린다. 마켓·플러그인 이름은 플러그인 폴더의 config/sources.json 에서 읽는다(처음엔 지금 폴더 기준으로 읽어 사용자 프로젝트에서 아무것도 못 빼고 「trimmed」 라고 했다 — 독립 검토가 잡음, 시험도 프로젝트 폴더에서 돈다). BOM 붙은 settings.json 도 읽는다. `scripts/lib/backup.mjs` withoutShare, `scripts/lib/plan.mjs`.
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
- v0.4.0 (2026-11-13, https://github.com/HwangSlater/harness-fit/releases/tag/v0.4.0): 실행 전에 묻기·막을 명령·migration-edit·stale-scratch 훅, 분야 지침 8→17개, 저장소 단서로 묻는 명령·보호 경로 미리 채우기, README·CI 명령, 옵션 칩·설명 달린 메뉴·확인 단계 옵션 표·공통 부품, 스킬 받기·겹침 시험·훅의 git 줄이기, 역할극 16 분야.
- 2026-11-13: 화면 역할 평가 반영 — 제안 값 「+」 단추, 긴 까닭 목록 「외 N개」, 팀원 「아니요」에도 저장소 보호 경로 유지, 적용 실패 안내를 오류 종류별로.
버전별 자세한 내용은 GitHub 릴리스(v0.3.0 부터)나 태그 메시지에 있다. 날짜별 옛 이력은 [decisions-archive.md](decisions-archive.md#바뀐-이력).

- v0.1.0 (2026-11-02): 첫 공개. 태그 메시지만.
- v0.2.0 (2026-11-02): 이름을 harness-fit 로. 태그 메시지만.
- v0.2.1 (2026-11-02): 스킬·훅·규칙 구분 표시. 태그 메시지만.
- v0.2.2 (2026-11-02): 빈 저장소 질문, 전체 검토 1~3차 반영. 태그 메시지만.
- v0.3.0 (2026-11-06): 새 고르기 화면, 훅 23개, git 커밋 전 훅, GitHub 저장소 설정, 용어 통일 — [릴리스](https://github.com/HwangSlater/harness-fit/releases/tag/v0.3.0)
- v0.3.1 (2026-11-07): 스킬 목록 예산 경고, CLAUDE.md 지침 손질, 사용자 rules 도 겹침 견주기 — [릴리스](https://github.com/HwangSlater/harness-fit/releases/tag/v0.3.1)
- v0.3.2 (2026-11-09, https://github.com/HwangSlater/harness-fit/releases/tag/v0.3.2): 조합 기본값을 저장소에 맞춤, prefer-gh 알림, 확인 단계 알림 한 줄, 스킬·훅 쉬운 한 줄과 알아 둘 점, 지침 창, 겹침 이름표, git 그래프 그림, 훅 한 번 30~60ms 줄임·테스트 나누기, 용어(테스트·코드 검사·한도), README·결정 문서 줄이기.
- 2026-11-09: 지금 유효한 결정만 분야별로 다시 정리, 옛 원문은 decisions-archive.md 로.
- 2026-11-11: 역할극 2~6 회차로 고친 것 — 플러그인 켜짐 판정, danger-cmd 의 DB 지우기, protected-files 의 셸 쓰기·경로 맞춤, 볼 파일 없는 훅·웹 지침 줄 빼기, 커밋 기록 언어로 commit-msg lang.
- 2026-11-11: 역할극 8·9 회차로 migration-edit 훅(커밋한 마이그레이션 고치기 막기)을 더하고 Flyway·Django·Alembic·Prisma 저장소에 기본으로 켬.
- 2026-11-11: 역할극 8·9 회차 — 템플릿 |safe·autoescape off, Django mark_safe·csrf_exempt, 설정 파일의 따옴표 없는 비밀값, migrate zero·flyway clean·celery purge -f.
- 2026-11-11: 역할극 7·8·9 회차 — 저장소 단서로 묻는 명령·보호 경로 미리 채우기, JVM·Django·ML 스택과 명령, Django·Spring 지침.
- 2026-11-11: 독립 검토 — migration-edit 의 폴더·글롭 헛막음, 보호 경로·마이그레이션 커밋 검사를 이 명령이 올리는 것만·이름만으로(커밋마다 0.5초 → 0~90ms).
- 2026-11-11: 역할극 10·11 회차와 검토 — ask-cmd 옵션 맞추기·시험 실행, terraform state·Kafka·s3 sync 내려받기, git rm·mv·checkout·restore·clean 의 보호 경로(git-writes.mjs 하나로), :/·알 수 없는 add, 지운 보호 파일 커밋 허용, 마이그레이션 글롭 복사·install·품은 폴더 지우기.
- 2026-11-11: 역할극 10·11 회차 뒤 검토 — 파일과 같은 이름의 브랜치 checkout 허용, git rm·checkout·restore 의 .·글롭·:/·폴더를 git 이 푼 파일로, 다른 커밋에서 폴더째 가져오는 마이그레이션, --dry-run=false·make -n, 대문자 _KEY 꼴의 제곱 시간과 공개 키·이름표 헛막음.
- 2026-11-12: 역할극 13·14 회차 — 배포 플랫폼 묻기, 공개 접두 비밀 이름·Go := ·주소 속 비밀번호, goose 마이그레이션, origin 없는 GitLab.
- 2026-11-12: 역할극 15 회차(인프라) — 보호 경로 글롭(* · **, .gitignore 꼴)과 글롭을 품은 폴더 지우기, ask-cmd 에 argocd·vault·terraform force-unlock, 비밀값을 찍는 명령(secretsmanager·ssm --with-decryption·kubectl get secret -o yaml·sensitive terraform output·vault kv get 등).
- 2026-11-12: 역할극 15 회차 독립 검토 — 도구 폴더(.terraform·dist·node_modules) 지우기 헛막음과 너비 우선 훑기, 앞이 / 인 보호 경로는 맨 위 기준, 화면의 너무 넓은 글롭 거르기, 파이프·파일·$( ) 로 넘기는 비밀값 명령과 kubectl 종류·이름만 jsonpath·vault sys/ 헛물음, vault --옵션 놓침.
- 2026-11-12: 역할극 15 회차 두 번째 독립 검토 — 비밀값 출력은 안 찍히는 곳(진짜 파일·값을 찍지 않는 도구·다시 안 쓰는 변수)만 두도록 뒤집음, kubectl 틀은 이름표 칸만 둠, dist·build·target 같은 흔한 이름 폴더는 git 이 무시하고 추적하지 않는 파일만 건너뜀.
- 2026-11-12: 역할극 15 회차 세 번째 독립 검토 — 비밀값은 화면에 분명히 닿을 때만 묻도록 다시 뒤집음(찍는 도구 목록, 2>&1·&> 는 넘겨쓰기, ( ) 묶음 뒤를 따름), kubectl metadata 는 이름표 칸만·secret.v1·--raw, 흔한 이름 폴더 git 확인을 한꺼번에(26.5초 → 0.4초).
- 2026-11-12: 옵션 칸 2안(칩)·B안(확인 단계 옵션 표) 적용, 저장소에서 찾은 값마다 까닭, 화면 문구의 「꼴」을 「형식·패턴·형태」로.
- 2026-11-12: 옵션 배치 A안(한 줄에 하나)·드롭다운 4안(설명 달린 메뉴) 적용, 긴 옵션 설명 줄이기.
- 2026-11-12: 화면 부품은 공통 부품 하나로(btn·navItem·segmented·checkRow·menuSelect), 옛 selectField 지움.
- 2026-11-13: 분야 지침 묶음 다섯(머신러닝 실험·dbt·인프라 코드·iOS 앱·Rust)을 스택에 묶음.
- 2026-11-13: 전체 검토 — 「이 저장소 명령」에서 묻는 명령·배포 대상 빼기, 한도를 넘으면 시험·검사부터, Cargo 는 CI 옵션대로. 앱 코드 없는 저장소·iOS 에 로그인 줄 빼기, 화면 파일 없는 TS 저장소에 unsafe-html 빼기.
- 2026-11-13: 전체 검토 1-A — Xcode 폴더·Swift 소스로 iOS, Fastlane 스택, 묻는 명령에 학습 입구 스크립트·dbt 운영 대상·--full-refresh·fastlane 레인·xcrun 올리기·Makefile 「리드만」, 보호 경로에 /data/·데이터 확장자·checkpoints/.
- 2026-11-13: 검토 — 「이 저장소 명령」에서 fastlane 시험·준비 레인·match --readonly 를 되살리고 출시·서명만 빼기(fastlane.mjs), 개발 고리는 이름 끝 마디로만(make migrate-up 되살림)·서버 띄우기 하나는 남기기·한도 10, rust 줄에서 cargo 옵션 빼기, 분야 지침 말 다듬기.
- 2026-11-13: 독립 검토 — fastlane ios <레인> 도 묻기, Makefile 설명은 리드·관리자만, Swift 소스만으로는 주 언어일 때만 iOS, dbt -t prod·outputs 블록, 인프라 지침은 Terraform·Ansible 만, 기호 올리기 레인 빼기, iOS 기본 묻는 명령과 까닭.
- 2026-11-13: 검토 셋째 — 묻는 명령의 fastlane 판정을 fastlane.mjs 하나로(본문으로 아는 ship 레인·플랫폼 낱말·레인을 부르는 레인), 묻는 명령 한도 10·까닭마다 하나씩 남기기, iOS 는 앱 단서가 있을 때만(Package.swift·Swift 소스만은 스택 Swift), 깊은 Xcode 프로젝트(KMP)도 iOS.
- 2026-11-13: 스킬 받기 — 카탈로그에 고정 커밋의 파일 목록(fileList)을 적어 적용 때 GitHub API 를 부르지 않음, 동시 6개로 함께 받기, 호출 한도(403·429)는 「약 N분 뒤 다시」로 알리고 끝 화면·setup 스킬에 까닭 보이기, 목록 없는 항목만 트리 API(gh 토큰은 API 에만).
- 2026-11-13: 기존 훅 겹침 시험 결과 캐시(설정 폴더 harness-fit/probe-cache.json)와 첫 시험 함께 돌리기 — auto 추천 26.7초 → 첫 15.5초·다음 1.8초.
- 2026-11-13: 사용자 결정 — 결제·돈 계산 지침 묶음(결제 SDK 의존성·원장·결제·정산 코드로 스택 Payments), 커밋한 결과·논문 폴더(bench-results/·paper 원고·그림 원자료)는 말없이 넣지 않고 적용 때 파일 보호에 넣을지 묻기.
- 2026-11-13: 검토 다섯째 — 버전 꼴 push 는 저장소에서 태그인지 찾아 보기, 운영 변수 DB 는 접속 자리만, Fastfile 여러 줄 문자열, 레인 판정 한 번에(1500×50 58초→0.14초), 브라우저 결제 SDK·화면 폴더 낱말 빼기, 학위 논문·학술 사이트·시험 기대값 폴더는 묻지 않기, 자동 되돌리기 no-backup·스킬 받기 터짐은 partial.
- 2026-11-13: 검토 넷째 — Fastfile 레인 부르기 자리·문자열 먼저 지우기·heredoc, python -m 모듈 꼴은 -m 뒤만, 버전 태그 push·운영 변수 DB·마이그레이션 묻기, iOS 기본 묻는 명령 더함, 읽기 전용 match 는 안 묻기.
- 2026-11-13: 전체 검토 — 훅의 git 프로세스 줄이기(저장소 맨 위·브랜치·HEAD 를 파일로, 필요한 조각이 있을 때만, 도구 호출마다 한 번). 읽기만 하는 git 명령 4→0번, 커밋 7→2번, Stop 11→5번.
- 2026-11-13: 400줄 한도에 맞춰 나눔 — 훅은 decisions-hooks.md, 추천·감지는 decisions-recommend.md. 회차별 목록은 주제마다 묶고, 뒤집히거나 합쳐진 줄은 decisions-archive.md 「2026-11-13 정리 때 옮긴 것」으로.
