# Deep Code Configuration

## Configuration Hierarchy

Configuration is applied in the following priority order (lower-numbered sources are overridden by higher-numbered ones):

| Layer | Configuration Source | Description                                    |
| ----- | -------------------- | ---------------------------------------------- |
| 1     | Defaults             | Hardcoded defaults within the application      |
| 2     | User settings file   | Global settings for the current user           |
| 3     | Project settings file| Project-specific settings                      |
| 4     | Environment variables| System-wide or session-specific variables      |

## Settings File

Deep Code uses the `settings.json` file for persistent configuration, supporting two storage locations:

| File Type           | Location                                  | Scope                                                                 |
| ------------------- | ----------------------------------------- | --------------------------------------------------------------------- |
| User settings file  | `~/.deepcode/settings.json`               | Applies to all Deep Code sessions for the current user.               |
| Project settings file | `<project root>/.deepcode/settings.json` | Takes effect only when running Deep Code in that specific project. Project settings override user settings. |

### Available Settings in `settings.json`

The following are all the top-level fields supported in `settings.json`, along with the sub-fields inside `env`:

| Field              | Type    | Description                                                                 |
| ------------------ | ------- | --------------------------------------------------------------------------- |
| `env`              | object  | Group of environment variables (see sub-field table below)                 |
| `contextWindow`   | number/string | Context-window limit as an exact token count or `128K`/`1M` value   |
| `autoCompactWindow` | number/string | Auto-compaction threshold; defaults to 80% of the context window |
| `retainRatio` | number | Budget for retaining recent conversation history after compaction, expressed as a fraction of the model's context window (default `0.16`, or 16%) |
| `retainTokens` | number | Budget for retaining recent conversation history after compaction, expressed as an absolute token count; mutually exclusive with `retainRatio` |
| `model`            | string  | Model name. Takes precedence over `env.MODEL`                              |
| `thinkingEnabled`  | boolean | Whether to enable thinking mode (enabled by default for DeepSeek V4 series)|
| `reasoningEffort`  | string  | Reasoning intensity: `"low"`, `"high"`, or `"max"` (default `"max"`)    |
| `experimental` | object | Experimental features, such as reasoning summaries (see below) |
| `multimodal`       | string  | Multimodal (image) capability override: `"default"`, `"on"`, or `"off"` (default `"default"`) |
| `filesApiEnabled`  | boolean | Send images through the DeepSeek Files API (default `false`)               |
| `filesApiTimeoutMs` | number | Per-image Files API timeout; defaults to `60000`, maximum `600000` ms       |
| `fileExpiresAfterSeconds` | number | Remote file lifetime, default `604800` seconds                       |
| `fileRefreshMarginSeconds` | number | Refresh cached IDs below this remaining lifetime, default `3600` seconds |
| `fileQuotaCleanupBatch` | number | Oldest Deep Code files removed during quota recovery, default `100`    |
| `maxRequestFilesBytes` | number | Raw image byte limit per request, default `134217728` (128 MiB)          |
| `debugLogEnabled`  | boolean | Enable debug log output (default `false`)                                   |
| `telemetryEnabled` | boolean | Enable anonymous usage reporting (default `true`)                           |
| `notify`           | string  | Full path to a task-status notification script (e.g., Slack notification script) |
| `webSearchTool`    | string  | Full path to a custom web search script                                     |
| `deepseekSearchApiEnabled` | boolean | Use DeepSeek official web search (default `false`) |
| `mcpServers`       | object  | MCP server configurations (keys are service names, values are McpServerConfig objects) |
| `temperature`      | number  | Sampling temperature for LLM, from `0` to `2`                 |
| `permissions`      | object  | Permission policy and additional `addWorkingDirs` workspace roots (see [permission_en.md](./permission_en.md)) |
| `enabledSkills`    | object  | Per-skill enable/disable map, keyed by skill name                           |
| `statusline`       | object  | Status line plugins (see [statusline_en.md](./statusline_en.md))            |
| `history` | object | Persistence and size limit for user input history |

#### `env` Sub-fields

| Field             | Type   | Description                                                      |
| ----------------- | ------ | ---------------------------------------------------------------- |
| `MODEL`           | string | Model name, e.g. `"deepseek-v4-pro"`, `"deepseek-v4-flash"`     |
| `BASE_URL`        | string | Base URL for API requests, e.g. `"https://api.deepseek.com"`    |
| `API_KEY`         | string | API key                                                         |
| `TEMPERATURE`     | string | Sampling temperature for chat completions, from `"0"` to `"2"`  |
| `THINKING_ENABLED`| string | Enable thinking mode                                            |
| `REASONING_EFFORT`| string | Reasoning intensity                                             |
| `MULTIMODAL`      | string | Multimodal (image) capability override: `"default"`, `"on"`, or `"off"` |
| `DEBUG_LOG_ENABLED`| string| Enable debug log output                                         |
| `TELEMETRY_ENABLED`| string| Enable anonymous usage reporting                                |
| `<any other KEY>` | string | Custom environment variable                                     |

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

- For `deepseek-flash`, `deepseek-v4-pro`, `deepseek-v4-flash`, and `deepseek-v4-flash-vision-exp`, thinking mode is **enabled by default**.
- For other models, thinking mode is **disabled by default**.

#### `reasoningEffort` — Reasoning Intensity

When thinking mode is enabled, controls the depth of the model’s reasoning:

| Value  | Description                                               |
| ------ | --------------------------------------------------------- |
| `max`  | Maximum reasoning depth (default)                         |
| `high` | Higher reasoning depth with relatively lower token usage  |
| `low`  | Lower reasoning depth with lower token usage              |

#### `experimental` — Experimental Features

