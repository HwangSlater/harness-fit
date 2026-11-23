## 브랜치 전략: Git Flow
- `main` = 배포된 것, `develop` = 다음 배포를 모으는 곳. {{judge}}
- main·develop 에는 직접 커밋하지 않는다. {{!hook:protect-branch}}
- 기능은 develop 에서 `feature/*` 로, 긴급 수정은 main 에서 `hotfix/*` 로 딴다. release·hotfix 를 main 에 합치면 develop 에도 바로 되돌려 합친다(한쪽만 합친 채로 두지 않는다). {{judge}}
- main 에는 `release/*`·`hotfix/*` 만 합치고, `feature/*` 는 develop 으로만 합친다. {{!hook:merge-flow}}
- 배포할 때 main 에 버전 태그(`v1.2.0`)를 단다. {{judge}}
- main 하나로 쓰는 저장소(배포 설정·GitOps 저장소)는 develop 없이 브랜치 → main PR·MR 로 합친다. {{judge}}
- PR·MR 은 열고 멈춘다. 병합·승인은 팀원이 한다 — Claude 는 병합·승인·자동 병합 예약을 하지 않고, 로컬에서 합쳐 보호 브랜치로 바로 올리지도 않는다. {{hook:self-merge}}
