# i18n 支持方案 v7（经过第6轮 Review — 最终版）

> **Review 6 发现与修正（综合审计）**:
> 1. **回滚方案**：每个 Phase 需明确回滚步骤；Phase 1 最安全，Phase 2 风险最高（13+ 文件）
> 2. **验证策略细化**：Phase 1 应验证 `t("ui.loading.thinking")` 返回正确字符串而非 key 自身
> 3. **esbuild ESM 的 `__dirname`**：`i18n.ts` 的 `loadLocaleFile` 必须使用与 `prompt.ts` 相同的 `typeof __dirname !== "undefined" ? ... : fileURLToPath(import.meta.url)`  fallback，因为 esbuild bundler 打包 ESM 时不提供 `__dirname`
> 4. **`tsconfig.json` 需启用 `resolveJsonModule`**：`import type en` 需要该选项；否则 `npm run typecheck` 会失败
> 5. **`npm run check:i18n` 实现**：一个 Node.js 脚本，读取 `en.json` 所有 key 后逐级与 `zh-CN.json` 比对，输出缺失 key
> 6. **`prompt.ts` 函数签名无需改**：`getSystemPrompt`/`getCompactPrompt` 内部调用 `getLocale()` 选择模板，不改变外部接口
> 7. **i18n 方案文档存放位置**：`i18n-plan.md` 和 `i18n-todo.md` 已放置在 `.deepcode/` 目录下，作为开发参考

> **Review 5 发现与修正（安全性 & 一致性）**:
> 1. **`TranslationKey` import 路径**：从 `src/common/i18n.ts` 到 `locales/en.json` 应为 `../../locales/en.json`（修复写为 `../../../` 的错误）
> 2. **`/config` 参数精确匹配**：使用 `/^\/config\s+/` 正则而非 `startsWith("/config ")`，避免误匹配 `/configxxx`
> 3. **`en` 自身 locale 跳过 fallback**：当前 locale 为 `"en"` 时只查当前表，避免冗余二次查找
> 4. **`PromptInput` 必须消费 `useI18n()`**：`footerText` 等字符串需通过 context 获取 `t()` 才能响应 locale 切换
> 5. **EJS 提示词模板命名**：统一为 `system-prompt.{locale}.md.ejs` 模式，根据 `getLocale()` 选择加载
> 6. **`MessageView/utils.ts` 直接 import 全局 `t()`**：纯函数模块无法使用 React context，直接 import `src/common/i18n`
> 1. **`TranslationKey` 类型推导**：用 `import type en from "../../locales/en.json"` + `keyof typeof en` 替代手动维护的 union type，避免三方同步
> 2. **`SessionManagerOptions.t` 类型**：应使用 `TranslationKey` 而非 `string`，保留类型安全
> 3. **`App` → `PromptInput` → `ConfigDropdown` 回调链**：需新增 `onLocaleChange` prop 传递 locale 切换事件
> 4. **Tool 文档翻译决策**：`templates/tools/` 下的工具描述保持英文（发给 LLM 使用），不需要翻译
> 5. **`loadingText.ts` 测试影响**：测试需 `initI18n("en")` 否则 `t()` 返回 key 字符串，现有断言会失败
> 6. **`exitSummary.ts` 异常路径**：退出时确保 i18n 已初始化，或使用 `getLocale()` 兜底检查

> **Review 2 发现与修正**:
> 1. 用 React Context (`I18nContext`) 替代 `key={locale}` remount 方案，避免状态丢失
> 2. locale 切换时刷新已渲染消息（通过 `setWelcomeNonce` + `reloadActiveSessionView`）
> 3. 非 React 模块直接 import 全局 `t()`，React 组件通过 context 获取
> 4. 增加翻译 key 类型导出，提升 TypeScript 安全性
> 5. 注明中间会话 locale 切换的行为边界

> **Review 1 发现与修正**:
> 1. 补充了 `WelcomeScreen`、`AskUserQuestionPrompt`、`ProcessStdoutView`、`McpStatusList`、`UpdatePrompt`、`SessionList` 的覆盖清单
> 2. 明确 esbuild 打包策略：locales/ 通过 `package.json` `files` 字段发布，运行时通过 `__dirname` 读取 JSON
> 3. `session.ts` 改为通过 `SessionManagerOptions` 注入 `t` 函数，避免直接耦合
> 4. 系统提示词改用 EJS 模板按 locale 加载（`templates/prompts/`）
> 5. `/config` 增加参数支持（如 `/config locale en`）

## 1. 总体目标

为 CLI 提供多语言支持（至少 en / zh-CN），覆盖以下四个维度：

| 维度 | 内容 | 策略 |
|------|------|------|
| **UI** | Ink 组件渲染的静态文本（标签、状态、提示、帮助、错误消息） | 用 `t()` 翻译 |
| **Prompt** | 发给 LLM 的系统提示词（`SYSTEM_PROMPT_BASE`、`COMPACT_PROMPT_BASE`、日期/模型信息等） | 用 `t()` 翻译 + locale-specific EJS 模板 |
| **Thinking** | ① UI 中推理区域的标签文字（"Thinking" / "思考"）<br>② LLM 的 **`reasoning_content`** 输出语言 | ① `t("ui.messageView.thinking")` 翻译标签<br>② `thinkingLocale` 配置 → 系统提示词追加 `t("prompt.thinkingLanguageInstruction")` |
| **Reply** | ① UI 中回复区域的前缀/标签（`✦` 等）<br>② LLM 的 **`content`** 输出语言 | ① `t()` 翻译 UI 标签（若有）<br>② `replyLocale` 配置 → 系统提示词追加 `t("prompt.replyLanguageInstruction")` |

**核心机制**：在系统提示词末尾追加两条独立语言指令，分别控制推理和回复的输出语言。例如 `thinkingLocale=zh-CN, replyLocale=en` 时：

```
IMPORTANT: Your reasoning and thinking process should be in Chinese.
IMPORTANT: Always respond to the user in English.
```

**重要区分：UI 标签 vs LLM 输出语言**

UI 中推理和回复区域的标签文字（"Thinking" / "思考"、`✦` 前缀等）**始终跟随主 `locale`**，通过 `t()` 翻译。`thinkingLocale` 和 `replyLocale` **仅**控制系统提示词中追加的语言指令，从而引导 LLM 输出的 `reasoning_content` 和 `content` 的语言。

```
UI 显示：
  locale=zh-CN → 推理标签="思考", 回复前缀="✦"          ← 从 zh-CN/ 目录翻译
  locale=en    → 推理标签="Thinking", 回复前缀="✦"       ← 从 en/ 目录翻译

LLM 输出语言：
  thinkingLocale=zh-CN → LLM reasoning_content 用中文   ← 系统提示词指令
  thinkingLocale=en    → LLM reasoning_content 用英文   ← 系统提示词指令
  replyLocale=zh-CN    → LLM content 用中文             ← 系统提示词指令
  replyLocale=en       → LLM content 用英文             ← 系统提示词指令
```

各维度的 locale 来源：

```
locale         → 控制 UI + Prompt 模板语言（必须有效 locale）
thinkingLocale → 控制 LLM reasoning_content 语言（默认 = locale）
replyLocale    → 控制 LLM content 语言（默认 = locale）
```

这种设计让用户可以灵活组合：推理用中文（模型中文推理更深）、回复用英文（输出给英文用户）。

