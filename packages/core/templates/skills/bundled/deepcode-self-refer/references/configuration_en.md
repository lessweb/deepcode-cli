# Deep Code Configuration

## Configuration Hierarchy

Configuration is applied in the following priority order (lower-numbered sources are overridden by higher-numbered ones):

| Layer | Configuration Source  | Description                               |
| ----- | --------------------- | ----------------------------------------- |
| 1     | Defaults              | Hardcoded defaults within the application |
| 2     | User settings file    | Global settings for the current user      |
| 3     | Project settings file | Project-specific settings                 |
| 4     | Environment variables | System-wide or session-specific variables |

## Settings File

Deep Code uses the `settings.json` file for persistent configuration, supporting two storage locations:

| File Type             | Location                                 | Scope                                                                                                       |
| --------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| User settings file    | `~/.deepcode/settings.json`              | Applies to all Deep Code sessions for the current user.                                                     |
| Project settings file | `<project root>/.deepcode/settings.json` | Takes effect only when running Deep Code in that specific project. Project settings override user settings. |

### Available Settings in `settings.json`

The following are all the top-level fields supported in `settings.json`, along with the sub-fields inside `env`:

| Field                      | Type          | Description                                                                                                          |
| -------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------- |
| `env`                      | object        | Group of environment variables (see sub-field table below)                                                           |
| `contextWindow`            | number/string | Context-window limit as an exact token count or `128K`/`1M` value                                                    |
| `autoCompactWindow`        | number/string | Auto-compaction threshold; defaults to 80% of the context window and may trigger earlier to reserve room for replies |
| `retainRatio`              | number        | Recent conversation retained as a fraction of the context window minus the output reserve; defaults to `0.16`        |
| `retainTokens`             | number        | Absolute token budget for recent conversation; mutually exclusive with `retainRatio`                                 |
| `model`                    | string        | Model name. Defaults to `deepseek-v4-flash` and takes precedence over `env.MODEL`                                    |
| `thinkingEnabled`          | boolean       | Whether to enable thinking mode (enabled by default for DeepSeek V4 series)                                          |
| `reasoningEffort`          | string        | Reasoning intensity: `"low"`, `"high"`, or `"max"` (default `"max"`)                                                 |
| `filesApiEnabled`          | boolean       | Send images through the DeepSeek Files API (default `false`)                                                         |
| `filesApiTimeoutMs`        | number        | Per-image Files API timeout; defaults to `60000`, maximum `600000` ms                                                |
| `fileExpiresAfterSeconds`  | number        | Remote file lifetime, default `604800` seconds                                                                       |
| `fileRefreshMarginSeconds` | number        | Refresh cached IDs below this remaining lifetime, default `3600` seconds                                             |
| `fileQuotaCleanupBatch`    | number        | Oldest Deep Code files removed during quota recovery, default `100`                                                  |
| `maxRequestFilesBytes`     | number        | Raw image byte limit per request, default `134217728` (128 MiB)                                                      |
| `debugLogEnabled`          | boolean       | Enable debug log output (default `false`)                                                                            |
| `telemetryEnabled`         | boolean       | Enable anonymous usage reporting (default `true`)                                                                    |
| `notify`                   | string        | Full path to a task-status notification script (e.g., Slack notification script)                                     |
| `webSearchTool`            | string        | Full path to a custom web search script                                                                              |
| `deepseekSearchApiEnabled` | boolean       | Use DeepSeek official web search (default `false`)                                                                   |
| `mcpServers`               | object        | MCP server configurations (keys are service names, values are McpServerConfig objects)                               |
| `temperature`              | number        | Sampling temperature for LLM, from `0` to `2`                                                                        |
| `permissions`              | object        | Permission policy and additional `addWorkingDirs` workspace roots (see [permission_en.md](./permission_en.md))       |
| `enabledSkills`            | object        | Per-skill enable/disable map, keyed by skill name                                                                    |
| `history`                  | object        | Persistence and size limit for user input history                                                                    |

#### `env` Sub-fields

| Field               | Type   | Description                                                    |
| ------------------- | ------ | -------------------------------------------------------------- |
| `MODEL`             | string | Model name, e.g. `"deepseek-v4-pro"`, `"deepseek-v4-flash"`    |
| `BASE_URL`          | string | Base URL for API requests, e.g. `"https://api.deepseek.com"`   |
| `API_KEY`           | string | API key                                                        |
| `TEMPERATURE`       | string | Sampling temperature for chat completions, from `"0"` to `"2"` |
| `THINKING_ENABLED`  | string | Enable thinking mode                                           |
| `REASONING_EFFORT`  | string | Reasoning intensity                                            |
| `DEBUG_LOG_ENABLED` | string | Enable debug log output                                        |
| `TELEMETRY_ENABLED` | string | Enable anonymous usage reporting                               |
| `<any other KEY>`   | string | Custom environment variable                                    |

