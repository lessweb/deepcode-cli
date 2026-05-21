---
name: i18n-development
description: Guide for implementing i18n across UI strings, prompt templates, thinking locale, and reply locale in the Deep Code CLI.
---

# i18n Development Skill

## Background

This skill documents the complete i18n implementation plan for the `@vegamo/deepcode-cli` project. It was produced after analyzing the codebase, designing the solution, and performing 6 rounds of review.

Reference documents:
- `.deepcode/i18n-plan.md` — Full architectural plan (v7, 13 sections, ~1070 lines)
- `.deepcode/i18n-todo.md` — Executable task list with progress tracking

## Architecture Overview

### Four Dimensions of i18n

| Dimension | What | How |
|-----------|------|-----|
| **UI** | Ink component static text (labels, status, hints, errors) | `t()` from locale JSON |
| **Prompt** | System prompts sent to LLM (`SYSTEM_PROMPT_BASE`, `COMPACT_PROMPT_BASE`, date/model info) | `t()` + locale-specific EJS templates |
| **Thinking** | LLM `reasoning_content` output language | System prompt appends `t("prompt.thinkingLanguageInstruction")` using `thinkingLocale` |
| **Reply** | LLM `content` output language | System prompt appends `t("prompt.replyLanguageInstruction")` using `replyLocale` |

**Key rule**: UI labels for Thinking/Reply (e.g., "Thinking" / "思考") always follow the main `locale`. `thinkingLocale` and `replyLocale` ONLY control LLM output language via system prompt instructions.

### Three Locale Settings

```
locale         → UI language + Prompt template language
thinkingLocale → LLM reasoning_content language (default = locale)
replyLocale    → LLM content language (default = locale)
```

### Translation File Structure

Translation files are split **by module**, not just by language. Each module has its own JSON file.

```
locales/
├── en/                           # English translations (fallback)
│   ├── ui-message-view.json      # MessageView labels (Thinking, reasoning, etc.)
│   ├── ui-prompt-input.json      # PromptInput status/hints (~20 keys)
│   ├── ui-app.json               # App.tsx error/status messages (~15 keys)
│   ├── ui-loading.json           # Loading text (2 keys)
│   ├── ui-exit-summary.json      # Exit summary (6 keys)
│   ├── ui-welcome.json           # Welcome page shortcut tips
│   ├── ui-mcp.json               # MCP status page
│   ├── ui-slash-commands.json    # Slash command descriptions
│   ├── ui-session-list.json      # Session list labels
│   ├── ui-ask-question.json      # Question prompt labels
│   ├── ui-process-stdout.json    # Process stdout view
│   ├── ui-update-prompt.json     # UpdatePlan display
│   ├── ui-config.json            # /config command UI
│   ├── cli-help.json             # CLI --help text
│   ├── session.json              # session.ts runtime hints
│   └── prompt.json               # System prompt translations
└── zh-CN/                        # Chinese translations (mirror structure)
    └── (same 16 files)
```

### Core API: `src/common/i18n.ts`

```typescript
type Locale = "en" | "zh-CN";
type TranslationKey = keyof typeof import("../../locales/en/index.json");  // auto-derived from en/*.json

// Initialization — reads all *.json from locales/{locale}/, flattens & merges
function initI18n(locale: Locale, options?: { thinkingLocale?: Locale; replyLocale?: Locale }): void;

// Translation — localeOverride for cross-locale lookups (used by system prompt generation)
function t(key: TranslationKey, params?: Record<string, string | number>, localeOverride?: Locale): string;

// Three independent locale states
function getLocale(): Locale;
function getThinkingLocale(): Locale;
function getReplyLocale(): Locale;
```

### React Integration

```typescript
// I18nContext provides { t, locale, setLocale, thinkingLocale, replyLocale, ... }
// React components: useI18n() hook
// Non-React modules: import { t } from "../common/i18n" (global singleton)
```

## Implementation Phases

### Phase 1: Infrastructure (PR 1)
- `src/common/i18n.ts` — core module with `loadLocaleDir()` + `flattenKeys()`
- `locales/{lang}/` directories with 16 placeholder JSON files each
- `src/settings.ts` — add `locale`, `thinkingLocale`, `replyLocale` resolution
- `src/ui/contexts/i18n.tsx` — `I18nProvider`, `useI18n()`
- `src/cli.tsx` — initialize i18n at startup
- `tsconfig.json` — enable `resolveJsonModule`
- `scripts/check-i18n.mjs` — `npm run check:i18n` script
- `package.json` — add `"locales/**"` to `files`

