# Deep Code 权限机制

Deep Code 内置了一套细粒度的权限控制机制，在 AI 助手执行工具调用（如执行 Shell 命令、读写文件、访问网络等）前，根据用户配置的策略决定是自动放行、直接拒绝、还是弹出交互式确认。

## 概述

每次 AI 助手调用工具时，系统会自动分析该操作涉及的**权限范围（Permission Scope）**，然后根据 `settings.json` 中的权限配置做出决策。对于需要用户确认的操作，会在终端中弹出交互式选择界面，用户可以选择：

- **Yes** — 仅本次放行
- **Yes, during this session** — 当前会话本次运行期间，同一类操作不再询问，也不写入权限配置
- **Yes, and always allow** — 本次放行，并将该权限范围写入项目配置文件，后续同类操作不再询问；Plan Mode 下不提供此选项
- **No** — 拒绝本次操作

`unknown` 范围只提供 **Yes** 和 **No**。已配置为拒绝的操作仍会保持拒绝。

## 权限范围

Deep Code 定义了以下 12 种权限范围，覆盖了工具调用的各类风险场景：

| 权限范围 | 说明 |
| -------- | ---- |
| `read-in-cwd` | 读取当前工作区内的文件 |
| `read-in-tmp` | 读取 `/tmp` 或 `/private/tmp` 内的文件 |
| `read-out-cwd` | 读取当前工作区外的文件 |
| `write-in-cwd` | 在当前工作区内创建或覆写文件 |
| `write-in-tmp` | 在 `/tmp` 或 `/private/tmp` 内创建或覆写文件 |
| `write-out-cwd` | 在当前工作区外创建或覆写文件 |
| `delete-in-cwd` | 删除当前工作区内的文件 |
| `delete-out-cwd` | 删除当前工作区外的文件 |
| `query-git-log` | 查询 Git 历史（如 `git log`、`git show`、`git blame`） |
| `mutate-git-log` | 修改 Git 历史（如 `git commit`、`git rebase`、`git tag`） |
| `network` | 访问网络（如 `curl`、`npm install` 等联网操作） |
| `mcp` | 调用 MCP 外部工具 |

此外还有一个特殊的 `unknown` 范围，当 LLM 无法准确分类命令的副作用时使用，**`unknown` 总是触发询问**。

## 权限配置

在 `~/.deepcode/settings.json`（用户级）或 `.deepcode/settings.json`（项目级）中通过 `permissions` 字段配置。

也可以在交互界面输入 `/permissions` 打开权限编辑器。如果当前项目已有项目级配置，就修改项目级配置；否则修改用户级配置。编辑器支持：

- 将默认模式设为 `allowAll` 或 `askAll`，选择后返回主菜单。
- 将各权限范围设为自动允许、拒绝、询问，或跟随默认配置。
- 预览当前项目的实际生效配置。所有修改统一通过主菜单的 **Save** 保存；在子菜单按 `Esc` 返回上一页并保留修改，在主菜单按 `Esc` 关闭编辑器并放弃尚未保存的修改。

手动配置时，使用 `permissions` 字段：

```json
{
  "permissions": {
    "allow": [],
    "deny": [],
    "ask": [],
    "defaultMode": "allowAll",
    "addWorkingDirs": ["/opt/my-project"]
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
| `addWorkingDirs` | `string[]` | 额外按当前工作区处理的目录列表 |

`addWorkingDirs` 的用户级和项目级配置会去重合并。绝对路径直接使用，相对路径相对当前项目根目录解析；目录无需预先存在。当路径同时属于工作区和系统临时目录时，工作区范围优先。

默认的 `allowAll` 模式会自动放行 `read-in-tmp` 和 `write-in-tmp`。显式配置的 `allow`、`ask`、`deny` 及 `askAll` 仍按下述优先级生效。

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


## 授权有效期

选择 **Yes, and always allow** 会把对应权限范围保存到当前项目的 `.deepcode/settings.json`，之后的新会话和重新启动都会沿用该选择，不再询问同类操作。

选择 **Yes, during this session** 只对当前会话的本次运行有效，不写入权限配置。暂时切换到其他会话再切回来时仍然有效；新会话、fork 会话和重新启动后恢复的会话都需要重新授权。
