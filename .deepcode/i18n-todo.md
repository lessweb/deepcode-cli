# i18n 支持 — TODO 任务清单 & 进度追踪

> 完整方案见 `.deepcode/i18n-plan.md`
> 开发技能见 `.agents/skills/i18n-development/SKILL.md`

> **关键约定**：UI 中 Thinking/Reply 的标签文字（"思考" / "Thinking"）**始终跟随主 `locale`**，与 `thinkingLocale`/`replyLocale` 无关。后两者仅控制 LLM 输出语言（通过系统提示词指令）。

## 翻译进度总览

| 状态 | 含义 |
|------|------|
| 🔴 待创建 | 文件尚未创建 |
| 🟡 翻译中 | en 版本完成，zh-CN 版本部分完成 |
| 🟢 已完成 | en + zh-CN 版本均完成 |

| 模块文件 | en | zh-CN | Phase | 代码文件 | 状态 |
|---------|----|-------|-------|---------|------|
| `ui-message-view.json` | 🟢 | 🟢 | Phase 2 | MessageView | ✅ 完成 |
| `ui-prompt-input.json` | 🟢 | 🟢 | Phase 2 | PromptInput | ✅ 完成 |
| `ui-app.json` | 🟢 | 🟢 | Phase 2 | App.tsx | ✅ 完成 |
| `ui-loading.json` | 🟢 | 🟢 | Phase 2 | loadingText.ts | ✅ 完成 |
| `ui-exit-summary.json` | 🟢 | 🟢 | Phase 2 | exitSummary.ts | ✅ 完成 |
| `ui-welcome.json` | 🟢 | 🟢 | Phase 2 | WelcomeScreen | ✅ 完成 |
| `ui-mcp.json` | 🟢 | 🟢 | Phase 2 | McpStatusList | ✅ 完成 |
| `ui-slash-commands.json` | 🟢 | 🟢 | Phase 2 | slashCommands.ts | ✅ 完成 |
| `ui-session-list.json` | 🟢 | 🟢 | Phase 2 | SessionList | ✅ 完成 |
| `ui-ask-question.json` | 🟢 | 🟢 | Phase 2 | AskUserQuestionPrompt | ✅ 完成 |
| `ui-process-stdout.json` | 🟢 | 🟢 | Phase 2 | ProcessStdoutView | ✅ 完成 |
| `ui-update-prompt.json` | 🟢 | 🟢 | Phase 2 | UpdatePrompt | ✅ 完成 |
| `session.json` | 🟢 | 🟢 | Phase 3 | session.ts | ✅ 完成 |
| `prompt.json` | 🟢 | 🟢 | Phase 3 | prompt.ts | ✅ 完成 |
| `ui-config.json` | 🟢 | 🟢 | Phase 4 | ConfigDropdown | ✅ 完成 |
| `cli.tsx` (help text) | 🟢 | 🟢 | Phase 2 | cli.tsx | ✅ 完成 |

---

## Phase 1：基础设施（PR 1）

### 文件
- `src/common/i18n.ts`（新增）
- `locales/en/` 目录结构
- `locales/zh-CN/` 目录结构
- `src/ui/contexts/i18n.tsx`（新增）
- `src/settings.ts`（修改）
- `src/cli.tsx`（修改）
- `scripts/check-i18n.mjs`（新增）

### 任务

- [x] 创建 `src/common/i18n.ts`
  - 导出 `Locale`、`TranslationKey`（`import type enMessages from "../../locales/en/..."`）
  - 实现 `initI18n()` — 读取 `locales/{locale}/` 目录下所有 `*.json`，展平合并
  - 实现 `t(key, params?, localeOverride?)` — 支持跨 locale 翻译
  - 实现 `loadLocaleDir()` + `flattenKeys()` — 多文件合并加载
  - 实现 `resetI18n()` — 测试用重置
  - 存储 `currentLocale` / `thinkingLocale` / `replyLocale` 三个全局状态
  - 导出 `getThinkingLocale()` / `getReplyLocale()` / `setThinkingLocale()` / `setReplyLocale()`
