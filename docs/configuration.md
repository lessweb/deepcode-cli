# Deep Code 配置

## 配置层级

配置按以下优先级顺序应用（数字较小的会被数字较大的覆盖）：

| 层级 | 配置来源     | 说明                                          |
| ---- | ------------ | ------------------------------------------- |
| 1    | 默认值       | 应用程序内硬编码的默认值                         |
| 2    | 用户设置文件 | 当前用户的全局设置                               |
| 3    | 项目设置文件 | 项目特定的设置                                   |
| 4    | 环境变量     | 系统范围或会话特定的变量                          |

## 设置文件

Deep Code 使用 `settings.json` 设置文件进行持久化配置，支持两个层级的存放位置：

| 文件类型     | 位置                                 | 作用范围                                              |
| ------------ | ---------------------------------- | ---------------------------------------------------- |
| 用户设置文件 | `~/.deepcode/settings.json`         | 适用于当前用户的所有 Deep Code 会话。                      |
| 项目设置文件 | `项目根目录/.deepcode/settings.json` | 仅在该特定项目中运行 Deep Code 时生效。项目设置会覆盖用户设置。 |

### `settings.json` 中的可用设置

以下是 `settings.json` 支持的全部顶层字段，以及 `env` 内部支持的子字段：

| 字段                 | 类型      | 说明                                                                |
| -------------------- | --------- | ------------------------------------------------------------------- |
| `env`                | object    | 环境变量分组（见下方子字段表）                                       |
| `model`              | string    | 模型名称。优先级高于 `env.MODEL`                                    |
| `thinkingEnabled`    | boolean   | 是否启用思考模式（DeepSeek V4 系列默认启用）                         |
| `reasoningEffort`    | string    | 推理强度，可选 `"high"` 或 `"max"`（默认 `"max"`）                  |
| `debugLogEnabled`    | boolean   | 是否启用调试日志输出（默认 `false`）                                 |
| `telemetryEnabled`   | boolean   | 是否启用匿名使用数据上报（默认 `true`）                              |
| `notify`             | string    | 任务完成通知脚本的完整路径（如 Slack 通知脚本）                      |
| `webSearchTool`      | string    | 自定义联网搜索脚本的完整路径                                         |
| `mcpServers`         | object    | MCP 服务器配置（键为服务名，值为 McpServerConfig 对象）              |

#### `env` 子字段

| 字段       | 类型   | 说明                                                               |
| ---------- | ------ | ------------------------------------------------------------------ |
| `MODEL`    | string | 模型名称。例如 `"deepseek-v4-pro"`、`"deepseek-v4-flash"`          |
| `BASE_URL` | string | API 请求的基础 URL。例如 `"https://api.deepseek.com"`              |
| `API_KEY`  | string | API 密钥                                                          |
| `THINKING_ENABLED`  | string | 是否启用思考模式                                         |
| `REASONING_EFFORT`  | string | 推理强度                                                |
| `DEBUG_LOG_ENABLED`  | string | 是否启用调试日志输出                                     |
| `TELEMETRY_ENABLED`  | string | 是否启用匿名使用数据上报                                   |
| `<其他任意KEY>` | string | 自定义环境变量 |

#### `thinkingEnabled` — 思考模式

是否启用 DeepSeek 思考模式。设置为 `true` 启用、`false` 禁用。

- 对于 `deepseek-v4-pro` 和 `deepseek-v4-flash`，思考模式**默认启用**。
- 对于其他模型，思考模式**默认关闭**。

#### `reasoningEffort` — 推理强度

当思考模式启用时，控制模型思考的深度：

| 值     | 说明                               |
| ------ | --------------------------------- |
| `max`  | 最大推理深度（默认值）              |
| `high` | 较高推理深度，token消耗相对较小      |

#### `notify` — 任务完成通知

设置一个 Shell 脚本的完整路径。当 AI 助手完成一轮任务后，会自动执行该脚本，可用于发送通知（如 Slack 消息）。

通知脚本执行时，会通过环境变量注入以下上下文信息：