**四维度翻译范围对比**：
```
                  UI 标签翻译    Prompt 模板    thinkingLocale    replyLocale
─────────────────────────────────────────────────────────────────────────────
UI               ✅ t()           —              —                —
Prompt           —               ✅ t()+EJS      —                —
Thinking（推理）  ✅ t()标签       —              ✅ 指令           —
Reply（回复）     ✅ t()标签       —              —                ✅ 指令
```

## 2. 文件结构

翻译文件按模块拆分，每个模块一个 JSON 文件，存放在对应语言的目录下。运行时自动合并加载。

```
deepcode-cli/
├── locales/                          # 新增
│   ├── en/                           # 英文翻译（fallback 默认）
│   │   ├── ui-message-view.json      # 消息视图标签（Thinking, reasoning 等）
│   │   ├── ui-prompt-input.json      # 输入框提示、状态消息
│   │   ├── ui-app.json               # 应用层消息（Error, Interrupted 等）
│   │   ├── ui-loading.json           # 加载状态文字
│   │   ├── ui-exit-summary.json      # 退出摘要
│   │   ├── ui-welcome.json           # 欢迎页快捷键提示
│   │   ├── ui-mcp.json               # MCP 状态页
│   │   ├── ui-slash-commands.json    # / 命令描述
│   │   ├── ui-session-list.json      # 会话列表
│   │   ├── ui-ask-question.json      # 问题提示
│   │   ├── ui-process-stdout.json    # 进程输出视图
│   │   ├── ui-update-prompt.json     # UpdatePlan 显示
│   │   ├── ui-config.json            # /config 命令 UI
│   │   ├── cli-help.json             # CLI --help 文本
│   │   ├── session.json              # session.ts 运行时提示
│   │   └── prompt.json               # 系统提示词相关
│   └── zh-CN/                        # 中文翻译（同名文件，结构与 en/ 镜像）
│       ├── ui-message-view.json
│       └── ...
├── src/
│   ├── common/
│   │   └── i18n.ts                   # 新增 - i18n 核心模块
│   ├── ui/
│   │   └── components/
│   │       └── ConfigDropdown.tsx    # 新增 - /config 命令 UI
│   └── ... (既有文件修改)
```

### 模块文件清单

| # | 文件名 | 用途 | 所属 Phase | key 前缀 | 预计 key 数 |
|---|--------|------|-----------|---------|-----------|
| 1 | `ui-message-view.json` | MessageView 标签文字 | Phase 2 | `ui.messageView.*` | 9 |
| 2 | `ui-prompt-input.json` | PromptInput 状态/提示 | Phase 2 | `ui.promptInput.*` | 20 |
| 3 | `ui-app.json` | App.tsx 错误/状态消息 | Phase 2 | `ui.app.*` | 15 |
| 4 | `ui-loading.json` | 加载状态文字 | Phase 2 | `ui.loading.*` | 2 |
| 5 | `ui-exit-summary.json` | 退出摘要 | Phase 2 | `ui.exitSummary.*` | 6 |
| 6 | `ui-welcome.json` | 欢迎页快捷键 | Phase 2 | `ui.welcome.*` | ~8 |
| 7 | `ui-mcp.json` | MCP 状态页文案 | Phase 2 | `ui.mcp.*` | ~10 |
| 8 | `ui-slash-commands.json` | / 命令描述 | Phase 2 | `ui.slashCommands.*` | ~10 |
| 9 | `ui-session-list.json` | 会话列表文案 | Phase 2 | `ui.sessionList.*` | ~5 |
| 10 | `ui-ask-question.json` | 问题提示文案 | Phase 2 | `ui.askUserQuestion.*` | ~5 |
| 11 | `ui-process-stdout.json` | 进程输出视图 | Phase 2 | `ui.processStdout.*` | ~5 |
| 12 | `ui-update-prompt.json` | UpdatePlan 显示 | Phase 2 | `ui.updatePrompt.*` | ~3 |
| 13 | `cli-help.json` | CLI --help 文本 | Phase 2 | `cli.help.*` | ~15 |
| 14 | `ui-config.json` | /config 命令 UI | Phase 4 | `ui.config.*` | 5 |
| 15 | `session.json` | session.ts 运行时提示 | Phase 3 | `session.*` | 2 |
| 16 | `prompt.json` | 系统提示词翻译 | Phase 3 | `prompt.*` | 4 |

## 3. 核心模块：`src/common/i18n.ts`

### 接口设计

```typescript
// i18n.ts

// 可用语言
export type Locale = "en" | "zh-CN";

// 所有翻译 key 的类型 — 从 locales/en/ 下所有模块 JSON 合并推导
// 可通过 locales/en/index.ts 聚合类型，或用构建脚本合并
// tsconfig.json 需启用 "resolveJsonModule": true
import type en from "../../locales/en/index.json";
export type TranslationKey = keyof typeof en;

// 运行时状态
let currentLocale: Locale = "en";
let thinkingLocale: Locale = "en";
let replyLocale: Locale = "en";
// localeCache: Map<Locale, Record<string, string>> 在 loadLocaleDir 内部维护

// 初始化：加载 locale 目录下所有模块 JSON
export function initI18n(locale: Locale, options?: { thinkingLocale?: Locale; replyLocale?: Locale }): void;

// 核心翻译函数，localeOverride 用于跨 locale 查找（系统提示词生成时使用）
export function t(key: TranslationKey, params?: Record<string, string | number>, localeOverride?: Locale): string;

// 获取/设置当前 UI locale
export function getLocale(): Locale;

// 获取/设置 LLM 推理语言
export function getThinkingLocale(): Locale;
export function setThinkingLocale(locale: Locale): void;

// 获取/设置 LLM 回复语言
export function getReplyLocale(): Locale;
export function setReplyLocale(locale: Locale): void;

// 测试用重置
export function resetI18n(): void;
```

### React Context 集成（替代 key={locale} remount）

```typescript
// src/ui/contexts/i18n.tsx
import React, { createContext, useContext, useState, useCallback } from "react";
import { initI18n, t, getLocale, type Locale } from "../../common/i18n";

type I18nContextValue = {
  t: typeof t;
  locale: Locale;
  setLocale: (locale: Locale) => void;
  thinkingLocale: Locale;
  replyLocale: Locale;
  setThinkingLocale: (locale: Locale) => void;
  setReplyLocale: (locale: Locale) => void;
};

const I18nContext = createContext<I18nContextValue>({
  t,
  locale: "en",
  setLocale: () => {},
  thinkingLocale: "en",
  replyLocale: "en",
  setThinkingLocale: () => {},
  setReplyLocale: () => {},
});

export function I18nProvider({ children, initialLocale, initialThinkingLocale, initialReplyLocale }:
  { children: React.ReactNode; initialLocale: Locale; initialThinkingLocale?: Locale; initialReplyLocale?: Locale }) {
  const [locale, setLocaleState] = useState(initialLocale);
  const [tLocale, setTLocaleState] = useState(initialThinkingLocale ?? initialLocale);
  const [rLocale, setRLocaleState] = useState(initialReplyLocale ?? initialLocale);

  const setLocale = useCallback((newLocale: Locale) => {
    initI18n(newLocale, { thinkingLocale: tLocale, replyLocale: rLocale });
    setLocaleState(newLocale);
  }, [tLocale, rLocale]);

  const setThinkingLocale = useCallback((locale: Locale) => {
    setTLocaleState(locale);
  }, []);

  const setReplyLocale = useCallback((locale: Locale) => {
    setRLocaleState(locale);
  }, []);

  return (
    <I18nContext.Provider value={{ t, locale, setLocale, thinkingLocale: tLocale, replyLocale: rLocale, setThinkingLocale, setReplyLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
```

