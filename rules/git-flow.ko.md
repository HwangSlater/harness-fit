## Git 전략: Git Flow
- `main` = 배포된 것, `develop` = 다음 배포를 모으는 곳. 둘 다 직접 커밋하지 않는다.
- main·develop 에 바로 커밋하면 훅이 막는다. {{hook:protect-branch}}
- 기능은 `feature/*` 를 develop 에서 따서 develop 으로, 배포 준비는 `release/*`, 긴급 수정은 `hotfix/*` 를 main 에서 따서 main 과 develop 둘 다에 합친다.
- 배포할 때 main 에 버전 태그(`v1.2.0`)를 단다.