- [x] 创建 `locales/en/` 目录和空的模块占位 JSON 文件
- [x] 创建 `locales/zh-CN/` 目录（镜像 en/ 结构）
- [x] 启用 `tsconfig.json` 的 `resolveJsonModule`
- [x] 创建 `scripts/check-i18n.mjs` + `npm run check:i18n` — 校验 `en/` 下所有文件 key 一致
- [x] 修改 `src/settings.ts`
  - `DeepcodingSettings` 增加 `locale?` / `thinkingLocale?` / `replyLocale?`
  - `ResolvedDeepcodingSettings` 增加对应三个解析字段
  - 环境变量支持：`DEEPCODE_LOCALE` / `DEEPCODE_THINKING_LOCALE` / `DEEPCODE_REPLY_LOCALE`
- [x] 创建 `src/ui/contexts/i18n.tsx`
  - `I18nProvider` 包裹 App 根节点
  - 扩展 context value：`{ t, locale, setLocale, thinkingLocale, replyLocale, setThinkingLocale, setReplyLocale }`
  - `useI18n()` hook
- [x] 修改 `src/cli.tsx`：启动时 `initI18n(settings.locale, { thinkingLocale, replyLocale })`
- [x] 更新 `package.json` `files` 字段：添加 `"locales/**"`
- **验证**:
  - `initI18n("en")` → `loadLocaleDir("en")` 正确合并所有模块文件
  - `t("ui.loading.thinking")` → `"Thinking..."`
  - `t("prompt.thinkingLanguageInstruction", undefined, "en")` → 英文指令
  - 缺失 key 返回 key 自身；目录缺失静默降级
- **回滚**: 删除新增文件 + 恢复 `settings.ts`/`cli.tsx` + 移除 `resolveJsonModule`

---

## Phase 2：UI 字符串替换（PR 2）

### 模块 2-1：MessageView

**文件**: `locales/{lang}/ui-message-view.json` | `MessageView/index.tsx` + `utils.ts`

- [x] 创建 `en/ui-message-view.json`（9 keys）
- [x] 创建 `zh-CN/ui-message-view.json`
- [x] `MessageView/index.tsx` — 使用 `useI18n()` 的 `t()` 替换 "Thinking" → `t("ui.messageView.thinking")`、"(reasoning...)"、"(no content)"、"(conversation summary inserted)"、"Loaded skill"、"Changes/Plan/Result"、"Tool"
- [x] `MessageView/utils.ts` — 直接 import 全局 `t()` 替换 `renderMessageToStdout` 中的字符串

### 模块 2-2：PromptInput

**文件**: `locales/{lang}/ui-prompt-input.json` | `PromptInput.tsx`

- [x] 创建 `en/ui-prompt-input.json`（~20 keys）
- [x] 创建 `zh-CN/ui-prompt-input.json`
- [x] 使用 `useI18n()` 的 `t()` 替换 footer、setStatusMessage、粘贴提示等 ~20 处字符串

### 模块 2-3：App

**文件**: `locales/{lang}/ui-app.json` | `App.tsx`

- [x] 创建 `en/ui-app.json`（~15 keys）
- [x] 创建 `zh-CN/ui-app.json`
- [x] 使用 `useI18n()` 的 `t()` 替换 Error:、Interrupted.、Killed processes、Model settings、session 提示等

### 模块 2-4：loadingText

**文件**: `locales/{lang}/ui-loading.json` | `loadingText.ts`

- [x] 创建 `en/ui-loading.json`（2 keys）
- [x] 创建 `zh-CN/ui-loading.json`
- [x] import 全局 `t()` 替换 "Thinking..."、"Thinking... ({elapsed}s)"

### 模块 2-5：exitSummary

**文件**: `locales/{lang}/ui-exit-summary.json` | `exitSummary.ts`

- [x] 创建 `en/ui-exit-summary.json`（6 keys）
- [x] 创建 `zh-CN/ui-exit-summary.json`
- [x] import 全局 `t()` 替换 "Goodbye!"、表格列头

### 模块 2-6：WelcomeScreen

**文件**: `locales/{lang}/ui-welcome.json` | `WelcomeScreen.tsx`

- [x] 创建 `en/ui-welcome.json`
- [x] 创建 `zh-CN/ui-welcome.json`
- [x] 替换快捷键提示文本

### 模块 2-7：McpStatusList

**文件**: `locales/{lang}/ui-mcp.json` | `McpStatusList.tsx`

- [x] 创建 `en/ui-mcp.json`
- [x] 创建 `zh-CN/ui-mcp.json`
- [x] 替换视图模式名、状态标签

### 模块 2-8：slashCommands

**文件**: `locales/{lang}/ui-slash-commands.json` | `slashCommands.ts`

