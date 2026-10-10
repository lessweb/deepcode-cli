# エージェントスキル

## 概要

スキルは、次のような指示セットに適しています。

- コードレビュー、リリース準備、レポート生成など、複数のタスクで繰り返し使うもの
- 毎回プロンプトに貼り付けるには長すぎる、または詳細すぎるもの
- テンプレート、スクリプト、スキーマ、サンプル、リファレンスドキュメントなどのリソースを伴うもの
- 「PDFフォームを処理する」「このプロジェクトのデータベースマイグレーションを作成する」のように、明確な状況で発動するもの

次のような用途にはスキルを使わないでください。

- 一度きりのタスク要件
- 短いリポジトリルール(通常は `AGENTS.md` に書くのが適切です)
- 外部システムへのライブな操作(通常はMCP(Model Context Protocol)ツールが適切です)

## スキャン対象の場所

Deep Code CLIは以下の順序でスキルをスキャンします。複数のスキルが同じ `name` に解決された場合、最も優先度の高いものだけが有効になります。

| 優先度 | スコープ | パス | 用途 |
| -------- | ------- | --------------------- | ------- |
| 1        | プロジェクト | `./.deepcode/skills/` | Deep Codeネイティブのプロジェクトスキル |
| 2        | プロジェクト | `./.agents/skills/`   | 他のエージェントクライアントと共有するプロジェクトスキル |
| 3        | ユーザー | `~/.deepcode/skills/` | Deep Codeネイティブのユーザースキル |
| 4        | ユーザー | `~/.agents/skills/`   | 他のエージェントクライアントと共有するユーザースキル |
| 5        | グローバル | `built-in`            | Deep Codeに同梱されているスキル |

構成例:

```text
.deepcode/
└── skills/
    └── code-review/
        ├── SKILL.md
        ├── checklist.md
        └── scripts/
            └── collect-diff.sh
```

## 最小構成のスキル

各スキルは専用のディレクトリに置き、`SKILL.md` を含める必要があります。

```markdown
---
name: code-review
description: Review code changes for correctness, regressions, security risks, and missing tests. Use when the user asks for a review, PR review, diff review, or pre-merge check.
---

# Code Review

Use a code review mindset. Prioritize bugs, behavioral regressions, security issues,
and missing tests over style comments.

## Workflow

1. Inspect the diff and relevant surrounding code.
2. List findings first, ordered by severity.
3. Include file and line references for every finding.
4. If there are no findings, say so and mention residual risks or test gaps.
```

## `SKILL.md` のフロントマター

Deep Code CLIは `SKILL.md` の先頭にあるYAMLフロントマターを読み取ります。

| フィールド | 必須かどうか | Deep Codeの動作 | 推奨事項 |
| ----- | -------- | ------------------ | -------------- |
| `name` | 推奨 | スキルの一意な名前として使われます。未指定の場合、Deep Codeはディレクトリ名を使い、`_` を `-` に変換します。 | 小文字、数字、ハイフンを使い、ディレクトリ名と揃えてください。 |
| `description` | 推奨 | 自動マッチングに使われ、`/skills` やスラッシュメニューに表示されます。 | スキルが何をするか、いつ使うか、よくあるトリガーとなる語句を記述してください。 |
| `metadata.allow-implicit-invocation` | 任意 | `false` に設定すると自動マッチングの対象から外れますが、手動での選択は引き続き可能です。 | 手動専用のスキルに使ってください。 |

例:

```yaml
---
name: db-migration
description: Create and review database migrations for this project. Use when the user asks to add columns, change schema, write migrations, or validate rollback behavior.
metadata:
  allow-implicit-invocation: false
---
```

> Deep Code CLIが現在解釈するのは上記のフィールドのみです。それ以外のフロントマターフィールドは、他クライアントとの互換性やドキュメント目的で役立つ場合がありますが、Deep Codeのツール権限を自動的に制限することはありません。

## 効果的な `description` の書き方

`description` は、スキルを見つけてもらうための最も重要なシグナルです。自動マッチングの際、Deep Codeがモデルに渡すのは各スキルの `name` と `description` だけなので、具体的に書くほど確実にマッチします。

推奨パターン:

```text
<What this skill does>. Use when <task types, file types, domain, user phrases, or trigger terms>.
```

良い例:

```yaml
description: Extract tables from PDF files, fill PDF forms, and merge documents. Use when working with PDFs, forms, invoices, statements, or document extraction.
```

```yaml
description: Generate Lessweb routes, services, and Pydantic request models. Use when editing Lessweb projects, adding @Get/@Post endpoints, configuring IOC modules, or updating OpenAPI output.
```

避けるべき例:

```yaml
description: Helps with documents
description: Useful project skill
description: Tooling instructions
```

チェックリスト:

- トピックだけでなく、具体的な機能を明記する
- 期待される結果だけでなく、いつ使うのかを明記する
- ユーザーが入力しそうな語句を含める
- 関連するファイル形式、フレームワーク名、コマンド名、ドメイン名を含める
- 無関係なタスクでも発動してしまうような、広すぎる表現を避ける

## スキル本文の構成

`SKILL.md` の本文は、一般の読者向けではなくエージェント向けに書いてください。直接的で、実行可能で、検証可能な内容に保ちます。

推奨構成:

```markdown
# Skill Name

Briefly state what this skill is for.

## When to use

- Use when ...
- Do not use when ...

## Workflow

1. Read ...
2. Run ...
3. Edit ...
4. Verify ...

## Rules

- Preserve ...
- Never ...
- Ask the user when ...

## Examples

...
```

執筆の原則:

