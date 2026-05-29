import type { ThemeTokens } from "./types";

/** 系统默认主题（唯一内置主题） */
export const DEFAULT_THEME: ThemeTokens = {
  primary: "#229ac3",
  secondary: "#229ac3e6",
  success: "#1a7f37",
  error: "#d1242f",
  warning: "#fa8c16",
  info: "#0969da",
  text: "#3D4149",
  textDim: "#646A71",
  textBright: "#646A71",
  code: "#787f8a",
  border: "#999",
  gradients: ["#229ac3", "#8250df"],
};

/** 预设主题映射表 */
export const PRESETS: Record<string, ThemeTokens> = {
  default: DEFAULT_THEME,
};
