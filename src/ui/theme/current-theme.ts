import { DEFAULT_THEME } from "./presets";
import { createThemedChalk, type ThemedChalk } from "./chalk-theme";
import type { ThemeTokens } from "./types";

let currentThemedChalk: ThemedChalk = createThemedChalk(DEFAULT_THEME);
let currentThemeTokens: ThemeTokens = DEFAULT_THEME;

/** 设置当前主题（在 AppContainer 中调用一次） */
export function setCurrentTheme(theme: ThemeTokens): void {
  currentThemeTokens = theme;
  currentThemedChalk = createThemedChalk(theme);
}

/** 获取当前主题的 chalk 样式工具 */
export function getCurrentThemedChalk(): ThemedChalk {
  return currentThemedChalk;
}

/** 获取当前 ThemeTokens */
export function getCurrentThemeTokens(): ThemeTokens {
  return currentThemeTokens;
}
