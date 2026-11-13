## SearchMcpTools

MCP tools are connected to this session but their schemas are **not** loaded up front — only their names appear in a system message. Call this tool to fetch the full schema for the ones you need, then call the returned `name` exactly as given.

Usage:

- `query` is either what you want to do ("weather forecast", "read a file from the repo") or part of the tool name ("fetch_sports"). Prefer the tool name when you already know it.
- The result is a list of matches, each with `name`, `description` and `parameters`. Read `parameters` before calling — it is the authoritative schema.
- Matches are ranked by keyword overlap, not semantics. If nothing matches, try a shorter query or a different word.
- Only MCP tool names are discoverable this way. Built-in tools (Bash, Read, Write, Edit, …) are already loaded.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "What you want to do, or part of the tool name (e.g. 'weather forecast', 'fetch_sports')."
    },
    "limit": {
      "type": "number",
      "description": "Maximum number of tools to return (default 8)."
    }
  },
  "required": ["query"],
  "additionalProperties": false
}
```