- [x] 创建 `en/ui-slash-commands.json`
- [x] 创建 `zh-CN/ui-slash-commands.json`
- [x] 替换命令描述文案

### 模块 2-9：SessionList

**文件**: `locales/{lang}/ui-session-list.json` | `SessionList.tsx`

- [x] 创建 `en/ui-session-list.json`
- [x] 创建 `zh-CN/ui-session-list.json`
- [x] 替换标题、空状态文案

### 模块 2-10：AskUserQuestionPrompt

**文件**: `locales/{lang}/ui-ask-question.json` | `AskUserQuestionPrompt.tsx`

- [x] 创建 `en/ui-ask-question.json`
- [x] 创建 `zh-CN/ui-ask-question.json`
- [x] 替换按钮、提示文案

### 模块 2-11：ProcessStdoutView

**文件**: `locales/{lang}/ui-process-stdout.json` | `ProcessStdoutView.tsx`

- [x] 创建 `en/ui-process-stdout.json`
- [x] 创建 `zh-CN/ui-process-stdout.json`
- [x] 替换标题栏、进程信息文案

### 模块 2-12：UpdatePrompt

**文件**: `locales/{lang}/ui-update-prompt.json` | `UpdatePrompt.tsx`

- [x] 创建 `en/ui-update-prompt.json`
- [x] 创建 `zh-CN/ui-update-prompt.json`
- [x] 替换计划显示文案

### 模块 2-13：cli.tsx

**文件**: `locales/{lang}/cli-help.json` | `cli.tsx`

- [x] 创建 `en/cli-help.json`
- [x] 创建 `zh-CN/cli-help.json`
- [x] 替换 `--help` 全部输出文本为翻译

### 测试

- [x] 所有测试调用 `initI18n("en")` 或 mock `t()`

---

## Phase 3：Prompt 模板 + 语言指令（PR 3）

### 模块 3-1：session

**文件**: `locales/{lang}/session.json` | `session.ts`

- [x] 创建 `en/session.json`（2 keys）
- [x] 创建 `zh-CN/session.json`
- [x] 通过 `SessionManagerOptions.t`（类型 `TranslationKey`）注入翻译，替换 "compacting"、"skillPromptHeader"

### 模块 3-2：prompt

**文件**: `locales/{lang}/prompt.json` | `prompt.ts`

- [x] 创建 `en/prompt.json`（4 keys）
- [x] 创建 `zh-CN/prompt.json`
- [x] `getSystemPrompt()` 末尾追加两条语言指令：
  - `t("prompt.thinkingLanguageInstruction", undefined, getThinkingLocale())`
  - `t("prompt.replyLanguageInstruction", undefined, getReplyLocale())`
- [x] `getCurrentDateAndModelPrompt()` 使用 `t("prompt.dateAndModel")` + locale 日期格式
- [x] `getDefaultSkillPrompt()` 使用 `t("prompt.skillDocumentsHeader")`

### EJS 模板

- [x] 创建 `templates/prompts/system-prompt.en.md.ejs`
- [x] 创建 `templates/prompts/system-prompt.zh-CN.md.ejs`
- [x] 创建 `templates/prompts/compact-prompt.en.md.ejs`
- [x] 创建 `templates/prompts/compact-prompt.zh-CN.md.ejs`

---

## Phase 4：/config 命令（PR 4）

### 模块 4-1：ConfigDropdown

**文件**: `locales/{lang}/ui-config.json` | `ConfigDropdown.tsx`

- [x] 创建 `en/ui-config.json`（5 keys）
- [x] 创建 `zh-CN/ui-config.json`
- [x] 创建 `ConfigDropdown.tsx` — 三项语言选择（UI 语言、推理语言、回复语言；后两项默认折叠为 "Advanced"）

### slashCommands

- [x] `slashCommands.ts` 注册 `config` 命令类型和内置条目

### PromptInput

- [x] 增加 `showConfigDropdown` 状态
- [x] 增加 `onLocaleChange`、`onThinkingLocaleChange`、`onReplyLocaleChange` props
- [x] 处理 `/config locale|thinkingLocale|replyLocale <value>` 参数模式（`/^\/config\s/`）
- [x] 渲染 ConfigDropdown 组件

### App.tsx

- [x] 三个 locale 变更回调 → 刷新 `<Static>` 消息 + 欢迎屏

