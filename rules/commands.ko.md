## 이 저장소 명령
- 테스트: {{cmd:test}} — 코드를 고쳤으면 끝내기 전에 테스트·검사를 돌린다. {{judge}}
- 테스트 하나만: {{cmd:testOne|file=파일|name=이름|pkg=패키지}} {{judge}}
- 검사: {{cmd:lint}} {{judge}}
- 타입 검사: {{cmd:typecheck}} {{judge}}
- 형식 맞추기: {{cmd:format}} {{judge}}
- 빌드: {{cmd:build}} {{judge}}
- 그 밖의 명령: {{cmd:tools}} — 하는 일은 그 명령을 정의한 파일을 읽고 쓴다. {{judge}}
- 사람이 직접 실행하는 명령: {{cmd:asked}} 등 — 위 목록에 넣지 않았고 Claude 는 실행하지 않는다(사용자가 직접 실행). {{hook:ask-cmd}}
- 생성 코드: sqlc 가 만든 코드(sqlc 설정의 `out` 폴더)는 손으로 고치지 않고, 쿼리(`.sql`)를 고친 뒤 {{cmd:sqlc}} 로 다시 만든다. {{judge}}
