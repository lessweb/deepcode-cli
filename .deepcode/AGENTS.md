# Repository Guidelines

## Project Structure & Module Organization

This is an **npm workspaces monorepo**. Packages live under `packages/`.

```
packages/
├── core/src/               # LLM session, tool execution, shared utilities
│   ├── common/             # File I/O, permissions, telemetry, OpenAI client, shell utils, etc.
│   ├── tools/              # 7 built-in handlers (bash, read, write, edit, web-search, ask-user-question, update-plan)
│   ├── mcp/                # MCP client & manager (JSON-RPC lifecycle)
│   ├── session.ts          # SessionManager — LLM loop, compaction, tool orchestration
│   ├── prompt.ts           # System prompt builder & tool definitions
│   └── settings.ts         # Settings resolution from ~/.deepcode/settings.json
├── cli/src/                # Terminal UI (Ink/React)
│   ├── cli.tsx             # Entry point — renders AppContainer
│   ├── cli-args.ts         # CLI argument parsing (yargs: -p, -r, -v, -h)
│   ├── common/             # Update checker
│   ├── utils/              # stdio helpers, version, package info
│   ├── generated/          # Build-time git commit info
│   ├── ui/views/           # Top-level screens (App, PromptInput, SessionList, PermissionPrompt, WelcomeScreen, UpdatePrompt, McpStatusList, etc.)
│   ├── ui/components/      # Reusable Ink components (MessageView, DropdownMenu, ModelsDropdown, etc.)
│   ├── ui/core/            # Prompt buffer, slash commands, file mentions, clipboard, undo/redo
│   ├── ui/hooks/           # Custom hooks (cursor, history navigation, paste handling, terminal input, statusline)
│   ├── ui/contexts/        # React contexts (AppContext, RawModeContext)
│   ├── ui/statusline/      # Pluggable statusline providers (command, module)
│   ├── ui/utils/            # Shared UI utilities (writing, formatting)
│   └── tests/              # UI-focused tests with run-tests.mjs runner
├── vscode-ide-companion/   # VSCode extension companion
│   └── src/                # extension.ts, provider.ts, utils.ts
docs/                       # User-facing documentation (configuration, MCP, notify, permissions)
scripts/                    # Build, release, and packaging scripts
dist/                       # Bundled CLI output — single-file dist/cli.js (gitignored)
dist/bundled/               # Bundled skills & references shipped with the CLI
```

Templates for tool descriptions and prompts are at `packages/cli/dist/templates/` (copied during build from `packages/core/templates/`). Built-in skills are under `packages/cli/dist/bundled/`.

## Build, Test, and Development Commands

All commands run from the repo root.

| Command | What it does |
|---|---|
| `npm run typecheck` | TypeScript type checking across all workspaces |
| `npm run lint` | ESLint across `packages/*/src/**/*.{ts,tsx}` + `scripts/*.js` |
| `npm run lint:fix` | ESLint with auto-fix |
| `npm run format` | Prettier on all source files |
| `npm run format:check` | Prettier in check-only mode |
| `npm run check` | Runs typecheck + lint + format:check together |
| `npm run build` | Orchestrates full build (scripts/build.js) — compiles core + bundles CLI + copies assets |
| `npm run bundle` | Generates git commit info + esbuild bundle + copies bundled assets |
| `npm run build:vscode` | Builds the VSCode extension companion |
| `npm test` | Runs all workspace tests (`npm run test --workspaces --if-present`) |
| `npm run start` | Runs the locally built CLI (`scripts/start.js`) |
| `npm run build-and-start` | Builds then starts the CLI |
| `npm run clean` | Removes generated files and dist directories |
| `npm run release:version` | Bumps version across all packages |
| `npm run prepare:package` | Prepares the CLI package for distribution |
| `npm run prepare:vscode` | Prepares the VSCode extension for distribution |

To run a **single test file** within a package:
```
node packages/core/src/tests/run-tests.mjs packages/core/src/tests/session.test.ts
node packages/cli/src/tests/run-tests.mjs packages/cli/src/tests/slash-commands.test.ts
```

Run the CLI locally for manual testing: `node packages/cli/dist/cli.js` (after `npm run bundle`).

## Coding Style & Naming Conventions

- **Indentation**: 2 spaces, no tabs
- **Quotes**: Double quotes (`"`)
- **Semicolons**: Required
- **Trailing commas**: `es5` (objects, arrays, etc.)
- **Line width**: 120 characters max
- **Line endings**: LF only

**TypeScript**: Strict mode enabled (`strict: true`). Use `import type` for type-only imports (`@typescript-eslint/consistent-type-imports`). Unused variables prefixed with `_` are allowed (`argsIgnorePattern: "^_"`). Target ES2022, module ESNext with bundler resolution. JSX is `react-jsx`.

**Formatting/Linting**: Prettier (double quotes, 2-space indent, semicolons) + ESLint (typescript-eslint, react-hooks). Run `npm run check` before pushing. On commit, Husky + lint-staged auto-formats staged `*.{ts,tsx,js,mjs,cjs,jsx}` and `*.json` files.

