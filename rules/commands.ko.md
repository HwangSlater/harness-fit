## 이 저장소 명령
- 테스트: {{cmd:test}} — 코드를 고쳤으면 끝내기 전에 돌린다. {{judge}}
- 테스트 하나만: {{cmd:testOne|file=파일|name=이름|pkg=패키지}} {{judge}}
- 검사: {{cmd:lint}} — 코드를 고쳤으면 끝내기 전에 돌린다. {{judge}}
- 타입 검사: {{cmd:typecheck}} {{judge}}
- 형식 맞추기: {{cmd:format}} {{judge}}
- 빌드: {{cmd:build}} {{judge}}
- 그 밖의 명령: {{cmd:tools}} — 하는 일은 그 명령을 정의한 파일을 읽고 쓴다. {{judge}}
- 사람이 직접 실행하는 명령: {{cmd:asked}} 등 — 위 목록에 넣지 않았고 Claude 는 실행하지 않는다(사용자가 직접 실행). {{hook:ask-cmd}}
