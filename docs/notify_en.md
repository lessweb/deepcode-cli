# Deep Code Task Completion Notification

When the AI assistant finishes a round of tasks, Deep Code can automatically execute a notification script to send task results to your chosen channel (Slack, system notifications, etc.).

## How It Works

Configure the `notify` field in `settings.json` with the full path to an executable script. Every time the AI assistant completes a task response, Deep Code executes that script and injects context as environment variables.

On Windows, when `notify` is not configured, Deep Code uses the built-in desktop tip. Clicking the tip attempts to focus the terminal window that launched the CLI. A custom `notify` script takes precedence over the built-in tip.

## Injected Environment Variables

| Variable | Description |
|----------|-------------|
| `DURATION` | Session duration in seconds (integer) |
| `STATUS` | Session status: `"completed"` or `"failed"` |
| `FAIL_REASON` | Failure reason (only set on failure) |
| `QUESTION` | The text content of the last user question |
| `BODY` | The text content of the last AI assistant reply |
| `TITLE` | Session title (matches the resume list title) |

## Configuration

Edit `~/.deepcode/settings.json` and add the `notify` field:

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

You can also configure custom environment variables for the notify script in `env`, such as a Slack Webhook URL:

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

These `env` variables are injected into the script's execution environment.

## Slack Notification

### 1. Get a Slack Webhook URL

1. Create a [Slack App](https://api.slack.com/apps)
2. In the App page, go to **Incoming Webhooks** → **Add New Webhook to Workspace** to generate a Webhook URL

### 2. Create the Notification Script

Create `~/.deepcode/notify-slack.sh`:

```bash
#!/usr/bin/env bash
SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"
CURRENT_DIR=$(pwd)
BRANCH=$(git branch --show-current 2>/dev/null)
curl -X POST "$SLACK_WEBHOOK_URL" \
  -H "Content-type: application/json" \
  --data "{
      \"text\": \"✅ Deep Code task completed\n · cwd: $CURRENT_DIR\n · Branch: $BRANCH\n · Duration: $DURATION s\"
  }"
```

Make the script executable:

```bash
chmod +x ~/.deepcode/notify-slack.sh
```

### 3. Configure settings.json

```json
{
  "env": {
    "SLACK_WEBHOOK_URL": "https://hooks.slack.com/services/*****/****/**********"
  },
  "notify": "/Users/you/.deepcode/notify-slack.sh"
}
```

> A Python version is also supported; you can pass and reference any custom environment variables via `env`.

## Feishu / WeCom Webhook Notification

Use `node` to build JSON (auto-escapes special characters) and `curl` to send. Pass `WEBHOOK_URL` via `env`:

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

Replace `WEBHOOK_URL` with your Feishu bot webhook URL. This pattern also works for other webhook-based notifications (Slack, WeCom, etc.) — just adjust the JSON payload format.

## Terminal Notification (iTerm2 / Windows Terminal)

On iTerm2 or Windows Terminal, you can use the OSC 9 escape sequence for native terminal notifications with zero dependencies.

Create `~/.deepcode/notify.sh`:

```bash
#!/bin/bash
# iTerm2 / Windows Terminal OSC 9 notification
printf '\x1b]9;DeepCode: task %s (%ss)\x07' "${STATUS:-completed}" "${DURATION}"
```

```json
{
  "notify": "/Users/you/.deepcode/notify.sh"
}
```

Windows users on Git Bash can use the same script; alternatively, create a `.bat` script:

```batch
@echo off
REM Windows Terminal OSC 9 notification
echo \x1b]9;DeepCode: task %STATUS% (%DURATION%s)\x07
```

## macOS System Notification

```bash
#!/bin/bash
# macOS system notification
osascript -e "display notification \"Task ${STATUS:-completed}, took ${DURATION}s\" with title \"DeepCode\""
```

```json
{
  "notify": "/Users/you/.deepcode/notify.sh"
}
```

## Linux System Notification

Requires `libnotify-bin`:

```bash
sudo apt install libnotify-bin   # Debian/Ubuntu
```

Create `~/.deepcode/notify.sh`:

```bash
#!/bin/bash
# Linux notify-send notification
notify-send "DeepCode" "Task ${STATUS:-completed}, took ${DURATION}s"
```

```json
{
  "notify": "/home/you/.deepcode/notify.sh"
}
```

## Windows msg Popup Notification

```batch
@echo off
REM Windows msg popup notification
msg %USERNAME% "DeepCode: task %STATUS% (%DURATION%s)"
```

```json
{
  "notify": "C:\\Users\\you\\.deepcode\\notify.bat"
}
```

## Custom Notification Scripts

You can write your own notification scripts in any language (Python, Node.js, Ruby, etc.) using the injected environment variables and any additional variables passed via `env`.