**File naming**: `kebab-case.ts` for modules, `kebab-case.tsx` for React/Ink components. Test files: `*.test.ts` (always kebab-case).

## Testing Guidelines

- **Framework**: Node.js native test runner (`node:test`) with `tsx` for TypeScript
- **Assertions**: `node:assert/strict`
- **Coverage**: Target meaningful unit tests for core logic (session management, tool handlers, settings resolution, prompt buffer, permissions, MCP client, telemetry). Test files are in `packages/*/src/tests/` matching the source module name.
- **Test naming**: `describe`/`test` blocks with descriptive names. Example: `test("SessionManager preserves structured system content when building OpenAI messages", ...)`
- **Relaxed lint rules**: Test files allow `any` and unused vars.
- Run all tests with `npm test` before submitting a PR. Each package has its own `run-tests.mjs` cross-platform runner.

## Commit & Pull Request Guidelines

**Commit messages** follow conventional commits:

- `feat:` — new feature (e.g., `feat: add /model command`)
- `fix:` — bug fix (e.g., `fix(mcp): fix Windows MCP spawn double-quoting`)
- `chore:` — tooling, deps, hooks (e.g., `chore: add husky + lint-staged`)
- `refactor:` — code restructuring (e.g., `refactor(ui): optimize App hooks`)
- `style:` — formatting-only changes
- `test:` — adding or updating tests
- `docs:` — documentation changes
- `perf:` — performance improvements
- `build:` — build system changes

**Pull requests** should include:
- A clear description of what changed and why
- Link to related issue(s) if applicable
- Screenshots or terminal recordings for UI changes
- All checks passing (`npm run check && npm test`)
- No unintended changes to `dist/` or `package-lock.json` without justification

## Architecture Overview

The CLI (`@vegamo/deepcode-cli`) renders a terminal UI using [Ink](https://github.com/vadimdemedes/ink) (React for terminals). `SessionManager` (in `@vegamo/deepcode-core`) drives the LLM interaction loop: it builds system prompts, sends user messages with optional skills/images, streams responses, executes tool calls via `ToolExecutor`, and compacts context when token thresholds are exceeded (512K for DeepSeek V4 models, 128K for others). OpenAI client connectivity is managed by `createOpenAIClient()` with a 180-second keep-alive timeout. API errors are normalized through `describeLlmError()` in `packages/core/src/common/llm-error.ts`, which produces credential-safe, structured error details.

Seven built-in tools are available to the LLM: `bash`, `read`, `write`, `edit`, `AskUserQuestion`, `UpdatePlan`, and `WebSearch`. The `read` tool returns a `snippet_id` that must be passed to subsequent `edit` calls, ensuring edits always operate on a known, session-local file snapshot. Tool definitions are registered in `packages/core/src/tools/executor.ts` and described to the LLM via `packages/core/src/prompt.ts`.

A **permission system** (`packages/core/src/common/permissions.ts`) controls tool execution scopes (read/write/delete/network/git-log, etc.) with configurable allow/deny/ask decisions.

A **file history system** (`packages/core/src/common/file-history.ts`) provides undo/checkpoint support via lightweight Git branches.

**Slash commands**: `/skills`, `/model`, `/plan`, `/new`, `/init`, `/resume`, `/continue`, `/undo`, `/mcp`, `/raw`, `/exit`, plus dynamic `/skill-name` for each loaded skill.

**Plan Mode** (`/plan` or `Shift+Tab`): Restricts the agent to read-only operations on the first turn and requires it to produce a task plan via `<proposed_plan>` for user approval before any file writes, deletions, or git mutations. When enabled, write/delete/mutate-git-log permissions are force-asked regardless of user settings.

**Key UI features**: `@` file mentions in the prompt input, `Ctrl+O` to view live process stdout, `Ctrl+V` to paste images, `Ctrl+X` to clear images, Shift+Enter for newlines, `Shift+Tab` to toggle Plan Mode, pluggable statusline, MCP server status display, undo selector, and permission prompts.

**CLI flags**: `-p <prompt>` / `--prompt` to auto-submit a prompt on launch, `-r [sessionId]` / `--resume [sessionId]` to resume a session or show the session picker, `-v` / `--version`, `-h` / `--help`.

## Agent-Specific Instructions

- **AGENTS.md loading**: The CLI loads agent instructions from `./AGENTS.md`, `./.deepcode/AGENTS.md`, or `~/.deepcode/AGENTS.md` (first found wins).
- **Skills**: Place skill definitions in `~/.agents/skills/<name>/SKILL.md` (user-level) or `./.agents/skills/<name>/SKILL.md` (project-level). Legacy path `./.deepcode/skills/` is also supported. Each SKILL.md uses YAML frontmatter with `name` and `description` fields.
- **Built-in skills**: Four bundled skills ship with the CLI — `plan` (task planning workflow), `deepcode-self-refer` (Deep Code CLI documentation), `skill-digester` (digest & install skills), `skill-writer` (create & debug skills). Additionally, `karpathy-guidelines` (behavioral guidelines to reduce LLM coding mistakes) is injected as a default skill template.
- **Prompt file references**: Use `@path/to/file` syntax in prompts to load file contents through the read tool.
