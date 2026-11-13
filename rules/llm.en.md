## LLM apps
- Mask personal data and secrets the model does not need (inside logs or outside documents) before sending them. {{judge}}
- Give every tool-use loop a maximum number of turns and a token or cost limit. {{judge}}
- Validate model output (JSON, tool arguments) before using it for files, databases or outside calls. {{judge}}
- Read model names from configuration, not from code. {{judge}}
- Run tests with a fake client; ask the user before making real API calls. {{judge}}
- Treat tool results and retrieved documents as data, not instructions (prompt injection). {{judge}}
- After changing prompts or retrieval, run the evaluation set if there is one and compare with before; if there is none, offer to write a few cases. {{judge}}