### Phase 2: UI String Replacement (PR 2)
Replace hardcoded strings in 13 UI components with `t()` calls, one module file at a time. Each module corresponds to one JSON file + one source file.

**Order**: MessageView → PromptInput → App → loadingText → exitSummary → WelcomeScreen → McpStatusList → slashCommands → SessionList → AskUserQuestionPrompt → ProcessStdoutView → UpdatePrompt → cli.tsx

### Phase 3: Prompt Templates + Language Instructions (PR 3)
- Locale-specific EJS templates: `templates/prompts/system-prompt.{locale}.md.ejs`
- `getSystemPrompt()` appends two language instructions using `thinkingLocale` and `replyLocale`
- `getCurrentDateAndModelPrompt()` uses `t("prompt.dateAndModel")`
- `session.ts` injects `t()` via `SessionManagerOptions`

### Phase 4: /config Command (PR 4)
- `slashCommands.ts` registers `config` command
- `ConfigDropdown.tsx` — three language selectors (UI/Thinking/Reply, advanced collapsed by default)
- `PromptInput.tsx` — handles `/config locale|thinkingLocale|replyLocale <value>`
- `App.tsx` — locale change callbacks that reload `<Static>` messages

## Development Workflow

### Per-Module Workflow

When adding i18n to a new component:

1. **Create translation JSON**: `locales/en/ui-{module}.json` + `locales/zh-CN/ui-{module}.json`
2. **Replace strings**: In the component file, use `t("ui.{module}.{key}")`
   - React components: `const { t } = useI18n();` → `t("ui.messageView.thinking")`
   - Non-React modules: `import { t } from "../common/i18n"` → `t("ui.loading.thinking")`
3. **Update tests**: Call `initI18n("en")` in test setup or mock `t()`
4. **Update progress**: Mark module as 🟢 in `i18n-todo.md` progress table
5. **Verify**: Run `npm run check && npm test`

### Commit Message Convention

Follow conventional commits for each phase:
- `feat(i18n): add i18n infrastructure and locale resolution`
- `feat(i18n): translate MessageView and PromptInput UI strings`
- `feat(i18n): add locale-specific system prompt templates`
- `feat(i18n): add /config command for language selection`

### Pre-Submit Checklist

Before opening a PR:

- [ ] `npm run check` passes (typecheck + lint + format)
- [ ] `npm test` passes (all existing tests + new i18n tests)
- [ ] `npm run check:i18n` passes (all translation keys consistent)
- [ ] Progress table in `i18n-todo.md` updated
- [ ] No unintended changes to `dist/` or `package-lock.json`

### Rollback Strategy

| Phase | Risk | Rollback |
|-------|------|----------|
| Phase 1 | Low | Delete new files + revert `settings.ts`/`cli.tsx` + remove `resolveJsonModule` |
| Phase 2 | High | `git revert` entire PR (13+ files modified) |
| Phase 3 | Medium | Revert `prompt.ts` + `session.ts`, delete new template files |
| Phase 4 | Medium | Revert `slashCommands.ts` + `PromptInput.tsx` + `App.tsx`, delete `ConfigDropdown.tsx` |

## Performance Notes

All i18n changes have negligible performance impact:

| Metric | Impact | Rating |
|--------|--------|--------|
| Startup time | +3~5ms | 🟢 None |
| Runtime `t()` | ~0.001ms/call | 🟢 None |
| Memory | +30~45KB | 🟢 Negligible |
| Bundle | +0KB (not in JS bundle) | 🟢 None |

## Key Constraints

1. **ESM `__dirname`**: `loadLocaleDir()` must use `typeof __dirname !== "undefined" ? path.resolve(__dirname, "..") : fileURLToPath(import.meta.url)` fallback because esbuild bundles as ESM.
2. **Ink `<Static>`**: Already-rendered messages won't re-render on locale switch. Call `reloadActiveSessionView()` to refresh.
3. **LLM output is a soft constraint**: Language instructions guide the LLM but cannot guarantee compliance. Most models follow reliably.
4. **`TranslationKey` type**: Must match keys in all `en/*.json` files. Auto-derived via `import type` + `keyof typeof`.
5. **Tool docs**: `templates/tools/*.md` stay in English (sent to LLM, not user-facing).