#### Context Windows

`contextWindow` and `autoCompactWindow` are top-level `settings.json` fields. A number must be a positive integer and represents an exact token count. A string uses a case-insensitive `K` or `M` suffix, with `1K = 1024` and `1M = 1024²`:

```json
{
  "contextWindow": "1M",
  "autoCompactWindow": "512K"
}
```

The default context window is `256K` for regular models and `1M` for DeepSeek V4 models. If the auto-compaction threshold is omitted, it is 80% of the final context window. Invalid values are ignored, and an auto-compaction threshold larger than the context window is capped at the context window.

#### Compaction retention

`retainRatio` and `retainTokens` are top-level `settings.json` fields. Set at most one per configuration file. A project-level setting replaces the user-level retention choice; otherwise, the user setting is inherited. With neither set, `retainRatio` defaults to `0.16`.

`retainRatio` must be a number in `(0, 1]`. Its budget is the context window minus the output reserve, multiplied by the ratio and rounded down. `retainTokens` must be a non-negative integer; `0` requests no extra tail retention. Strings such as `"32K"` are not supported.

The resulting budget must be strictly below the effective auto-compaction threshold. Invalid configurations produce an error rather than silently reducing the retention budget. A low threshold may require an explicit smaller retention budget:

```json
{
  "autoCompactWindow": "180K",
  "retainTokens": 32768
}
```

These settings apply to automatic compaction. Tool calls and their results stay together, so the retained tail may exceed the budget. Manual compaction and context-overflow recovery continue to use no extra tail retention.

#### `thinkingEnabled` — Thinking Mode

Whether to enable DeepSeek thinking mode. Set to `true` to enable, `false` to disable.

- For `deepseek-v4-pro` and `deepseek-v4-flash`, thinking mode is **enabled by default**.
- For other models, thinking mode is **disabled by default**.

#### `reasoningEffort` — Reasoning Intensity

When thinking mode is enabled, controls the depth of the model’s reasoning:

| Value  | Description                                              |
| ------ | -------------------------------------------------------- |
| `max`  | Maximum reasoning depth (default)                        |
| `high` | Higher reasoning depth with relatively lower token usage |
| `low`  | Lower reasoning depth with lower token usage             |

#### DeepSeek Files API

When `BASE_URL` is `https://api.deepseek.com`, enabling `filesApiEnabled` uploads images to the fixed `https://api.deepseek.com/files` endpoint and sends `file_id` references in chat requests. Other API endpoints do not enable this feature. An upload or cache-refresh failure fails the request; disabling the setting preserves the existing image path.

```json
{
  "filesApiEnabled": true,
  "filesApiTimeoutMs": 60000,
  "fileExpiresAfterSeconds": 604800,
  "fileRefreshMarginSeconds": 3600,
  "fileQuotaCleanupBatch": 100,
  "maxRequestFilesBytes": 134217728
}
```

Each file is limited to 64 MiB, and the upload timeout cannot exceed 10 minutes. Remote IDs are cached in `~/.deepcode/files-api-cache.json` without storing the plaintext API key. During quota recovery, only the oldest files whose names start with `deepcode-` are removed before one retry.

#### `notify` — Task Status Notifications

Set a full path to a shell script. When a session completes, fails, waits for user input, or waits for permission approval, the script is executed automatically to send notifications (e.g., a Slack message). After the session resumes, another notification is sent when it pauses or ends again.

The following context is injected as environment variables when the notify script runs:

| Variable      | Description                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DURATION`    | Elapsed time from the start of the current execution until it pauses or ends, in whole seconds; resets when execution resumes                    |
| `STATUS`      | Actual session status: `completed`, `failed`, `waiting_for_user` (waiting for user input), or `ask_permission` (waiting for permission approval) |
| `FAIL_REASON` | Failure reason (only set on failure)                                                                                                             |
| `BODY`        | The text content of the last AI assistant reply                                                                                                  |
| `TITLE`       | Session title (matches the resume list title)                                                                                                    |

```json
{
  "notify": "/path/to/notify-script.sh"
}
```

> For detailed configuration examples (Slack, Feishu, terminal notifications, system notifications, etc.), see [notify_en.md](notify_en.md).

#### `deepseekSearchApiEnabled` — DeepSeek Web Search

Set `deepseekSearchApiEnabled: true` to use [DeepSeek official web search](https://api-docs.deepseek.com/guides/search) when the active connection's `BASE_URL` is exactly `https://api.deepseek.com`. It uses the connection's API key and takes priority over `webSearchTool`. Queries are sent directly without translation and must not exceed 128 Unicode characters. Failed searches return an error without falling back to another search service.