React 组件统一从 context 获取 `t` 函数，非 React 模块直接 import `src/common/i18n.ts` 中的全局 `t()`。

### 非 React 模块使用方式

```typescript
// src/ui/loadingText.ts — 直接 import 全局 t()
import { t } from "../common/i18n";

export function buildLoadingText(input: LoadingTextInput): string {
  if (!progress) {
    return t("ui.loading.thinking");
  }
  // ...
}
```

### React 组件使用方式

```typescript
// src/ui/components/MessageView/index.tsx
import { useI18n } from "../../contexts/i18n";

function StatusLine({ name, params, ... }: Props) {
  const { t } = useI18n();
  const label = name === "Thinking" ? t("ui.messageView.thinking") : name;
  // ...
}
```

### 功能细节

1. **`initI18n(locale)`**: 
   - 读取 `locales/{locale}/` 目录下所有 `*.json` 文件
   - 将每个文件的嵌套 JSON 展开为扁平 key-value 结构并合并
   - 始终加载 `en/` 目录作为 fallback（未翻译的 key 回退到英文）
   - 设置 `currentLocale`

2. **`t(key, params?)`**:
   - 先查当前 locale 的 messages，找不到则查 fallback（en/）
   - 用简单的 `{placeholder}` 正则替换 params 中的值
   - 若 key 完全不存在，返回 key 本身（便于开发时发现缺失翻译）

3. **加载策略**:
   - 在 CLI 启动时（`src/cli.tsx` 的 `main()` 中）根据用户 locale 配置初始化
   - 通过 esbuild 将 locale JSON 打包进 dist（使用 `--loader:.json=json` 或 `fs.readFileSync` 运行时加载）

### 启动加载流程

```
main() 启动
  → resolveSettings() 获取 locale 配置
  → initI18n(locale)              // 通过 __dirname 读取 locales/{locale}/ 下所有 JSON
  → 注入 t 函数到 SessionManager   // new SessionManager({ ..., t: t })
  → render(<App/>)
```

### Locale JSON 加载策略

通过 `__dirname` 运行时读取目录下所有模块 JSON 并展平合并（而非静态 import），确保 esbuild 打包后仍能正确定位：

```typescript
// src/common/i18n.ts
function loadLocaleDir(locale: string): Record<string, string> {
  const localesDir = path.resolve(getExtensionRoot(), "locales", locale);
  if (!fs.existsSync(localesDir)) {
    return {};
  }
  const merged: Record<string, string> = {};
  const files = fs.readdirSync(localesDir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  for (const file of files) {
    const content = JSON.parse(fs.readFileSync(path.join(localesDir, file), "utf8"));
    Object.assign(merged, flattenKeys(content));
  }
  return merged;
}

function flattenKeys(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      result[newKey] = value;
    } else if (value && typeof value === "object") {
      Object.assign(result, flattenKeys(value as Record<string, unknown>, newKey));
    }
  }
  return result;
}
```

同时在 `package.json` 的 `files` 字段添加 `"locales/**"`，确保发布时包含所有翻译文件。

## 4. 配置集成：Settings

### `settings.ts` 新增字段

```typescript
export type DeepcodingSettings = {
  // ... 现有字段
  locale?: string;            // UI + Prompt 模板语言，"en" | "zh-CN"
  thinkingLocale?: string;    // LLM 推理语言，"en" | "zh-CN"（默认 = locale）
  replyLocale?: string;       // LLM 回复语言，"en" | "zh-CN"（默认 = locale）
};
```

### 配置优先级（与现有一致）

1. `DEEPCODE_LOCALE` — UI+Prompt 语言
2. `DEEPCODE_THINKING_LOCALE` — 推理语言（环境变量）
3. `DEEPCODE_REPLY_LOCALE` — 回复语言（环境变量）
4. `./.deepcode/settings.json` 中的 `locale` / `thinkingLocale` / `replyLocale`
5. `~/.deepcode/settings.json` 中的 `locale` / `thinkingLocale` / `replyLocale`
6. 默认：自动检测 `process.env.LANG`，回退到 `"en"`

### `ResolvedDeepcodingSettings` 新增

```typescript
export type ResolvedDeepcodingSettings = {
  // ... 现有字段
  locale: Locale;
  thinkingLocale: Locale;  // 新增
  replyLocale: Locale;     // 新增
};
```

## 5. `/config` 命令

### 注册

在 `src/ui/slashCommands.ts` 新增命令类型：

```typescript
export type SlashCommandKind =
  | "config"     // 新增
  | ...;
```

新增内置命令条目：

```typescript
{
  kind: "config",
  name: "config",
  label: "/config",
  description: "Configure settings: language, model, etc.",
}
```

### 命令处理（PromptInput.tsx）

```typescript
if (item.kind === "config") {
  clearSlashToken();
  setShowConfigDropdown(true);  // 新增状态
  return;
}
```

### ConfigDropdown 组件

类似 `ModelsDropdown`，提供以下配置项：

- **UI Language / 界面语言**: 选择 `en` / `zh-CN`，控制 UI 和 Prompt 模板语言
- **Thinking Language / 推理语言**: 选择 `en` / `zh-CN`，控制 LLM 推理（`reasoning_content`）语言（默认跟随 UI Language）
- **Reply Language / 回复语言**: 选择 `en` / `zh-CN`，控制 LLM 回复（`content`）语言（默认跟随 UI Language）
- **Model / 模型**: 复用现有 ModelsDropdown 逻辑
- 未来可扩展：thinking、notification 等

### `/config` 参数模式

除了交互式 dropdown，也支持一步到位的参数语法：

```
/config locale en                # 切换 UI 语言为英文
/config thinkingLocale zh-CN     # 设置推理语言为中文
/config replyLocale en           # 设置回复语言为英文
```

在 `PromptInput.tsx` 的 `submitCurrentBuffer()` 中检测 `/config` 开头的精确匹配：

```typescript
if (/^\/config\s/.test(trimmed)) {
  handleConfigCommand(trimmed);
  return;
}

function handleConfigCommand(input: string): void {
  const parts = input.split(/\s+/);
  const subCmd = parts[1];
  const value = parts[2];
  if (subCmd === "locale" && value) {
    applyLocaleChange(value as Locale);
  } else if (subCmd === "thinkingLocale" && value) {
    applyThinkingLocaleChange(value as Locale);
  } else if (subCmd === "replyLocale" && value) {
    applyReplyLocaleChange(value as Locale);
  }
}
```

### 持久化

```typescript
function onLocaleChange(locale: Locale): void {
  const settings = readSettings() || {};
  settings.locale = locale;
  writeSettings(settings);
  initI18n(locale);
  setStatusMessage(t("config.languageUpdated", { locale }));
}

function onThinkingLocaleChange(locale: Locale): void {
  const settings = readSettings() || {};
  settings.thinkingLocale = locale;
  writeSettings(settings);
  setStatusMessage(t("config.thinkingLanguageUpdated", { locale }));
}

function onReplyLocaleChange(locale: Locale): void {
  const settings = readSettings() || {};
  settings.replyLocale = locale;
  writeSettings(settings);
  setStatusMessage(t("config.replyLanguageUpdated", { locale }));
}
```

### 动态切换

