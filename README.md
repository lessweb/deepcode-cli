# Deep Code CLI

[Deep Code](https://github.com/lessweb/deepcode-cli) 是专为 `deepseek-v4` 模型优化的终端 AI 编码助手，支持深度思考、推理强度控制以及 Agent Skills。

## 🚀 新增功能（本 Fork）

### `/mcp` Skill 与 MCP 实现

本 Fork 新增了 `/mcp` 命令和 MCP（Model Context Protocol）集成，让 Deep Code CLI 能够连接外部工具和服务：

- **`/mcp` Skill**：一键管理 MCP 服务器连接，支持添加、移除、列出已配置的 MCP 服务。
- **MCP 协议实现**：支持与 GitHub、文件系统、数据库等多种外部服务的标准化集成，大幅扩展 AI 助手的操作能力。

通过 MCP，你现在可以让 Deep Code 直接操作 GitHub 仓库、读取文件、查询数据库等，而无需离开终端。

📖 **详细配置指南：** [docs/mcp.md](docs/mcp.md)

## 安装

```bash
npm install -g @vegamo/deepcode-cli
```

在任意项目目录下运行 `deepcode` 即可启动。

![intro2](resources/intro2.png)

## 配置

创建 `~/.deepcode/settings.json` 文件，内容如下：

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

配置文件与 [Deep Code VSCode 插件](https://github.com/lessweb/deepcode) 共享，无需重复配置。

## 主要功能

### **Skills**
Deep Code CLI 支持 agent skills，允许您扩展助手的能力：

- **User-level Skills**：从 `~/.agents/skills/` 目录中发现并激活 skills。
- **Project-level Skills**：从 `./.agents/skills/` 目录中加载项目专属 skills，并兼容旧的 `./.deepcode/skills/` 目录。

### **为 DeepSeek 优化**
- 专门为 DeepSeek 模型性能调优。
- 通过使用[上下文缓存](https://api-docs.deepseek.com/guides/kv_cache)来降低成本。
- 原生支持[思考模式](https://api-docs.deepseek.com/guides/thinking_mode)和思考强度控制。

## 快捷键

| 键              | 操作                              |
|-----------------|-----------------------------------|
| `Enter`         | 发送消息                          |
| `Shift+Enter`   | 插入换行（也可用 `Ctrl+J`）       |
| `Ctrl+V`        | 从剪贴板粘贴图片                  |
| `Esc`           | 中断当前模型回复                  |
| `/`             | 打开 skills / 命令菜单            |
| `/new`          | 开始新对话                        |
| `/resume`       | 选择历史对话继续                  |
| `/skills`       | 列出可用 skills                   |
| `/exit`         | 退出                              |
| 连续 `Ctrl+D`   | 退出                              |

## 支持的模型

- `deepseek-v4-pro`（推荐使用）
- `deepseek-v4-flash`
- 任何其他 OpenAI 兼容模型


## 常见问题

### Deep Code 是否有 VSCode 插件？

有的。Deep Code 提供功能完整的 VSCode 插件，可在 [VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=vegamo.deepcode-vscode) 安装。插件与 CLI 共享 `~/.deepcode/settings.json` 配置文件，可以在终端和编辑器之间无缝切换。

### Deep Code 是否支持理解图片？

Deep Code 支持多模态，可使用ctrl+v从剪贴板粘贴图片。但目前 deepseek-v4 不支持多模态。有些模型虽然有多模态能力，但对多轮对话请求的限制太严。目前多模态输入推荐使用火山方舟的 Doubao-Seed-2.0-pro 模型，适配效果最好。

### 怎样在任务完成后自动给 Slack 发消息？

编写一个调用 Slack webhook 的 Shell 通知脚本，然后在 `~/.deepcode/settings.json` 中将 `notify` 字段设为该脚本的完整路径即可。详细步骤可参考：https://binfer.net/share/jby5xnc-so6g

### 怎样启用联网搜索功能？

Deep Code自带免费的、且大部分情况够用的Web Search工具。如果你希望使用自定义脚本进行联网搜索，可以在 `~/.deepcode/settings.json` 中将 `webSearchTool` 设为脚本的完整路径即可。详细步骤可参考：https://github.com/qorzj/web_search_cli

### 是否支持 Coding Plan？

支持。只要把 `~/.deepcode/settings.json` 的 `env.BASE_URL` 配置为 OpenAI 兼容的接口地址就行。以火山方舟的 Coding Plan 为例：

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

### 如何配置 MCP？

Deep Code CLI 支持 MCP（Model Context Protocol），可以连接 GitHub、浏览器、文件系统等外部服务。配置方法请查看：[docs/mcp.md](docs/mcp.md)

## 获取帮助

- 在 GitHub Issues 上报告错误或请求功能 (https://github.com/lessweb/deepcode-cli/issues)

## 协议

- MIT

## 支持我们

如果你觉得这个工具对你有帮助，请考虑通过以下方式支持我们：

- 在 GitHub 上给我们一个 Star (https://github.com/lessweb/deepcode-cli)
- 向我们提交反馈和建议
- 分享给你的朋友和同事
