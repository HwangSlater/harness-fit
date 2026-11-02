## Git strategy: Trunk-based
- Everyone merges small changes into `main` often (at least daily). Branches, if any, live less than a day.
- Hide unfinished work behind feature flags. `main` must always pass the tests.
- A hook blocks force-pushes to main. {{hook:protect-branch}}
