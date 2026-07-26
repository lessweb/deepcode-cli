## Delegate

Delegate tasks to sub-agents that execute independently.

Usage:

- Use this tool to parallelize work: break a large task into smaller independent sub-tasks.
- Each sub-agent runs in an isolated context — it cannot see the main agent's conversation history.
- Sub-agents have access to `read` and `bash` tools by default. You can expand to `write`/`edit` if needed.
- Results include: summary, files read, files modified, errors, iterations, tokens used.
- Use `parallel: true` (default) for independent tasks, `parallel: false` for dependent sequential tasks.
- Max 8 tasks per call, up to 12 iterations per sub-agent.

### When to Delegate

- **Code search**: "Find all usages of createUser across the codebase"
- **Independent analysis**: "Analyze UserService.ts" and "Analyze AuthService.ts" in parallel
- **Multi-file refactoring**: "Rename getCwd to getCurrentWorkingDirectory in all .ts files"
- **Exploratory research**: "Search for all TODO comments" + "Find all test files without corresponding source files"

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "tasks": {
      "type": "array",
      "description": "List of tasks to delegate.",
      "items": {
        "type": "object",
        "properties": {
          "description": { "type": "string", "description": "What the sub-agent should do." },
          "tools": { "type": "array", "items": { "type": "string" } },
          "context": { "type": "string" },
          "maxIterations": { "type": "number" },
          "timeoutMs": { "type": "number" }
        },
        "required": ["description"]
      }
    },
    "parallel": { "type": "boolean", "description": "Run tasks in parallel (default true)." }
  },
  "required": ["tasks"],
  "additionalProperties": false
}
```
