## Next.js
- Read secrets only in server code (`server-only` modules, route handlers, server actions). Only `NEXT_PUBLIC_*` environment variables reach the browser. {{judge}}
- Never pass secrets, or values built from them, to client components (`"use client"`) through props. {{judge}}
- Do login and ownership checks inside route handlers and server actions too, not only in middleware. {{judge}} {{kind:backend|auth}}
- Use `dangerouslySetInnerHTML` only through the one sanitizer the repo keeps (DOMPurify or similar). {{judge}}