Use `/experimental`, select **Reasoning summary**, then choose `on` / `off` to enable or disable reasoning summaries.

You can also edit `settings.json` directly. This example enables reasoning summaries:

```json
{
  "experimental": {
    "reasoningSummary": "on",
    "reasoningSummaryModel": "deepseek-flash"
  }
}
```

| Sub-field | Type | Default | Description |
| --------- | ---- | ------- | ----------- |
| `reasoningSummary` | string | `"off"` | Enable or disable reasoning summaries with `"on"` or `"off"` |
| `reasoningSummaryModel` | string | `"deepseek-flash"` | Model used to generate summaries; configured in the settings file |

When enabled, if the model returns at least 400 characters of reasoning with no response body and the current session title is non-empty, an additional model request condenses the reasoning into one or two sentences. When displaying thinking messages, the CLI prefers the summary if the response body is empty. Summaries are only used for display and are not sent back to the model as assistant response text.

Summary requests always disable thinking mode, regardless of the main conversation's thinking settings. If summary generation fails, times out, or returns empty text, the conversation continues as usual.

#### `multimodal` — Multimodal (Image) Capability

Controls whether the current model is treated as a multimodal model that accepts image input:

| Value     | Description                                                                 |
| --------- | --------------------------------------------------------------------------- |
| `default` | Inferred from the built-in known-model list (default)                       |
| `on`      | Always treat the model as multimodal, images are sent inline as `image_url` |
| `off`     | Always treat the model as non-multimodal, images are read on demand via UnderstandImage tool |

Use this to override the default detection when your model is not in the known-model list, or when its actual capability differs from the default.

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

Each file is limited to 64 MiB, and the upload timeout cannot exceed DeepSeek's 10-minute limit. Remote IDs are cached in `~/.deepcode/files-api-cache.json` without storing the plaintext API key. On a remote storage-quota error, only the oldest files whose names start with `deepcode-` are removed before one retry.

#### `notify` — Task Status Notifications

Set a full path to a shell script. When a session completes, fails, waits for user input, or waits for permission approval, the script is executed automatically to send notifications (e.g., a Slack message). After the session resumes, another notification is sent when it pauses or ends again.

The following context is injected as environment variables when the notify script runs:

| Variable | Description |
|----------|-------------|
| `DURATION` | Elapsed time from the start of the current execution until it pauses or ends, in whole seconds; resets when execution resumes |
| `STATUS` | Actual session status: `completed`, `failed`, `waiting_for_user` (waiting for user input), or `ask_permission` (waiting for permission approval) |
| `FAIL_REASON` | Failure reason (only set on failure) |
| `BODY` | The text content of the last AI assistant reply |
| `TITLE` | Session title (matches the resume list title) |
| `SESSION_ID` | ID of the session that triggered the notification |

```json
{
  "notify": "/path/to/notify-script.sh"
}
```

> For detailed configuration examples (Slack, Feishu, terminal notifications, system notifications, etc.), see [notify_en.md](notify_en.md).

#### `webSearchTool` — Custom Web Search

Deep Code has a built-in, free-to-use Web Search tool. If you need custom search logic, set `webSearchTool` to the full path of an executable script:

```json
{
  "webSearchTool": "/path/to/my-search-script.sh"
}
```

The script receives a search query as an argument and outputs results in JSON format for the AI.

#### `deepseekSearchApiEnabled` — Enable the DeepSeek Web Search API

Deep Code supports the latest [DeepSeek official web search API](https://api-docs.deepseek.com/guides/search). Set `deepseekSearchApiEnabled: true` to enable it when the `BASE_URL` is `https://api.deepseek.com`. According to the official documentation as of October 30, 2026, web search is billed per request, rather than by tokens or the number of results returned, at $0.75 per 1,000 successful requests.

`deepseekSearchApiEnabled` defaults to `false`. When disabled or using another API address, the existing search behavior applies.

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

| McpServerConfig field | Type     | Required | Description                                                              |
| --------------------- | -------- | -------- | ------------------------------------------------------------------------ |
| `command`             | string   | Yes      | Executable path or command (e.g. `npx`, `node`, `python`)                |
| `args`                | string[] | No       | List of arguments passed to the command                                  |
| `env`                 | object   | No       | Environment variables passed to the MCP server process                   |

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

Configure PLUS separately in `~/.deepcode-plus/settings.json`:

```json
{
  "subscriptionPlan": "default",
  "env": { "PLUS_API_KEY": "sk-..." }
}
```

`subscriptionPlan` accepts `default`, `on`, or `off`; missing or invalid values use `default`. The regular connection retains the user/project/environment precedence described above.

- `default`: If you have a DeepCode Plus subscription, it's considered `on`; otherwise, it's considered `off`.
- `on`: Use the PLUS key, without a subscription check. A missing PLUS key produces an explicit error without falling back.
- `off`: Always use the regular connection without checking the subscription.

You can also set `env.PLUS_API_KEY` in user-level or project-level `settings.json`. The built-in image and video generation skills still read only the separate Plus settings file. The CLI also supports `deepcode --plus`, which prompts you to enter your DeepCode Plus API Key. After successful verification, the key is saved to `~/.deepcode-plus/settings.json`.

## Configuration diagnostics

Run `deepcode --doctor` to check configuration, API access, and the installation environment. Use `deepcode --doctor -s ./settings.json` to diagnose a specific settings file.

The report lists configuration paths, load status, effective values, and their sources, including DeepCode Plus settings. Keys and custom environment values are hidden. Diagnostics do not change settings or install updates.

Results use `PASS`, `WARN`, `FAIL`, and `SKIP`. The exit code is 1 if any check fails, otherwise 0; warnings can still mean a check could not be completed. The command works without a TTY and cannot be combined with `--json` or conversation options.
