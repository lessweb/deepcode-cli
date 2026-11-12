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
| `contextWindow`     | number/string | 上下文窗口上限，可使用精确 token 数或 `128K`、`1M` 等格式          |
| `autoCompactWindow` | number/string | 自动压缩阈值，默认取上下文窗口的 80%                           |
| `retainRatio` | number | 上下文压缩后，按模型上下文窗口的百分比保留最近对话历史的比例（默认 `0.16`，即 16%） |
| `retainTokens` | number | 上下文压缩后，按绝对 token 数量保留最近对话历史的预算，与 `retainRatio` 互斥 |
| `model`              | string    | 模型名称。优先级高于 `env.MODEL`                                    |
| `thinkingEnabled`    | boolean   | 是否启用思考模式（DeepSeek V4 系列默认启用）                         |
| `reasoningEffort`    | string    | 推理强度，可选 `"low"`、`"high"` 或 `"max"`（默认 `"max"`）        |
| `experimental`       | object    | 实验功能配置，如思维链摘要（见下方说明）                            |
| `multimodal`         | string    | 多模态（图片）能力开关，可选 `"default"`、`"on"` 或 `"off"`（默认 `"default"`） |
| `filesApiEnabled`    | boolean   | 是否通过 DeepSeek Files API 发送图片（默认 `false`）                       |
| `filesApiTimeoutMs`  | number    | 单张图片 Files API 处理超时，默认 `60000`，最大 `600000` 毫秒              |
| `fileExpiresAfterSeconds` | number | 远端文件有效期，默认 `604800` 秒                                      |
| `fileRefreshMarginSeconds` | number | 剩余有效期低于该值时刷新缓存，默认 `3600` 秒                         |
| `fileQuotaCleanupBatch` | number | 配额不足时清理的最旧 Deep Code 文件数，默认 `100`                         |
| `maxRequestFilesBytes` | number | 单次请求内图片原始字节总上限，默认 `134217728`（128 MiB）                    |
| `debugLogEnabled`    | boolean   | 是否启用调试日志输出（默认 `false`）                                 |
| `telemetryEnabled`   | boolean   | 是否启用匿名使用数据上报（默认 `true`）                              |
| `notify`             | string    | 任务状态通知脚本的完整路径（如 Slack 通知脚本）                      |
| `webSearchTool`      | string    | 自定义联网搜索脚本的完整路径                                         |
| `deepseekSearchApiEnabled` | boolean | 是否使用 DeepSeek 官方网页搜索（默认 `false`） |
| `mcpServers`         | object    | MCP 服务器配置（键为服务名，值为 McpServerConfig 对象）              |
| `temperature`        | number    | 模型采样温度，范围 `0` 到 `2`                           |
| `permissions`        | object    | 权限策略及 `addWorkingDirs` 额外工作目录配置（参见 [permission.md](./permission.md)） |
| `enabledSkills`      | object    | 按 skill 名称启用或禁用 skill 的配置                                 |
| `statusline`         | object    | 状态栏插件配置(参见 [statusline.md](./statusline.md))               |
| `history` | object | 用户输入历史的保存和大小限制 |

#### `env` 子字段

| 字段       | 类型   | 说明                                                               |
| ---------- | ------ | ------------------------------------------------------------------ |
| `MODEL`    | string | 模型名称。例如 `"deepseek-v4-pro"`、`"deepseek-v4-flash"`          |
| `BASE_URL` | string | API 请求的基础 URL。例如 `"https://api.deepseek.com"`              |
| `API_KEY`  | string | API 密钥                                                          |
| `TEMPERATURE`  | string | Chat Completions 采样温度，范围 `"0"` 到 `"2"`              |
| `THINKING_ENABLED`  | string | 是否启用思考模式                                         |
| `REASONING_EFFORT`  | string | 推理强度                                                |
| `MULTIMODAL`  | string | 多模态（图片）能力开关，可选 `"default"`、`"on"` 或 `"off"`         |
| `DEBUG_LOG_ENABLED`  | string | 是否启用调试日志输出                                     |
| `TELEMETRY_ENABLED`  | string | 是否启用匿名使用数据上报                                   |
| `<其他任意KEY>` | string | 自定义环境变量 |

#### 上下文窗口

`contextWindow` 和 `autoCompactWindow` 是 `settings.json` 的顶层字段。number 必须是正整数，表示精确 token 数；string 使用大小写不敏感的 `K` 或 `M` 后缀，按 `1K = 1024`、`1M = 1024²` 换算：

```json
{
  "contextWindow": "1M",
  "autoCompactWindow": "512K"
}
```

普通模型的默认上下文窗口为 `256K`，DeepSeek V4 系列为 `1M`。未设置自动压缩阈值时取最终上下文窗口的 80%；无效值会被忽略，自动压缩阈值超过上下文窗口时会限制为上下文窗口。

