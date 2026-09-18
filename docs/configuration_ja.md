# Deep Code の設定

## 設定の優先順位

設定は以下の優先順位で適用されます(番号が小さい設定ソースは、番号が大きい設定ソースによって上書きされます)。

| 階層 | 設定ソース | 説明 |
| ----- | -------------------- | ---------------------------------------------- |
| 1     | デフォルト値 | アプリケーション内にハードコードされたデフォルト値 |
| 2     | ユーザー設定ファイル | 現在のユーザーに対するグローバル設定 |
| 3     | プロジェクト設定ファイル | プロジェクト固有の設定 |
| 4     | 環境変数 | システム全体またはセッション固有の変数 |

## 設定ファイル

Deep Code は永続的な設定に `settings.json` ファイルを使用し、2 つの保存場所をサポートしています。

| ファイル種別 | 場所 | 適用範囲 |
| ------------------- | ----------------------------------------- | --------------------------------------------------------------------- |
| ユーザー設定ファイル | `~/.deepcode/settings.json`               | 現在のユーザーのすべての Deep Code セッションに適用されます。 |
| プロジェクト設定ファイル | `<project root>/.deepcode/settings.json` | その特定のプロジェクトで Deep Code を実行したときのみ有効になります。プロジェクト設定はユーザー設定を上書きします。 |

### `settings.json` で利用可能な設定

以下は `settings.json` でサポートされているすべてのトップレベルフィールドと、`env` 内のサブフィールドです。

| フィールド | 型 | 説明 |
| ------------------ | ------- | --------------------------------------------------------------------------- |
| `env`              | object  | 環境変数のグループ(下記のサブフィールド表を参照) |
| `model`            | string  | モデル名。`env.MODEL` より優先されます |
| `thinkingEnabled`  | boolean | 思考モードを有効にするかどうか(DeepSeek V4 シリーズではデフォルトで有効) |
| `reasoningEffort`  | string  | 推論努力の強度。`"high"` または `"max"`(デフォルトは `"max"`) |
| `debugLogEnabled`  | boolean | デバッグログ出力を有効にする(デフォルトは `false`) |
| `telemetryEnabled` | boolean | 匿名の利用状況レポートを有効にする(デフォルトは `true`) |
| `notify`           | string  | タスク完了通知スクリプトのフルパス(例: Slack 通知スクリプト) |
| `webSearchTool`    | string  | カスタム Web 検索スクリプトのフルパス |
| `mcpServers`       | object  | MCP サーバーの設定(キーはサービス名、値は McpServerConfig オブジェクト) |
| `temperature`      | number  | LLM のサンプリング温度。`0` から `2` まで |
| `enabledSkills`    | object  | スキルごとの有効/無効マップ。キーはスキル名 |
| `statusline`       | object  | ステータスラインプラグイン([statusline_ja.md](./statusline_ja.md) を参照) |

#### `env` サブフィールド

| フィールド | 型 | 説明 |
| ----------------- | ------ | ---------------------------------------------------------------- |
| `MODEL`           | string | モデル名。例: `"deepseek-v4-pro"`、`"deepseek-v4-flash"`     |
| `BASE_URL`        | string | API リクエストのベース URL。例: `"https://api.deepseek.com"`    |
| `API_KEY`         | string | API キー |
| `TEMPERATURE`     | string | チャット補完のサンプリング温度。`"0"` から `"2"` まで |
| `THINKING_ENABLED`| string | 思考モードを有効にする |
| `REASONING_EFFORT`| string | 推論努力の強度 |
| `DEBUG_LOG_ENABLED`| string| デバッグログ出力を有効にする |
| `TELEMETRY_ENABLED`| string| 匿名の利用状況レポートを有効にする |
| `<any other KEY>` | string | カスタム環境変数 |

#### `thinkingEnabled` — 思考モード

DeepSeek の思考モードを有効にするかどうかを設定します。`true` で有効、`false` で無効になります。

