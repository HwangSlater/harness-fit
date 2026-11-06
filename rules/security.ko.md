## 보안
- 키·토큰은 코드에 쓰지 않는다(환경 변수·시크릿 저장소). {{judge}}
- 되돌릴 수 없는 명령은 실행 전에 묻는다. {{judge}}
- 사용자 입력은 SQL·셸·파일 경로·HTML 에 그대로 넣지 않는다. {{!skill:security-and-hardening}}
- 로그인이 필요한 곳에는 「내 것만 보이는지」 권한 검사를 둔다. {{!skill:security-and-hardening}}
- 로그·오류 메시지에 비밀값·개인정보를 남기지 않는다. {{!skill:security-and-hardening}}
- 새 라이브러리는 유지보수 상태·라이선스를 보고 고른다. {{!skill:supply-chain-risk-auditor|security-and-hardening}}
- 의존성은 정확한 버전으로 넣는다. {{!hook:pin-deps}}
- package.json 밖의 의존성(requirements.txt·pyproject.toml 등)도 버전을 고정한다. {{hook:pin-deps}}
