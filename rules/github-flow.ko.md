## 브랜치 전략: GitHub Flow
- `main` 은 늘 배포할 수 있게 둔다. {{judge}}
- 작업은 브랜치에서 하고 PR(GitLab 은 MR)로 병합한다. {{!hook:protect-branch}}
- 브랜치 이름은 `feature/…`·`fix/…` 로 시작한다. {{!hook:branch-name}}
- PR 하나에는 기능 하나(대략 400줄을 넘으면 나눈다). {{judge}}
- 스쿼시 병합하고, 병합한 브랜치는 지운다. {{!hook:pr-merge}}
- 작업을 마칠 때는 로컬 병합 대신 PR(GitLab 은 MR)을 연다. {{skill:finishing-a-development-branch}}
- PR·MR 은 열고 멈춘다. 병합·승인은 팀원이 한다 — Claude 는 병합·승인·자동 병합 예약을 하지 않고, 로컬에서 합쳐 보호 브랜치로 바로 올리지도 않는다. {{hook:self-merge}}
