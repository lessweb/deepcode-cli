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

[English](README-en.md) · 中文

<br/>
</div>

[Deep Code](https://github.com/lessweb/deepcode-cli) 是专为 `deepseek-v4` 模型优化的终端 AI 编码助手，支持深度思考、推理强度控制、Agent Skills 以及 MCP 集成。

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

完整配置说明（多层级优先级、环境变量等）请参阅 [docs/configuration.md](docs/configuration.md)。

## 主要功能

### **Skills**
Deep Code CLI 支持 agent skills，允许您扩展助手的能力：

- **User-level Skills**：从 `~/.agents/skills/` 目录中发现并激活 skills。
- **Project-level Skills**：从 `./.agents/skills/` 目录中加载项目专属 skills，并兼容旧的 `./.deepcode/skills/` 目录。

### **为 DeepSeek 优化**
- 专门为 DeepSeek 模型性能调优。
- 通过使用[上下文缓存](https://api-docs.deepseek.com/guides/kv_cache)来降低成本。
- 原生支持[思考模式](https://api-docs.deepseek.com/guides/thinking_mode)和思考强度控制。

## 斜杠命令与按键功能

| 斜杠命令        | 操作                               |
|-------------|----------------------------------|
| `/`         | 打开 skills / 命令菜单                 |
| `/new`      | 开始新对话                            |
| `/resume`   | 选择历史对话继续                         |
| `/continue` | 继续当前对话，或选择历史对话恢复                 |
| `/model`    | 切换模型、思考模式和推理强度                   |
| `/raw`      | 切换显示模式（Normal / Lite / Raw 滚动回溯） |
| `/init`     | 初始化 AGENTS.md 文件                 |
| `/skills`   | 列出可用 skills                      |
| `/mcp`      | 查看 MCP 服务器状态和可用工具                |
| `/undo`     | 将代码和/或对话恢复到之前的状态                 |
| `/exit`     | 退出（也可用连续 `Ctrl+D`）               |

| 按键            | 操作                 |
|---------------|--------------------|
| `Enter`       | 发送消息               |
| `Shift+Enter` | 插入换行（也可用 `Ctrl+J`） |
| `Ctrl+V`      | 从剪贴板粘贴图片           |
| `Esc`         | 中断当前模型回复           |
| 连续 `Ctrl+D`   | 退出                 |

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

编写一个调用 Slack webhook 的 Shell 通知脚本，然后在 `~/.deepcode/settings.json` 中将 `notify` 字段设为该脚本的完整路径即可。详细步骤请参考 [docs/notify.md](docs/notify.md)。

### 怎样启用联网搜索功能？

Deep Code自带免费的、且大部分情况够用的Web Search工具。如果你希望使用自定义脚本进行联网搜索，可以在 `~/.deepcode/settings.json` 中将 `webSearchTool` 设为脚本的完整路径即可。详细步骤可参考：https://github.com/qorzj/web_search_cli

### 如何配置 MCP？

Deep Code 支持 MCP（Model Context Protocol），可以连接 GitHub、浏览器、数据库等外部服务。在 `settings.json` 中配置 `mcpServers` 字段即可启用，启动后使用 `/mcp` 命令查看已配置的 MCP 服务器状态和可用工具。

详细配置指南：[docs/mcp.md](docs/mcp.md)

### 如何配置 Deep Code 任务完成后发送通知？

当 AI 助手完成一轮任务后，Deep Code 可以自动执行一个通知脚本，将任务结果发送到你指定的渠道（如 Slack、系统通知等）。

详细配置指南：[docs/notify.md](docs/notify.md)

### Deep Code 只支持 YOLO 模式吗？

不是。Deep Code 内置了细粒度的权限控制机制，支持在 AI 助手执行 Shell 命令、读写文件、访问网络等操作前进行确认。你可以通过 `settings.json` 中的 `permissions` 字段按需配置每种权限范围的策略：始终允许、始终询问、或直接拒绝。详见 [docs/permission.md](docs/permission.md)。

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

### 如何自定义主题？

Deep Code CLI 内置一套默认主题（`DEFAULT_THEME`），无需配置即可使用。如需自定义颜色，在 `settings.json` 中设置 `theme.preset` 为 `"custom"` 后提供 `overrides` 或 `tokens`。

**使用默认主题（无需配置）**

直接使用内置主题，不做任何设置。

**方式一：局部覆盖（preset="custom" + overrides）**

只覆盖需要调整的颜色，其余保持默认值：

```json
{
  "theme": {
    "preset": "custom",
    "overrides": {
      "primary": "#ff6600",
      "success": "greenBright"
    }
  }
}
```

**方式二：完全自定义（preset="custom" + tokens）**

提供完整的 tokens 对象，基于默认主题合并：

```json
{
  "theme": {
    "preset": "custom",
    "tokens": {
      "primary": "#229ac3",
      "secondary": "#229ac3e6",
      "success": "green",
      "error": "red",
      "warning": "yellow",
      "info": "magenta",
      "text": "white",
      "textDim": "gray",
      "code": "cyan",
      "border": "gray",
      "gradients": ["#229ac3e6", "#229ac3e6"]
    }
  }
}
```

> 注意：`preset` 必须设为 `"custom"` 时 `overrides` 和 `tokens` 才会生效。`preset` 为 `"default"` 或不配置时始终使用系统默认主题。

默认主题色值（`DEFAULT_THEME`）：

| Token | 默认值 | 用途 |
|-------|--------|------|
| `primary` | `#229ac3` | 主品牌色：用户消息、选中项、状态行 bullet、Markdown 标题 |
| `secondary` | `#229ac3e6` | 辅助品牌色：欢迎屏 Logo 文字与边框、退出面板边框 |
| `success` | `#1a7f37` | 成功：工具执行成功、MCP ready、diff 新增行、低风险权限色 |
| `error` | `#d1242f` | 失败/错误：工具执行失败、Error 行、diff 删除行、高风险权限色 |
| `warning` | `#fa8c16` | 警告/进行中：忙时 spinner、权限提示边框、列表标记色、MCP 启动中 |
| `info` | `#0969da` | 特殊指示：技能加载提示、图片附件状态 |
| `text` | `#3D4149` | 主文字色：权限提示正文、问题文字、ProcessStdout 标题 |
| `textDim` | `#646A71` | 次要文字：状态行参数、搜索占位符、diff 上下文行、Markdown 引用块 |
| `code` | `#787f8a` | 代码块/内联代码 |
| `border` | `#999` | 所有组件的边框色 |
| `gradients` | `["#229ac3", "#8250df"]` | Logo 与退出面板的渐变色数组 |

颜色值支持 hex（`"#ff6600"`）、hex 含透明度（`"#229ac3e6"`）、chalk 命名色（`"cyanBright"`、`"green"`）。

> 注意：`tokens` 优先级高于 `overrides`——如果同时指定两者，仅 `tokens` 生效。主题配置可放在全局 `~/.deepcode/settings.json` 或项目根 `.deepcode/settings.json` 中。

## 贡献

欢迎贡献代码！以下是参与方式：

```bash
# 克隆仓库
git clone https://github.com/lessweb/deepcode-cli.git
cd deepcode-cli

# 安装依赖
npm install

# 本地开发（类型检查 + lint + 格式检查 + 构建）
npm run build

# 运行测试
npm test

# 链接到全局（即本地全局安装）
npm link
```

- 提交 PR 前请确保 `npm run check` 通过（类型检查 + lint + 格式检查）
- 建议在执行构建前，先执行 `npm run format` 自动格式化代码，避免构建报错

## 获取帮助

- 在 GitHub Issues 上报告错误或请求功能 (https://github.com/lessweb/deepcode-cli/issues)

## 协议

- MIT

## 支持我们

如果你觉得这个工具对你有帮助，请考虑通过以下方式支持我们：

- 在 GitHub 上给我们一个 Star (https://github.com/lessweb/deepcode-cli)
- 向我们提交反馈和建议
- 分享给你的朋友和同事

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