---

## 代码审查发现的问题（2026-05-22）

### 🔴 Bug
- `src/common/i18n.ts:getExtensionRoot()` 第 38 行存在不可达代码（死代码），应删除

### 🟡 需要修复
1. **McpStatusList 视图比较**（`McpStatusList.tsx:16,58`）：`viewMode === t("ui.mcp.serverDetail")` 使用翻译字符串做状态比较，切换 locale 后会失效。应使用固定字符串 `"server-detail"`。
2. **遗漏的 t() 调用（session.ts）**：
   - `activateSession()` 中第 1083, 1089, 1240, 1256 行的硬编码英文应改用 `t()`
3. **遗漏的 t() 调用（App.tsx）**：
   - `handleModelConfigChange()` 中第 243, 349, 380 行的硬编码应改用 `t()`
   - `handleUndoRestore()` 中第 460, 469 行的硬编码应改用 `t()`
   - `buildStatusLine()` 中第 808-813 行的硬编码应改用 `t()`
4. **遗漏的 t() 调用（cli.tsx）**：第 84 行非 TTY 错误消息未翻译
5. **session.skillPromptHeader 未使用**：`session.ts` 第 987 行硬编码 "Use the skill document below..."，应改用 `t("session.skillPromptHeader")`
6. **ui.slashCommands.continueDesc 未使用**：`slashCommands.ts` 第 62 行硬编码，应改用 `t("ui.slashCommands.continueDesc")`

### 🟢 无问题
- 所有 `t()` 调用均指向有效的 key（代码中无悬挂引用）
- `cli.help.*`（35个 key）、`ui.messageView.*`（10个）、`ui.exitSummary.*`（6个）、`ui.loading.*`（2个）、`prompt.*`（4个）使用率均为 100%
- `npm run check` 全部通过
- `npm run check:i18n` 全部 140 个 key 匹配

---

## 已知限制

- Ink `<Static>` 不会重渲染已挂载消息，语言切换后历史消息保持旧语言
- 中间会话切换 locale 只影响新 UI/新提示词，已有历史不回溯翻译
- LLM 的输出语言控制是"软约束"——LLM 可能不完全遵守语言指令，但实践中大多数模型会遵循
## 二阶段发现的遗漏项（2026-05-23）

> 以下是代码审查中发现的**仍在硬编码的字符串**，涉及 10+ 个组件文件。
> 这些字符串需要新增 translation key 到 `locales/{lang}/index.json`，然后在源码中替换为 `t()` 调用。

### 1. ModelsDropdown (`/model` 命令二级页面) — 完全未翻译

**文件**: `src/ui/components/ModelsDropdown/index.tsx`

| 行号 | 硬编码文本 | 建议 key |
|------|-----------|---------|
| 17 | `"Thinking mode [max]"` | `ui.modelsDropdown.thinkingMax` |
| 18 | `"Thinking mode [high]"` | `ui.modelsDropdown.thinkingHigh` |
| 19 | `"No thinking"` | `ui.modelsDropdown.noThinking` |
| 141 | `"current model"` | `ui.modelsDropdown.currentModel` |
| 147 | `` reasoningEffort: ${option.reasoningEffort} `` | `ui.modelsDropdown.reasoningEffort` |
| 147 | `"thinking disabled"` | `ui.modelsDropdown.thinkingDisabled` |
| 154 | `"Select Model"` | `ui.modelsDropdown.selectModel` |
| 154 | `"Select Thinking Mode"` | `ui.modelsDropdown.selectThinkingMode` |
| 155 | `"Space/Enter select model · Esc to cancel"` | `ui.modelsDropdown.selectModelHelp` |
| 155 | `"Space/Enter apply · Esc to cancel"` | `ui.modelsDropdown.applyHelp` |

### 2. RawModelDropdown (`/raw` 命令二级页面) — 完全未翻译

**文件**: `src/ui/components/RawModelDropdown/index.tsx` + `src/ui/contexts/RawModeContext.tsx`

