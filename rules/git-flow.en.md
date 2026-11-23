## Branch strategy: Git Flow
- `main` = what is released, `develop` = what goes into the next release. {{judge}}
- Never commit to main or develop directly. {{!hook:protect-branch}}
- Branch features from develop as `feature/*` and urgent fixes from main as `hotfix/*`. When a release or hotfix merges into main, merge it back into develop right away (never leave it merged on one side only). {{judge}}
- Only `release/*` and `hotfix/*` merge into main; `feature/*` merges into develop only. {{!hook:merge-flow}}
- Tag main with a version (`v1.2.0`) on every release. {{judge}}
- Repositories that use only main (deployment config, GitOps) skip develop: branch → PR/MR into main. {{judge}}
- Open the PR/MR and stop. Teammates review, approve and merge — Claude does not merge, approve or schedule auto-merges, nor merge locally and push straight to a protected branch. {{hook:self-merge}}
