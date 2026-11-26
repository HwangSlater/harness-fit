## Branch strategy: GitHub Flow
- Keep `main` deployable at all times. {{judge}}
- Work on branches and merge each one through its {{pr}}. {{!hook:protect-branch}}
- Branch names start with `feature/…` or `fix/…`. {{!hook:branch-name}}
- Keep each {{pr}} to one feature; split it at roughly 400 lines. {{judge}}
- Squash-merge, then delete the merged branch. {{!hook:self-merge}}
- When the work is done, commit on the branch, show what changed and stop. Push and open the {{pr}} only when the user asks. {{judge}}
- Once the {{pr}} is open, teammates review, approve and merge — Claude does not merge, approve or schedule auto-merges, nor merge locally and push straight to a protected branch. {{hook:self-merge}}
