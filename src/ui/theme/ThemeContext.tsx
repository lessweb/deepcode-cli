import { createContext, useContext } from "react";
import type { ThemeTokens } from "./types";
import { LIGHT_THEME } from "./presets";

/** 主题 React Context */
const ThemeContext = createContext<ThemeTokens>(LIGHT_THEME);

/** 主题 Provider */
export const ThemeProvider = ThemeContext.Provider;

/** 获取当前主题 token */
export function useTheme(): ThemeTokens {
  return useContext(ThemeContext);
}
