# Repository Guidelines

## Project Structure & Module Organization

npm workspaces monorepo under `packages/`:

- `packages/core/src/` — `session.ts` (LLM loop, retry, compaction), `tools/` (10 handlers), `common/` (permissions, OpenAI client, PLUS routing, sessions), `mcp/`, `templates/`.
- `packages/cli/src/` — Ink/React TUI (`ui/`), `exec-runner.ts`, `doctor.ts`, `plus-setup.ts`.
- `packages/vscode-ide-companion/` — VSCode extension. `docs/` — user docs; `scripts/` — build/release; `dist/` — gitignored output.

## Build, Test, and Development Commands

- `npm run check` — typecheck, lint, and Prettier check.
- `npm test` — all workspace tests.
- `npm run build` / `npm run build:vscode` — build the CLI / extension; `npm start` runs the bundle.
- Single test: `node --import tsx --test packages/core/src/tests/session.test.ts`.
- Release: `npm run release:version -- <bump>`, then `npm run prepare:package` / `npm run prepare:vscode` (`RELEASE.md`; v0.4.5).

## Coding Style & Naming Conventions

- 2-space indent, double quotes, semicolons, `es5` trailing commas, 120-char lines, LF endings; TypeScript strict.
- `import type` for type-only imports; `_` prefix for unused vars; ES2022/ESNext; JSX `react-jsx`.
- Prettier + ESLint; Husky/lint-staged formats staged files. Files: `kebab-case.ts`, `kebab-case.tsx`, `*.test.ts`.

## Testing Guidelines

- Node native test runner (`node:test`) via `tsx` with `node:assert/strict`, invoked by each package's `run-tests.mjs`.
- Tests live in `packages/*/src/tests/`, named after the source module; run `npm test` before PRs. No coverage gate.

## Commit & Pull Request Guidelines

- Conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `style:`, `test:`, `docs:`, `perf:`, `build:`.
- PRs: clear description, linked issues, screenshots for UI changes, passing `npm run check && npm test`, no unintended `dist/` or lockfile changes.

## Architecture Overview

- `@vegamo/deepcode-cli` (Ink TUI) drives the LLM loop via `SessionManager` (`@vegamo/deepcode-core`) over a 180s keep-alive `createOpenAIClientFactory()`.
- Built-in tools (10): `bash`, `read`, `write`, `edit`, `skill`, `AskUserQuestion`, `UpdatePlan`, `WebSearch`, `ReadImage`, `UnderstandImage`. `read`/`write` return a `snippet_id`; `edit` requires it, and edit/write results include diff previews. `bash` bounds output; `run_in_background` detaches work; new files follow Git `eol`.
- 12 permission scopes with session-only grants; `/permissions` edits settings, and model dialogs choose user/project scope. `addWorkingDirs` extends the workspace; file history enables undo.
- Default model `deepseek-flash`; `/model` offers `deepseek-v4-pro`, `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp` with thinking effort `max`/`high`/`low`/off.
- PLUS (`common/plus-subscription.ts`): `~/.deepcode-plus/settings.json` stores `subscriptionPlan` (`default`/`on`/`off`) and `env.PLUS_API_KEY` (`sk-` + 24/26 chars). 24-char keys use `deepcode.vegamo.cn`, 26-char use `www.deepcodeplus.com` (LLM `chat.deepcodeplus.com`); shared by web search, image understanding, and telemetry. Configure via `--plus`.
- Sessions persist as JSONL with auto-generated titles mirrored in the terminal title. Compaction uses `autoCompactWindow`, `retainRatio` (default 0.16) or `retainTokens`; `/compact` runs it.
- New CLI options: `--doctor`, `-s/--settings`, `--session-id`, `--json` (with `-x`); new commands: `/permissions`, `/compact`; Plan Mode gates writes behind `<proposed_plan>`.

## Agent-Specific Instructions

- AGENTS.md loads from `./.deepcode/AGENTS.md`, `./AGENTS.md`, then `~/.deepcode/AGENTS.md` (first wins).
- Skills load from `./.deepcode/skills`, `./.agents/skills`, or `~` equivalents via the `skill` tool. Bundled: `deepcode-self-refer`, `image-generator`, `video-generator` (+`references/`, `scripts/`), `skill-digester`, `skill-writer`.
- File references: `@path/to/file`.
