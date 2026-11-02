## Security
- Hooks block writing or committing secrets such as keys and tokens. {{hook:secrets}}
- Never put keys or tokens in code; read them from env variables or a secret store. {{!hook:secrets}}
- Hooks block dangerous commands such as wiping the system or home, or piping a downloaded script into a shell. {{hook:danger-cmd}}
- Ask the user before running anything irreversible (deleting whole folders, piping a downloaded script into a shell, 777 permissions). {{!hook:danger-cmd}}
- Never pass user input straight into paths, shells, SQL or HTML. Anything behind login needs an access check ("can I only see my own data?").
- Keep tokens, personal data and internal paths out of logs and error messages.
- Check maintenance status and license of new libraries, and pin versions.
