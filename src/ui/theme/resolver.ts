import { type ThemeTokens, type ThemeSettings } from "./types";
import { buildThemeTokens } from "./colors-theme";
import { LIGHT_THEME, PRESETS } from "./presets";

/**
 * 深度合并两个对象。right 的值覆盖 left。
 * 支持任意深度嵌套。
 */
function deepMerge<T extends object>(left: T, right: object): T {
  const result = { ...left };
  for (const key of Object.keys(right) as string[]) {
    const rv = (right as Record<string, unknown>)[key];
    if (rv === undefined) {
      continue;
    }
    const lv = (result as Record<string, unknown>)[key];
    if (lv && typeof lv === "object" && !Array.isArray(lv) && rv && typeof rv === "object" && !Array.isArray(rv)) {
      (result as Record<string, unknown>)[key] = deepMerge(lv as object, rv);
    } else {
      (result as Record<string, unknown>)[key] = rv;
    }
  }
  return result;
}

/**
 * 解析主题配置，返回最终的 ThemeTokens。
 *
 * - 未配置 / preset="light"：使用浅色主题 LIGHT_THEME
 * - preset 为预设名称（如 "dark", "monokai", "dracula"）：使用对应预设
 * - preset="custom"：使用用户自定义 tokens 或 overrides 合并到 LIGHT_THEME
 * - 当 terminalBg 与主题 mode 不匹配时，自动反转文字色
 */
export function resolveTheme(themeSettings: ThemeSettings | undefined, terminalBg?: "light" | "dark"): ThemeTokens {
  if (!themeSettings) {
    return applyTerminalContrast(LIGHT_THEME, terminalBg);
  }

  const { preset } = themeSettings;

  // preset 为预设名称时使用对应预设
  if (preset && preset !== "custom" && preset in PRESETS) {
    return applyTerminalContrast(PRESETS[preset], terminalBg);
  }

  // preset="custom"：基于 base 预设应用用户自定义
  if (preset === "custom") {
    const baseName = themeSettings.base;
    const baseTheme = baseName && baseName !== "custom" && baseName in PRESETS ? PRESETS[baseName] : LIGHT_THEME;

    // 优先级：tokens > colors + overrides > overrides > colors
    if (themeSettings.tokens) {
      return deepMerge(applyTerminalContrast(baseTheme, terminalBg), themeSettings.tokens);
    }
    if (themeSettings.colors && themeSettings.overrides) {
      return deepMerge(
        buildThemeTokens(themeSettings.colors, baseTheme.mode, "Custom", terminalBg),
        themeSettings.overrides
      );
    }
    if (themeSettings.colors) {
      return buildThemeTokens(themeSettings.colors, baseTheme.mode, "Custom", terminalBg);
    }
    if (themeSettings.overrides) {
      return deepMerge(applyTerminalContrast(baseTheme, terminalBg), themeSettings.overrides);
    }
  }

  // 未配置或无效 preset，回退默认
  return applyTerminalContrast(LIGHT_THEME, terminalBg);
}

/**
 * 当终端背景与主题模式不匹配时，反转文字相关 token 以确保对比度。
 * 只反转 primary ↔ inverse，muted/disabled（中性色）保持不变。
 */
export function applyTerminalContrast(base: ThemeTokens, terminalBg?: "light" | "dark"): ThemeTokens {
  if (!terminalBg || terminalBg === base.mode) return base;

  return {
    ...base,
    text: {
      primary: base.text.inverse,
      secondary: base.text.inverse,
      muted: base.text.muted,
      disabled: base.text.disabled,
      inverse: base.text.primary,
    },
    typography: {
      ...base.typography,
      paragraph: base.text.inverse,
      strong: base.text.inverse,
      emphasis: base.text.inverse,
    },
    inlineCode: {
      ...base.inlineCode,
      border: base.text.inverse,
    },
    codeBlock: {
      ...base.codeBlock,
      foreground: base.text.inverse,
      border: base.text.inverse,
      title: base.text.inverse,
      lineNumber: base.text.disabled,
    },
    syntax: {
      ...base.syntax,
      punctuation: base.text.inverse,
    },
    blockquote: {
      ...base.blockquote,
      border: base.text.inverse,
    },
    task: {
      ...base.task,
      unchecked: base.text.inverse,
    },
    table: {
      ...base.table,
      border: base.text.inverse,
      headerForeground: base.text.inverse,
      cellForeground: base.text.inverse,
    },
    hr: { foreground: base.text.inverse },
  };
}
