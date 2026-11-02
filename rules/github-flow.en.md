## Git strategy: GitHub Flow
- Keep `main` deployable. Work on `feature/<name>` or `fix/<name>` branches and merge through PRs.
- A hook blocks direct commits to main; create a branch first. {{hook:protect-branch}}
- One PR = one change. Split it when it gets hard to review (roughly 400+ lines).
- Squash-merge, then delete the merged branch.
