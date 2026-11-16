## Commands in this repo
- Test: {{cmd:test}} — run it before finishing whenever you changed code. {{judge}}
- One test only: {{cmd:testOne|pkg=package}} {{judge}}
- Lint: {{cmd:lint}} — run it before finishing whenever you changed code. {{judge}}
- Type check: {{cmd:typecheck}} {{judge}}
- Format: {{cmd:format}} {{judge}}
- Build: {{cmd:build}} {{judge}}
- Other commands: {{cmd:tools}} — read the file that defines each one before using it. {{judge}}
- Run by a person: {{cmd:asked}} and the like — left out of the list above; Claude does not run them (the user runs them). {{hook:ask-cmd}}
- Generated code: never hand-edit code sqlc generates (the `out` folder in its config); change the queries (`.sql`) and regenerate with {{cmd:sqlc}}. {{judge}}
