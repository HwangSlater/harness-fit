## 보안
- 키·토큰은 코드에 쓰지 않는다(환경 변수·시크릿 저장소). {{judge}}
- 파일·브랜치 지우기, DB 마이그레이션, 배포처럼 되돌릴 수 없는 명령은 실행 전에 묻는다. {{judge}}
- 사용자 입력은 SQL·셸·파일 경로·HTML 에 이어 붙이지 않는다(SQL 은 자리표시자, 셸은 인자 배열, HTML 은 이스케이프). {{!skill:security-and-hardening}}
- 로그인이 필요한 곳은 서버에서 「요청한 사람의 데이터인지」 검사한다. {{!skill:security-and-hardening}}
- 로그·오류 메시지에 비밀값·개인정보를 남기지 않는다. {{!skill:security-and-hardening}}
- 새 의존성을 넣기 전에 최근 릴리스 날짜와 라이선스를 확인해 답에 적는다. {{!skill:supply-chain-risk-auditor|security-and-hardening}}
- 의존성은 정확한 버전으로 넣는다. {{!hook:pin-deps}}
- package.json 밖의 의존성(requirements.txt·pyproject.toml 등)도 버전을 고정한다. {{hook:pin-deps}}
