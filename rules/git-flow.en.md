## Branch strategy: Git Flow
- `main` = what is released, `develop` = what goes into the next release. {{judge}}
- Never commit to main or develop directly. {{!hook:protect-branch}}
- Branch features from develop as `feature/*` and urgent fixes from main as `hotfix/*`. When a release or hotfix has been merged into main it must be merged back into develop — suggest a main → develop {{pr}} to the user and never leave it merged on one side only. {{judge}}
- Only `release/*` and `hotfix/*` merge into main; `feature/*` merges into develop only. {{!hook:merge-flow}}
- Tag main with a version (`v1.2.0`) on every release. {{judge}}
- When the work is done, commit on the branch, show what changed and stop. Push and open the {{pr}} only when the user asks. {{judge}}
- Once the {{pr}} is open, teammates review, approve and merge — Claude does not merge, approve or schedule auto-merges, nor merge locally and push straight to a protected branch. {{hook:self-merge}}
