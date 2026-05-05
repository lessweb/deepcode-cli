# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`@vegamo/deepcode-cli` (`deepcode`) — an interactive terminal coding assistant tuned for DeepSeek V4 and other OpenAI-compatible models. Rendered as a TUI with Ink (React 17). Source is TypeScript; ships as a single bundled CommonJS executable.

## Common Commands

```bash
npm run typecheck            # tsc -p ./ --noEmit (no .d.ts emitted; type-check only)
npm run bundle               # esbuild ./src/cli.tsx → dist/cli.cjs (CJS, packages external)
npm run build                # typecheck + bundle + chmod +x  (also runs on prepack)

npm test                     # tsx --test src/tests/*.test.ts   (Node native test runner)
npm run test:single -- src/tests/session.test.ts   # run a single file
                                                   # filter inside a file with --test-name-pattern

npm link && deepcode         # install local build globally for end-to-end testing
node dist/cli.cjs --version  # smoke-test the bundled binary directly
```

Requirements: Node ≥ 18.17. The CLI refuses to start without a TTY (`process.stdin.isTTY`).

## Architecture (read this before changing core logic)

The data flow is: **`cli.tsx` → Ink `<App />` → `SessionManager` → OpenAI streaming → `ToolExecutor` → tool handlers**.

### Entry & UI
- `src/cli.tsx` parses `--version` / `--help`, runs `setShellIfWindows()`, then mounts `<App />` via `ink.render`. `exitOnCtrlC: false` is intentional — Ctrl-C is intercepted to abort the active model turn instead of killing the process.
- `src/ui/App.tsx` owns React state: `messages`, `sessions`, `skills`, `streamProgress`, `runningProcesses`. It instantiates **one** `SessionManager` (via `useMemo`) and wires its callbacks (`onAssistantMessage`, `onSessionEntryUpdated`, `onLlmStreamProgress`) into setState.
- `src/ui/slashCommands.ts` builds the `/skills /new /resume /exit` menu plus one entry per discovered skill. Skill items dispatch `loadSkill`, not a literal slash command.

### Session orchestrator (`src/session.ts` — the heart of the app)
- **Persistence**: per project, files live under `~/.deepcode/projects/{projectCode}/`, where `projectCode` is `projectRoot.replace(/[\\/]/g, "-").replace(/:/g, "")`. The index is `sessions-index.json`; messages are append-only JSONL at `{sessionId}.jsonl`. Sessions are capped at `MAX_SESSION_ENTRIES = 50` (oldest by `updateTime` are dropped, and their JSONL files are deleted).
- **Agent loop** (`activateSession`): up to `maxIterations = 80000` rounds of `createChatCompletionStream` → if `tool_calls` returned, run `appendToolMessages` → loop. Exit conditions: no tool calls, `awaitUserResponse: true`, refusal, abort, or interrupt.
- **Streaming**: every chat completion uses `stream: true` + `include_usage: true`. The stream is collapsed back into one synthetic non-streaming response (`choices[0].message`) so downstream code is uniform. Token estimation for the progress UI uses `estimateStreamTokens` (Chinese chars weighted 0.6, others 0.3) and is purely a UX hint, not the real `usage.total_tokens`.
- **Compaction**: when `entry.activeTokens > getCompactPromptTokenThreshold(model)` (512 KB tokens for DeepSeek V4 models, 128 KB otherwise), `compactSession` summarizes a slice between the first non-system message and roughly the 2/3 mark, marks those messages `compacted: true`, and inserts a hidden summary system message. **Compacted messages stay in the JSONL** but are filtered out of the OpenAI request via `buildOpenAIMessages`.
- **Skill auto-injection**: before each user turn, `identifyMatchingSkillNames` makes a separate JSON-mode LLM call asking which available skills apply. Matched skills are appended into `userPrompt.skills`, then `dedupeSkills` + `normalizeSkills` reconcile against the current loaded set so a skill is never re-injected into the same session.
- **Default skill**: `AGENT_DRIFT_GUARD_SKILL` (defined inline in `src/prompt.ts`) is loaded as a hidden system message at the start of every session.
- **Tool-call recovery**: `closePendingToolCalls` synthesizes `{ok:false, error, metadata.interrupted:true}` tool results for any assistant `tool_calls` that lack matching `tool` responses (after interrupt or restart). This keeps OpenAI's strict tool-call/tool-response pairing invariant intact.
- **Telemetry**: `reportNewPrompt` POSTs an empty body to `https://deepcode.vegamo.cn/api/plugin/new` using the resolved `machineId` as a `Token` header. Failures are warn-logged only.

### Prompt + tool schema (`src/prompt.ts`)
- `getSystemPrompt(projectRoot, options)` concatenates `SYSTEM_PROMPT_BASE` + bundled tool docs (read at runtime from `docs/tools/*.md` relative to `__dirname/..`) + `getRuntimeContext`. The runtime context block embeds `pwd`, `homedir`, `uname -a`, shell path, Python/Node versions, and presence of `ast-grep` / `ripgrep` / `jq`.
- `getTools(options)` returns the OpenAI function-call schema. **Tool descriptions in this file are deliberately short** — the long-form usage rules live in `docs/tools/*.md` and are injected only into the system prompt. Keep the two in sync when changing a tool's contract.
- The `docs/tools/**` directory ships with the npm package (see `package.json` `files`); do not delete it during refactors.