#### 压缩后的尾部保留预算

`retainRatio` 和 `retainTokens` 是 `settings.json` 的顶层字段，同一配置文件只能设置其中一项。项目级设置任一项时，整体覆盖用户级的保留策略；项目未设置时继承用户配置，两处均未设置时默认采用 `retainRatio: 0.16`。

`retainRatio` 必须是 `(0, 1]` 范围内的数字，预算按「上下文窗口减去输出预留」乘以该比例并向下取整。`retainTokens` 必须是非负整数，`0` 表示不额外预留尾部；不支持 `"32K"` 等字符串。

最终保留预算必须严格小于实际生效的自动压缩阈值，否则报配置错误，不会自动缩小预算。使用较低阈值时，可能需要同时设置较小的保留预算：

```json
{
  "autoCompactWindow": "180K",
  "retainTokens": 32768
}
```

这两项配置用于自动压缩。工具调用与结果会保持完整，因此实际保留量可能超过预算。手动压缩和上下文超限恢复继续采用不额外预留尾部的策略。

#### `thinkingEnabled` — 思考模式

是否启用 DeepSeek 思考模式。设置为 `true` 启用、`false` 禁用。

- 对于 `deepseek-flash`、`deepseek-v4-pro`、`deepseek-v4-flash` 和 `deepseek-v4-flash-vision-exp`，思考模式**默认启用**。
- 对于其他模型，思考模式**默认关闭**。

#### `reasoningEffort` — 推理强度

当思考模式启用时，控制模型思考的深度：

| 值     | 说明                               |
| ------ | --------------------------------- |
| `max`  | 最大推理深度（默认值）              |
| `high` | 较高推理深度，token消耗相对较小      |
| `low`  | 较低推理深度，token消耗更少          |

#### `experimental` — 实验功能

通过 `/experimental` 选择 **Reasoning summary**，再选择 `on` / `off`，即可启用或关闭思维链摘要。

也可以直接编辑 `settings.json`，以下示例启用思维链摘要：

```json
{
  "experimental": {
    "reasoningSummary": "on",
    "reasoningSummaryModel": "deepseek-flash"
  }
}
```

| 子字段 | 类型 | 默认值 | 说明 |
| ------ | ---- | ------ | ---- |
| `reasoningSummary` | string | `"off"` | 思维链摘要开关，可选 `"on"` 或 `"off"` |
| `reasoningSummaryModel` | string | `"deepseek-flash"` | 用于生成摘要的模型，通过设置文件修改 |

启用后，当模型仅返回至少 400 个字符的推理内容、没有正文，且当前会话标题非空时，会额外调用摘要模型，将推理压缩为一两句话。CLI 显示 thinking 消息时，正文为空则优先显示摘要。摘要仅用于显示，不会作为助手正文发送回模型。

摘要请求始终关闭思考模式，不跟随主会话的思考设置。生成失败、超时或返回空文本时，会继续原有会话流程。

#### `multimodal` — 多模态（图片）能力

控制是否将当前模型视为支持图片输入的多模态模型：

| 值         | 说明                                                         |
| ---------- | ------------------------------------------------------------ |
| `default`  | 按内置模型列表自动判定（默认值）                              |
| `on`       | 强制视为多模态模型，图片以 `image_url` 形式直接内联发送        |
| `off`      | 强制视为非多模态模型，由模型通过识图工具按需读取      |

当使用的模型未内置在已知模型列表中、或其实际能力与默认判定不符时，可通过该配置覆盖。

#### DeepSeek Files API

当 `BASE_URL` 为 `https://api.deepseek.com` 时，设置 `filesApiEnabled: true` 后，Deep Code 会将图片上传到固定的 `https://api.deepseek.com/files`，并在聊天请求中使用 `file_id`。其他 API 地址不会启用该功能。上传或缓存刷新失败时，本次请求直接失败；关闭开关时图片处理逻辑保持不变。

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

单个文件最大 64 MiB，上传超时不能超过 DeepSeek 规定的 10 分钟。远端文件 ID 会缓存在 `~/.deepcode/files-api-cache.json`；缓存不保存明文 API Key。遇到远端存储配额错误时，只会清理文件名以 `deepcode-` 开头的最旧文件，然后重试一次。

#### `notify` — 任务状态通知

设置一个 Shell 脚本的完整路径。当会话完成、失败、等待用户输入或等待权限确认时，会自动执行该脚本，可用于发送通知（如 Slack 消息）。恢复执行后再次暂停或结束时，会再次通知。

通知脚本执行时，会通过环境变量注入以下上下文信息：

