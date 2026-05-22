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

## 已知限制

- Ink `<Static>` 不会重渲染已挂载消息，语言切换后历史消息保持旧语言
- 中间会话切换 locale 只影响新 UI/新提示词，已有历史不回溯翻译
- LLM 的输出语言控制是"软约束"——LLM 可能不完全遵守语言指令，但实践中大多数模型会遵循
- `exitSummary.ts` 的 `visibleLength()` 未处理 CJK 双倍宽度字符（现有 bug）
- Tool 文档（`templates/tools/`）保持英文，不翻译（发给 LLM 使用）
