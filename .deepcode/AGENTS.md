# Repository Guidelines

## Project Structure & Module Organization

npm workspaces monorepo; packages live under `packages/`.

- `packages/core/src/` — LLM session (`session.ts`), prompt/tool definitions (`prompt.ts`), settings resolution (`settings.ts`), `tools/` (10 built-in handlers), `common/` (permissions, OpenAI client, DeepSeek Files API, file history), `mcp/`.
- `packages/cli/src/` — Ink/React terminal UI: `cli.tsx` entry, `ui/views`, `ui/components`, `ui/core`, `ui/hooks`, `tests/`.
- `packages/vscode-ide-companion/` — VSCode extension companion.
- `docs/` — user documentation; `scripts/` — build/release tooling; `dist/` — bundled CLI output (gitignored).

## Build, Test, and Development Commands

All commands run from the repo root.

- `npm run typecheck`, `npm run lint`, `npm run format:check` — type/lint/format checks; `npm run check` runs all three.
- `npm run build` — full build (core + CLI bundle + assets); `npm run bundle` — esbuild bundle + git info; `npm run build:vscode` — VSCode companion.
- `npm test` — all workspace tests; `npm run start` — run the built CLI.
- Single test: `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/session.test.ts`.
- Manual run: `node packages/cli/dist/cli.js` (after `npm run bundle`).

## Coding Style & Naming Conventions

- 2-space indent, double quotes, semicolons, `es5` trailing commas, 120-char lines, LF endings.
- TypeScript strict; `import type` for type-only imports; `_` prefix for unused vars; ES2022/ESNext; JSX `react-jsx`.
- Prettier + ESLint; Husky/lint-staged formats staged files on commit.
- Files: `kebab-case.ts`; components `kebab-case.tsx`; tests `*.test.ts`.

## Testing Guidelines

- Node native test runner (`node:test`) via `tsx`; assertions with `node:assert/strict`.
- Tests live in `packages/*/src/tests/` matching the source module name; descriptive `describe`/`test` names.
- Run `npm test` before submitting a PR.

## Commit & Pull Request Guidelines

- Conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `style:`, `test:`, `docs:`, `perf:`, `build:`.
- PRs: clear description, linked issues, screenshots for UI changes, `npm run check && npm test` passing, no unintended `dist/` or `package-lock.json` changes.

## Architecture Overview

- `@vegamo/deepcode-cli` renders a terminal UI with Ink; `SessionManager` (`@vegamo/deepcode-core`) drives the LLM loop — prompts, streaming, `ToolExecutor`, context compaction (`contextWindow`/`autoCompactWindow`).
- Connectivity: `createOpenAIClient()` (180s keep-alive) with DeepCode Plus fallback; errors normalized via `describeLlmError()`.
- Tools: 10 built-ins — `bash`, `read`, `write`, `edit`, `skill`, `AskUserQuestion`, `UpdatePlan`, `WebSearch`, `ReadImage`, `UnderstandImage`. `ReadImage` (multimodal models) returns the image itself, validated/downscaled via Sharp; `UnderstandImage` is the plugin-backed fallback. `read` returns a `snippet_id` for subsequent `edit` calls.
- Images: `supportsMultimodal()` + `multimodal` setting choose `ReadImage` vs `UnderstandImage`; `filesApiEnabled` uploads images to the DeepSeek Files API, caching file IDs in `~/.deepcode/files-api-cache.json`.
- Permissions (`permissions.ts`) control allow/deny/ask by scope; `file-history.ts` provides undo via lightweight Git branches.
- Models: default `deepseek-v4-flash`; `/model` offers `deepseek-v4-pro`, `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp` with reasoning effort `low`/`high`/`max`.
- Slash commands: `/skills`, `/model`, `/plan`, `/new`, `/init`, `/resume`, `/fork`, `/continue`, `/undo`, `/mcp`, `/raw`, `/exit`, plus dynamic `/skill-name`. Plan Mode (`/plan` or `Shift+Tab`) requires `<proposed_plan>` approval before writes.
- CLI flags: `-p`, `-x`, `-r`, `-f`, `-l`, `-v`, `-h`.

## Agent-Specific Instructions

- AGENTS.md loads from `./AGENTS.md`, `./.deepcode/AGENTS.md`, or `~/.deepcode/AGENTS.md` (first found wins).
- Skills: `~/.agents/skills/<name>/SKILL.md` (user) or `./.agents/skills/<name>/SKILL.md` (project); legacy `./.deepcode/skills/` also scanned. Call the `skill` tool for full instructions. Bundled: `deepcode-self-refer`, `image-generator`, `skill-digester`, `skill-writer`.
- Prompt file references: `@path/to/file`.