| 环境变量 | 说明 |
|----------|------|
| `DURATION` | 本次执行从开始到暂停或结束的耗时，单位秒（整数）；恢复执行后重新计时 |
| `STATUS` | 实际会话状态：`completed`（完成）、`failed`（失败）、`waiting_for_user`（等待用户输入）或 `ask_permission`（等待权限确认） |
| `FAIL_REASON` | 失败原因（仅失败时设置） |
| `BODY` | 最后一条 AI 助手回复的文本内容 |
| `TITLE` | 会话标题（对应 resume 列表中的标题） |
| `SESSION_ID` | 触发本次通知的会话 ID |

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

#### `deepseekSearchApiEnabled` — 启用 DeepSeek 网页搜索 API

Deep Code 支持最新的[DeepSeek官方网页搜索API](https://api-docs.deepseek.com/zh-cn/guides/search)。设置 `deepseekSearchApiEnabled: true`，且当前连接的 `BASE_URL` 为 `https://api.deepseek.com` 时启用。按照官方文档介绍（截止2026-10-30），网页搜索按请求次数计费，不按 token 或返回结果条数计费，网页搜索每 1,000 次成功请求	5元。

`deepseekSearchApiEnabled` 默认值为 `false`。关闭开关或使用其他 API 地址时，保持原有搜索行为。

#### `enabledSkills` — Skill 启用配置

控制 skill 扫描时是否包含指定 skill。键是解析后的 skill 名称，值必须是布尔值：

```json
{
  "enabledSkills": {
    "skill-writer": false,
    "code-review": true
  }
}
```

- 未配置的 skill 默认启用。
- 将某个 skill 设置为 `false` 后，所有项目级和用户级目录中解析名称相同的 skill 都会被隐藏。
- 项目设置会按 skill 覆盖用户设置。如果项目设置没有配置某个 skill，则使用用户设置。

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

#### 输入历史与搜索

按 Ctrl+R 搜索当前会话及跨会话保存的用户输入。输入关键词实时预览；Ctrl+R / ↑ 查找更早的匹配，Ctrl+S / ↓ 查找更新的匹配。Enter 将结果放入输入框继续编辑，不会发送；Esc / Ctrl+C 取消并恢复原草稿。raw 显示模式仍通过 `/raw` 选择。

历史只保存实际提交的用户文本，不包含自动摘要、工具注入内容或其他角色的消息。跨会话历史位于 `~/.deepcode/history.jsonl`，可在 `settings.json` 中配置：

```json
{
  "history": {
    "persistence": "saveAll",
    "maxBytes": 10485760
  }
}
```

- `persistence` 默认为 `"saveAll"`。设为 `"none"` 停止保存，但不删除、清空或裁剪已有文件，已有历史仍可搜索。
- `maxBytes` 默认为 `10485760`（10 MiB），须为非负整数；`0` 表示不限制大小，仍然保存。
- 每次追加后检查文件大小。超限时删除最旧记录，保留最近记录至上限的约 80%；最新一条始终保留，因此单条超大记录仍可能超过上限。
- 项目配置按字段覆盖用户配置。已有会话不会自动回填到全局历史；恢复会话后可以搜索该会话的用户输入。

## DeepCode PLUS 订阅与 LLM 通道

PLUS 独立配置文件为 `~/.deepcode-plus/settings.json`：

```json
{
  "subscriptionPlan": "default",
  "env": { "PLUS_API_KEY": "sk-..." }
}
```

`subscriptionPlan` 支持 `default`、`on`、`off`；缺失或非法值按 `default` 处理。普通通道继续使用上文配置层级合并后的 API key 和 base URL。

- `default`：如果开通了DeepCode Plus订阅，则相当于`on`，否则相当于`off`。
- `on`：直接使用 PLUS key，不执行订阅检查。缺少 PLUS key 时明确报错，不回退普通通道。
- `off`：固定使用普通通道，不执行订阅检查。

也可以在用户级或项目级 `settings.json` 的 `env.PLUS_API_KEY` 中配置 Key。内置图片、视频生成 Skill 仍只读取独立 Plus 配置。CLI也支持运行 `deepcode --plus`，按提示输入 DeepCode Plus API Key。验证通过后，Key 会保存到 `~/.deepcode-plus/settings.json`。

## 配置诊断

运行 `deepcode --doctor` 检查配置、API 连接和安装环境；使用 `deepcode --doctor -s ./settings.json` 检查指定的配置文件。

报告列出配置文件路径、加载状态、最终值及其来源，并覆盖 DeepCode Plus 配置。密钥和自定义环境变量值不会显示。诊断不修改配置或执行更新。

输出包含 `PASS`、`WARN`、`FAIL` 和 `SKIP`。有 `FAIL` 时退出码为 1，否则为 0；只有警告不代表所有检查均已通过。命令可在非交互终端运行，不支持与 `--json` 或会话参数组合。
