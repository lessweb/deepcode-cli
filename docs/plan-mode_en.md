# Plan Mode

Plan Mode is a built-in collaboration mode in Deep Code. When Plan Mode is active, the AI assistant works with you to create a detailed implementation plan, but **does not perform any code-modifying actions**. Plan first, implement later—giving every step of a complex task a clear rationale.

## Why Plan Mode

Asking the AI to "just do it" works well for simple tasks, but with complex cross-file refactors, feature development, or architectural changes, common pitfalls include:

- The AI starts editing without a full picture, leading to wrong directions
- No shared understanding before acting, causing expensive back-and-forth corrections
- Implementation and planning mixed together, making it hard to trace decisions

Plan Mode separates "thinking" from "doing." First, explore, ask questions, and reach agreement during the planning phase. Then, once the plan is decision-complete, move on to implementation.

## Enabling Plan Mode

You can enter Plan Mode in two ways:

| Method | Action |
| ------ | ------ |
| Keyboard shortcut | Press `Shift+Tab` in the input box to toggle between Plan Mode and Default Mode |
| Slash command | Type `/plan`, or type `/` to open the command menu and select `/plan` |

Once active, a yellow `💡 Plan mode` indicator appears in the top-right corner of the input area.

To leave Plan Mode, toggle again with `Shift+Tab`, or select "switch to Default mode" after reviewing a proposed plan.

## Behavior in Plan Mode

### Three Planning Phases

In Plan Mode, the AI follows a three-phase collaboration workflow:

1. **Ground in the environment (Phase 1)** — Understand the current project state by reading files, searching code, and checking configuration. Resolve unknowns through exploration before asking questions.
2. **Intent chat (Phase 2)** — Ask about goals and preferences to clarify success criteria, scope boundaries, constraints, and key tradeoffs.
3. **Implementation chat (Phase 3)** — Once intent is stable, discuss the concrete implementation approach: API design, data flow, edge cases, testing strategy, and so on, until the spec is "decision complete."

In each phase, the AI interacts with you through the `AskUserQuestion` tool, offering concrete options to choose from.

### Strict Rules: No Mutations

Plan Mode's core rule: **plan only, don't touch code**. The following actions are **allowed**:

- Reading and searching files, configs, type definitions, and docs
- Static analysis and code exploration
- Running dry-run commands that don't modify repo-tracked files
- Running tests or builds that may write to caches or build artifacts (e.g. `target/`, `.cache/`) without altering tracked files

The following actions are **not allowed**:

- Editing or writing files
- Running formatters or linters that rewrite files
- Applying patches, migrations, or code generation
- Side-effectful commands whose purpose is to execute the plan rather than refine it

### Permission Restrictions

Even if your `settings.json` is configured to auto-allow write, delete, or similar operations, Plan Mode **forcibly escalates these to "ask."** Specifically, the following permission scopes always require confirmation in Plan Mode:

| Permission scope | Description |
| ---------------- | ----------- |
| `write-in-cwd` | Create or overwrite files within the workspace |
| `write-out-cwd` | Create or overwrite files outside the workspace |
| `delete-in-cwd` | Delete files within the workspace |
| `delete-out-cwd` | Delete files outside the workspace |
| `mutate-git-log` | Modify Git history |

This ensures that Plan Mode won't accidentally modify your code, even with permissive settings.

## The Proposed Plan

When the AI considers the plan decision-complete—meaning an implementer needs to make no further decisions—it outputs a `<proposed_plan>` block in the response:

```xml
<proposed_plan>
Plan content (in Markdown)
</proposed_plan>
```

A plan typically includes:

- **Title**: The plan name
- **Summary**: A brief overview
- **Key Changes / Implementation Changes**: Critical changes described at the behavior level (not a file-by-file inventory)
- **Test Plan**: Test cases and scenarios
- **Assumptions**: Assumptions made and defaults chosen

After the plan is output, Deep Code automatically shows a choice dialog—no extra input needed:

| Option | Effect |
| ------ | ------ |
| **1. implement this plan** | Leave Plan Mode and automatically send an implementation prompt so the AI starts coding |
| **2. stay in Plan mode** | Stay in Plan Mode to continue refining the plan |
| **3. switch to Default mode** | Leave Plan Mode and return to Default mode without starting implementation |

You can press `1-3` to select directly, or use `↑/↓` to move the cursor and `Enter` to confirm. Pressing `Esc` is equivalent to choosing "stay in Plan mode."

## Plan Mode vs. UpdatePlan Tool

Plan Mode is a **collaborative conversation mode** whose final artifact is the complete plan inside a `<proposed_plan>` block.

`UpdatePlan` is Deep Code's **progress checklist tool** that shows step-by-step progress during execution. It does not enter or exit Plan Mode and is not the final planning artifact.

The two can work together: during implementation, the AI may use `UpdatePlan` to track progress on complex tasks, but the plan itself is already settled in Plan Mode.

## Common Use Cases

### 1. New Feature Development

```
Add pagination and search to the user list.
```

In Plan Mode, the AI first understands the existing code structure, routes, and data models, then discusses pagination style (cursor vs. offset), search scope, API changes, etc., before producing a complete plan.

### 2. Code Refactoring

```
Split the tangled business logic in UserService into separate services.
```

The AI analyzes `UserService` dependencies and call sites, then proposes a split plan with migration steps and compatibility considerations.

### 3. Architecture Review

```
Analyze the current authentication flow and suggest security improvements.
```

The AI walks through auth-related code, identifies potential risks, and delivers concrete improvement steps as a plan.
