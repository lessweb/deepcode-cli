---
name: deepcode-self-refer
description: Answers questions about Deep Code CLI itself — including features, configuration options, slash commands, Skills, MCP integration, permissions, notifications, session persistence, and troubleshooting. Use this when users ask how to configure or use Deep Code, how to set up an MCP server, configure notifications (such as Slack/Feishu), manage permissions, view available skills, understand slash commands, configure thinking mode, etc.
---

# Deep Code Self-Refer

This Skill helps you answer user questions about Deep Code CLI itself by consulting the reference documentation bundled with this Skill. All docs live in the `references/` subdirectory — always refer to them for authoritative answers.

## When to use this Skill

Use this Skill when the user asks any question about Deep Code itself, such as:

- "列出可用的 skills"
- "如何配置 MCP？"
- "给当前项目配置 playwright mcp"
- "怎么启用搜索功能？"
- "支持哪些模型？"
- "如何配置思考模式？"
- "怎么设置权限？"
- "任务完成后怎么发通知？"
- "支持哪些斜杠命令？"
- "会话历史保存在哪里？"
- "/undo 是怎么工作的？"
- "Deep Code 和 VSCode 插件怎么配合？"
- Any other question about Deep Code CLI's features, configuration, or usage.

## Instructions

### Step 1: Identify the topic

Map the user's question to the appropriate document(s):

| Topic | Document | Key contents |
|-------|----------|-------------|
| **Overview, features, quick start** | `references/README.md` | Installation, slash commands, keyboard shortcuts, supported models, FAQ |
| **Configuration & settings** | `references/configuration.md` | `settings.json` fields, config hierarchy, env vars, thinking mode, reasoning effort, webSearchTool, enabledSkills |
| **MCP setup & usage** | `references/mcp.md` | MCP server config format, GitHub/Playwright/Filesystem examples, tool naming (`mcp__<name>__<tool>`), troubleshooting |
| **Permissions** | `references/permission.md` | Permission scopes (10 types), allow/deny/ask/defaultMode config, priority rules, persistence |
| **Notifications** | `references/notify.md` | Notify script path, injected env vars, Slack/Feishu/iTerm2/macOS/Linux/Windows examples |
| **Session persistence** | `references/session-persistence.md` | Storage paths, JSONL format, session index, compaction, `/undo` mechanics, code snapshots |

### Step 2: Read the relevant document(s)

Use the `Read` tool to read the appropriate document(s) from the list above. All paths are relative to this Skill's loaded root directory, where the `references/` subdirectory lives.

- If the question spans multiple topics, read multiple documents.
- If a document doesn't exist in the user's preferred language (e.g., Chinese), try the other language variant (e.g., `references/configuration_en.md`).
- When answering from references/README.md, focus on the relevant sections.

### Step 3: Answer with precision

- **Quote the doc directly** for config examples, JSON snippets, or command syntax.
- **Don't guess** — if the answer isn't in the docs, say so and suggest checking GitHub Issues.
- **Provide copy-paste-ready configurations** when the user asks to set something up (e.g., MCP servers, notify scripts, permissions).
- **Mention related docs** when appropriate (e.g., MCP setup references `references/mcp.md`, the permissions section references `references/permission.md`).

### Step 4: Handle common request patterns

**"列出/查看可用的 skills":**
- Treat `/skills` as the canonical UI for listing currently available skills.
- If answering directly, do not infer the list only from loaded skill prompts or from project/user directories. Enumerate all discovery roots:
  1. `./.deepcode/skills/<folder>/SKILL.md`
  2. `./.agents/skills/<folder>/SKILL.md`
  3. `~/.deepcode/skills/<folder>/SKILL.md`
  4. `~/.agents/skills/<folder>/SKILL.md`
  5. bundled built-in skills as `bundled:<folder>/SKILL.md`
- For a source checkout, bundled skills live under `templates/skills/bundled/<folder>/SKILL.md`. For a packaged install, bundled skills may live under `dist/bundled/<folder>/SKILL.md`.
- Read each candidate `SKILL.md` frontmatter to get the resolved `name` and `description`; the folder name is only a fallback.
- De-duplicate by resolved `name`, keeping the highest-priority root from the order above.
- Apply `enabledSkills` from `settings.json`: if `enabledSkills["<name>"] === false`, do not list that skill as available.
- Clearly separate discoverable skills from other concepts:
  - Discoverable skills are selectable through `/skills` and come from the roots above.
  - Bundled skills are discoverable skills shipped with Deep Code, such as `bundled:deepcode-self-refer/SKILL.md`.
  - Default prompt templates or always-injected guidance are not necessarily discoverable skills unless they also exist as `*/SKILL.md` in one of the scan roots.
  - Slash commands such as `/skills`, `/mcp`, and `/undo` are commands, not skills.
- Mention that `/skills` can be used to verify the result and `enabledSkills` can enable/disable specific skills by name.

**"配置 <X> MCP":**
- Read `references/mcp.md` for the MCP format and examples
- Ask the user for any required credentials (e.g., GitHub token)
- Provide the exact `mcpServers` JSON block to add to `settings.json`
- Mention using `/mcp` to verify the setup afterwards

**"如何配置/修改 <设置项>":**
- Read `references/configuration.md`
- Explain which `settings.json` field controls the setting
- Clarify user-level (`~/.deepcode/settings.json`) vs project-level (`.deepcode/settings.json`)
- Provide the exact JSON snippet

**"<斜杠命令> 是做什么的？":**
- Read the slash command table from references/README.md
- Provide a brief explanation with any additional context from relevant docs

### Best practices

1. **Always consult the docs first** — never answer from memory alone; the docs are the source of truth.
2. **Provide copy-paste-ready JSON** — users want to copy config blocks directly into their `settings.json`.
3. **Be specific about file paths** — always specify whether it's `~/.deepcode/settings.json` or `.deepcode/settings.json`.
4. **Mention `/mcp` verification** — after any MCP configuration change, remind users to use `/mcp` to verify.
5. **Acknowledge both Chinese and English docs** — the project has docs in both languages (`references/xxx.md` for Chinese, `references/xxx_en.md` for English).

## Examples

### Example 1: "列出可用的skills"

Read references/README.md, locate the Skills section, then enumerate all scan roots including bundled skills. Answer:

- Skills are discovered from: `./.deepcode/skills/`, `./.agents/skills/`, `~/.deepcode/skills/`, `~/.agents/skills/`, and bundled built-in skills such as `bundled:deepcode-self-refer/SKILL.md`.
- In a source checkout, check `templates/skills/bundled/*/SKILL.md`; in a packaged install, check `dist/bundled/*/SKILL.md`.
- Built-in bundled skills may include `deepcode-self-refer`, `plan`, `skill-digester`, and `skill-writer`; verify the actual list by scanning the bundled root because it can change between versions.
- Use `/skills` slash command in the Deep Code CLI to list all available skills
- Use `enabledSkills` in `settings.json` to enable/disable skills by name

### Example 2: "给当前项目配置playwright mcp"

Read `references/mcp.md`, locate the Playwright example. Answer:

- Add to `settings.json` (user-level `~/.deepcode/settings.json` or project-level `.deepcode/settings.json`):

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

- If merging with existing config, add the `"playwright"` entry into the existing `mcpServers` object
- After saving, use `/mcp` in Deep Code to verify the server is running

### Example 3: "怎么设置通知到Slack?"

Read `references/notify.md`, locate the Slack section. Answer with the script + config.

### Example 4: "如何只允许AI读写当前目录?"

Read `references/permission.md`, locate the strict mode example. Provide the exact JSON.
