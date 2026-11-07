# harness-fit

설계 메모: docs/decisions.md(왜 이렇게 정했나), docs/lessons.md(되풀이하면 안 되는 실수). docs/plan.md 는 로컬 전용 계획 문서(gitignore). 문서는 docs/ 에 Markdown 으로.

- 실행 의존성 없음. Node >= 18, ESM, `node:` 내장 모듈만. 화면도 외부 라이브러리 없이(picker/).
- 흐름: scripts/detect.mjs(저장소 읽기) → lib/catalog.mjs(추천·조합 펼치기) → picker.mjs(127.0.0.1 서버 + 화면) → apply.mjs(백업 → 파일 쓰기 → 스킬 받기, 되돌리기).
- 훅: 때마다 진입점 하나 — PreToolUse 는 hooks/run.mjs, Stop·SessionStart·UserPromptSubmit 은 hooks/stop.mjs·session-start.mjs·prompt-submit.mjs(틀은 hooks/lib/entry.mjs, 판정은 lib/events.mjs). 프로젝트에 .claude/harness.json 이 없으면 바로 통과(규칙 모듈도 안 불러옴), 오류면 통과하고 알림. 규칙은 hooks/rules/*.mjs, 문구는 hooks/messages/{ko,en}.json. 기존 훅 겹침 시험 입력은 catalog/probes.json(꼴은 scripts/lib/probe-run.mjs).
- 화면 문구는 실제 동작과 같은 데이터에서 만든다. 브랜치 방식↔훅은 catalog/packs.json 의 hooksOn/hooksOff, CLAUDE.md 문장은 rules/*.md 줄 끝 {{hook:id}} 조건.
- 화면에 넣는 카탈로그 글(외부 저장소에서 옴)은 textContent 로만. innerHTML 금지. 데이터 요청은 X-Harness-Token 헤더 + Host 검사.
- 외부 스킬은 커밋 해시로 고정해 받고 실행하지 않는다. 라이선스가 확실한 것만 복사, 나머지는 원 저장소 설치 안내.
- 카탈로그 갱신: 조사 → node scripts/build-catalog.mjs <조사.json> <SKILL.md 폴더> → node scripts/scan-skill-files.mjs. 검색어는 catalog/queries.json.
- 버전을 올릴 때: .claude-plugin/plugin.json version · package.json version · config/sources.json pluginRef · git 태그를 함께. 태그는 주석 태그로, 메시지는 첫 줄 「vX.Y.Z: 요약」 + 바뀐 점 글머리표 + 최소 Claude Code 버전(릴리스 커밋 메시지와 같게). 커밋과 태그 만들기는 따로 실행한다(전역 훅이 한 명령 안의 태그 옵션을 커밋 옵션으로 잘못 읽는다).
- 화면을 바꾸면 사용자 역할 평가(처음 쓰는 사람·팀 리드)로 클릭해 보고 확인한다.
- 시험: npm test. 해 보기: node cli/harness-fit.js (지금 폴더 저장소로 고르기 화면을 연다).