切换 locale 后：
1. `initI18n(newLocale)` 重新加载翻译 JSON
2. Context 中 `locale` 状态变更，所有消费 `useI18n()` 的组件自动重渲染
3. 由于 Ink `<Static>` 不会重渲染已挂载消息，需要：
   - 调用 `reloadActiveSessionView()` 重新加载当前会话消息（使用新 locale）
   - 对无活跃会话的场景，通过 `setWelcomeNonce(n => n + 1)` 触发 WelcomeScreen 重渲染
4. 持久化新 locale 到 `settings.json`

### 行为边界

- **中间会话切换 locale**：新消息使用新 locale；已有历史消息保持旧 locale（不会回溯翻译）
- **新会话**：始终使用当前 locale 构建系统提示词和 UI
- **未配置 locale**：默认自动检测 `process.env.LANG`，回退到 `"en"`

## 6. 各维度 i18n 覆盖清单

### 6a. UI 字符串（所有 Ink 组件）

| 文件 | 需翻译内容 | 翻译 key 前缀 |
|------|-----------|-------------|
| `MessageView/index.tsx` | `"Thinking"`, `"(reasoning...)"`, `"(no content)"`, `"(conversation summary inserted)"`, `"⚡ Loaded skill: {name}"`, `"└ Changes"`, `"└ Plan"`, `"└ Result"`, `"Tool"` | `ui.messageView.` |
| `MessageView/utils.ts` | `renderMessageToStdout` 中的对应字符串 | `ui.messageView.` |
| `PromptInput.tsx` | 所有 `setStatusMessage` 文案、`footerText`、`"Interrupting…"`, `"Attached image from clipboard"`, `"No image found in clipboard"`, `"Reading clipboard..."`, `"Failed to read clipboard"`, `"Cleared attached images"`, `"s attached"`, `"use /skills to edit"`, `"ctrl+o view output"`, `"ctrl+o expand"`, `"ctrl+o collapse"`, `"press ctrl+d again to exit"`, `"press ctrl+d to exit"`, `"wait for the current response or press esc to interrupt"`, `"No paste marker at cursor"`, `"Paste content not found"` | `ui.promptInput.` |
| `App.tsx` | `"No active session to undo."`, `"Model settings unchanged"`, `"Model settings updated: "`, `"Error: "`, status line: `"status: "`, `"tokens: "`, `"fail: "`, `"Interrupted."`, `"Killed processes: "`, `"Failed to kill processes: "`, `"The AI agent has taken several steps..."`, `"OpenAI API key not found..."`, `"Request failed: "`, `"No active session to undo."`, `"Code restore failed: "`, `"Conversation restore failed: "` | `ui.app.` |
| `loadingText.ts` | `"Thinking..."`, `"Thinking... ({elapsed}s) · ↓ {tokens} tokens"` | `ui.loading.` |
| `exitSummary.ts` | `"Goodbye!"`, 表格列头: `"Model Usage"`, `"Reqs"`, `"Input Tokens"`, `"Output Tokens"`, `"Cached Tokens"` | `ui.exitSummary.` |
| `cli.tsx` | 全部 `--help` 输出文本 | `cli.help.` |
| `slashCommands.ts` | 所有 `description` 文案 | `ui.slashCommands.` |
| `WelcomeScreen.tsx` | 快捷键提示（`"Send the prompt"`, `"Insert a newline"`, `"Paste an image"`, `"Interrupt"`, `"Open the skills and commands menu"`, `"Quit"`）、路径显示格式、`"Deep Code"` 标题 | `ui.welcome.` |
| `McpStatusList.tsx` | 视图模式名（`"server-list"`, `"server-detail"`）、状态标签（`"ready"`, `"failed"`, `"connecting"`, `"reconnecting"`）、操作按钮文字 | `ui.mcp.` |
| `AskUserQuestionPrompt.tsx` | 问题提示文案、按钮文字 | `ui.askUserQuestion.` |
| `ProcessStdoutView.tsx` | 标题栏、进程信息、超时调整文案 | `ui.processStdout.` |
| `UpdatePrompt.tsx` | 计划显示文案 | `ui.updatePrompt.` |
| `SessionList.tsx` | 会话列表标题、空状态文案 | `ui.sessionList.` |

### 6b. Prompt 字符串

| 文件 | 需翻译内容 | 策略 |
|------|-----------|------|
| `prompt.ts` | `SYSTEM_PROMPT_BASE`（中文） | 改为加载 `locales/{locale}/system-prompt.md.ejs` 模板 |
| `prompt.ts` | `COMPACT_PROMPT_BASE`（英文） | 同上，改为 locale-specific 模板 |
| `prompt.ts` | `getCurrentDateAndModelPrompt()`（中英文混合） | 使用 `t()` + locale 日期格式化 |
| `prompt.ts` | `getDefaultSkillPrompt()` 中的 `"Use the skill documents below"` | 使用 `t()` |
| `session.ts` | `identifyMatchingSkillNames` 中的英文 prompt | 使用 `t()` 或 locale 模板 |
| `prompt.ts` | 追加两条独立语言指令 | 追加 `t("prompt.thinkingLanguageInstruction")` 和 `t("prompt.replyLanguageInstruction")`，分别控制 LLM 的 reasoning_content 和 content 输出语言 |

### 6c. Thinking 相关（引导 LLM 推理语言 + UI 标签）

| 文件 | 内容 | 策略 |
|------|------|------|
| `prompt.ts` | 推理语言指令（引导 LLM 的 `reasoning_content` 语言） | 在 `getSystemPrompt()` 末尾追加 `t("prompt.thinkingLanguageInstruction")`，使用 `thinkingLocale` 对应的翻译 |
| `MessageView/index.tsx` | "Thinking" UI 标签 | `t("ui.messageView.thinking")` |
| `MessageView/utils.ts` | `"(reasoning...)"` UI fallback | `t("ui.messageView.reasoning")` |

### 6d. Reply 相关（引导 LLM 回复语言 + UI 标签）

| 文件 | 内容 | 策略 |
|------|------|------|
| `prompt.ts` | 回复语言指令（引导 LLM 的 `content` 语言） | 在 `getSystemPrompt()` 末尾追加 `t("prompt.replyLanguageInstruction")`，使用 `replyLocale` 对应的翻译 |
| `MessageView/index.tsx` | assistant 消息前缀 `✦` | emoji 无需翻译 |
| `session.ts` | "The agent has taken several steps..." 等运行时提示 | 使用 `t()` |

## 7. 翻译 JSON 示例

> 以下展示的是合并后的内容参考（`flattenKeys` 展开前的嵌套结构）。实际存储按 §2 模块文件拆分，每个文件只包含对应模块的键值对，最终由 `loadLocaleDir()` 在运行时合并。

### `en/` 合并参考内容（非实际文件布局）

