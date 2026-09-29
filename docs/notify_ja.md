# Deep Code タスク完了通知

AIアシスタントが一連のタスクを終えたとき、Deep Code は通知スクリプトを自動的に実行し、タスクの結果を任意のチャネル(Slack、システム通知など)へ送信できます。

## 仕組み

`settings.json` の `notify` フィールドに、実行可能なスクリプトのフルパスを設定します。AIアシスタントがタスクの応答を完了するたびに、Deep Code はそのスクリプトを実行し、コンテキストを環境変数として注入します。

## 注入される環境変数

| 変数 | 説明 |
|----------|-------------|
| `DURATION` | セッションの所要時間(秒、整数) |
| `STATUS` | セッションのステータス: `"completed"` または `"failed"` |
| `FAIL_REASON` | 失敗の理由(失敗時のみ設定) |
| `BODY` | AIアシスタントの最後の応答のテキスト内容 |
| `TITLE` | セッションのタイトル(再開リストのタイトルと同じ) |

## 設定方法

`~/.deepcode/settings.json` を編集し、`notify` フィールドを追加します。

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

Slack の Webhook URL など、通知スクリプト用のカスタム環境変数を `env` に設定することもできます。

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

これらの `env` の変数は、スクリプトの実行環境に注入されます。

## Slack 通知

### 1. Slack Webhook URL を取得する

1. [Slack App](https://api.slack.com/apps) を作成します
2. App のページで **Incoming Webhooks** → **Add New Webhook to Workspace** に進み、Webhook URL を生成します

### 2. 通知スクリプトを作成する

`~/.deepcode/notify-slack.sh` を作成します。

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

スクリプトに実行権限を付与します。

```bash
chmod +x ~/.deepcode/notify-slack.sh
```

### 3. settings.json を設定する

```json
{
  "env": {
    "SLACK_WEBHOOK_URL": "https://hooks.slack.com/services/*****/****/**********"
  },
  "notify": "/Users/you/.deepcode/notify-slack.sh"
}
```

> Python 版のスクリプトも利用できます。任意のカスタム環境変数を `env` 経由で渡して参照できます。

## Feishu / WeCom Webhook 通知

`node` で JSON を組み立て(特殊文字を自動エスケープ)、`curl` で送信します。`WEBHOOK_URL` は `env` 経由で渡します。

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

`WEBHOOK_URL` は、お使いの Feishu ボットの Webhook URL に置き換えてください。このパターンは、JSON ペイロードの形式を調整するだけで、他の Webhook ベースの通知(Slack、WeCom など)にも応用できます。

## ターミナル通知(iTerm2 / Windows Terminal)

iTerm2 や Windows Terminal では、OSC 9 エスケープシーケンスを使うことで、依存関係なしにネイティブなターミナル通知を表示できます。

`~/.deepcode/notify.sh` を作成します。

```bash
#!/bin/bash
# iTerm2 / Windows Terminal の OSC 9 通知
printf '\x1b]9;DeepCode: task %s (%ss)\x07' "${STATUS:-completed}" "${DURATION}"
```

```json
{
  "notify": "/Users/you/.deepcode/notify.sh"
}
```

Git Bash を使っている Windows ユーザーは同じスクリプトをそのまま利用できます。あるいは、`.bat` スクリプトを作成する方法もあります。

```batch
@echo off
REM Windows Terminal の OSC 9 通知
echo \x1b]9;DeepCode: task %STATUS% (%DURATION%s)\x07
```

## macOS システム通知

```bash
#!/bin/bash
# macOS システム通知
osascript -e "display notification \"Task ${STATUS:-completed}, took ${DURATION}s\" with title \"DeepCode\""
```

```json
{
  "notify": "/Users/you/.deepcode/notify.sh"
}
```

## Linux システム通知

`libnotify-bin` が必要です。

```bash
sudo apt install libnotify-bin   # Debian/Ubuntu
```

`~/.deepcode/notify.sh` を作成します。

```bash
#!/bin/bash
# Linux の notify-send 通知
notify-send "DeepCode" "Task ${STATUS:-completed}, took ${DURATION}s"
```

```json
{
  "notify": "/home/you/.deepcode/notify.sh"
}
```

## Windows msg ポップアップ通知

```batch
@echo off
REM Windows の msg ポップアップ通知
msg %USERNAME% "DeepCode: task %STATUS% (%DURATION%s)"
```

```json
{
  "notify": "C:\\Users\\you\\.deepcode\\notify.bat"
}
```

## カスタム通知スクリプト

注入される環境変数と、`env` 経由で渡した任意の追加変数を使って、任意の言語(Python、Node.js、Ruby など)で独自の通知スクリプトを作成できます。
