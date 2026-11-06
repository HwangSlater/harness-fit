## Branch strategy: Trunk-based
- Merge small changes into `main` at least daily; branches live less than a day. {{judge}}
- Hide unfinished work behind feature flags, and keep `main` passing the tests. {{judge}}
- Never force-push to main. {{!hook:protect-branch}}
