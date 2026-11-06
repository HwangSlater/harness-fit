## Security
- Never put keys or tokens in code (use environment variables or a secret store). {{judge}}
- Ask before running anything that cannot be undone. {{judge}}
- Never put user input into SQL, shell commands, file paths or HTML as-is. {{!skill:security-and-hardening}}
- Where login is required, check that users only see their own data. {{!skill:security-and-hardening}}
- Keep secrets and personal data out of logs and error messages. {{!skill:security-and-hardening}}
- Check maintenance status and license before adopting a new library. {{!skill:supply-chain-risk-auditor|security-and-hardening}}
- Add dependencies at exact versions. {{!hook:pin-deps}}
- Pin versions outside package.json too (requirements.txt, pyproject.toml …). {{hook:pin-deps}}
