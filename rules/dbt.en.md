## dbt
- After changing a model, run `dbt build --select <model>+` (or `dbt test --select <model>+`) to test it and everything downstream, and check the result. {{judge}}
- Ask before running anything with `--target prod` or `--full-refresh`. {{judge}}
- Never delete or weaken tests in schema.yml; when renaming a column, tell the user what depends on that model. {{judge}}
- Give new models and columns a description and tests in schema.yml. {{judge}}
- Never edit existing rows in seeds or snapshots (ask if they need to change). {{judge}}
- Never create `profiles.yml` (connection details) in the repo. {{judge}}
