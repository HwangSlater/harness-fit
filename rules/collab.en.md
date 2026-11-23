## Collaboration
- Commits use `type: description`. {{!hook:commit-msg}} {{!fmt:commit}}
- Split changes with different reasons (feature, bug fix, cleanup, rename) into separate commits. {{judge}}
- PR (MR on GitLab) descriptions give the reason for the change and the commands used to verify it, with their results. {{!skill:pr-writer}}
- Never rewrite commits that are already pushed. {{!hook:no-rewrite-pushed}}
- Do not rework pushed commits with reset or filter-branch and force-push them. {{hook:no-rewrite-pushed}}
- Change protected branches or approval rules only when the user asks. {{judge}}
- Before a push or PR, check that the commits going up (`git log @{u}..HEAD`, or `git log <base>..HEAD` for a new branch) are all from this task; if another session or agent's commits are mixed in, stop and ask. {{judge}}
- Reverting a merged PR/MR also goes through review: put the `git revert` commit on a branch and open a PR/MR. {{judge}}
