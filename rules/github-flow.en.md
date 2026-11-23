## Branch strategy: GitHub Flow
- Keep `main` deployable at all times. {{judge}}
- Work on branches and merge through PRs (MRs on GitLab). {{!hook:protect-branch}}
- Branch names start with `feature/…` or `fix/…`. {{!hook:branch-name}}
- One feature per PR (split it at roughly 400 lines). {{judge}}
- Squash-merge, then delete the merged branch. {{!hook:pr-merge}}
- When finishing work, open a PR (an MR on GitLab) instead of merging locally. {{skill:finishing-a-development-branch}}
- Open the PR/MR and stop. Teammates review, approve and merge — Claude does not merge, approve or schedule auto-merges, nor merge locally and push straight to a protected branch. {{hook:self-merge}}
