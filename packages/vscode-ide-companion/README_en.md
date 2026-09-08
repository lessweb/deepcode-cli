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

- `deepseek-v4-pro`
- `deepseek-v4-flash` (Recommended)
- `deepseek-v4-flash-vision-exp`
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

Yes. The `deepseek-v4-flash-vision-exp` model can read local images directly, or you can paste images from the clipboard with `Ctrl+V`, so the model can see the image content directly.

Non-multimodal models such as `deepseek-v4-pro` and `deepseek-v4-flash` continue to use the `UnderstandImage` image-understanding tool. Deep Code detects model capabilities automatically; you can also override the detection with the `multimodal` setting.

By default, images are sent inline as base64. With `filesApiEnabled`, Deep Code uploads images through the DeepSeek Files API and reuses the `file_id` in subsequent requests. See [docs/configuration_en.md](../../docs/configuration_en.md#deepseek-files-api).

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
- Report bugs or request features on GitHub Issues (https://github.com/lessweb/deepcode-cli/issues)