| 行号 | 硬编码文本 | 建议 key |
|------|-----------|---------|
| 43 | `"Select mode"` | `ui.rawModelDropdown.title` |
| 45 | `"Space/Enter select mode · Esc to close"` | `ui.rawModelDropdown.helpText` |
| RawModeContext:11 | `"Lite mode"` (label) | `ui.rawModelDropdown.liteMode` |
| RawModeContext:12 | `"Lite mode"` (RawMode.Lite enum) | 枚举值用作标识符，不可翻译 |
| RawModeContext:13 | `"Collapse chain-of-thought reasoning."` (description) | `ui.rawModelDropdown.liteDesc` |
| RawModeContext:16 | `"Normal mode"` (label) | `ui.rawModelDropdown.normalMode` |
| RawModeContext:18 | `"Show full chain-of-thought reasoning."` (description) | `ui.rawModelDropdown.normalDesc` |
| RawModeContext:21 | `"Raw scrollback mode"` (label) | `ui.rawModelDropdown.rawScrollbackMode` |
| RawModeContext:23 | `"Show scrollback mode for copy-friendly terminal selection."` (description) | `ui.rawModelDropdown.rawDesc` |

### 3. SkillsDropdown (`/skills` 命令二级页面) — 完全未翻译

**文件**: `src/ui/components/SkillsDropdown/index.tsx`

| 行号 | 硬编码文本 | 建议 key |
|------|-----------|---------|
| 57 | `"Select Skills"` | `ui.skillsDropdown.title` |
| 58 | `"Space toggle · Enter toggle · Esc to close"` | `ui.skillsDropdown.helpText` |
| 59 | `"No skills found"` | `ui.skillsDropdown.emptyText` |

### 4. FileMentionMenu (`@` 文件菜单) — 完全未翻译

**文件**: `src/ui/components/FileMentionMenu/index.tsx`

| 行号 | 硬编码文本 | 建议 key |
|------|-----------|---------|
| 87 | `"Mention File"` | `ui.fileMentionMenu.title` |
| 88 | `"Enter/Tab insert · Esc close"` | `ui.fileMentionMenu.helpText` |
| 89 | `"No matching files"` | `ui.fileMentionMenu.noMatching` |
| 89 | `"Type after @ to search files"` | `ui.fileMentionMenu.typeHint` |
| 93 | `"directory"` | `ui.fileMentionMenu.directory` |
| 93 | `"file"` | `ui.fileMentionMenu.file` |

### 5. DropdownMenu（通用组件）— 部分未翻译

**文件**: `src/ui/DropdownMenu.tsx`

| 行号 | 硬编码文本 | 建议 key |
|------|-----------|---------|
| 71 | `"No items found"` | `ui.dropdownMenu.emptyText` |
| 138 | `"above"`（参数化：`… {n} above`） | `ui.dropdownMenu.above` |
| 174 | `"more"`（参数化：`… {n} more`） | `ui.dropdownMenu.more` |

### 6. SlashCommandMenu — 剩余未翻译

**文件**: `src/ui/SlashCommandMenu.tsx`

| 行号 | 硬编码文本 | 建议 key |
|------|-----------|---------|
| 77 | `"({current}/{total}) ↑↓ to navigate · Enter to select"` | `ui.slashCommandMenu.footerHelp` |

### 7. McpStatusList (`/mcp` 命令二级页面) — 遗漏翻译

**文件**: `src/ui/McpStatusList.tsx`

| 行号 | 硬编码文本 | 建议 key |
|------|-----------|---------|
| 45, 195 | `"Manage MCP servers"` | `ui.mcp.manageTitle` |
| 47 | `"0 servers"` | `ui.mcp.zeroServers` |
| 50 | `"No MCP servers configured."` | `ui.mcp.noServersConfigured` |
| 51 | `"Add MCP servers to your settings to get started."` | `ui.mcp.addServersHint` |
| 53 | `"Esc to close"` | `ui.mcp.escToClose` |
| 244 | `"servers above."`（参数化） | `ui.mcp.serversAbove` |
| 246 | `"servers below."`（参数化） | `ui.mcp.serversBelow` |
| 292 | `"tools, prompts, resources"` 计数标签 | 转为 ${t("...")} 调用 |
| 458 | `` ${server.toolCount} tools, ${server.promptCount} prompts, ${server.resourceCount} resources `` | `ui.mcp.itemCounts` |
| 459 | `` `Status: ${server.status}` `` | `ui.mcp.statusPrefix` |

### 8. SessionList (`/resume`/`/continue` 命令二级页面) — 遗漏翻译

**文件**: `src/ui/SessionList.tsx`

