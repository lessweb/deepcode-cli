import chalk, { type ChalkInstance } from "chalk";
import type { ThemeTokens } from "./types";

/**
 * 将 ThemeTokens 中的颜色 token 转换为实际的 chalk 颜色实例。
 * 对于命名颜色（如 "cyanBright"），通过 chalk 的索引访问获取对应颜色函数。
 * 对于 hex 颜色，直接用 chalk.hex()。
 */
function chalkColor(color: string): ChalkInstance {
  // 尝试 hex 格式
  if (color.startsWith("#")) {
    return chalk.hex(color);
  }
  // 尝试 chalk 命名颜色（如 "cyanBright" → chalk.cyanBright）
  const chalkWithIndex = chalk as unknown as Record<string, ChalkInstance>;
  const instance = chalkWithIndex[color];
  if (instance) {
    return instance;
  }
  return chalk;
}

/**
 * 根据主题创建 chalk 样式函数集合。
 * 用于 markdown 渲染、raw mode 输出等非 Ink 组件的终端输出。
 */
export interface ThemedChalk {
  heading1: (text: string) => string;
  heading2: (text: string) => string;
  heading3: (text: string) => string;
  listBullet: (text: string) => string;
  quote: (text: string) => string;
  inlineCode: (text: string) => string;
  code: (text: string) => string;
  bold: (text: string) => string;
  italic: (text: string) => string;
  dim: (text: string) => string;
  primary: (text: string) => string;
  secondary: (text: string) => string;
  text: (text: string) => string;
  textDim: (text: string) => string;
  success: (text: string) => string;
  error: (text: string) => string;
  warning: (text: string) => string;
  info: (text: string) => string;
}

export function createThemedChalk(theme: ThemeTokens): ThemedChalk {
  const pr = chalkColor(theme.primary);
  const se = chalkColor(theme.secondary);
  const tx = chalkColor(theme.text);
  const td = chalkColor(theme.textDim);
  const cd = chalkColor(theme.code);
  const sc = chalkColor(theme.success);
  const er = chalkColor(theme.error);
  const wr = chalkColor(theme.warning);
  const inf = chalkColor(theme.info);

  return {
    // Markdown 渲染 — 直接复用顶层 token
    heading1: (text: string) => chalk.bold(pr(text)),
    heading2: (text: string) => chalk.bold(pr(text)),
    heading3: (text: string) => chalk.bold(pr(text)),
    listBullet: (text: string) => wr(text),
    quote: (text: string) => chalk.italic(td(text)),
    inlineCode: (text: string) => cd(text),
    code: (text: string) => cd(text),
    // 基础样式
    bold: (text: string) => chalk.bold(text),
    italic: (text: string) => chalk.italic(text),
    dim: (text: string) => chalk.dim(text),
    // 语义色
    primary: (text: string) => pr(text),
    secondary: (text: string) => se(text),
    text: (text: string) => tx(text),
    textDim: (text: string) => td(text),
    success: (text: string) => sc(text),
    error: (text: string) => er(text),
    warning: (text: string) => wr(text),
    info: (text: string) => inf(text),
  };
}
