# Deep Code 任务完成通知

当 AI 助手完成一轮任务后，Deep Code 可以自动执行一个通知脚本，将任务结果发送到你指定的渠道（如 Slack、系统通知等）。

## 工作原理

在 `settings.json` 中配置 `notify` 字段，指向一个可执行脚本的完整路径。每次 AI 助手完成任务应答后，Deep Code 会执行该脚本，并通过环境变量注入上下文信息。

## 注入的环境变量

| 环境变量      | 说明                                  |
| ------------- | ------------------------------------- |
| `DURATION`    | 会话耗时，单位秒（整数）              |
| `STATUS`      | 会话状态：`"completed"` 或 `"failed"` |
| `FAIL_REASON` | 失败原因（仅失败时设置）              |
| `BODY`        | 最后一条 AI 助手回复的文本内容        |
| `TITLE`       | 会话标题（对应 resume 列表中的标题）  |

## 配置方法

编辑 `~/.deepcode/settings.json`，添加 `notify` 字段：

```json
{
  "env": {
    "MODEL": "deepseek-v4-pro",
    "BASE_URL": "https://api.deepseek.com",
    "API_KEY": "sk-..."
  },
  "thinkingEnabled": true,
  "reasoningEffort": "max",
  "notify": "/path/to/your-notify-script.sh"
}
```

你也可以在 `env` 中配置通知脚本所需的自定义环境变量，例如 Slack Webhook URL：

```json
{
  "env": {
    "MODEL": "deepseek-v4-pro",
    "BASE_URL": "https://api.deepseek.com",
    "API_KEY": "sk-...",
    "SLACK_WEBHOOK_URL": "https://hooks.slack.com/services/*****/****/**********"
  },
  "notify": "/Users/you/.deepcode/notify-slack.sh"
}
```

这些 `env` 中的变量会被注入到脚本的执行环境中。

## Slack 通知

### 1. 获取 Slack Webhook URL

1. 创建 [Slack App](https://api.slack.com/apps)
2. 在 App 页面点击 **Incoming Webhooks** → **Add New Webhook to Workspace**，生成 Webhook URL

### 2. 创建通知脚本

创建 `~/.deepcode/notify-slack.sh`：

```bash
#!/usr/bin/env bash
SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"
CURRENT_DIR=$(pwd)
BRANCH=$(git branch --show-current 2>/dev/null)
curl -X POST "$SLACK_WEBHOOK_URL" \
  -H "Content-type: application/json" \
  --data "{
      \"text\": \"✅ Deep Code 任务已完成\n · cwd: $CURRENT_DIR\n · Branch: $BRANCH\n · Duration: $DURATION 秒\"
  }"
```

给脚本添加可执行权限：

```bash
chmod +x ~/.deepcode/notify-slack.sh
```

### 3. 配置 settings.json

```json
{
  "env": {
    "SLACK_WEBHOOK_URL": "https://hooks.slack.com/services/*****/****/**********"
  },
  "notify": "/Users/you/.deepcode/notify-slack.sh"
}
```

> Python 版本的脚本同样支持，你可以在 `env` 中传入并引用任意自定义环境变量。

## 飞书 / 企业微信等 Webhook 通知

以下示例使用 `node` 构建 JSON（自动转义特殊字符），`curl` 发送。通过 `env` 传入 `WEBHOOK_URL`：

```bash
#!/bin/bash
WEBHOOK_URL="${WEBHOOK_URL:-}"

STATUS="${STATUS:-completed}"
TITLE="${TITLE:-Untitled}"
DURATION="${DURATION:-0}"
BODY="${BODY:-(no output)}"

PAYLOAD=$(node -e "
process.stdout.write(JSON.stringify({
  msg_type: 'interactive',
  card: {
    header: { title: { tag: 'plain_text', content: 'DeepCode: ' + process.env.TITLE + ' ' + process.env.STATUS + ' [' + process.env.DURATION + 's]' } },
    elements: [{ tag: 'markdown', content: (process.env.BODY || '').slice(0, 2000) || '(no output)' }]
  }
}))
")

curl -s -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD"
```

```json
{
  "env": {
    "WEBHOOK_URL": "https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxxxx"
  },
  "notify": "/Users/you/.deepcode/notify-feishu.sh"
}
```

将 `WEBHOOK_URL` 替换为你的飞书机器人 Webhook 地址。此模式同样适用于 Slack、企业微信等 webhook 类通知，只需修改 JSON payload 格式。

## 终端通知（iTerm2 / Windows Terminal）

如果你的终端是 iTerm2 或 Windows Terminal，可以直接通过 OSC 9 转义序列弹出终端原生通知，无需额外依赖。

创建 `~/.deepcode/notify.sh`：

```bash
#!/bin/bash
# iTerm2 / Windows Terminal OSC 9 通知
printf '\x1b]9;DeepCode: task %s (%ss)\x07' "${STATUS:-completed}" "${DURATION}"
```

```json
{
  "notify": "/Users/you/.deepcode/notify.sh"
}
```

Windows 用户如使用 Git Bash，上述脚本同样可用；也可创建 `.bat` 脚本：

```batch
@echo off
REM Windows Terminal OSC 9 通知
echo \x1b]9;DeepCode: task %STATUS% (%DURATION%s)\x07
```

## macOS 系统通知

```bash
#!/bin/bash
# macOS 系统通知
osascript -e "display notification \"任务已${STATUS:-完成}，耗时 ${DURATION}s\" with title \"DeepCode\""
```

```json
{
  "notify": "/Users/you/.deepcode/notify.sh"
}
```

## Linux 系统通知

需要安装 `libnotify-bin`：

```bash
sudo apt install libnotify-bin   # Debian/Ubuntu
```

创建 `~/.deepcode/notify.sh`：

```bash
#!/bin/bash
# Linux notify-send 通知
notify-send "DeepCode" "任务已${STATUS:-完成}，耗时 ${DURATION}s"
```

```json
{
  "notify": "/home/you/.deepcode/notify.sh"
}
```

## Windows msg 弹窗通知

```batch
@echo off
REM Windows msg 弹窗通知
msg %USERNAME% "DeepCode: task %STATUS% (%DURATION%s)"
```

```json
{
  "notify": "C:\\Users\\you\\.deepcode\\notify.bat"
}
```

## 自定义通知脚本

你可以根据通知脚本注入的环境变量自行编写任意逻辑的通知脚本（Python、Node.js、Ruby 等均可），只要脚本可执行即可。脚本中可通过 `env` 字段传入额外需要的配置变量。