```json
{
  "ui": {
    "messageView": {
      "thinking": "Thinking",
      "reasoningFallback": "(reasoning...)",
      "noContent": "(no content)",
      "loadedSkill": "⚡ Loaded skill: {name}",
      "conversationSummaryInserted": "(conversation summary inserted)",
      "changes": "└ Changes",
      "plan": "└ Plan",
      "result": "└ Result",
      "toolName": "Tool"
    },
    "promptInput": {
      "interrupting": "Interrupting…",
      "imageAttached": "Attached image from clipboard",
      "noImageFound": "No image found in clipboard",
      "readingClipboard": "Reading clipboard...",
      "failedClipboard": "Failed to read clipboard",
      "clearedImages": "Cleared attached images",
      "waitForResponse": "wait for the current response or press esc to interrupt",
      "pressCtrlDExit": "press ctrl+d to exit",
      "pressCtrlDAgain": "press ctrl+d again to exit",
      "footer": "enter send · shift+enter newline · @ files · ctrl+v image · / commands · ctrl+d exit",
      "footerBusy": "esc to interrupt · ctrl+c to cancel input",
      "ctrlOViewOutput": " · ctrl+o view output",
      "ctrlOExpand": " · ctrl+o expand",
      "ctrlOCollapse": " · ctrl+o collapse",
      "noPasteMarker": "No paste marker at cursor",
      "pasteNotFound": "Paste content not found",
      "imageCount": "📎 {count} image{count,plural,=1{} other{s}} attached"
    },
    "loading": {
      "thinking": "Thinking...",
      "thinkingElapsed": "Thinking... ({elapsed}s) · ↓ {tokens} tokens"
    },
    "app": {
      "error": "Error: {message}",
      "statusStatus": "status: {status}",
      "statusTokens": "tokens: {tokens}",
      "statusFail": "fail: {reason}",
      "interrupted": "Interrupted.",
      "killedProcesses": "Killed processes: {pids}",
      "failedKillProcesses": "Failed to kill processes: {pids}",
      "modelUnchanged": "Model settings unchanged",
      "modelUpdated": "Model settings updated: {before} → {after}",
      "noActiveSession": "No active session to undo.",
      "codeRestoreFailed": "Code restore failed: {error}",
      "conversationRestoreFailed": "Conversation restore failed: {error}",
      "sessionDefaultSummary": "[Image Prompt]",
      "sessionAgentSteps": "The AI agent has taken several steps but hasn't reached a conclusion yet. Do you want to continue?",
      "apiKeyNotFound": "OpenAI API key not found. Please configure ~/.deepcode/settings.json or ./.deepcode/settings.json.",
      "requestFailed": "Request failed: {error}"
    },
    "exitSummary": {
      "goodbye": "Goodbye!",
      "modelUsage": "Model Usage",
      "reqs": "Reqs",
      "inputTokens": "Input Tokens",
      "outputTokens": "Output Tokens",
      "cachedTokens": "Cached Tokens"
    },
    "config": {
      "title": "Configuration",
      "language": "Language",
      "languageUpdated": "Language updated to {locale}",
      "thinkingLanguageUpdated": "Thinking language updated to {locale}",
      "replyLanguageUpdated": "Reply language updated to {locale}"
    }
  },
  "session": {
    "compacting": "The conversation is getting long, compacting...",
    "skillPromptHeader": "Use the skill document below to assist the user:\n"
  },
  "prompt": {
    "skillDocumentsHeader": "Use the skill documents below to assist the user:\n",
    "dateAndModel": "Today is {date}. As the conversation progresses, time passes.\nCurrent LLM model is {model}. You can switch models using the /model command.",
    "thinkingLanguageInstruction": "IMPORTANT: Your reasoning and thinking process should be in English.",
    "replyLanguageInstruction": "IMPORTANT: Always respond to the user in English."
  }
}
```

### `zh-CN/` 合并参考内容（非实际文件布局）

```json
{
  "ui": {
    "messageView": {
      "thinking": "思考",
      "reasoningFallback": "(推理中...)",
      "noContent": "(无内容)",
      "loadedSkill": "⚡ 已加载技能：{name}",
      "conversationSummaryInserted": "(已插入对话摘要)",
      "changes": "└ 变更",
      "plan": "└ 计划",
      "result": "└ 结果",
      "toolName": "工具"
    },
    "promptInput": {
      "interrupting": "正在中断…",
      "imageAttached": "已从剪贴板粘贴图片",
      "noImageFound": "剪贴板中没有图片",
      "readingClipboard": "正在读取剪贴板...",
      "failedClipboard": "读取剪贴板失败",
      "clearedImages": "已清除粘贴的图片",
      "waitForResponse": "请等待当前响应完成，或按 esc 中断",
      "pressCtrlDExit": "按 ctrl+d 退出",
      "pressCtrlDAgain": "再按一次 ctrl+d 退出",
      "footer": "回车发送 · shift+回车换行 · @ 文件 · ctrl+v 图片 · / 命令 · ctrl+d 退出",
      "footerBusy": "esc 中断 · ctrl+c 取消输入",
      "ctrlOViewOutput": " · ctrl+o 查看输出",
      "ctrlOExpand": " · ctrl+o 展开",
      "ctrlOCollapse": " · ctrl+o 折叠",
      "noPasteMarker": "光标位置没有粘贴标记",
      "pasteNotFound": "找不到粘贴内容",
      "imageCount": "📎 {count} 张图片已粘贴"
    },
    "loading": {
      "thinking": "思考中...",
      "thinkingElapsed": "思考中... ({elapsed}秒) · ↓ {tokens} tokens"
    },
    "app": {
      "error": "错误：{message}",
      "statusStatus": "状态：{status}",
      "statusTokens": "token 数：{tokens}",
      "statusFail": "失败原因：{reason}",
      "interrupted": "已中断。",
      "killedProcesses": "已终止进程：{pids}",
      "failedKillProcesses": "终止进程失败：{pids}",
      "modelUnchanged": "模型设置未变更",
      "modelUpdated": "模型设置已更新：{before} → {after}",
      "noActiveSession": "没有活跃会话可供撤销。",
      "codeRestoreFailed": "代码恢复失败：{error}",
      "conversationRestoreFailed": "对话恢复失败：{error}",
      "sessionDefaultSummary": "[图片提示]",
      "sessionAgentSteps": "AI 助手已执行多个步骤但未得出结论。是否继续？",
      "apiKeyNotFound": "未找到 OpenAI API key。请配置 ~/.deepcode/settings.json 或 ./.deepcode/settings.json。",
      "requestFailed": "请求失败：{error}"
    },
    "exitSummary": {
      "goodbye": "再见！",
      "modelUsage": "模型用量",
      "reqs": "请求数",
      "inputTokens": "输入 Tokens",
      "outputTokens": "输出 Tokens",
      "cachedTokens": "缓存 Tokens"
    },
    "config": {
      "title": "设置",
      "language": "语言",
      "languageUpdated": "语言已切换为 {locale}"
    }
  },
  "session": {
    "compacting": "对话内容较长，正在压缩...",
    "skillPromptHeader": "使用以下技能文档来协助用户：\n"
  },
  "prompt": {
    "skillDocumentsHeader": "使用以下技能文档来协助用户：\n",
    "dateAndModel": "今天是{date}。随着对话的进行，时间在流逝。\n当前 LLM 模型为{model}，可通过 /model 命令切换模型。",
    "thinkingLanguageInstruction": "重要：你的推理和思考过程请使用中文。",
    "replyLanguageInstruction": "重要：请始终使用中文回复用户。"
  }
}
```

## 8. 修改文件清单

