## 협업
- 커밋은 `타입: 설명` 형식으로 쓴다. {{!hook:commit-msg}} {{!fmt:commit}}
- 이유가 다른 변경(기능·버그 수정·정리·이름 바꾸기)은 커밋을 나눈다. {{judge}}
- {{pr}} 설명에는 바꾼 까닭과 확인에 쓴 명령·결과를 적는다. {{!skill:pr-writer}}
- 이미 푸시한 커밋은 다시 쓰지 않는다. {{!hook:no-rewrite-pushed}}
- 이미 푸시한 커밋을 reset·filter-branch 로 고쳐 강제 푸시하지 않는다. {{hook:no-rewrite-pushed}}
- 보호 브랜치·승인 규칙 설정은 사용자가 시킬 때만 바꾼다. {{!hook:protect-rules}}
- push·{{pr}} 전에 올라갈 커밋(`git log @{u}..HEAD`, 새 브랜치면 `git log <기준>..HEAD`)이 이번 작업의 것뿐인지 본다. 다른 세션·에이전트의 커밋이 섞였으면 멈추고 묻는다. {{judge}}
- 병합된 {{pr}} 을 되돌릴 때도 `git revert` 커밋을 브랜치에 올려 {{pr}} 로 검토받는다. {{hook:self-merge}}