- 「まずスキーマを読む」「編集後にテストを実行する」のように、命令形のステップで書く
- 必ず守るべき制約は明示的なルールとして書く
- ファイル削除、データ移行、リクエスト送信といった高リスクな操作には境界を定義する
- 「設定ファイルがなければ、まずデフォルトのパスを探す」のように、よくある分岐を文書化する
- 長いリファレンス資料は `SKILL.md` の外に移す

## 補助リソース

スキルには `SKILL.md` と同じ階層にファイルを含めることができます。

```text
my-skill/
├── SKILL.md
├── references/
│   └── api.md
├── examples/
│   └── request.json
├── scripts/
│   └── validate.py
└── templates/
    └── report.md
```

`SKILL.md` が長くなりすぎたり、一覧性が損なわれたりする資料には補助ファイルを使ってください。

- 長いドキュメント、仕様、APIノートは `references/` に置く
- 入出力のサンプルは `examples/` に置く
- 再利用可能なコマンドは `scripts/` に置く
- ドキュメントやコードの雛形は `templates/` に置く
- 各補助ファイルをいつ参照すべきかを `SKILL.md` で説明する

例:

```markdown
## Workflow

1. Read `references/schema.md` before changing generated types.
2. Use `templates/migration.sql` when creating a new migration.
3. Run `python scripts/check_migration.py <file>` before reporting completion.
```

## 呼び出し方法

Deep Code CLIはスキルの自動呼び出しと手動呼び出しの両方をサポートしています。

### 自動呼び出し

ユーザーのメッセージごとに、Deep Codeは利用可能なスキルの `name` と `description` フィールドを確認し、タスクに合致するスキルを選択します。マッチしたスキルは現在のセッションに読み込まれます。

自動呼び出しのルール:

- 一度読み込まれたスキルは、同じセッション内で再度読み込まれない
- `metadata.allow-implicit-invocation: false` が設定されたスキルは自動では読み込まれない
- マッチングでは現在の `AGENTS.md` の指示も考慮される
- マッチするスキルがなければ、何も読み込まれない

### 手動呼び出し

入力ボックスに `/` と入力するとスキルとコマンドのメニューが開くので、そこからスキルを選択します。利用可能なスキルの一覧は `/skills` で確認できます。

よく使うコマンド:

| コマンド | 動作 |
| ------- | -------- |
| `/` | スキルとコマンドのメニューを開く |
| `/skills` | 利用可能なスキルを一覧表示する |
| `/<skill-name>` | メニューから該当するスキルを選択する |

## スキルの有効化と無効化

`settings.json` の `enabledSkills` を使うと、スキルを名前単位で有効化・無効化できます。

```json
{
  "enabledSkills": {
    "code-review": true,
    "db-migration": false
  }
}
```

ルール:

- 記載されていないスキルはデフォルトで有効
- スキルを `false` に設定すると、その解決名を持つスキャン済みスキルがすべて非表示になる
- プロジェクト設定はスキルごとにユーザー設定を上書きする

詳細は [configuration_ja.md](configuration_ja.md) を参照してください。

## スキル vs. `AGENTS.md` vs. MCP

| 仕組み | 適している用途 | 適していない用途 |
| --------- | -------- | ------------ |
| `AGENTS.md` | 長期的なリポジトリルール、コーディングスタイル、テストコマンド、コラボレーション上の取り決め | 再利用可能な複雑なワークフローや、プロジェクト横断のツール指示 |
| エージェントスキル | 再利用可能なワークフロー、ドメイン知識、テンプレート、スクリプト、リファレンスドキュメント | 単一タスク限りの一時的な要件 |
| MCP | 外部システム、ライブデータ、ブラウザ操作、データベース、GitHubなどのツール呼び出し | 純粋なテキストベースのワークフロー指示 |

よくあるパターン:

- リポジトリルールは `AGENTS.md` に置く
- 再利用可能なワークフローはスキルに置く
- 外部への操作はMCPツールに任せる

## 例: プロジェクトリリーススキル

```markdown
---
name: release-check
description: Prepare and verify a project release. Use when the user asks to release, publish, bump version, update changelog, or run pre-release checks.
---

# Release Check

Use this skill to prepare a safe release for this repository.

## Workflow

1. Read `package.json` and the existing changelog.
2. Inspect commits or diffs since the previous release tag.
3. Update version and changelog only when the user explicitly asks.
4. Run the project test and build commands.
5. Report the version, changed files, verification results, and remaining risks.

## Rules

- Do not publish packages unless the user explicitly asks.
- Do not create or push git tags without explicit approval.
- Preserve existing changelog style.
```

## トラブルシューティング

### スキルが `/skills` に表示されない

確認事項:

1. ディレクトリがDeep Codeのスキャン対象の場所のいずれかにあるか
2. ファイル名が `SKILL.md` になっているか
3. `SKILL.md` が `.deepcode/skills/my-skill/SKILL.md` のように専用のスキルディレクトリ内にあるか
4. `enabledSkills` でそのスキルが `false` に設定されていないか
5. 同名のより高優先度のスキルに隠されていないか

### 自動呼び出しが安定しない

確認事項:

1. `description` に明確なユースケースとトリガーとなる語句が含まれているか
2. スキルが広すぎて、モデルが適用範囲を推測できなくなっていないか
3. `metadata.allow-implicit-invocation` が `false` に設定されていないか
4. ユーザーのリクエストが、関連するドメインやファイル形式を十分明確に言及しているか

### スキルが長すぎる

推奨事項:

1. 中核となるワークフローとルールは `SKILL.md` に残す
2. 長いドキュメントは `references/` に移す
3. 繰り返し使うコマンドは `scripts/` に移す
4. 各補助ファイルをエージェントがいつ読むべきかを説明する

## 参考資料

- [Agent Skills Specification](https://agentskills.io/specification)