| 环境变量 | 说明 |
|----------|------|
| `DURATION` | 会话耗时，单位秒（整数） |
| `STATUS` | 会话状态：`"completed"` 或 `"failed"` |
| `FAIL_REASON` | 失败原因（仅失败时设置） |
| `BODY` | 最后一条 AI 助手回复的文本内容 |
| `TITLE` | 会话标题（对应 resume 列表中的标题） |

```json
{
  "notify": "/path/to/notify-script.sh"
}
```

> 详细的 Slack、飞书、终端通知、系统通知等配置示例，请参阅 [notify.md](notify.md)。

#### `webSearchTool` — 自定义联网搜索

Deep Code 内置免费可用的 Web Search 工具。如果需要自定义搜索逻辑，可将 `webSearchTool` 设为一个可执行脚本的完整路径：

```json
{
  "webSearchTool": "/path/to/my-search-script.sh"
}
```

脚本接收一个搜索查询参数，输出 JSON 格式的结果供 AI 使用。

#### `mcpServers` — MCP 服务器

MCP（Model Context Protocol）服务器配置。值是键值对，键为服务名称，值为服务器配置对象。

```json
{
  "mcpServers": {
    "<服务名>": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxxxxxxxxxxx"
      }
    }
  }
}
```

| McpServerConfig 字段 | 类型     | 必填 | 说明                                                                 |
| -------------------- | -------- | ---- | -------------------------------------------------------------------- |
| `command`            | string   | 是   | 可执行文件路径或命令（如 `npx`、`node`、`python`）                   |
| `args`               | string[] | 否   | 传递给命令的参数列表                                                  |
| `env`                | object   | 否   | 传递给 MCP 服务器进程的环境变量                                       |

> 当 `command` 为 `npx` 时，Deep Code 会自动在参数前补充 `-y`。

详细 MCP 使用说明请参考 [mcp.md](mcp.md)。


#### `theme` — 主题配置

Deep Code 支持自定义主题颜色，让你的终端界面更符合个人喜好。

**使用预设主题**

```json
{
  "theme": {
    "preset": "dark"
  }
}
```

可用的预设主题：

| 预设名称        | 说明                           |
| --------------- | ------------------------------ |
| `light`         | 浅色主题（默认，浅色背景优化） |
| `dark`          | 暗色主题（深色背景优化）       |
| `github-light`  | GitHub Light 风格主题          |
| `github-dark`   | GitHub Dark 风格主题           |
| `gitlab-light`  | GitLab Light 风格主题          |
| `gitlab-dark`   | GitLab Dark 风格主题           |
| `monokai`       | Monokai 风格主题               |
| `dracula`       | Dracula 风格主题               |

**自定义主题颜色**

使用 `preset: "custom"` 并通过 `overrides` 覆盖部分颜色：

```json
{
  "theme": {
    "preset": "custom",
    "overrides": {
      "primary": "#ff6600",
      "success": "greenBright"
    }
  }
}
```

**可用的颜色 Token**

| Token        | 说明                                         | 默认值     |
| ------------ | -------------------------------------------- | ---------- |
| `primary`    | 品牌色：Logo、用户消息、选中项、标题         | `#229ac3`  |
| `secondary`  | 辅助品牌色：边框、渐变                       | `#229ac3e6`|
| `success`    | 成功：工具执行成功、低风险操作               | `#1a7f37`  |
| `error`      | 错误：工具执行失败、高风险操作               | `#d1242f`  |
| `warning`    | 警告：进行中状态、中风险操作                 | `#fa8c16`  |
| `info`       | 信息：技能、图片附件                         | `#0969da`  |
| `text`       | 主文字颜色                                   | `#3D4149`  |
| `textDim`    | 次要文字：暗化提示、引用块                   | `#646A71`  |
| `textBright` | 亮色文字：强调提示                           | `#1F2329`  |
| `code`       | 代码块/内联代码                              | `#787f8a`  |
| `border`     | 边框                                         | `#999`     |
| `gradients`  | Logo 渐变色数组                              | `["#229ac3", "#8250df"]` |

颜色值支持以下格式：
- Hex 格式：`"#ff6600"`、`"#ff6600cc"`（带透明度）
- Chalk 命名颜色：`"greenBright"`、`"cyanBright"`、`"red"` 等

**运行时切换主题**

