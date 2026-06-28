# Quickstart

Deep Code is an open-source terminal AI coding assistant for the DeepSeek-V4 model, supporting deep thinking, reasoning effort control, and extend its capabilities with Skills and MCP.

## Prerequisites

Before you start, make sure you have:

- Node.js `22` or later
- A DeepSeek API key

## Install

Install Deep Code globally with npm:

```bash
npm install -g @vegamo/deepcode-cli
```

Check the installed version:

```bash
deepcode --version
```

## Configure DeepSeek-V4

Deep Code recommends `deepseek-v4-pro` and also supports `deepseek-v4-flash`. Create `~/.deepcode/settings.json` and add your DeepSeek model configuration:

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

Replace `API_KEY` with your DeepSeek API key.

Common fields:

| Field | Description |
| ----- | ----------- |
| `env.MODEL` | DeepSeek model name, recommended `deepseek-v4-pro` |
| `env.BASE_URL` | DeepSeek API endpoint, default `https://api.deepseek.com` |
| `env.API_KEY` | DeepSeek API key |
| `thinkingEnabled` | Whether to enable thinking mode |
| `reasoningEffort` | Reasoning effort, commonly `"high"` or `"max"` |

You can also create `.deepcode/settings.json` inside a project to customize the model, permissions, or MCP settings for that project only.

For DeepSeek's official setup notes, see the [Deep Code integration guide](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/deepcode).

For all configuration options, see [configuration_en.md](configuration_en.md).

## Start

Open your project directory:

```bash
cd path/to/your/project
deepcode
```

Deep Code starts an interactive terminal UI in the current directory. Type a task and press `Enter`.

To start with an initial prompt:

```bash
deepcode -p "Summarize this project"
```

### Non-Interactive Mode (Headless)

For scripts, CI/CD pipelines, or Docker containers where you need automatic execution, use the `--headless` flag. In this mode, deepcode skips the interactive TUI, runs the prompt, prints the result to stdout, and exits:

```bash
deepcode --headless -p "Summarize this project"

# Pipe with other tools
deepcode --headless -p "List all API endpoints" | grep "auth"
```

`--headless` requires `-p`, and all permission operations are auto-approved in this mode.

## Try These First

Start with a read-only task:

```text
Summarize this repository and explain how to run it.
```

```text
Find the main entry points and explain the request flow.
```

Then try a coding task:

```text
Add a unit test for the login validation logic.
```

```text
Run the test suite and fix the failing tests.
```

You can also ask for a plan first:

```text
Before editing files, propose a plan for adding pagination to the user list.
```

## Basic Controls

| Action | Key |
| ------ | --- |
| Send message | `Enter` |
| Insert a newline | `Shift+Enter` or `Ctrl+J` |
| Interrupt the current response | `Esc` |
| Paste an image | `Ctrl+V` |
| Quit | Press `Ctrl+D` twice, or use `/exit` |

## Slash Commands

Type `/` in the input box to open the command menu.

| Command | Action |
| ------- | ------ |
| `/new` | Start a new conversation |
| `/resume` | Choose a previous conversation to continue |
| `/continue` | Continue the current conversation or resume the latest one |
| `/model` | Switch model, thinking mode, and reasoning effort |
| `/init` | Create an `AGENTS.md` instruction file for the current project |
| `/skills` | Show available Agent Skills |
| `/mcp` | Show MCP server status and available tools |
| `/undo` | Restore code and/or conversation to an earlier point |
| `/raw` | Change the display mode |
| `/exit` | Quit Deep Code |

## Add Project Instructions

Run this inside a project:

```text
/init
```

Deep Code helps create `AGENTS.md`. Use it to record project conventions, such as:

- How to install dependencies and run tests
- Code style and contribution expectations
- Important directory notes
- Checks to run before or after editing code

Deep Code automatically uses these instructions when working in the project.

## Use Skills

Agent Skills are reusable workflows, such as code review, release checks, documentation generation, or framework-specific development steps.

List available skills:

```text
/skills
```

You can also type `/` and choose a skill from the menu.

For more details, see [agent-skills_en.md](agent-skills_en.md).

## Connect External Tools

Use MCP to connect Deep Code to GitHub, browsers, databases, or other services.

After configuring MCP, run:

```text
/mcp
```

This shows connected MCP servers and available tools.

For setup instructions, see [mcp_en.md](mcp_en.md).

## Permissions and Safety

Deep Code may read files, edit code, or run commands. You can configure which actions are allowed automatically, which require confirmation, and which are denied.

Deep Code supports YOLO mode by default, so it can smoothly read and write files, run commands, and continue common coding tasks. If you prefer a more cautious setup, use strict permissions so Deep Code asks before higher-risk actions.

For details, see [permission_en.md](permission_en.md).

## Task Completion Notifications

Deep Code can run a notification script when a task finishes, such as sending a Slack message, Feishu message, system notification, or terminal alert.

For examples, see [notify_en.md](notify_en.md).

## Next Steps

- Read the full configuration guide: [configuration_en.md](configuration_en.md)
- Configure permissions: [permission_en.md](permission_en.md)
- Write Agent Skills: [agent-skills_en.md](agent-skills_en.md)
- Configure MCP tools: [mcp_en.md](mcp_en.md)
- Configure task completion notifications: [notify_en.md](notify_en.md)
