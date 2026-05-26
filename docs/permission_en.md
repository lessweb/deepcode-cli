# Deep Code Permission Mechanism

Deep Code includes a fine-grained permission control mechanism. Before the AI assistant executes a tool call (such as running a shell command, reading/writing files, accessing the network, etc.), the system determines whether to auto-allow, auto-deny, or prompt for interactive confirmation based on your configured policy.

## Overview

Each time the AI assistant invokes a tool, the system automatically analyzes the **permission scopes** involved and makes a decision based on the permission configuration in `settings.json`. For operations requiring user confirmation, an interactive prompt appears in the terminal with the following choices:

- **Yes** — Allow this one time only
- **Yes, and always allow** — Allow this time and persistently save the scope to the project configuration so future calls skip the prompt
- **No** — Deny this operation

## Permission Scopes

Deep Code defines the following 10 permission scopes, covering various risk scenarios for tool calls:

| Permission Scope | Description |
| ---------------- | ----------- |
| `read-in-cwd` | Read files inside the current workspace |
| `read-out-cwd` | Read files outside the current workspace |
| `write-in-cwd` | Create or overwrite files inside the current workspace |
| `write-out-cwd` | Create or overwrite files outside the current workspace |
| `delete-in-cwd` | Delete files inside the current workspace |
| `delete-out-cwd` | Delete files outside the current workspace |
| `query-git-log` | Query Git history (e.g., `git log`, `git show`, `git blame`) |
| `mutate-git-log` | Mutate Git history (e.g., `git commit`, `git rebase`, `git tag`) |
| `network` | Access the network (e.g., `curl`, `npm install`) |
| `mcp` | Invoke MCP external tools |

There is also a special `unknown` scope used when the LLM cannot classify a command's side effects — **`unknown` always triggers a prompt**.

## Permission Configuration

Configure permissions in `~/.deepcode/settings.json` (user-level) or `.deepcode/settings.json` (project-level) via the `permissions` field:

```json
{
  "permissions": {
    "allow": [],
    "deny": [],
    "ask": [],
    "defaultMode": "allowAll"
  }
}
```

### Configuration Fields

| Field | Type | Description |
| ----- | ---- | ----------- |
| `allow` | `string[]` | Permission scopes that are always auto-allowed |
| `deny` | `string[]` | Permission scopes that are always auto-denied |
| `ask` | `string[]` | Permission scopes that always trigger a confirmation prompt |
| `defaultMode` | `"allowAll"` \| `"askAll"` | Default behavior for scopes not explicitly listed in `allow`/`deny`/`ask`. Defaults to `"allowAll"` |

### Priority Rules

When a tool call involves multiple permission scopes, the decision follows this priority:

1. If any scope matches `deny` → **Deny**
2. If any scope matches `ask` → **Prompt**
3. If all scopes are in `allow` → **Auto-allow**
4. Otherwise → use `defaultMode`

### Example: Relaxed Mode (default)

```json
{
  "permissions": {
    "defaultMode": "allowAll"
  }
}
```

Default behavior: all operations are auto-allowed with no confirmation required.

### Example: Strict Mode

```json
{
  "permissions": {
    "allow": ["read-in-cwd", "write-in-cwd", "query-git-log"],
    "defaultMode": "askAll"
  }
}
```

With this configuration:
- Reading/writing inside the workspace and querying Git history → auto-allowed
- All other operations → require user confirmation

## Persistence

When you select "Yes, and always allow" in a permission prompt, the corresponding scope is written to the project's `.deepcode/settings.json`:

- The scope is appended to the `permissions.allow` list
- If the scope was previously in `deny` or `ask`, it is automatically removed
- Duplicate scopes are not written again

This means subsequent calls involving the same scope will no longer prompt for confirmation.
