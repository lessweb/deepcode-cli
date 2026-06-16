# Deep Code CLI MCP Configuration Guide

Deep Code CLI supports MCP (Model Context Protocol), enabling AI assistants to connect with external tools and services such as GitHub, browsers, databases, and more.

## Overview

Once MCP is configured, Deep Code can:

- Operate on GitHub repositories (view issues, create PRs, search code, etc.)
- Control browsers (screenshots, clicks, form filling, etc.)
- Access the file system
- Connect to databases and APIs
- ...and any external service compatible with the MCP protocol

MCP tools are named in Deep Code using the format `mcp__<service_name>__<tool_name>`, for example `mcp__github__search_code`.

## Configuring MCP Servers

Edit `~/.deepcode/settings.json` and add the `mcpServers` field:

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
    "<service_name>": {
      "command": "<executable>",
      "args": ["<arg1>", "<arg2>"],
      "env": {
        "<env_var>": "<value>"
      }
    }
  }
}
```

### Configuration Fields

| Field     | Type     | Required | Description                                                                                                                                                      |
| --------- | -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `command` | string   | Yes      | Path or command of the MCP server executable (e.g., `npx`, `node`, `python`). When the command is `npx`, Deep Code automatically prepends `-y` to the arguments. |
| `args`    | string[] | No       | List of arguments to pass to the command                                                                                                                         |
| `env`     | object   | No       | Environment variables (e.g., API keys) to pass to the MCP server process                                                                                         |

## Common MCP Examples

### GitHub MCP

Allows Deep Code to directly operate on GitHub repositories (search code, manage issues/PRs, read/write files, etc.):

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

> Generate a GitHub Personal Access Token at [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens).

### Browser Control (Playwright)

Lets Deep Code control a browser for screenshots, page interactions, etc.:

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

### File System

Enables Deep Code to read and write files within a specified directory:

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

### Custom Python MCP

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

## Full Configuration Example

Below is a complete `~/.deepcode/settings.json` with both GitHub and Playwright MCP servers configured:

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

## Using MCP

After configuration, start `deepcode` and type `/mcp` in the chat to view the status of all configured MCP servers and the list of tools each server provides.

Simply use the MCP tool name in your conversation to invoke it, for example:

```
Help me search for issues in the deepcode-cli repository on GitHub
```

The AI will automatically invoke the `mcp__github__search_issues` tool to complete the action.

## Tool Naming Convention

An MCP tool name consists of three parts: `mcp__<service_name>__<tool_name>`

| Service    | Tool Name               | Full Invocation Name                       |
| ---------- | ----------------------- | ------------------------------------------ |
| github     | search_code             | `mcp__github__search_code`                 |
| github     | create_pull_request     | `mcp__github__create_pull_request`         |
| playwright | browser_navigate        | `mcp__playwright__browser_navigate`        |
| playwright | browser_take_screenshot | `mcp__playwright__browser_take_screenshot` |

You can view the list of tools provided by each server using `/mcp`.

## Troubleshooting

### Startup Failure

If an MCP server fails to start, check:

1. Whether `command` is installed (e.g., `npx` requires Node.js)
2. Whether environment variables in `env` are correct (e.g., `GITHUB_PERSONAL_ACCESS_TOKEN`)
3. Whether the terminal running `deepcode` has network access

### Tools Not Showing Up

1. Verify that the `mcpServers` field in `settings.json` is correctly formatted
2. After starting deepcode, use `/mcp` to check server status
3. If the server status shows an error, debug based on the error message

### Windows Users

On Windows, Deep Code CLI automatically adds shell support for `.cmd` commands. If your MCP command is a batch script, ensure the filename ends with `.cmd`.

## Writing Your Own MCP Server

MCP servers follow the [Model Context Protocol](https://modelcontextprotocol.io/) specification and communicate using JSON‑RPC 2.0. You can write an MCP server in any language as long as it implements the following methods:

1. `initialize` — Handshake and protocol negotiation
2. `tools/list` — Return the list of available tools
3. `tools/call` — Execute a tool call

For more information, see the [official MCP documentation](https://modelcontextprotocol.io/).
