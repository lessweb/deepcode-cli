# Status Line Plugins

Deep Code CLI lets you inject custom information into the status line at the bottom of the terminal (Git branch, current time, token usage, etc.) through plugins, without modifying the CLI source. The status line renders below the keyboard hint line under the prompt input, and all provider outputs are concatenated with a separator.

## Configuration

Add a `statusline` field to `~/.deepcode/settings.json` (or the project-level `.deepcode/settings.json`):

```json
{
  "statusline": {
    "enabled": true,
    "refreshMs": 2000,
    "separator": " · ",
    "providers": [
      {
        "type": "command",
        "id": "git",
        "command": "git branch --show-current",
        "color": "cyan"
      },
      {
        "type": "module",
        "id": "tokens",
        "path": "./.deepcode/plugins/tokens.mjs",
        "color": "yellow"
      }
    ]
  }
}
```

### Fields

| Field         | Type      | Description                                                                  |
| ------------- | --------- | ---------------------------------------------------------------------------- |
| `enabled`     | boolean   | Whether the status line is enabled. If omitted, defaults to true when at least one provider is configured. |
| `refreshMs`   | number    | Refresh interval in milliseconds. Minimum 500, default 2000.                 |
| `separator`   | string    | Separator between provider outputs. Default `" · "`.                         |
| `providers`   | array     | List of providers, rendered in declaration order.                            |

## Provider Types

### `command` — Run an External Command

Executes a shell command every `refreshMs` and uses the first line of stdout as the status segment.

| Field       | Type    | Required | Description                                                              |
| ----------- | ------- | -------- | ------------------------------------------------------------------------ |
| `type`      | string  | Yes      | Must be `"command"`.                                                     |
| `command`   | string  | Yes      | Shell command (supports pipes, redirection, etc.).                       |
| `id`        | string  | No       | Unique identifier. Auto-generated from index if omitted.                 |
| `cwd`       | string  | No       | Working directory. Relative paths resolved against the project root.    |
| `timeoutMs` | number  | No       | Timeout in milliseconds. Default 1500. Empty string on timeout.          |
| `color`     | string  | No       | Ink-supported color (e.g. `"red"`, `"#229ac3"`).                         |

Examples:

```json
{ "type": "command", "id": "git", "command": "git status -sb | head -1" }
{ "type": "command", "id": "time", "command": "date +%H:%M" }
{ "type": "command", "id": "node", "command": "node -v", "color": "green" }
```

### `module` — Load a JS Module

Loads a local JS/MJS module and calls its default-exported function. The return value becomes the segment text.

| Field       | Type    | Required | Description                                                                          |
| ----------- | ------- | -------- | ------------------------------------------------------------------------------------ |
| `type`      | string  | Yes      | Must be `"module"`.                                                                  |
| `path`      | string  | Yes      | Module path. Relative paths resolved against the project root.                       |
| `id`        | string  | No       | Unique identifier.                                                                   |
| `timeoutMs` | number  | No       | Timeout in milliseconds. Default 2000.                                               |
| `color`     | string  | No       | Ink-supported color.                                                                 |

The module must export a `default` function (or a named `provider`):

```js
// .deepcode/plugins/tokens.mjs
export default function tokensProvider({ projectRoot, session }) {
  // Return a string (sync or async).
  if (session?.activeSessionId) {
    return `msgs:${session.messageCount} reqs:${session.requestCount} tokens:${session.totalTokens}`;
  }
  return `tokens: 1.2k`;
}
```

The function receives `{ projectRoot: string, session: SessionInfo | null }` and returns `string` or `Promise<string>`.

`SessionInfo` shape:

| Field             | Type                | Description                                                |
| ----------------- | ------------------- | ---------------------------------------------------------- |
| `activeSessionId` | `string \| null`    | ID of the currently active session, or `null` if none.    |
| `messageCount`    | `number`            | Total messages in the active session.                      |
| `requestCount`    | `number`            | Total LLM API requests made in the active session.        |
| `totalTokens`     | `number`            | Total tokens consumed in the active session.              |

## Safety Constraints

- **Module provider paths must reside within the project root or the user's home directory**; absolute paths outside both are rejected (to prevent loading arbitrary code).
- Each segment's text is automatically:
  - Reduced to the first non-empty line
  - Stripped of ANSI escape sequences
  - Whitespace-collapsed
  - Truncated to 40 characters (with `…` for overflow)
- Command provider stdout is capped at 4 KB.
- If any provider throws, times out, or returns an empty string, **only that segment is skipped**; the rest are unaffected.

## Behavior

- The first refresh fires immediately after CLI startup, then on the configured interval.
- The `providers` arrays from user-level and project-level configs are **merged** (user first, project second); other fields prefer the project-level value.
- The status line is shown in every state (including busy and permission prompts) without interfering with busy indicators.
- Changes to config require a CLI restart (no hot reload).

## Full Example

```json
{
  "statusline": {
    "enabled": true,
    "refreshMs": 3000,
    "providers": [
      {
        "type": "command",
        "id": "branch",
        "command": "git branch --show-current",
        "color": "cyan"
      },
      {
        "type": "command",
        "id": "dirty",
        "command": "git status --porcelain | wc -l | xargs -I{} echo '{} files changed'",
        "color": "yellow"
      },
      {
        "type": "module",
        "id": "ts-errors",
        "path": "./.deepcode/plugins/ts-errors.mjs",
        "color": "red",
        "timeoutMs": 5000
      }
    ]
  }
}
```
