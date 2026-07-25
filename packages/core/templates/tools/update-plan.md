## UpdatePlan

Updates the current task plan and progress display.

Usage:

- Use this tool for non-trivial multi-step tasks when a task list helps track execution progress.
- Pass the complete current task list every time. The latest call replaces the previous visible plan.
- The `plan` argument is a markdown string, not an array of step objects. If the requirement is in Chinese, then use Chinese for the markdown as well.
- Keep exactly one task marked `[>]` while work is in progress.
- Update the plan before starting a task, immediately after completing a task, and whenever tasks are split, merged, reordered, blocked, or changed.
- Before executing the first task and after completing each task, re-evaluate the latest conversation and project context, then revise the remaining plan if needed.
- Remove tasks that are no longer relevant, and add newly discovered follow-up tasks before working on them.

### TaskPlan Execution Loop (when using `steps`)

When you provide structured `steps`, you MUST follow this verification-driven loop:

1. **Plan**: Generate 3-5 concrete steps, each with `verification` (a command to run) and `fallback` (what to do on failure).
2. **Execute**: Perform the code changes for the current `[>]` step.
3. **Verify**: Run the step's `verification.command` (e.g., `npm test`, `npm run typecheck`, `npm run lint`). Never skip verification.
4. **Pass → Next**: If verification passes, mark the step `[x]` and proceed to the next step.
5. **Fail → Fix → Retry**: If verification fails:
   - Analyze the error output carefully.
   - Fix the issue (do NOT skip or work around verification).
   - If the same step fails `maxRetries` times, invoke the `fallback` strategy:
     - `rollback_and_retry`: Undo all changes from this step and try the `alternativeApproach`.
     - `rollback_and_skip`: Undo changes, mark skipped, and move to the next step.
     - `ask_user`: Pause and ask the user for guidance.
6. **Loop** until all steps are `[x]` or the plan is `failed`.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "plan": {
      "description": "The complete markdown task list to display as the latest plan state.",
      "type": "string"
    },
    "explanation": {
      "description": "Optional short reason for changing the plan.",
      "type": "string"
    },
    "steps": {
      "description": "Optional structured steps with verification and fallback strategies.",
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "description": { "type": "string" },
          "verification": {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "enum": ["command", "file_exists", "test_pass", "manual"]
              },
              "command": { "type": "string" },
              "expected": { "type": "string" }
            },
            "required": ["type"]
          },
          "fallback": {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "enum": ["rollback_and_retry", "rollback_and_skip", "ask_user"]
              },
              "alternativeApproach": { "type": "string" }
            },
            "required": ["type"]
          },
          "maxRetries": { "type": "number" }
        },
        "required": ["description"]
      }
    }
  },
  "required": ["plan"],
  "additionalProperties": false
}
```