### Tools (`src/tools/`)
- `executor.ts` — `ToolExecutor` registers six handlers: `bash`, `read`, `write`, `edit`, `AskUserQuestion`, `WebSearch`. Every result is normalized to `{ok, name, output?, error?, metadata?, awaitUserResponse?}` JSON before being fed back to the model.
- `bash-handler.ts` — persistent **per-session** working directory tracked in a `sessionWorkingDirs` Map. Output cap: `MAX_OUTPUT_CHARS = 30000` returned to the model, `MAX_CAPTURE_CHARS = 10 MB` retained for UI. On Windows, commands are routed through Git Bash via helpers in `shell-utils.ts`; `rewriteWindowsNullRedirect` patches `> /dev/null` style redirects.
- `read-handler.ts` / `edit-handler.ts` — Read returns a `metadata.snippet` `{id, startLine, endLine}` when `offset`/`limit` are used. Edit accepts `snippet_id` to scope replacements to that prior read range — preserve this contract; it is the primary safety mechanism against ambiguous `replace_all`.
- `runtime.ts` — `executeValidatedTool` wraps Zod validation. New tools should go through it so that `InputValidationError:` prefixes stay consistent.

### Settings & models
- `src/settings.ts` — `~/.deepcode/settings.json` (also shared with the VSCode extension). Field shape: `{env:{MODEL,BASE_URL,API_KEY,THINKING}, thinkingEnabled, reasoningEffort, notify, webSearchTool}`. `THINKING=enabled` is a legacy alias for `thinkingEnabled:true`. `reasoningEffort` accepts `"high"` or `"max"` (defaults `"max"`).
- `src/model-capabilities.ts` — `DEEPSEEK_V4_MODELS` is the single source of truth for which models default to thinking mode and get the larger compaction threshold. Add new model IDs here when adding support.
- `src/openai-thinking.ts` — when `baseURL` contains `.volces.com` (Volcano Ark), the `thinking` field is sent at the top level and `reasoning_effort` goes into `extra_body`; everything else nests both under `extra_body`. Don't collapse this branch — vendors disagree on the schema.
- `AGENTS.md`: `SessionManager.loadAgentInstructions()` reads `./.deepcode/AGENTS.md` then `~/.deepcode/AGENTS.md` and prepends the first non-empty one as a system message after the main system prompt.

### Skills system
Two roots, scanned in order; project skills override user skills with the same name:
- `~/.agents/skills/{skill}/SKILL.md` (user-level)
- `./.deepcode/skills/{skill}/SKILL.md` (project-level)

Each `SKILL.md` is parsed with `gray-matter`; the `name` and `description` frontmatter fields drive the `/skills` menu. When a skill is loaded into a session, its full markdown becomes a system message wrapped in `<{name}-skill path="...">…</{name}-skill>` and tagged with `meta.skill.isLoaded = true` so subsequent `identifyMatchingSkillNames` calls skip it.

## Conventions and Gotchas

- **JSX runtime**: `tsconfig.json` uses `"jsx": "react-jsx"` and esbuild uses `--jsx=automatic --jsx-import-source=react`. React 17 is pinned — do not rely on React 18 features (no `useTransition`, no `<Suspense>` for data, no concurrent features).
- **Bundle externals**: esbuild uses `--packages=external`. The published artifact is `dist/cli.cjs` and depends on `node_modules/` shipped via `npm install -g`. Anything you add to `dependencies` is fine; if you switch to a bundled dependency, add it manually because there's no automatic externals list.
- **No top-level await** in code that ends up in `cli.tsx` — the bundle target is CJS and `node18` strict mode.
- **Tests use Node's native runner**, not Jest/Vitest. Imports look like `import { test } from "node:test"; import assert from "node:assert/strict";`. Tests run through `tsx`, so they can import `.ts`/`.tsx` directly. Keep tests free of test-runner-specific globals.
- **Session JSONL is append-only except via `saveSessionMessages`**, which rewrites the whole file. Use `appendSessionMessage` for incremental writes; only call `saveSessionMessages` when you must rewrite (e.g. compaction, `closePendingToolCalls`).
- **Tool result envelope is contract-stable**: the model has been prompted to expect `{ok, name, output, error, metadata}`. Don't add new top-level fields without also updating the system prompt.
- **`isInvisibleExecution`**: tool messages with `name === "bash"` and `ok !== true` are hidden from the UI. If you add a new tool whose failures should also be silent, extend that helper rather than tagging at the call site.
- **Windows**: every shell-out path goes through `shell-utils.ts`. Use `findGitBashPath()` / `resolveShellPath()` instead of spawning `bash` directly, and remember `setShellIfWindows()` runs once at startup. Test new shell logic on both POSIX and Windows code paths (or at minimum, exercise the helpers in `shell-utils.ts`).
- **Reasoning content replay**: `buildOpenAIMessages` injects `reasoning_content: ""` on every replayed assistant message when `thinkingEnabled` is true. Some providers reject the request without it. Don't strip this branch when refactoring message construction.
- **AbortController plumbing**: `activePromptController` (one global) and `sessionControllers` (per session) coexist. `interruptActiveSession` aborts both plus kills any tracked child PIDs. New long-running async work in `SessionManager` must check `isInterrupted(sessionId)` between awaits or accept an `AbortSignal`.