The default is `false`. When disabled or using another API address, the existing search behavior applies.

#### `webSearchTool` — Custom Web Search

Deep Code has a built-in, free-to-use Web Search tool. If you need custom search logic, set `webSearchTool` to the full path of an executable script:

```json
{
  "webSearchTool": "/path/to/my-search-script.sh"
}
```

The script receives a search query as an argument and outputs results in JSON format for the AI.

#### `enabledSkills` — Skill Enablement

Controls whether skills are included during skill scanning. Keys are resolved skill names, and values must be booleans:

```json
{
  "enabledSkills": {
    "skill-writer": false,
    "code-review": true
  }
}
```

- Missing entries are enabled by default.
- Setting a skill to `false` hides every skill with that resolved `name`, across project and user skill roots.
- Project settings override user settings per skill. If the project setting omits a skill, the user setting is used.

#### `mcpServers` — MCP Servers

Configuration for MCP (Model Context Protocol) servers. The value is a key-value pair, where the key is the service name and the value is a server configuration object.

```json
{
  "mcpServers": {
    "<service name>": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxxxxxxxxxxx"
      }
    }
  }
}
```

| McpServerConfig field | Type     | Required | Description                                               |
| --------------------- | -------- | -------- | --------------------------------------------------------- |
| `command`             | string   | Yes      | Executable path or command (e.g. `npx`, `node`, `python`) |
| `args`                | string[] | No       | List of arguments passed to the command                   |
| `env`                 | object   | No       | Environment variables passed to the MCP server process    |

> When `command` is `npx`, Deep Code automatically prepends `-y` to the arguments.

For detailed MCP usage instructions, refer to [mcp.md](mcp.md).

#### `debugLogEnabled` — Debug Log

Set to `true` to enable detailed debug logging (default `false`), useful for troubleshooting API calls and tool execution.

#### `telemetryEnabled` — Anonymous Usage Reporting

Set to `false` to disable anonymous usage reporting (default `true`). The report only includes an anonymous machine identifier and does not contain conversation content, code, or API keys.

You can also disable it via environment variable:

```bash
DEEPCODE_TELEMETRY_ENABLED=0 deepcode
```

## Environment Variable Priority

Environment variables are a common way to configure applications, especially for sensitive information (such as api-key) or settings that may change between environments.

### Priority Principle

Environment variable priority follows the logic of “the more specific and localized the configuration, the higher the priority”, and the override rule of “env files protect existing environment by default, system variables override env files”. (The `env` object in settings.json can be thought of as a type of env file.)

Priority levels (from lowest to highest):

1. `env` defined at the top level of `settings.json` – this is a general configuration for the entire tool and all its subprocesses (global variables). Can be overridden by outer environment variables, but the environment variable KEY has the `DEEPCODE_` prefix removed.
2. `env` defined inside `mcpServers` in `settings.json` – this is the most specific configuration for a particular MCP service (local variables). Can be overridden by outer environment variables, but the KEY has the `MCP_` prefix removed.
3. Shell/system environment variables – operating system level.

### Scenarios

#### 1. Setting the model’s api_key and base_url

Applied in the following priority order (lower-numbered sources are overridden by higher-numbered ones) – using api_key as an example:

1. Hardcoded default: `""`
2. User-level settings.json: `{"env": {"API_KEY": "abc123"}}`
3. Project-level settings.json: `{"env": {"API_KEY": "abc123"}}`
4. System environment variable: `DEEPCODE_API_KEY=abc123 deepcode`

#### 2. Setting model, thinkingEnabled, and reasoningEffort

Applied in the following priority order (lower-numbered overridden by higher-numbered) – using thinkingEnabled as an example:

1. Hardcoded default: `true`
2. User-level settings.json: `{"env": {"THINKING_ENABLED": "true"}}`
3. User-level settings.json: `{"thinkingEnabled": true}`
4. Project-level settings.json: `{"env": {"THINKING_ENABLED": "true"}}`
5. Project-level settings.json: `{"thinkingEnabled": true}`
6. System environment variable: `DEEPCODE_THINKING_ENABLED=true deepcode`

#### 3. Setting environment variables for external scripts like notify and webSearchTool

Applied in the following priority order (lower-numbered overridden by higher-numbered) – using notify as an example:

1. Hardcoded default: `os.environ.get('WEBHOOK', '...')  # notify script code`
2. User-level settings.json: `{"env": {"WEBHOOK": "..."}}`
3. Project-level settings.json: `{"env": {"WEBHOOK": "true"}}`
4. System environment variable: `DEEPCODE_WEBHOOK=... deepcode`

#### 4. Setting environment variables for an MCP Service

Applied in the following priority order (lower-numbered overridden by higher-numbered) – using a GitHub MCP server as an example:

1. User-level settings.json: `{"mcpServers":{"github":{"env":{"GITHUB_PERSONAL_ACCESS_TOKEN":"..."}}}}`
2. User-level settings.json: `{"env": {"MCP_GITHUB_PERSONAL_ACCESS_TOKEN": "..."}}`
3. Project-level settings.json: `{"mcpServers":{"github":{"env":{"GITHUB_PERSONAL_ACCESS_TOKEN":"..."}}}}`
4. Project-level settings.json: `{"env": {"MCP_GITHUB_PERSONAL_ACCESS_TOKEN": "..."}}`
5. System environment variable: `DEEPCODE_MCP_GITHUB_PERSONAL_ACCESS_TOKEN=... deepcode`

#### Input history and search

Press Ctrl+R to search user input from the current session and saved history. Type to preview matches; Ctrl+R / ↑ finds older matches, and Ctrl+S / ↓ finds newer matches. Enter places the result in the input for editing without sending it. Esc / Ctrl+C cancels and restores the original draft. Use `/raw` to select the raw display mode.

History contains submitted user text only, excluding generated summaries, tool-injected content, and messages from other roles. Cross-session history is stored at `~/.deepcode/history.jsonl`. Configure it in `settings.json`:

```json
{
  "history": {
    "persistence": "saveAll",
    "maxBytes": 10485760
  }
}
```

- `persistence` defaults to `"saveAll"`. Set it to `"none"` to stop saving without deleting, clearing, or trimming existing history. Existing history remains searchable.
- `maxBytes` defaults to `10485760` (10 MiB) and must be a non-negative integer. `0` means unlimited size; history is still saved.
- The size is checked after every append. When it exceeds the limit, the oldest records are removed to retain about 80% of the limit. The newest record is always kept, even if that record alone exceeds the limit.
- Project settings override user settings per field. Existing sessions are not automatically copied into global history; resuming a session makes its user input searchable.

## DeepCode PLUS subscription and LLM routing

Run `deepcode --plus` and enter your DeepCode Plus API Key. After successful verification, the command saves the key to `~/.deepcode-plus/settings.json` and exits, preserving the existing `subscriptionPlan` and other settings. Invalid, unavailable, or unverifiable keys are not saved. This command requires an interactive terminal and cannot be combined with prompt or session options.

You can also set `env.PLUS_API_KEY` in user or project `settings.json`. Core features select the key in this order: `DEEPCODE_PLUS_API_KEY` environment variable → project settings → user settings → the separate Plus settings file. The first three sources also select the `default` subscription policy, overriding `subscriptionPlan` in the separate file. An invalid key from the highest-priority source causes an error instead of falling back. Bundled image and video generation scripts still read only the separate Plus settings file.

Configure PLUS separately in `~/.deepcode-plus/settings.json`:

```json
{
  "subscriptionPlan": "default",
  "env": { "PLUS_API_KEY": "sk-..." }
}
```

PLUS API domains are selected from `env.PLUS_API_KEY` after trimming surrounding whitespace. With `sk-` followed by 24 characters, all services use `https://deepcode.vegamo.cn`. With 26 characters, LLM requests under `/plugin/openai/**` (including `/models` subscription probes and connection warmup) use `https://chat.deepcodeplus.com`; all other services use `https://www.deepcodeplus.com`, including web search, image understanding, image/video generation, telemetry, and cost estimates. Without a key, anonymous plugin requests retain the legacy host. No additional suffix character restriction applies. An explicitly configured invalid value (including an empty string or non-string) produces an error even when `subscriptionPlan=off`. In the URLs below, `{llmHost}` refers to the selected LLM domain.

`subscriptionPlan` accepts `default`, `on`, or `off`; missing or invalid values use `default`. The regular connection retains the user/project/environment precedence described above.

- `default`: Without a PLUS key, use the regular connection. Otherwise, before each session creation or reply, request `GET {llmHost}/plugin/openai/models` with the PLUS key. HTTP 200 means `full ability` and selects PLUS. HTTP 401/403 means `api only` and selects the regular connection, even if its key is missing. Other HTTP statuses, network errors, and a 3-second timeout mean `unknown`: prefer the regular key if configured, otherwise use PLUS.
- `on`: Use the PLUS key with `{llmHost}/plugin/openai` directly, without a subscription check. A missing PLUS key produces an explicit error without falling back.
- `off`: Always use the regular connection without checking the subscription.

All LLM calls within a turn share the selected connection. The next turn reloads configuration and checks again. Cancelling the check stops the turn. Existing `/models` connection warmup remains independent of subscription checks and can also run in `on` mode; its result does not change routing.

When the selected connection uses PLUS, the CLI appends `plus` after the model and reasoning effort, for example `deepseek-flash max plus`. These settings control LLM routing and do not change credentials used by PLUS plugin tools.
