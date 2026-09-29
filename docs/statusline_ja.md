# ステータスラインプラグイン

Deep Code CLI では、CLI のソースコードを変更することなく、プラグインを通じてターミナル下部のステータスラインにカスタム情報(Git ブランチ、現在時刻、トークン使用量など)を表示できます。ステータスラインはプロンプト入力欄の下にあるキーボードヒント行のさらに下に描画され、すべてのプロバイダーの出力がセパレーターで連結されて表示されます。

## 設定

`~/.deepcode/settings.json`(またはプロジェクトレベルの `.deepcode/settings.json`)に `statusline` フィールドを追加します。

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

### フィールド

| フィールド    | 型        | 説明                                                                         |
| ------------- | --------- | ---------------------------------------------------------------------------- |
| `enabled`     | boolean   | ステータスラインを有効にするかどうか。省略した場合、プロバイダーが 1 つ以上設定されていればデフォルトで true になります。 |
| `refreshMs`   | number    | 更新間隔(ミリ秒)。最小値は 500、デフォルトは 2000 です。                   |
| `separator`   | string    | プロバイダー出力間のセパレーター。デフォルトは `" · "` です。                |
| `providers`   | array     | プロバイダーのリスト。宣言順に描画されます。                                 |

## プロバイダーの種類

### `command` — 外部コマンドの実行

`refreshMs` ごとにシェルコマンドを実行し、標準出力の最初の行をステータスセグメントとして使用します。

| フィールド  | 型      | 必須     | 説明                                                                     |
| ----------- | ------- | -------- | ------------------------------------------------------------------------ |
| `type`      | string  | はい     | `"command"` を指定します。                                               |
| `command`   | string  | はい     | シェルコマンド(パイプやリダイレクトなどにも対応)。                     |
| `id`        | string  | いいえ   | 一意の識別子。省略した場合はインデックスから自動生成されます。           |
| `cwd`       | string  | いいえ   | 作業ディレクトリ。相対パスはプロジェクトルートを基準に解決されます。     |
| `timeoutMs` | number  | いいえ   | タイムアウト(ミリ秒)。デフォルトは 1500。タイムアウト時は空文字列になります。 |
| `color`     | string  | いいえ   | Ink がサポートする色(例: `"red"`、`"#229ac3"`)。                       |

例:

```json
{ "type": "command", "id": "git", "command": "git status -sb | head -1" }
{ "type": "command", "id": "time", "command": "date +%H:%M" }
{ "type": "command", "id": "node", "command": "node -v", "color": "green" }
```

### `module` — JS モジュールの読み込み

ローカルの JS/MJS モジュールを読み込み、デフォルトエクスポートされた関数を呼び出します。その戻り値がセグメントのテキストになります。

| フィールド  | 型      | 必須     | 説明                                                                                 |
| ----------- | ------- | -------- | ------------------------------------------------------------------------------------ |
| `type`      | string  | はい     | `"module"` を指定します。                                                            |
| `path`      | string  | はい     | モジュールのパス。相対パスはプロジェクトルートを基準に解決されます。                 |
| `id`        | string  | いいえ   | 一意の識別子。                                                                       |
| `timeoutMs` | number  | いいえ   | タイムアウト(ミリ秒)。デフォルトは 2000。                                          |
| `color`     | string  | いいえ   | Ink がサポートする色。                                                               |

モジュールは `default` 関数(または `provider` という名前付きエクスポート)をエクスポートする必要があります。

```js
// .deepcode/plugins/tokens.mjs
export default function tokensProvider({ projectRoot, session }) {
  // 文字列を返します(同期・非同期のどちらでも可)。
  if (session?.activeSessionId) {
    return `msgs:${session.messageCount} reqs:${session.requestCount} tokens:${session.totalTokens}`;
  }
  return `tokens: 1.2k`;
}
```

この関数は `{ projectRoot: string, session: SessionInfo | null }` を受け取り、`string` または `Promise<string>` を返します。

`SessionInfo` の構造:

| フィールド        | 型                  | 説明                                                       |
| ----------------- | ------------------- | ---------------------------------------------------------- |
| `activeSessionId` | `string \| null`    | 現在アクティブなセッションの ID。存在しない場合は `null`。 |
| `messageCount`    | `number`            | アクティブなセッション内のメッセージ総数。                 |
| `requestCount`    | `number`            | アクティブなセッションで実行された LLM API リクエストの総数。 |
| `totalTokens`     | `number`            | アクティブなセッションで消費されたトークンの総数。         |

## 安全上の制約

- **モジュールプロバイダーのパスは、プロジェクトルートまたはユーザーのホームディレクトリの配下に置く必要があります**。どちらの外にもある絶対パスは拒否されます(任意のコードの読み込みを防ぐため)。
- 各セグメントのテキストには自動的に次の処理が適用されます:
  - 最初の空でない行のみに切り詰め
  - ANSI エスケープシーケンスの除去
  - 連続する空白の圧縮
  - 40 文字への切り詰め(超過分は `…` で表示)
- コマンドプロバイダーの標準出力は 4 KB までに制限されます。
- いずれかのプロバイダーが例外を投げた場合、タイムアウトした場合、または空文字列を返した場合は、**そのセグメントだけがスキップされ**、他のセグメントには影響しません。

## 動作

- 最初の更新は CLI の起動直後に実行され、その後は設定された間隔で実行されます。
- ユーザーレベル設定とプロジェクトレベル設定の `providers` 配列は**マージ**されます(ユーザー設定が先、プロジェクト設定が後)。その他のフィールドはプロジェクトレベルの値が優先されます。
- ステータスラインはあらゆる状態(処理中や権限プロンプトの表示中を含む)で表示され、処理中インジケーターの妨げにはなりません。
- 設定の変更を反映するには CLI の再起動が必要です(ホットリロードには対応していません)。

## 完全な設定例

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
