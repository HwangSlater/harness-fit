## 브랜치 전략: Git Flow
- `main` = 배포된 것, `develop` = 다음 배포를 모으는 곳. {{judge}}
- main·develop 에는 직접 커밋하지 않는다. {{!hook:protect-branch}}
- 기능은 develop 에서 `feature/*` 로, 긴급 수정은 main 에서 `hotfix/*` 로 딴다. release·hotfix 가 main 에 병합되면 develop 에도 되돌려 합쳐야 한다 — 사용자에게 main → develop {{pr}} 을 제안하고, 한쪽만 합친 채로 두지 않는다. {{judge}}
- main 에는 `release/*`·`hotfix/*` 만 합치고, `feature/*` 는 develop 으로만 합친다. {{!hook:merge-flow}}
- 배포할 때 main 에 버전 태그(`v1.2.0`)를 단다. {{judge}}
- 작업을 마치면 브랜치에 커밋까지 하고 바뀐 것을 보여 준 뒤 멈춘다. push 와 {{pr}} 열기는 사용자가 올리라고 할 때만 한다. {{judge}}
- {{pr}} 을 연 뒤 병합·승인은 팀원이 한다 — Claude 는 병합·승인·자동 병합 예약을 하지 않고, 로컬에서 합쳐 보호 브랜치로 바로 올리지도 않는다. {{hook:self-merge}}
