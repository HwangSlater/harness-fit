## Git strategy: Git Flow
- `main` = what is released, `develop` = what goes into the next release. Never commit to either directly.
- A hook blocks direct commits to main and develop. {{hook:protect-branch}}
- Branch `feature/*` from develop and merge back; prepare releases on `release/*`; branch `hotfix/*` from main and merge into both main and develop.
- Tag main with a version (`v1.2.0`) on every release.