在 CLI 中使用 `/theme` 命令打开主题选择器，使用方向键浏览主题，按 Space 或 Enter 确认选择：

```
/theme    # 打开主题选择器
```

选择器中可用的主题与上表一致。在浏览过程中会实时预览主题效果，按 Esc 可取消并恢复原主题。确认后会自动保存到 `settings.json`，下次启动时生效。

#### `debugLogEnabled` — 调试日志

设为 `true` 可让程序输出详细的调试日志（默认 `false`），用于排查 API 调用和工具执行的问题。

#### `telemetryEnabled` — 匿名使用数据上报

设为 `false` 可关闭匿名使用数据上报（默认 `true`）。上报仅包含匿名的机器标识，不包含对话内容、代码或 API 密钥。

也可以通过环境变量关闭：

```bash
DEEPCODE_TELEMETRY_ENABLED=0 deepcode
```

## 环境变量优先级

环境变量是配置应用程序的常用方式，尤其适用于敏感信息（如 api-key）或可能在不同环境之间更改的设置。

### 优先级原则

环境变量优先级遵循“越具体、越局部的配置，优先级越高”和“env文件默认保护现有环境，系统变量高于env文件”的覆盖逻辑。(settings.json的env对象可以认为是一种env文件)

优先级层级 (由低到高)
1. settings.json 外层的 env：这是针对整个工具及其所有子进程的通用配置（全局变量）。可被外层环境变量覆盖，但环境变量KEY会移除`DEEPCODE_`前缀。
2. settings.json mcpServers 内定义的 env：这是针对特定 MCP 服务的最具体配置（局部变量）。可被外层环境变量覆盖，但环境变量KEY会移除`MCP_`前缀。
3. Shell 环境系统变量：操作系统层面的环境变量。

### 场景

#### 一、设置模型的api_key, base_url

按以下优先级顺序应用（数字较小的会被数字较大的覆盖）(以api_key为例)：

1. 硬编码默认值: `""`
2. 用户级settings.json: `{"env": {"API_KEY": "abc123"}}`
3. 项目级settings.json: `{"env": {"API_KEY": "abc123"}}`
4. 系统环境变量: `DEEPCODE_API_KEY=abc123 deepcode`

#### 二、设置模型的model, thinkingEnabled, reasoningEffort

按以下优先级顺序应用（数字较小的会被数字较大的覆盖）(以thinkingEnabled为例)：

1. 硬编码默认值: `true`
2. 用户级settings.json: `{"env": {"THINKING_ENABLED": "true"}}`
3. 用户级settings.json: `{"thinkingEnabled": true}`
4. 项目级settings.json: `{"env": {"THINKING_ENABLED": "true"}}`
5. 项目级settings.json: `{"thinkingEnabled": true}`
6. 系统环境变量: `DEEPCODE_THINKING_ENABLED=true deepcode`

#### 三、设置启动notify, webSearchTool等外挂脚本的环境变量

按以下优先级顺序应用（数字较小的会被数字较大的覆盖）(以notify为例)：

1. 硬编码默认值：`os.environ.get('WEBHOOK', '...')  # notify脚本代码`
2. 用户级settings.json: `{"env": {"WEBHOOK": "..."}}`
3. 项目级settings.json: `{"env": {"WEBHOOK": "true"}}`
4. 系统环境变量: `DEEPCODE_WEBHOOK=... deepcode`

#### 四、设置MCP Service的环境变量

按以下优先级顺序应用（数字较小的会被数字较大的覆盖）(以github MCP server为例)：

1. 用户级settings.json: `{"mcpServers":{"github":{"env":{"GITHUB_PERSONAL_ACCESS_TOKEN":"..."}}}}`
2. 用户级settings.json: `{"env": {"MCP_GITHUB_PERSONAL_ACCESS_TOKEN": "..."}}`
3. 项目级settings.json: `{"mcpServers":{"github":{"env":{"GITHUB_PERSONAL_ACCESS_TOKEN":"..."}}}}`
4. 项目级settings.json: `{"env": {"MCP_GITHUB_PERSONAL_ACCESS_TOKEN": "..."}}`
5. 系统环境变量: `DEEPCODE_MCP_GITHUB_PERSONAL_ACCESS_TOKEN=... deepcode`
