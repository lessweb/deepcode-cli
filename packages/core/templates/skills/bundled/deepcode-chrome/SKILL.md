---
name: deepcode-chrome
description: >
  DeepCode Chrome Bridge — 移植自 Claude Code claudeInChrome/setup.ts。
  让 DeepCode 控制 Chrome 浏览器 (导航/读取/Tab 管理)。
  对标 claude-in-chrome 扩展的 5 个 MCP 工具。
version: 1.0.0
author: DeepCode + Ghidra RE (Claude Code v2.1.216)
date: 2026-07-26
tags: [chrome, browser, automation, mcp]
---

# DeepCode Chrome Bridge

移植自 **Claude Code v2.1.216** 的 `claudeInChrome/setup.ts`。
通过逆向 .bun 段中的 V8 字节码提取了完整 API。

## 对标项

| Claude Code claudeInChrome | DeepCode Chrome |
|:--------------------------|:----------------|
| `openInChrome(url)` | `chrome_navigate` |
| `read_page` | `chrome_snap` |
| `tabs_context_mcp` | `chrome_tabs` |
| `tabs_create_mcp` | `chrome_new_tab` |
| `trackClaudeInChromeTabId` | TabManager.track() |
| `isClaudeInChromeMCPServer` | `chrome_status` |
| `getClaudeInChromeMCPToolOverrides` | `get_mcp_tool_overrides()` |

## MCP 工具

| 工具 | 说明 | 对标 |
|:----|:-----|:-----|
| `chrome_navigate` | 在 Chrome 中打开 URL | `navigate` / `openInChrome` |
| `chrome_snap` | 读取页面内容 + 截屏 | `read_page` |
| `chrome_tabs` | 列出所有 Tab 上下文 | `tabs_context_mcp` |
| `chrome_new_tab` | 创建新 Tab | `tabs_create_mcp` |
| `chrome_status` | Chrome 桥接器状态 | `isClaudeInChromeMCPServer` |

## 用法

### MCP Server

```json
"deepcode-chrome": {
  "command": "python",
  "args": [
    "F:/DEEPCODE/.deepcode/skills/deepcode-chrome/chrome_bridge.py",
    "--mcp"
  ]
}
```

### CLI

```bash
# 打开 URL
python chrome_bridge.py navigate https://example.com

# HTTP Server (RESTful API)
python chrome_bridge.py --http --port 8090

# MCP stdio
python chrome_bridge.py --mcp
```

### HTTP API

```bash
curl http://127.0.0.1:8090/status
curl -X POST http://127.0.0.1:8090/navigate \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'
curl http://127.0.0.1:8090/snap
curl http://127.0.0.1:8090/tabs
```

## 先决条件

```bash
pip install playwright
playwright install chromium
```

## 注意事项

- 默认连接系统已安装的 Chrome (自动查找路径)
- `--headless` 参数启用无头模式
- 截屏保存到临时目录
- 依赖 Playwright (不能独立运行)
