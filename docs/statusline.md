# 状态栏插件

Deep Code CLI 支持通过插件向终端底部状态栏注入自定义信息（Git 分支、当前时间、token 用量等),无需修改 CLI 源码。状态栏行展示在输入框下方的快捷键提示行下方,所有 provider 的输出会用分隔符拼接后渲染。

## 配置

在 `~/.deepcode/settings.json`(或项目级 `.deepcode/settings.json`)中添加 `statusline` 字段:

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

### 字段

| 字段          | 类型      | 说明                                                                |
| ------------- | --------- | ------------------------------------------------------------------- |
| `enabled`     | boolean   | 是否启用。省略时,只要存在至少一个 provider 即视为启用              |
| `refreshMs`   | number    | 拉取间隔毫秒。最小 500,默认 2000                                  |
| `separator`   | string    | 多个 provider 输出之间的分隔符,默认 `" · "`                       |
| `providers`   | array     | provider 列表,按声明顺序渲染                                       |

## Provider 类型

### `command` —— 执行外部命令

每隔 `refreshMs` 在 shell 中执行一次命令,取 stdout 第一行作为状态栏 segment。

| 字段        | 类型    | 必填 | 说明                                                              |
| ----------- | ------- | ---- | ----------------------------------------------------------------- |
| `type`      | string  | 是   | 固定为 `"command"`                                                |
| `command`   | string  | 是   | shell 命令(支持管道、重定向等)                                  |
| `id`        | string  | 否   | 唯一标识。省略时按下标自动生成                                    |
| `cwd`       | string  | 否   | 执行目录。相对路径相对于项目根目录,省略时使用项目根目录          |
| `timeoutMs` | number  | 否   | 超时毫秒,默认 1500。超时返回空串                                  |
| `color`     | string  | 否   | ink 支持的颜色名(如 `"red"`、`"#229ac3"`)                       |

示例:

```json
{ "type": "command", "id": "git", "command": "git status -sb | head -1" }
{ "type": "command", "id": "time", "command": "date +%H:%M" }
{ "type": "command", "id": "node", "command": "node -v", "color": "green" }
```

### `module` —— 加载 JS 模块

加载本地 JS/MJS 模块,调用其默认导出函数,把返回值作为 segment 文本。

| 字段        | 类型    | 必填 | 说明                                                                                |
| ----------- | ------- | ---- | ----------------------------------------------------------------------------------- |
| `type`      | string  | 是   | 固定为 `"module"`                                                                   |
| `path`      | string  | 是   | 模块路径。相对路径相对于项目根目录                                                  |
| `id`        | string  | 否   | 唯一标识                                                                            |
| `timeoutMs` | number  | 否   | 超时毫秒,默认 2000                                                                  |
| `color`     | string  | 否   | ink 支持的颜色                                                                      |

模块需导出一个 `default` 函数(或具名 `provider`):

```js
// .deepcode/plugins/tokens.mjs
export default function tokensProvider({ projectRoot, session }) {
  // 返回字符串(同步或异步)
  if (session?.activeSessionId) {
    return `msgs:${session.messageCount} reqs:${session.requestCount} tokens:${session.totalTokens}`;
  }
  return `tokens: 1.2k`;
}
```

函数接收一个对象 `{ projectRoot: string, session: SessionInfo | null }`,返回 `string` 或 `Promise<string>`。

`SessionInfo` 结构:

| 字段              | 类型               | 说明                                                |
| ----------------- | ------------------ | --------------------------------------------------- |
| `activeSessionId` | `string \| null`   | 当前活跃会话的 ID，无会话时为 `null`                |
| `messageCount`    | `number`           | 当前会话中的消息总数                                  |
| `requestCount`    | `number`           | 当前会话中的 LLM API 请求次数                        |
| `totalTokens`     | `number`           | 当前会话中消耗的 token 总数                          |

## 安全限制

- **module provider 路径必须位于项目根目录或用户home目录之下**,绝对路径在这两个范围之外会被拒绝加载(防止从任意位置执行代码)。
- 单个 segment 文本被自动:
  - 取第一个非空行
  - 去除 ANSI 转义序列
  - 折叠空白字符
  - 截断到 40 个字符(超出加 `…`)
- command provider 的 stdout 最多读取 4 KB。
- 任何 provider 抛错、超时、或返回空字符串,**只跳过该 segment**,不影响其它 provider。

## 行为

- 启动 CLI 后立即触发一次拉取,之后按 `refreshMs` 周期刷新。
- 用户级与项目级配置的 `providers` 数组会**合并**(用户先、项目后);其他字段以项目级为优先。
- 状态栏行在任何场景下都显示(包括 busy、permission prompt 等),不影响 busy 提示。
- 修改配置文件后需重启 CLI 生效(不会热加载)。

## 完整示例

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
