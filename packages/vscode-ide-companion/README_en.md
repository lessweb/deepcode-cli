# Deep Code

[Deep Code](https://marketplace.visualstudio.com/items?itemName=vegamo.deepcode-vscode) is an AI coding assistant extension for Visual Studio Code, specifically optimized for the latest `deepseek-v4` model.

## Configuration

Create `~/.deepcode/settings.json` with:

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

## Key Features

### **Skills**
Deep Code supports agent skills that allows you to extend the assistant's capabilities:

- **User-level Skills**: discovered and activated from `~/.agents/skills/`.
- **Project-level Skills**: loaded from `./.agents/skills/` for project-specific workflows, with legacy `./.deepcode/skills/` compatibility.

### **Optimized for DeepSeek**
- Specifically tuned for DeepSeek model performance.
- Reduce costs by using [Context Caching](https://api-docs.deepseek.com/guides/kv_cache).
- Natively supports [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode) and Thinking Effort Control.

## Supported Models

- `deepseek-v4-pro` (Recommended)
- `deepseek-v4-flash`
- `deepseek-chat`
- Any other OpenAI-compatible model

## Screenshot

![screenshot](resources/deepcode_screenshot.png)

## Deep Code CLI

```bash
npm install -g @vegamo/deepcode-cli
```

![intro1](https://raw.githubusercontent.com/lessweb/deepcode-cli/main/resources/intro1.png)

> The VSCode plugin and CLI share configuration and data, but they have no dependencies at runtime.

- GitHub： https://github.com/lessweb/deepcode-cli

## FAQ

### How can I move Deep Code from the left sidebar to the right (Secondary Side Bar) in VS Code?

![faq1](resources/faq1.gif)

### Does Deep Code support understanding images?

Deep Code supports multimodal, but `deepseek-v4` does not support multimodal yet. Some models have multimodal capabilities but impose strict limits on multi-turn dialogue requests. For multimodal input, we recommend using the Volcano Ark `Doubao-Seed-2.0-pro` model, which has the best integration.

### How to automatically send a Slack message after a task completes?

Write a shell notification script that calls a Slack webhook, then set the `notify` field in `~/.deepcode/settings.json` to the full path of the script. For detailed steps, refer to: https://binfer.net/share/jby5xnc-so6g

### Does it support Coding Plan?

Yes. Just set `env.BASE_URL` in `~/.deepcode/settings.json` to an OpenAI-compatible API endpoint. Take Volcano Ark's Coding Plan as an example, configure `~/.deepcode/settings.json` as follows:

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

## Getting Help
- Report bugs or request features on GitHub Issues (https://github.com/lessweb/deepcode/issues)
