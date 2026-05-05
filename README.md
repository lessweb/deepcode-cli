# Deep Code CLI

> **DeepSeek API 没有联网功能？复制粘贴烦死了？**
> DeepCode CLI 让 DeepSeek 在终端里联网搜索、自动修 Bug、自定义脚本省 Token。
> 开源免费，Claude Code 十分之一的价格。

[![Demo Video](https://img.shields.io/badge/▶️-Demo-FF6B6B?style=for-the-badge)](https://www.bilibili.com/video/BV11ARqB7Eco)
[![npm version](https://badge.fury.io/js/@vegamo%2Fdeepcode-cli.svg)](https://www.npmjs.com/package/@vegamo/deepcode-cli)
[![GitHub stars](https://img.shields.io/github/stars/lessweb/deepcode-cli)](https://github.com/lessweb/deepcode-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![DeepSeek V4](https://img.shields.io/badge/DeepSeek-V4-orange)](https://www.deepseek.com/)

---

## 🎯 为什么需要 DeepCode CLI？

DeepSeek V4 很强，但用它编程让人抓狂：

- ❌ **API 本身不联网**，每次查资料都要手动复制粘贴
- ❌ **Bug 定位靠人肉**，看日志、搜解决方案，重复劳动
- ❌ **Token 烧得心疼**，多轮对话没有缓存，上下文重复计费
- ❌ **Claude Code 太贵**，$20~$200/月，且不开源

DeepCode CLI 是专为 DeepSeek V4 深度优化的**开源终端 AI 编程助手**，一行命令装好，终端里直接用。

---

## ✨ 五大核心卖点

### 🌐 1. 联网搜索 — 补齐 DeepSeek 的最大短板

DeepSeek API 没有联网能力。DeepCode CLI 内置**免费 Web Search 工具**，AI 在终端里直接搜索最新资料，无需复制粘贴。

> 用 `deepcode` 问"最新的 React 19 有哪些特性"，AI 直接联网查，返回答案。

---

### 🐛 2. 自动修 Bug — 终端里的 AI 修理工

粘贴错误日志，AI 自动分析 → 定位根因 → 生成修复代码，你只需要确认执行。

```bash
# 终端里直接丢给它错误信息
deepcode

> paste your error log here...
> 分析中...
> 发现问题：N+1 查询导致数据库连接池耗尽
> 正在生成修复方案...
```

---

### 💰 3. 自定义脚本省 Token — Agent Skills 系统

编写自定义脚本（`~/.agents/skills/`），让 AI 按预设流程执行，**避免重复消耗 Token**。

配合 KV Cache 上下文缓存，多轮对话中缓存命中时 Token 成本降低 **80%+**。

> 比 Claude Code ($200/月) 便宜 90%+，只需 API 成本。

---

### 🔓 4. 开源免费 — 看得见、审得了、部署得起

- ✅ **MIT 开源协议**，代码完全透明可审计
- ✅ 无锁定，自部署到私有服务器
- ✅ 用户级 + 项目级双级 Skills 系统

> 你的代码，永远是你的代码。

---

### ⌨️ 5. 终端原生 — 不用离开命令行

```bash
npm install -g @vegamo/deepcode-cli
cd your-project/
deepcode
```

无需切换窗口，VSCode 写代码，终端里和 AI 对话。

---

## 🚀 快速上手

```bash
# 1. 安装（需要 Node.js 18+）
npm install -g @vegamo/deepcode-cli

# 2. 配置（创建 ~/.deepcode/settings.json）
deepcode --setup

# 3. 在项目目录里直接启动
cd your-project/
deepcode
```

> 💡 配置文件与 VSCode 扩展 [DeepCode VSCode](https://marketplace.visualstudio.com/items?itemName=vegamo.deepcode-vscode) **共享**，终端和编辑器二选一，或同时用。

---

## 🔧 配置示例

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

**reasoningEffort** — 控制 AI "思考深度"：简单任务设 `low`，复杂任务设 `max`，不浪费 Token。

---

## 🛠️ 完整功能列表

| 功能 | 说明 |
|------|------|
| 🌐 **联网搜索** | 内置免费 Web Search 工具，支持自定义脚本 |
| 🐛 **Bug 自动修复** | 粘贴错误日志，AI 自动定位 + 生成修复 |
| 💰 **KV Cache** | 上下文缓存，多轮对话 Token 成本降低 80%+ |
| 🧠 **Thinking Mode** | 可配置推理深度（`reasoningEffort`） |
| 📜 **Agent Skills** | 用户级（`~/.agents/skills/`）+ 项目级（`./.deepcode/skills/`）|
| 🖼️ **图片理解** | `Ctrl+V` 直接粘贴剪贴板图片（推荐 Volcano Ark `Doubao-Seed-2.0-pro`）|
| 🔔 **任务通知** | 支持 Slack/钉钉 Webhook 脚本，任务完成后自动推送 |
| 🤖 **OpenAI 兼容** | 同时支持火山方舟 Coding Plan、Ollama、自托管模型 |

---

## ⌨️ 快捷键

| 按键 | 操作 |
|------|------|
| `Enter` | 发送消息 |
| `Shift+Enter` / `Ctrl+J` | 插入换行 |
| `Ctrl+V` | 粘贴剪贴板图片 |
| `Esc` | 中断当前回复 |
| `/` | 打开 Skills / 命令菜单 |
| `/new` | 新建对话 |
| `/resume` | 继续历史对话 |
| `/skills` | 列出可用 Skills |
| `/exit` | 退出 |

---

## 🤖 支持的模型

| 模型 | 推荐场景 |
|------|---------|
| `deepseek-v4-pro` | ✅ **推荐** — 能力与成本最佳平衡 |
| `deepseek-v4-flash` | 简单任务，速度快，成本低 |
| 火山方舟 `ark-code-latest` | 需要图片理解时推荐 |
| 任意 OpenAI 兼容模型 | Claude、GPT、Ollama 本地模型 |

---

## 🆚 竞品对比

| 维度 | DeepCode CLI | Claude Code | Aider |
|------|:-----------:|:-----------:|:-----:|
| 开源协议 | ✅ MIT | ❌ 闭源 | ✅ Apache-2.0 |
| 价格 | **免费**（仅 API 成本）| $20~$200/月 | 免费 |
| DeepSeek V4 优化 | ✅ 原生 | ❌ | ⚠️ 通用 |
| KV Cache 成本优化 | ✅ 最高 90% 节省 | ❌ | ⚠️ 部分 |
| 推理深度控制 | ✅ `reasoningEffort` | N/A | N/A |
| Agent Skills | ✅ 双级支持 | ⚠️ 有限 | ❌ |
| 联网搜索内置 | ✅ 免费 | ❌ | ⚠️ 需配置 |
| VSCode 扩展 | ✅ | ✅ | ❌ |

---

## 📖 常见问题

**Q: DeepCode 有 VSCode 扩展吗？**
A: 有！在 [VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=vegamo.deepcode-vscode) 搜索 `DeepCode`。配置文件 `~/.deepcode/settings.json` **两边共用**，终端和编辑器无缝切换。

**Q: 如何开启联网搜索？**
A: DeepCode 内置免费 Web Search 工具，开箱即用。如需自定义，配置 `webSearchTool` 指向你的脚本路径。
→ [自定义搜索配置指南](https://github.com/qorzj/web_search_cli)

**Q: 支持图片理解吗？**
A: 支持 `Ctrl+V` 粘贴剪贴板图片。目前 `deepseek-v4` 不支持多模态输入，推荐使用火山方舟 `Doubao-Seed-2.0-pro` 模型。

**Q: 如何在任务完成后收到通知？**
A: 写一个调用 Webhook 的 Shell 脚本，配置 `notify` 字段指向脚本路径即可。
→ [通知配置指南](https://binfer.net/share/jby5xnc-so6g)

---

## 🛠️ 开发与贡献

```bash
git clone https://github.com/lessweb/deepcode-cli.git
cd deepcode-cli
npm install
npm run build
npm link   # 本地测试
```

欢迎提 PR！请先阅读 [贡献指南](CONTRIBUTING.md)。

---

## 🔗 相关链接

- 🌐 GitHub: [github.com/lessweb/deepcode-cli](https://github.com/lessweb/deepcode-cli)
- 💾 VSCode 扩展: [DeepCode on Marketplace](https://marketplace.visualstudio.com/items?itemName=vegamo.deepcode-vscode)
- 🐛 问题反馈: [GitHub Issues](https://github.com/lessweb/deepcode-cli/issues)
- 💬 讨论区: [GitHub Discussions](https://github.com/lessweb/deepcode-cli/discussions)
- 📚 DeepSeek API 文档: [api-docs.deepseek.com](https://api-docs.deepseek.com/)
- 🌟 官网: [vegamo.cn/deepcode](https://deepcode.vegamo.cn)

---

## ⭐ 支持我们

如果 DeepCode CLI 帮你省了时间、省了钱，请：

- ⭐ **Star** → [github.com/lessweb/deepcode-cli](https://github.com/lessweb/deepcode-cli)
- 🐛 提 [Issues](https://github.com/lessweb/deepcode-cli/issues)
- 📣 分享给同事和朋友！

---

*DeepCode CLI 是 [lessweb](https://github.com/lessweb) 的开源项目，与 DeepSeek 无官方关联。*
