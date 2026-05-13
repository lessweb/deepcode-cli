# Deep Code CLI MCP 配置指南

Deep Code CLI 支持 MCP（Model Context Protocol），让 AI 助手能够连接外部工具和服务，如 GitHub、浏览器、数据库等。

## 概述

配置 MCP 后，Deep Code 可以：

- 操作 GitHub 仓库（查看 Issues、创建 PR、搜索代码等）
- 操控浏览器（截图、点击、填表单等）
- 访问文件系统
- 连接数据库和 API
- ...以及任何兼容 MCP 协议的外部服务

MCP 工具在 Deep Code 中的命名格式为 `mcp__<服务名>__<工具名>`，例如 `mcp__github__search_code`。

## 配置 MCP 服务器

编辑 `~/.deepcode/settings.json`，添加 `mcpServers` 字段：

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
    "<服务名称>": {
      "command": "<可执行文件>",
      "args": ["<参数1>", "<参数2>"],
      "env": {
        "<环境变量>": "<值>"
      }
    }
  }
}
```

### 配置项说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `command` | string | 是 | MCP 服务器的可执行文件路径或命令（如 `npx`、`node`、`python`） |
| `args` | string[] | 否 | 传递给命令的参数列表 |
| `env` | object | 否 | 传递给 MCP 服务器进程的环境变量（如 API Key） |

## 常用 MCP 示例

### GitHub MCP

让 Deep Code 直接操作 GitHub 仓库（搜索代码、管理 Issue/PR、读写文件等）：

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

> GitHub Personal Access Token 可在 [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens) 生成。

### 浏览器控制（Playwright）

让 Deep Code 操控浏览器进行截图、页面操作等：

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

### 文件系统

让 Deep Code 在指定目录中读写文件：

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

### 自定义 Python MCP

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

## 完整配置示例

以下是一个配置了 GitHub 和 Playwright 两个 MCP 服务器的完整 `~/.deepcode/settings.json`：

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

## 使用 MCP

配置完成后，启动 `deepcode`，使用 `/mcp` 命令管理 MCP 连接：

- `/mcp` — 查看已配置的 MCP 服务器状态
- `/mcp add` — 添加新的 MCP 服务器
- `/mcp remove` — 移除 MCP 服务器
- `/mcp list` — 列出所有已连接的 MCP 服务器及其工具

在对话中直接使用 MCP 工具名称即可调用，例如：

```
帮我搜索 GitHub 上 deepcode-cli 仓库的 issues
```

AI 会自动调用 `mcp__github__search_issues` 工具完成操作。

## 工具命名规则

MCP 工具名称由三部分组成：`mcp__<服务名>__<工具名>`

| 服务名 | 工具名 | 完整调用名 |
|--------|--------|-----------|
| github | search_code | `mcp__github__search_code` |
| github | create_pull_request | `mcp__github__create_pull_request` |
| playwright | browser_navigate | `mcp__playwright__browser_navigate` |
| playwright | browser_take_screenshot | `mcp__playwright__browser_take_screenshot` |

你可以通过 `/mcp list` 查看每个服务器提供的具体工具列表。

## 故障排查

### 启动失败

如果 MCP 服务器无法启动，检查：

1. `command` 是否已安装（如 `npx` 需要 Node.js）
2. `env` 中的环境变量是否正确（如 `GITHUB_PERSONAL_ACCESS_TOKEN`）
3. 运行 `deepcode` 的终端是否有网络访问权限

### 工具不显示

1. 确认 `settings.json` 中的 `mcpServers` 字段格式正确
2. 启动 deepcode 后使用 `/mcp` 查看服务器状态
3. 如果服务器状态显示错误，根据错误信息排查

### Windows 用户

在 Windows 上，Deep Code CLI 会自动为 `.cmd` 命令添加 shell 支持。如果你的 MCP 命令是批处理脚本，确保文件名以 `.cmd` 结尾。

## 编写你自己的 MCP 服务器

MCP 服务器遵循 [Model Context Protocol](https://modelcontextprotocol.io/) 规范，使用 JSON-RPC 2.0 通信。你可以用任何语言编写 MCP 服务器，只要实现以下协议即可：

1. `initialize` — 握手和协议协商
2. `tools/list` — 返回可用工具列表
3. `tools/call` — 执行工具调用

更多参考：[MCP 官方文档](https://modelcontextprotocol.io/)
