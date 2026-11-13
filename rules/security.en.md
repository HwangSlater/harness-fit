## Security
- Never put keys or tokens in code (use environment variables or a secret store). {{judge}}
- Ask before running anything that cannot be undone, such as deleting files or branches, database migrations or deploys. {{judge}}
- Never concatenate user input into SQL, shell commands or file paths (SQL uses placeholders, shell uses argument arrays). {{!skill:security-and-hardening}}
- Escape user input that goes into HTML. {{!skill:security-and-hardening}} {{kind:web|html}}
- Where login is required, check on the server that the data belongs to the requester. {{!skill:security-and-hardening}} {{kind:backend|auth}}
- Keep secrets and personal data out of logs and error messages. {{!skill:security-and-hardening}}
- Before adding a dependency, check its latest release date and license and state both in your answer. {{!skill:supply-chain-risk-auditor|security-and-hardening}}
- Add dependencies at exact versions. {{!hook:pin-deps}} {{kind:pinned}}
- Pin versions outside package.json too (requirements.txt, pyproject.toml …). {{hook:pin-deps}}
