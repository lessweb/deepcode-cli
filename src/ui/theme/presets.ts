import type { ThemeTokens } from "./types";

/** 系统默认主题（唯一内置主题） */
export const DEFAULT_THEME: ThemeTokens = {
  accent: "#229ac3",
  accentAlpha: "#229ac3e6",
  active: "#89B4FA",
  success: "#52c41a",
  error: "#ff4d4f",
  warning: "#faad14",
  info: "#1677ff",
  riskLow: "#22c55e",
  riskMedium: "#f59e0b",
  riskHigh: "#ef4444",
  text: "#6C7086",
  textDim: "#6C7086",
  code: "#787f8a",
  border: "#4C566A",
  thinking: "#CCCFD3",
  gradients: ["#229ac3", "#7c3aed"],
};

/** 预设主题映射表 */
export const PRESETS: Record<string, ThemeTokens> = {
  default: DEFAULT_THEME,
};
