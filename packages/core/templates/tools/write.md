## Write

Writes a file to the local filesystem.

Usage:

- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST read the full file first. A partial read is not enough for overwriting an existing file.
- `content` must be a single string. If you are writing JSON, serialize the full document to text before calling this tool.
- Prefer `Edit` for updating existing files. Use `Write` for new files or intentional full-file rewrites.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- NEVER proactively create documentation files (\*.md) or README files. Only create documentation files if explicitly requested by the User.
- NEVER proactively create one-off test script. Only create one-off test script files if explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "file_path": {
      "description": "The absolute path to the file to write (must be absolute, not relative)",
      "type": "string"
    },
    "content": {
      "description": "The complete file content as a string",
      "type": "string"
    }
  },
  "required": ["file_path", "content"],
  "additionalProperties": false
}
```
