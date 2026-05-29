# Deep Code 权限机制

Deep Code 内置了一套细粒度的权限控制机制，在 AI 助手执行工具调用（如执行 Shell 命令、读写文件、访问网络等）前，根据用户配置的策略决定是自动放行、直接拒绝、还是弹出交互式确认。

## 概述

每次 AI 助手调用工具时，系统会自动分析该操作涉及的**权限范围（Permission Scope）**，然后根据 `settings.json` 中的权限配置做出决策。对于需要用户确认的操作，会在终端中弹出交互式选择界面，用户可以选择：

- **Yes** — 仅本次放行
- **Yes, and always allow** — 本次放行，并将该权限范围写入项目配置文件，后续同类操作不再询问
- **No** — 拒绝本次操作

## 权限范围

Deep Code 定义了以下 10 种权限范围，覆盖了工具调用的各类风险场景：

| 权限范围 | 说明 |
| -------- | ---- |
| `read-in-cwd` | 读取当前工作区内的文件 |
| `read-out-cwd` | 读取当前工作区外的文件 |
| `write-in-cwd` | 在当前工作区内创建或覆写文件 |
| `write-out-cwd` | 在当前工作区外创建或覆写文件 |
| `delete-in-cwd` | 删除当前工作区内的文件 |
| `delete-out-cwd` | 删除当前工作区外的文件 |
| `query-git-log` | 查询 Git 历史（如 `git log`、`git show`、`git blame`） |
| `mutate-git-log` | 修改 Git 历史（如 `git commit`、`git rebase`、`git tag`） |
| `network` | 访问网络（如 `curl`、`npm install` 等联网操作） |
| `mcp` | 调用 MCP 外部工具 |

此外还有一个特殊的 `unknown` 范围，当 LLM 无法准确分类命令的副作用时使用，**`unknown` 总是触发询问**。

## 权限配置

在 `~/.deepcode/settings.json`（用户级）或 `.deepcode/settings.json`（项目级）中通过 `permissions` 字段配置：

```json
{
  "permissions": {
    "allow": [],
    "deny": [],
    "ask": [],
    "defaultMode": "allowAll"
  }
}
```

### 配置项说明

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `allow` | `string[]` | 始终自动放行的权限范围列表 |
| `deny` | `string[]` | 始终自动拒绝的权限范围列表 |
| `ask` | `string[]` | 始终弹出询问的权限范围列表 |
| `defaultMode` | `"allowAll"` \| `"askAll"` | 未在 `allow`/`deny`/`ask` 中明确列出的权限范围的默认处理方式。默认为 `"allowAll"` |

### 优先级规则

当一个工具调用涉及多个权限范围时，决策按以下优先级进行：

1. 若任一范围命中 `deny` → **拒绝**
2. 若任一范围命中 `ask` → **询问**
3. 若所有范围均在 `allow` 中 → **自动放行**
4. 否则 → 按 `defaultMode` 处理

### 示例：宽松模式（默认）

```json
{
  "permissions": {
    "defaultMode": "allowAll"
  }
}
```

默认行为：所有操作自动放行，无需确认。

### 示例：严格模式

```json
{
  "permissions": {
    "allow": ["read-in-cwd", "write-in-cwd", "query-git-log"],
    "defaultMode": "askAll"
  }
}
```

此配置的效果：
- 工作区内读写、Git 查询 → 自动放行
- 其他操作都需要用户确认。


## 持久化机制

当用户在权限提示中选择 "Yes, and always allow" 后，对应的权限范围会被写入当前项目的 `.deepcode/settings.json` 文件中：

- 新增范围会追加到 `permissions.allow` 列表
- 如果该范围之前存在于 `deny` 或 `ask` 中，会被自动移除
- 不会重复写入已存在的范围

这样后续同类操作就不再询问。
