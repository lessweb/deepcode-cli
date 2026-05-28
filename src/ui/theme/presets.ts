import type { ThemeTokens } from "./types";

/** 系统默认主题（唯一内置主题） */
export const DEFAULT_THEME: ThemeTokens = {
  primary: "#229ac3",
  secondary: "#229ac3e6",
  success: "#52c41a",
  error: "#f5222d",
  warning: "#fa8c16",
  info: "#2f54eb",
  riskLow: "#22c55e",
  riskMedium: "#f59e0b",
  riskHigh: "#ef4444",
  text: "#3D4149",
  textDim: "#646A71",
  code: "#787f8a",
  border: "#ABADB1",
  thinking: "#ff4400",
  gradients: ["#229ac3", "#7c3aed"],
};

/** 预设主题映射表 */
export const PRESETS: Record<string, ThemeTokens> = {
  default: DEFAULT_THEME,
};
