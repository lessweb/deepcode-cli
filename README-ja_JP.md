<div align="center">
<br/>
<br/>
<p align="center">
  <a href='https://deepcode.vegamo.cn/'>
    <img src='https://avatars.githubusercontent.com/u/118287711?s=200&v=4' width='100' alt="deepcode-cli"/>
  </a>
</p>
<h1>Deep Code CLI</h1>

[![][npm-release-shield]][npm-release-link] [![][npm-downloads-shield]][npm-downloads-link] [![][github-contributors-shield]][github-contributors-link] [![][github-forks-shield]][github-forks-link] [![][github-stars-shield]][github-stars-link]
[![][github-issues-shield]][github-issues-link] [![][github-issues-pr-shield]][github-issues-pr-link] [![][github-license-shield]][github-license-link]

[English](./README-en.md) · [中文](./README.md) · 日本語

<br/>
</div>

[Deep Code](https://github.com/lessweb/deepcode-cli) は、`deepseek-v4` モデルに最適化されたターミナル AI コーディングアシスタントです。深い思考(Deep Thinking)、推論努力(Reasoning Effort)の制御、Agent Skills、MCP(Model Context Protocol)統合をサポートしています。


## インストール

```bash
npm install -g @vegamo/deepcode-cli
```

任意のプロジェクトディレクトリで `deepcode` を実行して開始します。

![intro2](resources/intro2.png)

## 設定

`~/.deepcode/settings.json` を作成します:

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

この設定ファイルは [Deep Code VSCode 拡張機能](https://github.com/lessweb/deepcode) と共有されます — 一度設定すれば、どこでも使えます。

設定の詳細(多階層の優先順位、環境変数など)については、[docs/configuration_ja.md](docs/configuration_ja.md) を参照してください。

## 主な機能

### **スキル(Skills)**
Deep Code CLI はエージェントスキルをサポートしており、アシスタントの機能を拡張できます:

スキルは以下の場所から、優先順位の高い順に検出されます:

| スコープ   | パス                  | 用途                          |
| :--------- | :-------------------- | :---------------------------- |
| プロジェクト | `./.deepcode/skills/` | Deep Code のネイティブな場所  |
| プロジェクト | `./.agents/skills/`   | クロスクライアント相互運用性  |
| ユーザー    | `~/.deepcode/skills/` | Deep Code のネイティブな場所  |
| ユーザー    | `~/.agents/skills/`   | クロスクライアント相互運用性  |

### **DeepSeek に最適化**
- DeepSeek モデルのパフォーマンスに特化してチューニングされています。
- [Context Caching](https://api-docs.deepseek.com/guides/kv_cache) を利用してコストを削減できます。
- [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode) と Effort Control をネイティブにサポートしています。

## スラッシュコマンドとキーボードショートカット

| スラッシュコマンド | 動作                                                       |
|------------------|------------------------------------------------------------|
| `/`              | スキル / コマンドメニューを開く                            |
| `/new`           | 新しい会話を開始する                                       |
| `/resume`        | 続きから再開する以前の会話を選択する                       |
| `/continue`      | アクティブな会話を続けるか、再開する会話を選択する         |
| `/model`         | モデル、思考モード、推論努力を切り替える                   |
| `/raw`           | 表示モードを切り替える(Normal / Lite / Raw スクロールバック) |
| `/init`          | AGENTS.md ファイルを初期化する(LLM プロジェクト指示)     |
| `/skills`        | 利用可能なスキルを一覧表示する                             |
| `/mcp`           | MCP サーバーの状態と利用可能なツールを表示する             |
| `/undo`          | コードや会話を以前の状態に復元する                         |
| `/exit`          | 終了する(`Ctrl+D` を 2 回でも可)                          |

| キー             | 動作                                                       |
|------------------|------------------------------------------------------------|
| `Enter`          | プロンプトを送信する                                       |
| `Shift+Enter`    | 改行を挿入する(`Ctrl+J` でも可)                          |
| `Ctrl+V`         | クリップボードから画像を貼り付ける                         |
| `Esc`            | 現在のモデルターンを中断する                               |
| `Ctrl+D` を 2 回 | Deep Code を終了する                                       |

## サポートされているモデル

- `deepseek-v4-pro`(推奨)
- `deepseek-v4-flash`
- その他の OpenAI 互換モデル

## FAQ

### Deep Code に VSCode 拡張機能はありますか?

はい。Deep Code はフル機能の VSCode 拡張機能を提供しており、[VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=vegamo.deepcode-vscode) から入手できます。拡張機能は CLI と `~/.deepcode/settings.json` 設定ファイルを共有しているため、ターミナルとエディタをシームレスに切り替えられます。

### Deep Code は画像の理解をサポートしていますか?

Deep Code はマルチモーダル入力をサポートしています — `Ctrl+V` でクリップボードから画像を貼り付けられます。ただし、`deepseek-v4` はまだマルチモーダルに対応していません。一部のモデルはマルチモーダル機能を持っていますが、マルチターン対話のリクエストに厳しい制限があります。マルチモーダル入力には、最も統合が優れている Volcano Ark の `Doubao-Seed-2.0-pro` モデルの使用をおすすめします。

### タスク完了後に自動で Slack メッセージを送信するには?

Slack の Webhook を呼び出すシェル通知スクリプトを作成し、`~/.deepcode/settings.json` の `notify` フィールドにそのスクリプトのフルパスを設定します。詳細な手順は [docs/notify_ja.md](docs/notify_ja.md) を参照してください。

### Web 検索を有効にするには?

Deep Code には、ほとんどのユースケースで十分に機能する無料の Web Search ツールが組み込まれています。Web 検索にカスタムスクリプトを使いたい場合は、`~/.deepcode/settings.json` の `webSearchTool` フィールドにスクリプトのフルパスを設定してください。詳細な手順は次を参照してください: https://github.com/qorzj/web_search_cli

### Coding Plan はサポートされていますか?

はい。`~/.deepcode/settings.json` の `env.BASE_URL` を OpenAI 互換の API エンドポイントに設定するだけです。Volcano Ark の Coding Plan を例にすると:

```json
{
  "env": {
    "MODEL": "ark-code-latest",
    "BASE_URL": "https://ark.cn-beijing.volces.com/api/coding/v3",
    "API_KEY": "**************"
  },
  "thinkingEnabled": true
}
```

### MCP を設定するには?

Deep Code は MCP(Model Context Protocol)をサポートしており、GitHub、ブラウザ、データベースなどの外部サービスに接続できます。`settings.json` の `mcpServers` フィールドを設定して有効化し、`/mcp` コマンドで MCP サーバーの状態と利用可能なツールを確認できます。

詳細なセットアップ手順は次を参照してください: [docs/mcp_ja.md](docs/mcp_ja.md)

### タスク完了後に通知を送信するように Deep Code を設定するには?

AI アシスタントがタスクを完了すると、Deep Code は通知スクリプトを自動的に実行して、タスクの結果を指定されたチャネル(Slack、システム通知など)に送信できます。

詳細な設定手順は次を参照してください: [docs/notify_ja.md](docs/notify_ja.md)

### Deep Code は YOLO モードのみのサポートですか?

いいえ。Deep Code にはきめ細かな権限制御メカニズムが組み込まれており、AI アシスタントがシェルコマンドの実行、ファイルの読み書き、ネットワークアクセスなどを行う前に操作を確認できます。`settings.json` の `permissions` フィールドで、各権限スコープのポリシー(常に許可、常に確認、拒否)を設定できます。詳細は [docs/permission_ja.md](docs/permission_ja.md) を参照してください。

## コントリビューション

コントリビューションを歓迎します!始め方は次のとおりです:

```bash
# リポジトリをクローン
git clone https://github.com/lessweb/deepcode-cli.git
cd deepcode-cli

# 依存関係をインストール
npm install

# ローカル開発(型チェック + Lint + フォーマットチェック + バンドル)
npm run build

# テストを実行
npm test

# グローバルにリンク(ローカルのグローバルインストール)
npm link
```

- PR を提出する前に `npm run check` が通ることを確認してください(型チェック + Lint + フォーマットチェック)
- エラーを避けるため、ビルド前に `npm run format` を実行することをおすすめします

## ヘルプ

- バグ報告や機能リクエストは GitHub Issues へ (https://github.com/lessweb/deepcode-cli/issues)

## ライセンス

- MIT

## 応援のお願い

このツールが役に立ったと感じたら、次の方法で応援をご検討ください:

- GitHub で Star を付ける (https://github.com/lessweb/deepcode-cli)
- フィードバックや提案を送る
- 友人や同僚に共有する


<!-- LINK GROUP -->

[npm-release-link]: https://www.npmjs.com/package/@vegamo/deepcode-cli
[npm-release-shield]: https://img.shields.io/npm/v/@vegamo/deepcode-cli?color=4d6BFE&labelColor=black&logo=npm&logoColor=white&style=flat-square&cacheSeconds=1800
[npm-downloads-link]: https://www.npmjs.com/package/@vegamo/deepcode-cli
[npm-downloads-shield]: https://img.shields.io/npm/dt/@vegamo/deepcode-cli?labelColor=black&style=flat-square&color=4d6BFE&cacheSeconds=1800
[github-contributors-link]: https://github.com/lessweb/deepcode-cli/graphs/contributors
[github-contributors-shield]: https://img.shields.io/github/contributors/lessweb/deepcode-cli?color=4d6BFE&labelColor=black&style=flat-square&cacheSeconds=1800
[github-forks-link]: https://github.com/lessweb/deepcode-cli/network/members
[github-forks-shield]: https://img.shields.io/github/forks/lessweb/deepcode-cli?color=4d6BFE&labelColor=black&style=flat-square&cacheSeconds=1800
[github-stars-link]: https://github.com/lessweb/deepcode-cli/network/stargazers
[github-stars-shield]: https://img.shields.io/github/stars/lessweb/deepcode-cli?color=4d6BFE&labelColor=black&style=flat-square&cacheSeconds=1800
[github-issues-link]: https://github.com/lessweb/deepcode-cli/issues
[github-issues-shield]: https://img.shields.io/github/issues/lessweb/deepcode-cli?color=4d6BFE&labelColor=black&style=flat-square&cacheSeconds=1800
[github-issues-pr-link]: https://github.com/lessweb/deepcode-cli/pulls
[github-issues-pr-shield]: https://img.shields.io/github/issues-pr/lessweb/deepcode-cli?color=4d6BFE&labelColor=black&style=flat-square&cacheSeconds=1800
[github-license-link]: https://github.com/lessweb/deepcode-cli/blob/main/LICENSE
[github-license-shield]: https://img.shields.io/github/license/lessweb/deepcode-cli?color=4d6BFE&labelColor=black&style=flat-square&cacheSeconds=1800