| 文件 | 修改类型 | 说明 |
|------|---------|------|
| `src/common/i18n.ts` | **新增** | i18n 核心模块 |
| `locales/en/` (16 个模块文件) | **新增** | 按模块拆分的英文翻译 |
| `locales/zh-CN/` (16 个模块文件) | **新增** | 中文翻译（镜像 en/ 结构） |
| `src/ui/components/ConfigDropdown.tsx` | **新增** | /config 命令 UI |
| `src/settings.ts` | 修改 | 增加 `locale` 字段解析 |
| `src/ui/slashCommands.ts` | 修改 | 增加 `config` 命令类型 |
| `src/ui/PromptInput.tsx` | 修改 | 增加 ConfigDropdown 渲染和 `setShowConfigDropdown` 状态；UI 字符串改用 `t()` |
| `src/ui/App.tsx` | 修改 | UI 字符串改用 `t()`；处理 ConfigDropdown 传来的 locale 变更事件（强制重渲染） |
| `src/ui/components/MessageView/index.tsx` | 修改 | UI 字符串改用 `t()` |
| `src/ui/components/MessageView/utils.ts` | 修改 | UI 字符串改用 `t()` |
| `src/ui/loadingText.ts` | 修改 | UI 字符串改用 `t()` |
| `src/ui/exitSummary.ts` | 修改 | UI 字符串改用 `t()` |
| `src/cli.tsx` | 修改 | 初始化时调用 `initI18n()`；帮助文本改用翻译 |
| `src/prompt.ts` | 修改 | `SYSTEM_PROMPT_BASE`、`COMPACT_PROMPT_BASE`、`getCurrentDateAndModelPrompt()` 改用翻译 |
| `src/session.ts` | 修改 | 硬编码提示字符串改用 `t()` |

## 9. 分阶段实施

### Phase 1：基础设施（建议 PR 1）
1. 创建 `src/common/i18n.ts` — i18n 核心（initI18n, t, resetI18n, Locale, TranslationKey）
   - `loadLocaleDir` 使用 `typeof __dirname !== "undefined" ? path.resolve(__dirname, "..") : fileURLToPath(import.meta.url)` fallback
2. 创建 `locales/en/` 和 `locales/zh-CN/` 目录及 16 个模块 JSON 占位文件
3. 修改 `src/settings.ts` — 添加 locale 解析（`DEEPCODE_LOCALE` + settings.json）
4. 创建 `src/ui/contexts/i18n.tsx` — I18nContext, I18nProvider, useI18n
5. 修改 `src/cli.tsx` — 启动时初始化 i18n
6. 启用 `tsconfig.json` 的 `resolveJsonModule`
7. 创建 `scripts/check-i18n.mjs` — `npm run check:i18n` 脚本
- **验证**:
  - `initI18n("en")` + `t("ui.loading.thinking")` → `"Thinking..."`
  - `initI18n("zh-CN")` + `t("ui.loading.thinking")` → `"思考中..."`
  - `t("non.existent.key")` → `"non.existent.key"`（key 自身）
  - missing `locales/zh-CN/` 目录 → 静默降级到 en/
  - `npm run check` 通过
- **回滚**: 删除 `src/common/i18n.ts`、`locales/`、`src/ui/contexts/i18n.tsx`，恢复 `settings.ts`、`cli.tsx` 的修改，移除 `resolveJsonModule`

### Phase 2：UI 字符串替换（建议 PR 2）

7. 逐个修改各 UI 组件，替换字符串为 `t()` 调用
   - `MessageView/index.tsx` + `utils.ts`
   - `PromptInput.tsx`
   - `App.tsx`
   - `loadingText.ts`, `exitSummary.ts`
   - `cli.tsx`（--help）
   - `WelcomeScreen.tsx`, `McpStatusList.tsx`, `SessionList.tsx`
   - `AskUserQuestionPrompt.tsx`, `ProcessStdoutView.tsx`, `UpdatePrompt.tsx`
8. 所有测试需包装 `I18nProvider` 或 mock `t()`
- **验证**: 切换 locale 时 UI 文字立即变化

### Phase 3：Prompt 模板 + 语言指令（建议 PR 3）
9. 修改 `src/prompt.ts`：
   - `getSystemPrompt()` / `getCompactPrompt()` 内部调用 `getLocale()` 选择对应 locale 的 EJS 模板（不改变外部签名）
   - `getSystemPrompt()` 末尾追加两条独立语言指令：
     - `t("prompt.thinkingLanguageInstruction")` — 使用 `thinkingLocale`，引导 LLM 的 `reasoning_content` 语言
     - `t("prompt.replyLanguageInstruction")` — 使用 `replyLocale`，引导 LLM 的 `content` 语言
   - `getCurrentDateAndModelPrompt()` 使用 `t("prompt.dateAndModel")` + locale 日期格式化
   - `getDefaultSkillPrompt()` 使用 `t("prompt.skillDocumentsHeader")`
10. 创建 `templates/prompts/system-prompt.zh-CN.md.ejs` 和 `system-prompt.en.md.ejs`
11. 创建 `templates/prompts/compact-prompt.zh-CN.md.ejs` 和 `compact-prompt.en.md.ejs`
12. 修改 `src/session.ts` — 通过 `SessionManagerOptions.t`（类型为 `TranslationKey`）注入翻译，替换硬编码字符串
- **验证**: 新会话系统提示词末尾包含两条独立语言指令；`thinkingLocale=zh-CN, replyLocale=en` 时推理用中文回复用英文

### Phase 4：/config 命令（建议 PR 4）
13. 修改 `src/ui/slashCommands.ts` — 注册 `config` 命令类型
14. 创建 `ConfigDropdown.tsx` — /config 命令 UI（语言切换 dropdown）
15. 修改 `PromptInput.tsx` — 集成 ConfigDropdown + `/config locale en` 参数模式
16. 修改 `App.tsx` — locale 变更处理（刷新消息列表 + 欢迎屏）
- **验证**: `/config` 打开 dropdown、`/config locale zh-CN` 一键切换

## 10. 分开配置可行性分析

### 核心挑战：`t()` 需要跨 locale 翻译

UI 字符串始终使用 `currentLocale` 翻译。但生成系统提示词的语言指令时，`thinkingLocale` 可能不同于 `currentLocale`。

```
举例：locale=zh-CN, thinkingLocale=en
  t("prompt.thinkingLanguageInstruction")
  → 需要返回英文版 "Your reasoning should be in English."
  → 但 t() 默认从 zh-CN.json 查找 → 会返回 "重要：你的推理..."
  → ✗ 错误！
```

### 解决方案：`t()` 增加 locale 覆盖参数

```typescript
export function t(
  key: TranslationKey,
  params?: Record<string, string | number>,
  localeOverride?: Locale  // 新增：指定读取哪个 locale 的翻译
): string;
```

实现逻辑：

```
1. targetLocale = localeOverride ?? currentLocale
2. 从 targetLocale 的 messages 查找
3. 找不到则回退到 en/ 目录
4. 仍然找不到则返回 key 自身
```

调用方式：

```typescript
// prompt.ts — 生成系统提示词时使用指定 locale 的翻译
const thinkingInstruction = t("prompt.thinkingLanguageInstruction", undefined, thinkingLocale);
const replyInstruction = t("prompt.replyLanguageInstruction", undefined, replyLocale);
```

### 全局状态管理

`i18n.ts` 中存储三个独立 locale 值：

```typescript
// src/common/i18n.ts
let currentLocale: Locale = "en";
let thinkingLocale: Locale = "en";
let replyLocale: Locale = "en";

export function initI18n(locale: Locale, options?: { thinkingLocale?: Locale; replyLocale?: Locale }): void {
  currentLocale = locale;
  // 选项中的 thinking/reply locale 优先级最高，未设置则跟随 locale
  thinkingLocale = options?.thinkingLocale ?? locale;
  replyLocale = options?.replyLocale ?? locale;
  // 加载对应的 locale JSON...
}

export function getThinkingLocale(): Locale { return thinkingLocale; }
export function getReplyLocale(): Locale { return replyLocale; }
export function setThinkingLocale(locale: Locale): void { thinkingLocale = locale; }
export function setReplyLocale(locale: Locale): void { replyLocale = locale; }
```

