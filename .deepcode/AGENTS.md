# Repository Guidelines

## Project Structure & Module Organization

npm workspaces monorepo under `packages/`.

- `packages/core/src/` — `session.ts` (LLM loop, streaming, retry, compaction), `tools/` (10 handlers), `common/` (permissions, OpenAI client, model capabilities, file history), `mcp/`, `templates/`.
- `packages/cli/src/` — Ink/React terminal UI (`cli.tsx`, `ui/views`, `ui/components`, `ui/core`, `ui/hooks`); `packages/vscode-ide-companion/` — VSCode companion.
- `docs/` — user docs; `scripts/` — build/release tooling; `dist/` — bundled output (gitignored).

## Build, Test, and Development Commands

- `npm run check` — typecheck/lint/format check; `npm test` — all workspace tests.
- `npm run build` — full build; `npm run bundle` — esbuild bundle + git info; `npm run start` — run the built CLI.
- Single test: `node packages/core/src/tests/run-tests.mjs packages/core/src/tests/session.test.ts`.

## Coding Style & Naming Conventions

- 2-space indent, double quotes, semicolons, `es5` trailing commas, 120-char lines, LF endings; TypeScript strict.
- `import type` for type-only imports; `_` prefix for unused vars; ES2022/ESNext; JSX `react-jsx`.
- Prettier + ESLint; Husky/lint-staged formats staged files. Files: `kebab-case.ts`, `kebab-case.tsx`, `*.test.ts`.

## Testing Guidelines

- Node native test runner (`node:test`) via `tsx`; assertions with `node:assert/strict`.
- Tests live in `packages/*/src/tests/`, named after the source module. Run `npm test` before PRs.

## Commit & Pull Request Guidelines

- Conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `style:`, `test:`, `docs:`, `perf:`, `build:`.
- PRs: clear description, linked issues, UI screenshots, passing `npm run check && npm test`, no unintended `dist/`/`package-lock.json` changes.

## Architecture Overview

- `@vegamo/deepcode-cli` (Ink TUI) uses `SessionManager` (`@vegamo/deepcode-core`) to drive the LLM loop: prompts, streaming preview, tools, retry, compaction.
- Connectivity: `createOpenAIClient()` (180s keep-alive) with DeepCode Plus fallback; `describeLlmError()` normalizes errors.
- Tools: 10 built-ins — `bash`, `read`, `write`, `edit`, `skill`, `AskUserQuestion`, `UpdatePlan`, `WebSearch`, `ReadImage`, `UnderstandImage`; `read` returns a `snippet_id` for `edit`.
- Images: `supportsMultimodal()` + `multimodal` choose `ReadImage` vs `UnderstandImage`; `filesApiEnabled` uploads via the DeepSeek Files API.
- Permissions: 12 scopes incl. `read-in-tmp`/`write-in-tmp`; `addWorkingDirs` extends the workspace; `file-history.ts` provides undo.
- Models: default `deepseek-flash` (V4.1 Flash); `/model` offers `deepseek-flash`, `deepseek-v4-pro`, `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp` with thinking effort `low`/`high`/`max`.
- Slash commands: `/skills`, `/model`, `/plan`, `/new`, `/init`, `/resume`, `/fork`, `/continue`, `/undo`, `/mcp`, `/raw`, `/exit`, plus dynamic `/skill-name`. Plan Mode gates writes behind `<proposed_plan>` approval.
- CLI flags: `-p`, `-x`, `-r`, `-f`, `-l`, `-v`, `-h`.

## Agent-Specific Instructions

- AGENTS.md loads from `./.deepcode/AGENTS.md`, `./AGENTS.md`, then `~/.deepcode/AGENTS.md` (first found wins).
- Skills load from `./.deepcode/skills`, `./.agents/skills`, or `~` equivalents; call the `skill` tool. Bundled: `deepcode-self-refer`, `image-generator`, `video-generator`, `skill-digester`, `skill-writer`.
- File references: `@path/to/file`.
