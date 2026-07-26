---
name: deepcode-agent-sdk
description: >
  DeepCode Agent SDK — 移植自 Claude Code v2.1.216 agentSdk.ts。
  让 DeepCode 作为 Agent 被外部程序调用 (HTTP API / MCP stdio / Python 嵌入)。
  支持工具注册、任务执行、文件操作、命令执行、AI 查询等。
version: 1.0.0
author: DeepCode + Ghidra RE (Claude Code v2.1.216)
date: 2026-07-26
tags: [agent, sdk, mcp, api, integration]
---

# DeepCode Agent SDK

移植自 **Claude Code v2.1.216** 的 `agentSdk.ts` 入口点。

## 功能

| 模式 | 说明 | 端口/协议 |
|:---|:-----|:----------|
| **HTTP API** | RESTful API Server | 8088 (HTTP) |
| **MCP stdio** | 作为 MCP Server 运行 | stdin/stdout |
| **Python 嵌入** | `from agent_sdk_server import DeepCodeAgent` | — |

## 内置工具

| 工具名 | 说明 |
|:------|:-----|
| `read_file` | 读取文件内容 |
| `write_file` | 写入文件 |
| `execute_command` | 执行 Shell 命令 |
| `search_files` | 搜索文件 (通配符) |
| `list_directory` | 列出目录内容 |
| `agent_query` | 向 AI 模型发送查询 |
| `agent_status` | 获取 Agent 状态 |

## 用法

### 启动 HTTP Server

```bash
python agent_sdk_server.py --http --port 8088
```

外部调用示例:

```bash
# 列出工具
curl http://127.0.0.1:8088/tools

# 执行工具
curl -X POST http://127.0.0.1:8088/execute \
  -H "Content-Type: application/json" \
  -d '{"tool": "list_directory", "params": {"path": "."}}'

# 批量执行
curl -X POST http://127.0.0.1:8088/batch \
  -H "Content-Type: application/json" \
  -d '{"tasks": [{"tool": "agent_status", "params": {}}]}'
```

### 作为 MCP Server (注册到 settings.json)

```json
"deepcode-agent-sdk": {
  "command": "python",
  "args": [
    "F:/DEEPCODE/.deepcode/skills/deepcode-agent-sdk/agent_sdk_server.py",
    "--mcp"
  ],
  "env": {
    "DEEPSEEK_API_KEY": "${DEEPSEEK_API_KEY}"
  }
}
```

### Python 嵌入

```python
from agent_sdk_server import DeepCodeAgent

agent = DeepCodeAgent(workspace="/path/to/project")
# 注册自定义工具
agent.register_tool("my_tool", my_handler, "My tool description")
# 执行工具
result = await agent.execute("read_file", {"path": "test.txt"})
```

## 配置

通过环境变量控制:

| 变量 | 默认值 | 说明 |
|:----|:------|:----|
| `DEEPSEEK_API_KEY` | — | DeepSeek API 密钥 (agent_query 需要) |
| `DEEPCODE_AGENT_PORT` | 8088 | HTTP 服务端口 |
| `DEEPCODE_AGENT_HOST` | 127.0.0.1 | HTTP 绑定地址 |

## 安全性

- 所有文件操作限制在 `allowed_dirs` 范围内 (默认 = workspace)
- 跨目录路径访问会被拒绝
- HTTP 模式默认仅绑定 localhost
- 命令执行受 timeout 保护 (默认 30s)

## 注意事项

- HTTP 模式需要 `fastapi` + `uvicorn`: `pip install fastapi uvicorn`
- 默认无认证，生产环境请加 reverse proxy 认证
- agent_query 工具需要设置 `DEEPSEEK_API_KEY` 环境变量
