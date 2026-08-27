# Deep Code CLI MCP 設定ガイド

Deep Code CLI は MCP(Model Context Protocol)に対応しており、AI アシスタントを GitHub、ブラウザ、データベースなどの外部ツールやサービスと接続できます。

## 概要

MCP を設定すると、Deep Code は次のことができるようになります。

- GitHub リポジトリの操作(Issue の閲覧、PR の作成、コード検索など)
- ブラウザの操作(スクリーンショット、クリック、フォーム入力など)
- ファイルシステムへのアクセス
- データベースや API への接続
- ...そのほか MCP プロトコルに対応したあらゆる外部サービス

Deep Code では、MCP ツールは `mcp__<service_name>__<tool_name>` という形式で命名されます。例: `mcp__github__search_code`

## MCP サーバーの設定

`~/.deepcode/settings.json` を編集し、`mcpServers` フィールドを追加します。

```json
{
  "env": {
    "MODEL": "deepseek-v4-pro",
    "BASE_URL": "https://api.deepseek.com",
    "API_KEY": "sk-..."
  },
  "thinkingEnabled": true,
  "reasoningEffort": "max",
  "mcpServers": {
    "<service_name>": {
      "command": "<executable>",
      "args": ["<arg1>", "<arg2>"],
      "env": {
        "<env_var>": "<value>"
      }
    }
  }
}
```

### 設定フィールド

| フィールド | 型       | 必須 | 説明                                                                                                                                                     |
| --------- | -------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `command` | string   | はい | MCP サーバー実行ファイルのパスまたはコマンド(例: `npx`、`node`、`python`)。コマンドが `npx` の場合、Deep Code は自動的に引数の先頭へ `-y` を追加します。 |
| `args`    | string[] | いいえ | コマンドに渡す引数のリスト                                                                                                                                |
| `env`     | object   | いいえ | MCP サーバープロセスに渡す環境変数(API キーなど)                                                                                                        |

## よく使われる MCP の例

### GitHub MCP

Deep Code から GitHub リポジトリを直接操作できるようになります(コード検索、Issue/PR の管理、ファイルの読み書きなど)。

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxxxxxxxxxxx"
      }
    }
  }
}
```

> GitHub Personal Access Token は [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens) で生成できます。

### ブラウザ操作(Playwright)

Deep Code でブラウザを操作し、スクリーンショットの取得やページ操作などを行えるようになります。

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

### ファイルシステム

指定したディレクトリ内のファイルを Deep Code が読み書きできるようになります。

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"]
    }
  }
}
```

### カスタム Python MCP

```json
{
  "mcpServers": {
    "my-tool": {
      "command": "python",
      "args": ["-m", "my_mcp_server"],
      "env": {
        "API_KEY": "xxx"
      }
    }
  }
}
```

## 完全な設定例

GitHub と Playwright の両方の MCP サーバーを設定した、完全な `~/.deepcode/settings.json` の例を以下に示します。

```json
{
  "env": {
    "MODEL": "deepseek-v4-pro",
    "BASE_URL": "https://api.deepseek.com",
    "API_KEY": "sk-xxxxxxxxxxxx"
  },
  "thinkingEnabled": true,
  "reasoningEffort": "max",
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxxxxxxxxxxx"
      }
    },
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

## MCP の使い方

設定が完了したら `deepcode` を起動し、チャットで `/mcp` と入力すると、設定済みのすべての MCP サーバーの状態と、各サーバーが提供するツールの一覧を確認できます。

会話の中で MCP ツール名を使うだけで、そのツールを呼び出せます。例:

```
Help me search for issues in the deepcode-cli repository on GitHub
```

AI が自動的に `mcp__github__search_issues` ツールを呼び出して処理を完了します。

## ツールの命名規則

MCP ツール名は `mcp__<service_name>__<tool_name>` の 3 つの部分で構成されます。

| サービス   | ツール名                | 完全な呼び出し名                             |
| ---------- | ----------------------- | ------------------------------------------- |
| github     | search_code             | `mcp__github__search_code`                  |
| github     | create_pull_request     | `mcp__github__create_pull_request`          |
| playwright | browser_navigate        | `mcp__playwright__browser_navigate`         |
| playwright | browser_take_screenshot | `mcp__playwright__browser_take_screenshot`  |

各サーバーが提供するツールの一覧は `/mcp` で確認できます。

## トラブルシューティング

### 起動に失敗する場合

MCP サーバーの起動に失敗する場合は、次の点を確認してください。

1. `command` がインストールされているか(例: `npx` には Node.js が必要です)
2. `env` に設定した環境変数が正しいか(例: `GITHUB_PERSONAL_ACCESS_TOKEN`)
3. `deepcode` を実行しているターミナルがネットワークにアクセスできるか

### ツールが表示されない場合

1. `settings.json` の `mcpServers` フィールドの書式が正しいか確認する
2. deepcode の起動後、`/mcp` でサーバーの状態を確認する
3. サーバーの状態がエラーになっている場合は、エラーメッセージをもとにデバッグする

### Windows ユーザー向け

Windows では、Deep Code CLI が `.cmd` コマンドに対するシェルサポートを自動的に追加します。MCP のコマンドがバッチスクリプトの場合は、ファイル名が `.cmd` で終わっていることを確認してください。

## 独自の MCP サーバーを作成する

MCP サーバーは [Model Context Protocol](https://modelcontextprotocol.io/) の仕様に従い、JSON-RPC 2.0 を使って通信します。次のメソッドを実装していれば、どの言語でも MCP サーバーを作成できます。

1. `initialize` — ハンドシェイクとプロトコルのネゴシエーション
2. `tools/list` — 利用可能なツールの一覧を返す
3. `tools/call` — ツール呼び出しを実行する

詳しくは [MCP 公式ドキュメント](https://modelcontextprotocol.io/) を参照してください。
