# Repository Guidelines

## Project Structure & Module Organization

```
src/
├── cli.tsx              # Entry point — parses args, renders Ink App
├── session.ts           # SessionManager — LLM loop, compaction, tool orchestration
├── settings.ts          # Settings resolution from ~/.deepcode/settings.json
├── prompt.ts            # System prompt builder, tool definitions, agent-drift-guard skill
├── model-capabilities.ts # Model detection and thinking-mode defaults
├── ui/
│   ├── App.tsx          # Root Ink component — state, routing, session orchestration
│   ├── PromptInput.tsx  # Multi-line input with slash commands, image paste, skills
│   ├── MessageView.tsx  # Renders assistant/tool messages with markdown
│   ├── SessionList.tsx  # Session picker for /resume
│   └── ...
├── tools/
│   ├── executor.ts      # ToolExecutor — dispatches tool calls to handlers
│   ├── bash-handler.ts  # Executes shell commands
│   ├── read-handler.ts  # Reads files and images
│   ├── write-handler.ts # Creates/overwrites files
│   ├── edit-handler.ts  # Scoped string replacements in files
│   ├── web-search-handler.ts # Web search tool
│   └── ask-user-question-handler.ts # Interactive user prompts
├── tests/               # Test suite — one *.test.ts per module
docs/
├── tools/               # Tool descriptions fed to the LLM
├── prompts/             # EJS templates (e.g., init_command.md.ejs)
dist/                    # Bundled CLI output (gitignored)
```

## Build, Test, and Development Commands

| Command | Purpose |
|---|---|
| `npm run typecheck` | TypeScript type checking (`tsc --noEmit`) |
| `npm run lint` | ESLint across `src/` |
| `npm run lint:fix` | ESLint with auto-fix |
| `npm run format` | Prettier on all `src/**/*.{ts,tsx}` |
| `npm run format:check` | Prettier in check-only mode |
| `npm run check` | Runs typecheck + lint + format:check together |
| `npm run bundle` | esbuild bundles `src/cli.tsx` → `dist/cli.js` (ESM, Node 18) |
| `npm run build` | `check` + `bundle` — full CI gate before publish |
| `npm test` | Runs all tests via `tsx --test src/tests/*.test.ts` |
| `npm run test:single -- <file>` | Run a single test file (e.g., `npm run test:single -- src/tests/session.test.ts`) |

Run the CLI locally for manual testing: `node dist/cli.js` (after `npm run bundle`).

## Coding Style & Naming Conventions

- **Indentation**: 2 spaces, no tabs
- **Quotes**: Double quotes (`"`)
- **Semicolons**: Required
- **Trailing commas**: `es5` (objects, arrays, etc.)
- **Line width**: 120 characters max
- **Line endings**: LF only

**TypeScript**: Strict mode enabled. Use `import type` for type-only imports (enforced by `@typescript-eslint/consistent-type-imports`). Unused variables prefixed with `_` are allowed.

**Formatting/Linting**: Prettier + ESLint (typescript-eslint, react-hooks). Run `npm run check` before pushing. On commit, Husky + lint-staged auto-formats staged `*.{ts,tsx,js,mjs,cjs,ejs,jsx}` and `*.json` files.

**File naming**: `kebab-case.ts` for modules, `kebab-case.tsx` for React/Ink components. Test files: `*.test.ts`.

## Testing Guidelines

- **Framework**: Node.js native test runner (`node:test`) with `tsx` for TypeScript
- **Assertions**: `node:assert/strict`
- **Coverage**: Target meaningful unit tests for core logic (session management, tool handlers, settings resolution, prompt buffer). Test files are in `src/tests/` matching the source module name.
- **Test naming**: `describe`/`test` blocks with descriptive names. Example: `test("SessionManager preserves structured system content when building OpenAI messages", ...)`
- **Relaxed lint rules**: Test files allow `any` and unused vars.
- Run all tests with `npm test` before submitting a PR.

## Commit & Pull Request Guidelines

**Commit messages** follow conventional commits. From the project history:

- `feat:` — new feature (e.g., `feat: add /model command`)
- `fix:` — bug fix (e.g., `fix(ui): redraw cleanly after terminal resize`)
- `chore:` — tooling, deps, hooks (e.g., `chore: add husky + lint-staged`)
- `refactor:` — code restructuring (e.g., `refactor(ui): optimize App hooks`)
- `style:` — formatting-only changes

**Pull requests** should include:
- A clear description of what changed and why
- Link to related issue(s) if applicable
- Screenshots or terminal recordings for UI changes
- All checks passing (`npm run check && npm test`)
- No unintended changes to `dist/` or `package-lock.json` without justification

## Architecture Overview

The CLI renders a terminal UI using [Ink](https://github.com/vadimdemedes/ink) (React for terminals). `SessionManager` drives the LLM interaction loop: it builds system prompts, sends user messages with optional skills/images, streams responses, executes tool calls via `ToolExecutor`, and compacts context when token thresholds are exceeded (512K for DeepSeek V4 models, 128K for others).

Six tools are available to the LLM: `bash`, `read`, `write`, `edit`, `AskUserQuestion`, and `WebSearch`. Tool definitions are registered in `src/tools/executor.ts` and described to the LLM via `src/prompt.ts` and `docs/tools/`.

## Agent-Specific Instructions

- **AGENTS.md loading**: The CLI loads agent instructions from `./AGENTS.md`, `./.deepcode/AGENTS.md`, or `~/.deepcode/AGENTS.md` (first found wins). Write project-specific guidance for the LLM in any of these.
- **Skills**: Place skill definitions in `~/.agents/skills/<name>/SKILL.md` (user-level) or `./.agents/skills/<name>/SKILL.md` (project-level). Legacy path `./.deepcode/skills/` is also supported. Each SKILL.md uses YAML frontmatter with `name` and `description` fields.
- The built-in `agent-drift-guard` skill is always injected into every session.
