## Recall

Search the conversation history and code index for specific information.

Usage:

- Use this tool when you need to recall specific details from earlier in the conversation that may have been compacted.
- Search for function signatures, class definitions, type declarations, and import paths.
- Search for past decisions, error messages, and fixes.
- Use `category: "code"` for code entities, `category: "fact"` for decisions/errors, or `category: "all"` (default) for everything.
- Narrow results with `filePath` for file-specific queries.
- Results are ranked by relevance.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "query": {
      "description": "Search query — keyword, function name, or concept.",
      "type": "string"
    },
    "category": {
      "description": "Category to search: code, decision, error, fact, or all (default).",
      "type": "string",
      "enum": ["code", "decision", "error", "fact", "all"]
    },
    "filePath": {
      "description": "Optional file path to narrow search results.",
      "type": "string"
    },
    "limit": {
      "description": "Maximum number of results (default 5, max 20).",
      "type": "number"
    }
  },
  "required": ["query"],
  "additionalProperties": false
}
```
