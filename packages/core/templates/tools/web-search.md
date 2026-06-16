## WebSearch

Use this tool when you need up-to-date web information before writing code, changing dependencies, or citing external guidance.

JSON schema:

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "A search query phrased as a clear, specific natural language question or statement that includes key context."
    }
  },
  "required": ["query"],
  "additionalProperties": false
}
```

Usage:

- Do not reduce `query` to space-separated keywords.

Typical use cases:

- Confirm recent SDK, framework, or API changes
- Check current compatibility, deprecations, or migration notes
- Look up active issue tracker discussions or recent regressions
- Gather cited sources before producing technical guidance