- `deepseek-v4-pro` と `deepseek-v4-flash` では、思考モードは**デフォルトで有効**です。
- その他のモデルでは、思考モードは**デフォルトで無効**です。

#### `reasoningEffort` — 推論努力の強度

思考モードが有効な場合に、モデルの推論の深さを制御します。

| 値 | 説明 |
| ------ | --------------------------------------------------------- |
| `max`  | 最大の推論深度(デフォルト) |
| `high` | 比較的少ないトークン使用量で、高い推論深度を実現 |

#### `notify` — タスク完了通知

シェルスクリプトのフルパスを設定します。AI アシスタントが一連のタスクを完了すると、そのスクリプトが自動的に実行され、通知の送信(例: Slack メッセージ)などに利用できます。

notify スクリプトの実行時には、以下のコンテキストが環境変数として渡されます。

| 変数 | 説明 |
|----------|-------------|
| `DURATION` | セッションの実行時間(秒、整数) |
| `STATUS` | セッションの状態: `"completed"` または `"failed"` |
| `FAIL_REASON` | 失敗理由(失敗時のみ設定) |
| `BODY` | AI アシスタントの最後の返信のテキスト内容 |
| `TITLE` | セッションのタイトル(再開リストのタイトルと一致) |

```json
{
  "notify": "/path/to/notify-script.sh"
}
```

> 詳細な設定例(Slack、Feishu、ターミナル通知、システム通知など)については、[notify_ja.md](notify_ja.md) を参照してください。

#### `webSearchTool` — カスタム Web 検索

Deep Code には無料で利用できる Web 検索ツールが組み込まれています。独自の検索ロジックが必要な場合は、`webSearchTool` に実行可能スクリプトのフルパスを設定してください。

```json
{
  "webSearchTool": "/path/to/my-search-script.sh"
}
```

このスクリプトは検索クエリを引数として受け取り、AI 向けに JSON 形式で結果を出力します。

#### `enabledSkills` — スキルの有効化

スキルスキャン時にスキルを含めるかどうかを制御します。キーは解決済みのスキル名で、値は boolean である必要があります。

```json
{
  "enabledSkills": {
    "skill-writer": false,
    "code-review": true
  }
}
```

- 設定に含まれていないスキルは、デフォルトで有効になります。
- あるスキルを `false` に設定すると、プロジェクトおよびユーザーのスキルルート全体で、その解決済み `name` を持つすべてのスキルが非表示になります。
- プロジェクト設定は、スキルごとにユーザー設定を上書きします。プロジェクト設定にそのスキルの記載がない場合は、ユーザー設定が使用されます。

#### `mcpServers` — MCP サーバー

MCP(Model Context Protocol)サーバーの設定です。値はキーと値のペアで、キーはサービス名、値はサーバー設定オブジェクトです。

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

| McpServerConfig フィールド | 型 | 必須 | 説明 |
| --------------------- | -------- | -------- | ------------------------------------------------------------------------ |
| `command`             | string   | はい | 実行ファイルのパスまたはコマンド(例: `npx`、`node`、`python`) |
| `args`                | string[] | いいえ | コマンドに渡す引数のリスト |
| `env`                 | object   | いいえ | MCP サーバープロセスに渡す環境変数 |

> `command` が `npx` の場合、Deep Code は自動的に引数の先頭に `-y` を追加します。

MCP の詳しい使い方については、[mcp_ja.md](mcp_ja.md) を参照してください。

#### `debugLogEnabled` — デバッグログ

`true` に設定すると詳細なデバッグログが有効になります(デフォルトは `false`)。API 呼び出しやツール実行のトラブルシューティングに役立ちます。

#### `telemetryEnabled` — 匿名の利用状況レポート

`false` に設定すると匿名の利用状況レポートを無効にできます(デフォルトは `true`)。レポートに含まれるのは匿名のマシン識別子のみで、会話内容、コード、API キーは含まれません。

環境変数で無効にすることもできます。

```bash
DEEPCODE_TELEMETRY_ENABLED=0 deepcode
```