### React Context 扩展

```typescript
type I18nContextValue = {
  t: typeof t;
  locale: Locale;
  setLocale: (locale: Locale) => void;
  thinkingLocale: Locale;
  replyLocale: Locale;
  setThinkingLocale: (locale: Locale) => void;
  setReplyLocale: (locale: Locale) => void;
};
```

### Settings 解析链

在 `resolveSettingsSources()` 中增加两个新字段：

```typescript
const thinkingLocale =
  trimString(systemEnv.THINKING_LOCALE) ||
  trimString(projectSettings?.thinkingLocale) ||
  trimString(userSettings?.thinkingLocale) ||
  locale;  // 默认跟随主locale

const replyLocale =
  trimString(systemEnv.REPLY_LOCALE) ||
  trimString(projectSettings?.replyLocale) ||
  trimString(userSettings?.replyLocale) ||
  locale;  // 默认跟随主locale
```

### prompt.ts 生成系统提示词的完整流程

```typescript
function getSystemPrompt(projectRoot: string, options: PromptToolOptions = {}): string {
  const locale = getLocale();
  const tLocale = getThinkingLocale();
  const rLocale = getReplyLocale();

  // 1. 根据 locale 选择系统提示词模板
  const basePrompt = loadSystemPromptTemplate(locale);

  // 2. 追加工具描述（保持英文）
  const toolDocs = readToolDocs(getExtensionRoot(), options);

  // 3. 追加两条独立语言指令（使用各自的 locale）
  const thinkingInstr = t("prompt.thinkingLanguageInstruction", undefined, tLocale);
  const replyInstr = t("prompt.replyLanguageInstruction", undefined, rLocale);

  return `${basePrompt}\n\n${toolDocs}\n\n${thinkingInstr}\n${replyInstr}`;
}
```

### 技术风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| `t()` 第三个参数因疏忽未传递，导致从主 locale 获取翻译 | 语言指令语言错误，LLM 输出错乱 | 添加 TypeScript 类型约束：`getSystemPrompt()` 内部强制类型检查；添加单元测试覆盖 thinkingLocale≠locale 的场景 |
| 多 locale JSON 重复加载（切换 locale 时每次加载两份 JSON） | 轻度性能开销，IO 增加约 2x | 添加 `preloadLocale(locale)` 缓存；切换时检查是否已加载 |
| 用户配置 thinkingLocale="ja"（不支持的 locale） | 静默回退到 en/，指令为英文 | 在 `resolveSettings()` 中校验，无效值回退到 `locale` |
| ConfigDropdown 三个 dropdown 让用户困惑 | UX 复杂度过高 | UI 默认折叠为 "Advanced" 区域，仅显示 "UI Language"；展开后显示 Thinking/Reply 选项 |
| 中间会话切换 thinkingLocale | 已有系统提示词中的指令仍为旧语言 | 在 `setThinkingLocale()` 时向活跃会话插入一条新 system message 更新指令 |

### 最终结论

该方案**技术上完全可行**，核心改动点在：

```
i18n.ts       — t() 增加 localeOverride 参数 + 三个全局 locale 状态
settings.ts   — 解析 thinkingLocale/replyLocale（回退链到 locale）
prompt.ts     — getSystemPrompt() 使用两条独立 locale 语言指令
I18nContext   — 新增三个字段（状态 + setter）
ConfigDropdown — 三项语言选择（UI/Thinking/Reply）
App.tsx       — 三个回调处理 locale 变更
```

估计代码量：`+200 行`（相比单 locale 方案约增加 30% 的 i18n 基础设施代码）。

## 11. 注意事项

1. **esbuild 打包**: locale JSON 通过 `package.json` `files` 字段发布，运行时通过 `__dirname` + `getExtensionRoot()` 读取。不静态 import，避免 esbuild 打包成 JS。
2. **Ink 重渲染**: 使用 React Context（`I18nProvider`）而非 `key={locale}` remount。Context value 变化时消费 `useI18n()` 的组件自动重渲染。Ink `<Static>` 中的历史消息通过 `reloadActiveSessionView()` 刷新。
3. **LLM 输出语言控制**：LLM 生成的 `content`（回复）和 `reasoning_content`（推理）本身**不翻译**，而是通过系统提示词中的两条独立语言指令控制：`t("prompt.thinkingLanguageInstruction")` 使用 `thinkingLocale`，`t("prompt.replyLanguageInstruction")` 使用 `replyLocale`。两者默认都跟随主 `locale`。不翻译的部分：文件路径、工具参数中的路径和命令、JSON/代码片段。
4. **向后兼容**: 未设置 locale 时自动检测 `process.env.LANG`，回退到 `\"en\"`。所有 `t()` 调用对缺失 key 先回退到 en/ 目录，再回退到 key 本身。
5. **测试**: `t()` 在未初始化时返回 key 本身。`resetI18n()` 用于测试间重置状态。单元测试需调用 `initI18n("en")` 或在测试文件顶部 mock。
6. **CJK 字符宽度**: `exitSummary.ts` 的 `visibleLength()` 未考虑中文字符在终端中的双倍宽度。这是现有 bug，zh-CN 场景会更明显，建议单独修复。
7. **翻译 key 完整性**: `TranslationKey` union type 与 `locales/en/` 下所有 JSON 文件中的 key 需保持一致。建议 CI 中运行 `npm run check:i18n` 校验所有模块文件。
8. **中间会话语言切换**: 只有新 UI 组件渲染和新会话提示词会用新 locale。已有历史消息保持原样，这是预期行为。

## 12. 翻译进度追踪

### 模块文件状态表

| 状态 | 含义 |
|------|------|
| 🔴 待创建 | 文件尚未创建 |
| 🟡 翻译中 | en 版本完成，zh-CN 版本部分完成 |
| 🟢 已完成 | en + zh-CN 版本均完成 |

| 文件名 | en | zh-CN | Phase | 对应代码文件 |
|--------|----|-------|-------|-------------|
| `ui-message-view.json` | 🔴 | 🔴 | Phase 2 | MessageView/index.tsx, utils.ts |
| `ui-prompt-input.json` | 🔴 | 🔴 | Phase 2 | PromptInput.tsx |
| `ui-app.json` | 🔴 | 🔴 | Phase 2 | App.tsx |
| `ui-loading.json` | 🔴 | 🔴 | Phase 2 | loadingText.ts |
| `ui-exit-summary.json` | 🔴 | 🔴 | Phase 2 | exitSummary.ts |
| `ui-welcome.json` | 🔴 | 🔴 | Phase 2 | WelcomeScreen.tsx |
| `ui-mcp.json` | 🔴 | 🔴 | Phase 2 | McpStatusList.tsx |
| `ui-slash-commands.json` | 🔴 | 🔴 | Phase 2 | slashCommands.ts |
| `ui-session-list.json` | 🔴 | 🔴 | Phase 2 | SessionList.tsx |
| `ui-ask-question.json` | 🔴 | 🔴 | Phase 2 | AskUserQuestionPrompt.tsx |
| `ui-process-stdout.json` | 🔴 | 🔴 | Phase 2 | ProcessStdoutView.tsx |
| `ui-update-prompt.json` | 🔴 | 🔴 | Phase 2 | UpdatePrompt.tsx |
| `cli-help.json` | 🔴 | 🔴 | Phase 2 | cli.tsx |
| `ui-config.json` | 🔴 | 🔴 | Phase 4 | ConfigDropdown.tsx |
| `session.json` | 🔴 | 🔴 | Phase 3 | session.ts |
| `prompt.json` | 🔴 | 🔴 | Phase 3 | prompt.ts |

