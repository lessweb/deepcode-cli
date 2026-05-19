<div align="center">
<br/>
<br/>
<p align="center">
  <a href='https://deepcode.vegamo.cn/'>
    <img src='https://avatars.githubusercontent.com/u/118287711?s=200&v=4' width='100' alt="deepcode-cli"/>
  </a>
</p>
<h1>Deep Code CLI</h1>

English · [中文](./README.md)

<br/>
</div>

[Deep Code](https://github.com/lessweb/deepcode-cli) is a terminal AI coding assistant optimized for the `deepseek-v4` model, with support for deep thinking, reasoning effort control, Agent Skills, and MCP (Model Context Protocol) integration.


## Installation

```bash
npm install -g @vegamo/deepcode-cli
```

Run `deepcode` inside any project directory to get started.

![intro2](resources/intro2.png)

## Configuration

Create `~/.deepcode/settings.json`:

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

The configuration file is shared with the [Deep Code VSCode extension](https://github.com/lessweb/deepcode) — configure once, use everywhere.

For complete configuration details (multi-level priority, environment variables, etc.), see [docs/configuration.md](docs/configuration.md).

## Key Features

### **Skills**
Deep Code CLI supports agent skills that allow you to extend the assistant's capabilities:

- **User-level Skills**: discovered and activated from `~/.agents/skills/`.
- **Project-level Skills**: loaded from `./.agents/skills/` for project-specific workflows, with legacy `./.deepcode/skills/` compatibility.

### **Optimized for DeepSeek**
- Specifically tuned for DeepSeek model performance.
- Reduce costs by using [Context Caching](https://api-docs.deepseek.com/guides/kv_cache).
- Natively supports [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode) and Effort Control.

## Slash Commands & Keyboard Shortcuts

| Slash Command    | Action                                                   |
|------------------|----------------------------------------------------------|
| `/`              | Open the skills / commands menu                          |
| `/new`           | Start a fresh conversation                               |
| `/resume`        | Choose a previous conversation to continue               |
| `/model`         | Switch model, thinking mode, and reasoning effort        |
| `/raw`           | Toggle display mode (Normal / Lite / Raw scrollback)     |
| `/init`          | Initialize an AGENTS.md file (LLM project instructions)  |
| `/skills`        | List available skills                                    |
| `/mcp`           | View MCP server status and available tools               |
| `/exit`          | Quit (also `Ctrl+D` twice)                               |

| Key              | Action                                                   |
|------------------|----------------------------------------------------------|
| `Enter`          | Send the prompt                                          |
| `Shift+Enter`    | Insert a newline (also `Ctrl+J`)                         |
| `Ctrl+V`         | Paste an image from the clipboard                        |
| `Esc`            | Interrupt the current model turn                         |
| `Ctrl+D` twice   | Quit Deep Code                                           |

## Supported Models

- `deepseek-v4-pro` (Recommended)
- `deepseek-v4-flash`
- Any other OpenAI-compatible model

## FAQ

### Does Deep Code have a VSCode extension?

Yes. Deep Code offers a full-featured VSCode extension, available on the [VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=vegamo.deepcode-vscode). The extension shares the `~/.deepcode/settings.json` configuration file with the CLI, so you can switch seamlessly between the terminal and the editor.

### Does Deep Code support understanding images?

Deep Code supports multimodal input — you can paste images from the clipboard with `Ctrl+V`. However, `deepseek-v4` does not support multimodal yet. Some models have multimodal capabilities but impose strict limits on multi-turn dialogue requests. For multimodal input, we recommend using the Volcano Ark `Doubao-Seed-2.0-pro` model, which has the best integration.

### How to automatically send a Slack message after a task completes?

Write a shell notification script that calls a Slack webhook, then set the `notify` field in `~/.deepcode/settings.json` to the full path of the script. For detailed steps, refer to: https://binfer.net/share/jby5xnc-so6g

### How do I enable web search?

Deep Code comes with a built-in, free Web Search tool that works well for most use cases. If you prefer to use a custom script for web search, set the `webSearchTool` field in `~/.deepcode/settings.json` to the full path of your script. For detailed steps, refer to: https://github.com/qorzj/web_search_cli

### Does it support Coding Plan?

Yes. Just set `env.BASE_URL` in `~/.deepcode/settings.json` to an OpenAI-compatible API endpoint. Take Volcano Ark's Coding Plan as an example:

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

### How do I configure MCP?

Deep Code supports MCP (Model Context Protocol) to connect external services such as GitHub, browsers, databases, and more. Configure the `mcpServers` field in `settings.json` to enable it, then use the `/mcp` command to view MCP server status and available tools.

For detailed setup instructions, see: [docs/mcp.md](docs/mcp.md)

## Contributing

Contributions are welcome! Here's how to get started:

```bash
# Clone the repository
git clone https://github.com/lessweb/deepcode-cli.git
cd deepcode-cli

# Install dependencies
npm install

# Local development (typecheck + lint + format check + bundle)
npm run build

# Run tests
npm test

# Link globally (local global install)
npm link
```

- Make sure `npm run check` passes before submitting a PR (typecheck + lint + format check)
- We recommend running `npm run format` before building to avoid errors

## Getting Help

- Report bugs or request features on GitHub Issues (https://github.com/lessweb/deepcode-cli/issues)

## License

- MIT

## Support Us

If you find this tool helpful, please consider supporting us by:

- Giving us a Star on GitHub (https://github.com/lessweb/deepcode-cli)
- Submitting feedback and suggestions
- Sharing with your friends and colleagues