## 環境変数の優先順位

環境変数はアプリケーションを設定する一般的な方法であり、特に機密情報(api-key など)や環境ごとに変わりうる設定に適しています。

### 優先順位の原則

環境変数の優先順位は、「設定がより具体的でローカルであるほど優先度が高い」というロジックと、「env ファイルはデフォルトで既存の環境を保護し、システム変数は env ファイルを上書きする」という上書きルールに従います。(settings.json 内の `env` オブジェクトは、env ファイルの一種と考えることができます。)

優先度のレベル(低いものから高いものへ):
1. `settings.json` のトップレベルで定義された `env` – ツール全体とそのすべてのサブプロセスに対する一般的な設定(グローバル変数)です。外側の環境変数で上書きできますが、環境変数の KEY からは `DEEPCODE_` プレフィックスが取り除かれます。
2. `settings.json` の `mcpServers` 内で定義された `env` – 特定の MCP サービスに対する最も具体的な設定(ローカル変数)です。外側の環境変数で上書きできますが、KEY からは `MCP_` プレフィックスが取り除かれます。
3. シェル/システム環境変数 – オペレーティングシステムレベルです。

### シナリオ

#### 1. モデルの api_key と base_url を設定する

以下の優先順位で適用されます(番号が小さいものは番号が大きいものによって上書きされます)。api_key を例にします。

1. ハードコードされたデフォルト値: `""`
2. ユーザーレベルの settings.json: `{"env": {"API_KEY": "abc123"}}`
3. プロジェクトレベルの settings.json: `{"env": {"API_KEY": "abc123"}}`
4. システム環境変数: `DEEPCODE_API_KEY=abc123 deepcode`

#### 2. model、thinkingEnabled、reasoningEffort を設定する

以下の優先順位で適用されます(番号が小さいものは番号が大きいものによって上書きされます)。thinkingEnabled を例にします。

1. ハードコードされたデフォルト値: `true`
2. ユーザーレベルの settings.json: `{"env": {"THINKING_ENABLED": "true"}}`
3. ユーザーレベルの settings.json: `{"thinkingEnabled": true}`
4. プロジェクトレベルの settings.json: `{"env": {"THINKING_ENABLED": "true"}}`
5. プロジェクトレベルの settings.json: `{"thinkingEnabled": true}`
6. システム環境変数: `DEEPCODE_THINKING_ENABLED=true deepcode`

#### 3. notify や webSearchTool などの外部スクリプト向けに環境変数を設定する

以下の優先順位で適用されます(番号が小さいものは番号が大きいものによって上書きされます)。notify を例にします。

1. ハードコードされたデフォルト値: `os.environ.get('WEBHOOK', '...')  # notify スクリプトのコード`
2. ユーザーレベルの settings.json: `{"env": {"WEBHOOK": "..."}}`
3. プロジェクトレベルの settings.json: `{"env": {"WEBHOOK": "true"}}`
4. システム環境変数: `DEEPCODE_WEBHOOK=... deepcode`

#### 4. MCP サービス向けに環境変数を設定する

以下の優先順位で適用されます(番号が小さいものは番号が大きいものによって上書きされます)。GitHub MCP サーバーを例にします。

1. ユーザーレベルの settings.json: `{"mcpServers":{"github":{"env":{"GITHUB_PERSONAL_ACCESS_TOKEN":"..."}}}}`
2. ユーザーレベルの settings.json: `{"env": {"MCP_GITHUB_PERSONAL_ACCESS_TOKEN": "..."}}`
3. プロジェクトレベルの settings.json: `{"mcpServers":{"github":{"env":{"GITHUB_PERSONAL_ACCESS_TOKEN":"..."}}}}`
4. プロジェクトレベルの settings.json: `{"env": {"MCP_GITHUB_PERSONAL_ACCESS_TOKEN": "..."}}`
5. システム環境変数: `DEEPCODE_MCP_GITHUB_PERSONAL_ACCESS_TOKEN=... deepcode`