### 进度更新方式

每次提交 PR 时：
1. 创建/更新对应模块的 `en/{module}.json` 和 `zh-CN/{module}.json`
2. 在 `.deepcode/i18n-todo.md` 中勾选对应任务
3. 更新本进度表的状态标记
4. 运行 `npm run check:i18n` 验证 key 一致性

## 13. 性能影响分析

### 分析范围

覆盖 i18n 改造对以下维度的性能影响：启动时间、运行时 `t()` 调用、React 渲染、内存占用、热路径、打包体积。

### 13.1 启动时间

| 阶段 | 改造前 | 改造后 | 增量 |
|------|--------|--------|------|
| CLI 初始化 | 无 locale 加载 | `initI18n()` 读取 16 个 JSON 文件 + 展平合并 | **+3~5ms** |
| 首次渲染 | 无 | 消费 `useI18n()` 的组件首次通过 context 获取 `t` | **可忽略** |

**多文件加载分析**：
- 16 个 JSON 文件，每个 ~0.5~3KB，总计 ~30KB
- `fs.readdirSync` → 扫描目录（~0.1ms）
- 16 × `fs.readFileSync` → 读取文件（~16 × 0.1ms = ~1.6ms）
- `JSON.parse` × 16 → 解析 JSON（~16 × 0.05ms = ~0.8ms）
- `flattenKeys()` → 展平嵌套结构（~0.3ms）
- **合计约 3ms**，在 CLI 启动的 ~500ms 总耗时中占比 < 1%

**对比合并 en.json vs 多文件**：单文件 `JSON.parse` 一个 30KB 文件约 0.8ms，多文件方案多 ~2ms 的 fs 开销。**可接受**。

**优化建议**：添加 `localeCache = Map<Locale, Record<string, string>>()`，`initI18n()` 时先检查缓存。切换回已加载过的 locale 时零 IO。

### 13.2 运行时 `t()` 调用开销

`t()` 函数实现：

```typescript
function t(key: TranslationKey, params?, localeOverride?): string {
  const targetLang = localeOverride ?? currentLocale;
  const msg = messagesMap.get(targetLang)?.get(key)    // O(1) Map lookup
         ?? messagesMap.get("en")?.get(key)             // fallback
         ?? key;                                        // key itself
  return params ? interpolate(msg, params) : msg;        // regex replace
}
```

| 操作 | 耗时 |
|------|------|
| 无 params 调用（Map 查找） | **~0.001ms** |
| 带 params 调用（+ regex replace） | **~0.003ms** |

**对比硬编码字符串**：硬编码字符串的引用是编译期确定的，零运行时开销。`t()` 每次调用需要一次 Map 查找，但 ~0.001ms 在交互式 CLI 中**完全不可感知**。

### 13.3 React 渲染影响

| 组件 | `t()` 调用位置 | 调用频率 | 影响 |
|------|--------------|---------|------|
| `MessageView` | `useI18n()` 获取 `t`，渲染标签 | 每消息 1 次（`<Static>` 渲染一次） | 无 |
| `PromptInput` | `useI18n()` 获取 `t`，footerText | 每次键盘输入重渲染 | 毫秒级字符串替换，无感知 |
| `App.tsx` | `useI18n()` 获取 `t`，状态行 | 会话状态变化时 | 低频，无影响 |
| `loadingText.ts` | import 全局 `t()` | 每 500ms tick | Map 查找，< 0.01ms/tick |
| `exitSummary.ts` | import 全局 `t()` | 退出时 1 次 | 无 |

**关键热路径分析 — `loadingText.ts`**：

```
改造前: return "Thinking..."
改造后: return t("ui.loading.thinking")
```

每 500ms 被调用一次（`App.tsx` 中的 `setInterval`），额外开销 **0.001ms/次**。运行 1 小时（7200 次调用）累计 **7.2ms**。**可忽略**。

**关键热路径分析 — `PromptInput`**：

`footerText` 是 `useMemo` 计算的值，当 `statusMessage`、`busy`、`loadingText`、`processOrPasteHint` 变化时才重新计算。每次用户输入触发组件重渲染，但 `footerText` 的依赖未变时不会重新计算 `t()`。

```
改造前: `enter send · shift+enter newline · @ files · ctrl+v image · / commands · ctrl+d exit`
改造后: t("ui.promptInput.footer") + t("ui.promptInput.ctrlOViewOutput")
```

`t()` 调用在 `useMemo` 内部，仅在依赖变化时计算。**无额外重渲染开销**。

### 13.4 内存占用

| 数据 | 大小 | 说明 |
|------|------|------|
| en/ 下 16 个 JSON | ~16KB | `loadLocaleDir("en")` 加载后留在内存 |
| zh-CN/ 下 16 个 JSON | ~16KB | 仅当 locale=zh-CN 时加载 |
| en fallback | ~16KB | 始终在内存中作为回退 |
| **合计** | **~32-48KB** | 两个 `Record<string, string>` 对象 |

**当前 CLI 基线内存**：Node.js 进程 ~50MB。i18n 增加 **< 0.1%**。**可忽略**。

### 13.5 打包体积

| 文件 | 大小 |
|------|------|
| `locales/en/` 16 个 JSON | ~16KB |
| `locales/zh-CN/` 16 个 JSON | ~16KB |
| **合计** | **~30KB** |

这些文件通过 `package.json` `files` 字段分发，运行时由 `fs.readFileSync` 加载，**不被打入 esbuild bundle**（因为 `--packages=external` 且不是 `import` 而是 `fs.readFileSync`）。对 `dist/cli.js` 体积 **零影响**。

### 13.6 `t()` 带 `localeOverride` 的性能

```typescript
t("prompt.thinkingLanguageInstruction", undefined, "en")  // 指定从 en 取翻译
```

相比无 override 的 `t()` 调用，多一次 `localeOverride ?? currentLocale` 三元运算（~0.0001ms）。**可忽略**。

只在 `getSystemPrompt()` 每次创建会话时调用两次，属于低频路径。

### 13.7 Locale 切换性能

切换 locale 时：

| 步骤 | 耗时 |
|------|------|
| `initI18n(newLocale)` 读取 ~15 JSON | ~3ms |
| `setLocaleState(newLocale)` 触发 context 更新 | React 同步 |
| `reloadActiveSessionView()` 刷新消息 | ~5ms（加载 JSONL + 渲染） |
| **合计** | **~8-10ms** |

用户无感知（终端 UI 不需要 60fps）。

### 13.8 综合结论

| 指标 | 影响 | 评级 |
|------|------|------|
| 启动时间 | +3~5ms | 🟢 无影响 |
| 运行时 `t()` | ~0.001ms/次 | 🟢 无影响 |
| React 重渲染 | 仅 locale 切换时触发 | 🟢 无影响 |
| 内存 | +30~45KB | 🟢 可忽略 |
| 打包体积 | +0KB（不打包进 JS） | 🟢 无影响 |
| 磁盘分发 | +30KB JSON | 🟢 可忽略 |
| 热路径 (500ms tick) | +0.001ms/tick | 🟢 无影响 |

**最终结论**：i18n 改造对性能的影响**极小**，所有维度均在可忽略范围内。无需特殊优化措施。建议仅在 `loadLocaleDir` 中添加 `Map` 缓存避免重复 IO，其他不做额外优化。