| 行号 | 硬编码文本 | 建议 key |
|------|-----------|---------|
| 162 | `"Press Esc to go back."` | `ui.sessionList.escBack` |
| 185 | `"total"` | `ui.sessionList.total` |
| 186 | `", {n} matched"`（参数化） | `ui.sessionList.matched` |
| 213 | `'No sessions match "{query}".'`（参数化） | `ui.sessionList.noMatch` |
| 229 | `"Untitled"` | `ui.sessionList.untitled` |
| 243 | `"sessions above."`（参数化） | `ui.sessionList.above` |
| 245 | `"sessions below."`（参数化） | `ui.sessionList.below` |
| 253-259 | Footer 帮助文本 | `ui.sessionList.footerHelp` |
| 284-301 | `formatSessionStatus()` 状态值 | `ui.sessionList.statusDone`/`Running`/`Pending`/`Waiting`/`Failed`/`Stopped` |

### 9. UndoSelector (`/undo` 命令二级页面) — 几乎完全未翻译

**文件**: `src/ui/UndoSelector.tsx`

| 行号 | 硬编码文本 | 建议 key |
|------|-----------|---------|
| 86 | `"Nothing to undo yet."` | `ui.undoSelector.nothingYet` |
| 87 | `"Press Esc to go back."` | `ui.undoSelector.escBack` |
| 104 | `"Undo"` | `ui.undoSelector.title` |
| 106 | `"restore to the point before a prompt"` | `ui.undoSelector.subtitle` |
| 133 | `"code checkpoint available"` | `ui.undoSelector.checkpointAvailable` |
| 133 | `"conversation only"` | `ui.undoSelector.conversationOnly` |
| 153 | `"Selected prompt:"` | `ui.undoSelector.selectedPrompt` |
| 157 | `"Restore code and conversation"` | `ui.undoSelector.restoreCodeAndConversation` |
| 164 | `"Restore conversation"` | `ui.undoSelector.restoreConversation` |
| 166 | `"Fork the conversation without changing files."` | `ui.undoSelector.forkConversation` |
| 173-174 | Footer 帮助文本（两种 phase） | `ui.undoSelector.footerMessage` + `ui.undoSelector.footerMode` |
| 183 | `"(empty message)"` | `ui.undoSelector.emptyMessage` |

### 10. ProcessStdoutView (Ctrl+O 全屏) — 遗漏翻译

**文件**: `src/ui/ProcessStdoutView.tsx`

| 行号 | 硬编码文本 | 建议 key |
|------|-----------|---------|
| 56 | `"(no running processes)"` | `ui.processStdout.noRunning` |
| 85 | `"lines above/scroll/total"` 滚动提示 | `ui.processStdout.scrollHint` |
| 137 | `"📟 Process Output"` | `ui.processStdout.title` |
| 138-140 | Footer 操作提示 | `ui.processStdout.footerHelp` |
| 174 | `"timeout unavailable"` | `ui.processStdout.timeoutUnavailable` |
| 176 | `"timeout {duration}"` | `ui.processStdout.timeoutHint` |
| 183 | `"Timeout set to {duration}"` | `ui.processStdout.timeoutSet` |

---

## 已解决的已知问题

- `exitSummary.ts` 的 `visibleLength()` 未处理 CJK 双倍宽度字符（现有 bug）→ **已缓解**：新增 `display-width.ts`，但 `exitSummary.ts` 尚未改用（仅视觉偏移，不影响功能）
- **CJK 视觉宽度导致的布局截断** → **已修复**：`DropdownMenu.tsx` 和 `SlashCommandMenu.tsx` 改用 `displayWidth()` 替代 `String.length` 计算列宽
- Tool 文档（`templates/tools/`）保持英文，不翻译（发给 LLM 使用）

---

## Key 使用审计（2026-05-22）

> 通过对照 `en/index.json` 定义的所有 key 与源代码中 `t()` 调用进行扫描比对。

### 总览

| 类别 | 数量 | 占比 |
|------|------|------|
| 已定义且使用的 key | 105 | 75% |
| 已定义但未使用的 key | 35 | 25% |
| 代码调用但未定义的 key | 0 | 0% |

### 各模块使用率

