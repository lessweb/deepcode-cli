# Deep Code Permission Mechanism

Deep Code includes a fine-grained permission control mechanism. Before the AI assistant executes a tool call (such as running a shell command, reading/writing files, accessing the network, etc.), the system determines whether to auto-allow, auto-deny, or prompt for interactive confirmation based on your configured policy.

## Overview

Each time the AI assistant invokes a tool, the system automatically analyzes the **permission scopes** involved and makes a decision based on the permission configuration in `settings.json`. For operations requiring user confirmation, an interactive prompt appears in the terminal with the following choices:

- **Yes** — Allow this one time only
- **Yes, during this session** — Do not ask again for the same kind of operation during this run of the current session, without writing to permission configuration
- **Yes, and always allow** — Allow this time and save the scope to the project configuration so future calls skip the prompt; this option is unavailable in Plan Mode
- **No** — Deny this operation

The `unknown` scope offers only **Yes** and **No**. Operations configured as denied remain denied.

## Permission Scopes

Deep Code defines the following 12 permission scopes, covering various risk scenarios for tool calls:

| Permission Scope | Description |
| ---------------- | ----------- |
| `read-in-cwd` | Read files inside the current workspace |
| `read-in-tmp` | Read files inside `/tmp` or `/private/tmp` |
| `read-out-cwd` | Read files outside the current workspace |
| `write-in-cwd` | Create or overwrite files inside the current workspace |
| `write-in-tmp` | Create or overwrite files inside `/tmp` or `/private/tmp` |
| `write-out-cwd` | Create or overwrite files outside the current workspace |
| `delete-in-cwd` | Delete files inside the current workspace |
| `delete-out-cwd` | Delete files outside the current workspace |
| `query-git-log` | Query Git history (e.g., `git log`, `git show`, `git blame`) |
| `mutate-git-log` | Mutate Git history (e.g., `git commit`, `git rebase`, `git tag`) |
| `network` | Access the network (e.g., `curl`, `npm install`) |
| `mcp` | Invoke MCP external tools |

There is also a special `unknown` scope used when the LLM cannot classify a command's side effects — **`unknown` always triggers a prompt**.

## Permission Configuration

Configure permissions in `~/.deepcode/settings.json` (user-level) or `.deepcode/settings.json` (project-level) via the `permissions` field.

You can also enter `/permissions` in the interactive UI to open the permission editor. If the current project already has project-level configuration, the editor changes that configuration; otherwise, it changes user-level configuration. The editor supports:

- Setting the default mode to `allowAll` or `askAll`, then returning to the home menu.
- Setting each permission scope to allow, deny, ask, or follow the default configuration.
- Previewing the configuration that actually applies to the current project. All changes are saved together by selecting **Save** on the home menu. Pressing `Esc` in a submenu returns to the previous page and keeps your changes; pressing `Esc` on the home menu closes the editor and discards unsaved changes.

For manual configuration, use the `permissions` field:

```json
{
  "permissions": {
    "allow": [],
    "deny": [],
    "ask": [],
    "defaultMode": "allowAll",
    "addWorkingDirs": ["/opt/my-project"]
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
| `addWorkingDirs` | `string[]` | Additional directories treated as part of the current workspace |

User-level and project-level `addWorkingDirs` values are merged and deduplicated. Absolute paths are used directly, while relative paths are resolved against the current project root; directories do not need to exist yet. The workspace scope takes precedence when a path is both a working directory and a system temporary directory.

The default `allowAll` mode auto-allows `read-in-tmp` and `write-in-tmp`. Explicit `allow`, `ask`, `deny`, and `askAll` settings still follow the priority rules below.

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

## Authorization Duration

Selecting **Yes, and always allow** saves the scope to the current project's `.deepcode/settings.json`. New sessions and future restarts keep using that choice and do not prompt again for the same kind of operation.

Selecting **Yes, during this session** applies only to this run of the current session and is not written to permission configuration. It remains available if you switch away and back to the session. New sessions, forked sessions, and sessions restored after a restart require authorization again.
