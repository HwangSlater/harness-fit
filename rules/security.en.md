## Security
- Hooks already block secrets and dangerous commands; this covers judgment calls. {{hook:secrets}}
- Never put keys or tokens in code; read them from env variables or a secret store. {{!hook:secrets}}
- Never pass user input straight into paths, shells, SQL or HTML. Anything behind login needs an access check ("can I only see my own data?").
- Keep tokens, personal data and internal paths out of logs and error messages.
- Check maintenance status and license of new libraries, and pin versions.
