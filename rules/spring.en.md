## Spring Boot
- Do not put secrets in application*.yml; read them through `${ENV_VAR}` placeholders. {{judge}}
- Code that reads or changes owned data (orders, accounts) checks in the service that it belongs to the requester (also behind caches). {{judge}}
- Keep transactions on service methods, and check list queries for N+1 (fetch join, EntityGraph). {{judge}}
- Event and API response shapes only gain fields; never remove or rename them (consumers break). {{judge}}
- Error responses carry no stack traces, SQL or internal class names. {{judge}}
