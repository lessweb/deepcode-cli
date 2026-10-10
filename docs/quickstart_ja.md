# クイックスタート

Deep Code は、DeepSeek-V4 モデル向けのオープンソースのターミナル AI コーディングアシスタントです。深い思考(Thinking)と推論努力の制御に対応し、スキルや MCP(Model Context Protocol)によって機能を拡張できます。

## 前提条件

始める前に、以下を用意してください。

- Node.js `22` 以上
- DeepSeek API キー

## インストール

npm で Deep Code をグローバルにインストールします。

```bash
npm install -g @vegamo/deepcode-cli
```

インストールされたバージョンを確認します。

```bash
deepcode --version
```

## DeepSeek-V4 の設定

Deep Code では `deepseek-v4-pro` を推奨しており、`deepseek-v4-flash` にも対応しています。`~/.deepcode/settings.json` を作成し、DeepSeek モデルの設定を追加してください。

```json
{
  "env": {
    "MODEL": "deepseek-v4-pro",
    "BASE_URL": "https://api.deepseek.com",
    "API_KEY": "sk-..."
  },
  "thinkingEnabled": true,
  "reasoningEffort": "max"
}
```

`API_KEY` はお使いの DeepSeek API キーに置き換えてください。

主な項目:

| 項目 | 説明 |
| ----- | ----------- |
| `env.MODEL` | DeepSeek のモデル名。`deepseek-v4-pro` を推奨 |
| `env.BASE_URL` | DeepSeek API のエンドポイント。デフォルトは `https://api.deepseek.com` |
| `env.API_KEY` | DeepSeek API キー |
| `thinkingEnabled` | 思考モードを有効にするかどうか |
| `reasoningEffort` | 推論努力。通常は `"high"` または `"max"` |

プロジェクト内に `.deepcode/settings.json` を作成すれば、そのプロジェクトだけに適用されるモデル、権限、MCP の設定をカスタマイズすることもできます。

DeepSeek 公式のセットアップ手順については、[Deep Code 連携ガイド](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/deepcode)を参照してください。

すべての設定オプションについては、[configuration_ja.md](configuration_ja.md) を参照してください。

## 起動

プロジェクトのディレクトリを開きます。

```bash
cd path/to/your/project
deepcode
```

Deep Code はカレントディレクトリで対話型のターミナル UI を起動します。タスクを入力して `Enter` を押してください。

初期プロンプトを指定して起動するには、次のようにします。

```bash
deepcode -p "Summarize this project"
```

## まず試してみる

まずは読み取り専用のタスクから始めましょう。

```text
Summarize this repository and explain how to run it.
```

```text
Find the main entry points and explain the request flow.
```

次に、コーディングタスクを試してみます。

```text
Add a unit test for the login validation logic.
```

```text
Run the test suite and fix the failing tests.
```

先に計画を立ててもらうこともできます。

```text
Before editing files, propose a plan for adding pagination to the user list.
```

## 基本操作

| 操作 | キー |
| ------ | --- |
| メッセージを送信 | `Enter` |
| 改行を挿入 | `Shift+Enter` または `Ctrl+J` |
| 現在の応答を中断 | `Esc` |
| 画像を貼り付け | `Ctrl+V` |
| 終了 | `Ctrl+D` を 2 回押すか、`/exit` を使用 |

## スラッシュコマンド

入力欄に `/` と入力すると、コマンドメニューが開きます。

| コマンド | 動作 |
| ------- | ------ |
| `/new` | 新しい会話を開始する |
| `/resume` | 続きから再開する過去の会話を選ぶ |
| `/continue` | 現在の会話を続ける、または最新の会話を再開する |
| `/model` | モデル、思考モード、推論努力を切り替える |
| `/init` | 現在のプロジェクト用に `AGENTS.md` 指示ファイルを作成する |
| `/skills` | 利用可能なエージェントスキルを表示する |
| `/mcp` | MCP サーバーの状態と利用可能なツールを表示する |
| `/undo` | コードや会話を以前の時点に戻す |
| `/raw` | 表示モードを変更する |
| `/exit` | Deep Code を終了する |

## プロジェクト指示の追加

プロジェクト内で次を実行します。

```text
/init
```

Deep Code が `AGENTS.md` の作成を手伝います。次のようなプロジェクトの約束事を記録しておきましょう。

- 依存関係のインストール方法とテストの実行方法
- コードスタイルとコントリビューションの方針
- 重要なディレクトリに関する注意事項
- コード編集の前後に実行すべきチェック

Deep Code は、そのプロジェクトで作業する際にこれらの指示を自動的に利用します。

## スキルを使う

エージェントスキルは、コードレビュー、リリースチェック、ドキュメント生成、フレームワーク固有の開発手順など、再利用可能なワークフローです。

利用可能なスキルを一覧表示するには、次を実行します。

```text
/skills
```

`/` と入力してメニューからスキルを選ぶこともできます。

詳細は [agent-skills_ja.md](agent-skills_ja.md) を参照してください。

## 外部ツールとの連携

MCP を使うと、Deep Code を GitHub、ブラウザ、データベースなどのサービスに接続できます。

MCP を設定した後、次を実行します。

```text
/mcp
```

接続中の MCP サーバーと利用可能なツールが表示されます。

セットアップ手順は [mcp_ja.md](mcp_ja.md) を参照してください。

## 権限と安全性

Deep Code はファイルの読み取り、コードの編集、コマンドの実行を行うことがあります。どの操作を自動的に許可するか、どれを確認必須にするか、どれを拒否するかを設定できます。

Deep Code はデフォルトで YOLO モードに対応しており、ファイルの読み書きやコマンドの実行など、一般的なコーディングタスクをスムーズに進められます。より慎重に運用したい場合は、厳格な権限設定を使うことで、リスクの高い操作の前に Deep Code が確認を求めるようになります。

詳細は [permission_ja.md](permission_ja.md) を参照してください。

## タスク完了通知

Deep Code は、タスクの完了時に通知スクリプトを実行できます。たとえば Slack メッセージ、Feishu メッセージ、システム通知、ターミナルアラートの送信などです。

具体例は [notify_ja.md](notify_ja.md) を参照してください。

## 次のステップ

- 設定ガイド全体を読む: [configuration_ja.md](configuration_ja.md)
- 権限を設定する: [permission_ja.md](permission_ja.md)
- エージェントスキルを書く: [agent-skills_ja.md](agent-skills_ja.md)
- MCP ツールを設定する: [mcp_ja.md](mcp_ja.md)
- タスク完了通知を設定する: [notify_ja.md](notify_ja.md)
