import { type ThemeTokens, type ThemeSettings } from "./types";
import { DEFAULT_THEME } from "./presets";

/**
 * 深度合并两个对象。right 的值覆盖 left。
 * 仅支持最多两层嵌套（ThemeTokens）。
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
 * - 未配置 / preset="default"：使用系统默认 DEFAULT_THEME
 * - preset="custom"：使用用户自定义 tokens 或 overrides 合并到 DEFAULT_THEME
 */
export function resolveTheme(themeSettings: ThemeSettings | undefined): ThemeTokens {
  if (!themeSettings) {
    return DEFAULT_THEME;
  }

  // preset 不为 "custom" 时使用默认主题
  if (themeSettings.preset !== "custom") {
    return DEFAULT_THEME;
  }

  // preset="custom"：应用用户自定义
  if (themeSettings.tokens) {
    return deepMerge(DEFAULT_THEME, themeSettings.tokens);
  }
  if (themeSettings.overrides) {
    return deepMerge(DEFAULT_THEME, themeSettings.overrides);
  }

  // preset="custom" 但没有提供自定义内容，回退默认
  return DEFAULT_THEME;
}
