import type { ThemeTokens } from "./types";
import type { DetectedTheme } from "./detect-system-theme";

/**
 * 用户配置的简化主题色板。
 * 只需定义基础色，系统自动推导出完整的 ThemeTokens。
 */
export interface ColorsTheme {
  /** 主背景色 */
  Background: string;
  /** 主前景/文字色 */
  Foreground: string;
  /** 次要文字色（dimmed） */
  Gray: string;
  /** 浅蓝：信息提示、链接 */
  LightBlue: string;
  /** 强调蓝：品牌色、交互态、选中项 */
  AccentBlue: string;
  /** 紫色：特殊强调、已访问链接 */
  AccentPurple: string;
  /** 青色：代码高亮 */
  AccentCyan: string;
  /** 绿色：成功、diff 新增 */
  AccentGreen: string;
  /** 黄色：警告、进行中 */
  AccentYellow: string;
  /** 红色：错误、危险 */
  AccentRed: string;
  /** 黄色淡化：中风险、列表标记 */
  AccentYellowDim: string;
  /** 红色淡化：高风险 */
  AccentRedDim: string;
  /** Diff 新增行背景 */
  DiffAdded: string;
  /** Diff 删除行背景 */
  DiffRemoved: string;
  /** 注释色 */
  Comment: string;
  /** 渐变色数组（可选） */
  GradientColors?: string[];
}

/**
 * 将 hex 颜色淡化（混合灰色）。
 * 对非 hex 命名色（如 ANSI 的 "white"、"black"）返回原色，不做淡化。
 */
function dimHex(hex: string, ratio: number): string {
  if (!hex.startsWith("#")) {
    return hex;
  }
  const h = hex.slice(1);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const gr = 128;
  const dr = Math.round(r + (gr - r) * ratio);
  const dg = Math.round(g + (gr - g) * ratio);
  const db = Math.round(b + (gr - b) * ratio);
  return `#${dr.toString(16).padStart(2, "0")}${dg.toString(16).padStart(2, "0")}${db.toString(16).padStart(2, "0")}`;
}

/**
 * 从 ColorsTheme 推导完整的 ThemeTokens。
 *
 * @param c 自定义主题色板
 * @param mode 主题模式
 * @param name 主题显示名称
 * @param terminalBackground - 终端实际背景色（可选）。当与 mode 不匹配时，
 *   自动反转文字色以确保对比度。例如 light 主题 + 深色终端 → 文字变亮。
 */
export function buildThemeTokens(
  c: ColorsTheme,
  mode: DetectedTheme,
  name: string,
  terminalBackground?: DetectedTheme
): ThemeTokens {
  const gradient = c.GradientColors ?? [c.AccentBlue, c.AccentPurple];

  // 判断是否需要反转文字色
  const bgMismatch = terminalBackground && terminalBackground !== mode;
  const needInvert = bgMismatch ?? false;

  // 文字色：当终端背景与主题模式不匹配时反转，确保对比度
  // fg = 当前终端上实际使用的前景色
  // inverse = fg 的反色（用于 badge、高亮等需要反差的场景）
  // muted/disabled = 中性色，深浅背景上都可读
  const fg = needInvert ? c.Background : c.Foreground;
  const inv = needInvert ? c.Foreground : c.Background;

  return {
    name,
    mode,
    text: {
      primary: fg,
      secondary: dimHex(fg, 0.4),
      muted: c.Gray,
      disabled: dimHex(c.Gray, 0.5),
      inverse: inv,
    },
    border: {
      default: dimHex(fg, 0.7),
      subtle: dimHex(fg, 0.85),
      active: c.AccentBlue,
      focus: c.AccentBlue,
    },
    surface: {
      default: c.Background,
      elevated: mode === "dark" ? dimHex(c.Background, 0.15) : "#ffffff",
      muted: dimHex(c.Background, 0.08),
      code: dimHex(c.Background, 0.08),
      panel: dimHex(c.Background, 0.08),
      quote: dimHex(c.Background, 0.08),
      selection: mode === "dark" ? "#264f78" : "#ddf4ff",
    },
    brand: {
      primary: c.AccentBlue,
      secondary: `${c.AccentBlue}cc`,
      accent: c.AccentBlue,
    },
    status: {
      success: c.AccentGreen,
      warning: c.AccentYellow,
      danger: c.AccentRed,
      info: c.LightBlue,
    },
    risk: {
      low: c.AccentGreen,
      medium: c.AccentYellowDim,
      high: c.AccentRed,
      critical: c.AccentRed,
    },
    typography: {
      h1: c.AccentBlue,
      h2: c.AccentBlue,
      h3: c.AccentBlue,
      h4: c.AccentBlue,
      h5: c.AccentBlue,
      h6: c.AccentBlue,
      paragraph: fg,
      strong: fg,
      emphasis: fg,
      delete: c.AccentRed,
    },
    link: {
      default: c.LightBlue,
      visited: c.AccentPurple,
      hover: c.LightBlue,
    },
    inlineCode: {
      foreground: `${c.AccentPurple}cc`,
      background: dimHex(c.Background, 0.08),
      border: dimHex(fg, 0.7),
    },
    codeBlock: {
      foreground: fg,
      background: mode === "dark" ? dimHex(c.Background, 0.15) : dimHex(c.Background, 0.05),
      border: dimHex(fg, 0.7),
      title: fg,
      lineNumber: c.Gray,
      highlight: mode === "dark" ? "#2d333b" : "#fff8c5",
    },
    syntax: {
      keyword: c.AccentRed,
      string: mode === "dark" ? "#a5d6ff" : "#0a3069",
      function: c.AccentPurple,
      variable: mode === "dark" ? "#ffa657" : "#953800",
      property: c.AccentCyan,
      type: mode === "dark" ? "#ffa657" : "#953800",
      number: c.AccentCyan,
      operator: c.AccentRed,
      punctuation: fg,
      comment: c.Comment,
      regexp: c.AccentGreen,
      constant: c.AccentCyan,
    },
    blockquote: {
      foreground: c.Gray,
      border: dimHex(fg, 0.7),
    },
    list: {
      bullet: c.AccentYellowDim,
      ordered: c.AccentYellowDim,
      marker: c.AccentYellowDim,
    },
    task: {
      checked: c.AccentGreen,
      unchecked: dimHex(fg, 0.7),
    },
    table: {
      border: dimHex(fg, 0.7),
      headerForeground: fg,
      headerBackground: dimHex(c.Background, 0.08),
      cellForeground: fg,
    },
    hr: { foreground: dimHex(fg, 0.7) },
    admonition: {
      note: c.LightBlue,
      tip: c.AccentGreen,
      warning: c.AccentYellow,
      important: c.AccentPurple,
      caution: c.AccentRed,
    },
    diff: {
      added: c.AccentGreen,
      removed: c.AccentRed,
      modified: c.AccentYellow,
      addedBackground: c.DiffAdded,
      removedBackground: c.DiffRemoved,
      modifiedBackground: mode === "dark" ? "#2d2700" : "#fff8c5",
    },
    agent: {
      thinking: c.Comment,
      reasoning: c.Comment,
      toolCall: c.AccentBlue,
      toolResult: c.Gray,
      streaming: c.AccentYellow,
      completed: c.AccentGreen,
    },
    approval: {
      allow: c.AccentGreen,
      deny: c.AccentRed,
      review: c.AccentYellow,
    },
    gradients: {
      banner: gradient,
      logo: gradient,
      thinking: [c.Comment, c.Gray],
    },
  };
}
