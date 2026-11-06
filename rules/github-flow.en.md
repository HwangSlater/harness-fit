## Branch strategy: GitHub Flow
- Keep `main` deployable at all times. {{judge}}
- Work on branches and merge through PRs. {{!hook:protect-branch}}
- Branch names start with `feature/…` or `fix/…`. {{!hook:branch-name}}
- One feature per PR (split it at roughly 400 lines). {{judge}}
- Squash-merge, then delete the merged branch. {{!hook:pr-merge}}
