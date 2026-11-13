## 브랜치 전략: GitHub Flow
- `main` 은 늘 배포할 수 있게 둔다. {{judge}}
- 작업은 브랜치에서 하고 PR(GitLab 은 MR)로 병합한다. {{!hook:protect-branch}}
- 브랜치 이름은 `feature/…`·`fix/…` 로 시작한다. {{!hook:branch-name}}
- PR 하나에는 기능 하나(대략 400줄을 넘으면 나눈다). {{judge}}
- 스쿼시 병합하고, 병합한 브랜치는 지운다. {{!hook:pr-merge}}