| 模块 | 定义数 | 使用数 | 使用率 | 状态 |
|------|--------|--------|--------|------|
| `cli.help.*` | 35 | 35 | 100% | ✅ |
| `ui.messageView.*` | 10 | 10 | 100% | ✅ |
| `ui.exitSummary.*` | 6 | 6 | 100% | ✅ |
| `ui.loading.*` | 2 | 2 | 100% | ✅ |
| `prompt.*` | 4 | 4 | 100% | ✅ |
| `session.compacting` | 1 | 1 | 100% | ✅ |
| `ui.config.*` | 10 | 7 | 70% | ⚠️ |
| `ui.slashCommands.*` | 12 | 11 | 92% | ⚠️ |
| `ui.welcome.*` | 7 | 6 | 86% | ⚠️ |
| `ui.mcp.*` | 7 | 5 | 71% | ⚠️ |
| `ui.promptInput.*` | 19 | 14 | 74% | ⚠️ |
| `ui.app.*` | 16 | 3 | 19% | 🔴 |
| `ui.askUserQuestion.*` | 3 | 0 | 0% | 🔴 |
| `ui.processStdout.*` | 4 | 0 | 0% | 🔴 |
| `ui.sessionList.*` | 2 | 0 | 0% | 🔴 |
| `ui.updatePrompt.*` | 1 | 0 | 0% | 🔴 |
| `session.skillPromptHeader` | 1 | 0 | 0% | 🔴 |

### 未使用的 Key 及原因

| Key | 原因 |
|-----|------|
| `ui.app.error` | App.tsx 第 674 行硬编码 `"Error: "` 前缀 |
| `ui.app.statusStatus` | App.tsx 第 808 行硬编码 `` `status: ${entry.status}` `` |
| `ui.app.statusTokens` | App.tsx 第 810 行硬编码 `` `tokens: ${entry.activeTokens}` `` |
| `ui.app.statusFail` | App.tsx 第 813 行硬编码 `` `fail: ${entry.failReason}` `` |
| `ui.app.modelUnchanged` | App.tsx 第 349 行硬编码 |
| `ui.app.modelUpdated` | App.tsx 第 380 行硬编码 |
| `ui.app.noActiveSession` | App.tsx 第 243, 449 行硬编码 |
| `ui.app.codeRestoreFailed` | App.tsx 第 460 行硬编码 |
| `ui.app.conversationRestoreFailed` | App.tsx 第 469 行硬编码 |
| `ui.app.sessionDefaultSummary` | session.ts 第 925 行硬编码 |
| `ui.app.sessionAgentSteps` | session.ts 第 1240 行硬编码 |
| `ui.app.apiKeyNotFound` | session.ts 第 1089 行硬编码 |
| `ui.app.requestFailed` | session.ts 第 1256 行硬编码 |
| `ui.config.languageUpdated` | 未在任何 t() 中调用 |
| `ui.config.thinkingLanguageUpdated` | 未在任何 t() 中调用 |
| `ui.config.replyLanguageUpdated` | 未在任何 t() 中调用 |
| `ui.welcome.deepCodeTitle` | 可能未在 WelcomScreen 中使用 |
| `ui.mcp.serverList` | McpStatusList 使用字面量 `"server-list"` |
| `ui.mcp.statusConnecting` | McpStatusList 字面量 |
| `ui.slashCommands.continueDesc` | slashCommands.ts 第 62 行硬编码英文 |
| `ui.sessionList.title` | SessionList 硬编码 |
| `ui.sessionList.empty` | SessionList 硬编码 |
| `ui.askUserQuestion.submit` | AskUserQuestionPrompt 硬编码 |
| `ui.askUserQuestion.cancel` | AskUserQuestionPrompt 硬编码 |
| `ui.askUserQuestion.selectOption` | AskUserQuestionPrompt 硬编码 |
| `ui.processStdout.title` | ProcessStdoutView 硬编码 |
| `ui.processStdout.running` | ProcessStdoutView 硬编码 |
| `ui.processStdout.adjustTimeout` | ProcessStdoutView 硬编码 |
| `ui.processStdout.noOutput` | ProcessStdoutView 硬编码 |
| `ui.updatePrompt.planHeader` | UpdatePrompt 硬编码 |
| `session.skillPromptHeader` | session.ts 第 987 行硬编码 |
| `ui.promptInput.footerBusy` | PromptInput 动态拼接 |
| `ui.promptInput.ctrlOViewOutput` | PromptInput 动态拼接 |
| `ui.promptInput.ctrlOExpand` | PromptInput 动态拼接 |
| `ui.promptInput.ctrlOCollapse` | PromptInput 动态拼接 |
| `ui.promptInput.imageCount` | PromptInput 动态拼接 |
