## Edit

Performs scoped string replacements in files.

Usage:

- You must use `Read` tool at least once in the conversation before editing to get the required `snippet_id`. This tool will error if you attempt an edit without reading the file.
- `snippet_id` defines the search scope. Provide `file_path` only as an optional guard that the snippet belongs to the expected file.
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- If `old_string` is not unique, the tool returns candidate matches with line ranges, previews, and snippet ids that you can reuse in a follow-up edit.
- If `old_string` is not found, the tool returns the closest likely match in metadata, including a preview. If the only difference is escaping and there is a unique loose-escape match, the tool may use the configured model to correct `old_string` and `new_string` before retrying.
- `replace_all` has safety checks. For broad or short-fragment replacements, provide `expected_occurrences` so the tool can verify the exact number of matches before editing.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "snippet_id": {
      "description": "Required snippet_id returned by Read or a prior Edit error response.",
      "type": "string"
    },
    "file_path": {
      "description": "Optional absolute path guard. If provided, it must match the snippet's file.",
      "type": "string"
    },
    "old_string": {
      "description": "The text to replace within the snippet_id scope",
      "type": "string"
    },
    "new_string": {
      "description": "The text to replace it with (must be different from old_string)",
      "type": "string"
    },
    "replace_all": {
      "description": "Replace all occurences of old_string (default false)",
      "default": false,
      "type": "boolean"
    },
    "expected_occurrences": {
      "description": "Expected number of matches. Useful as a guardrail for replace_all.",
      "type": "number"
    }
  },
  "required": ["snippet_id", "old_string", "new_string"],
  "additionalProperties": false
}
```
