## Branch strategy: Git Flow
- `main` = what is released, `develop` = what goes into the next release. {{judge}}
- Never commit to main or develop directly. {{!hook:protect-branch}}
- Branch features from develop as `feature/*`; branch urgent fixes from main as `hotfix/*` and merge them into both main and develop. {{judge}}
- Tag main with a version (`v1.2.0`) on every release. {{judge}}
