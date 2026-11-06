## 브랜치 전략: Git Flow
- `main` = 배포된 것, `develop` = 다음 배포를 모으는 곳. {{judge}}
- main·develop 에는 직접 커밋하지 않는다. {{!hook:protect-branch}}
- 기능은 develop 에서 `feature/*` 로, 긴급 수정은 main 에서 `hotfix/*` 로 따서 main·develop 둘 다에 합친다. {{judge}}
- 배포할 때 main 에 버전 태그(`v1.2.0`)를 단다. {{judge}}
