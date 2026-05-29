/** 主题颜色 Token 定义 */
export interface ThemeTokens {
  // ——— 品牌色 ———
  /** 主品牌色：Logo、用户消息、选中项，及 Markdown H1-H6 标题 */
  primary: string;
  /** 辅助品牌色：边框、渐变 */
  secondary: string;

  // ——— 语义颜色 ———
  /** 成功：工具执行成功、MCP ready，低风险操作 */
  success: string;
  /** 失败/错误：工具执行失败、错误信息，高风险操作 */
  error: string;
  /** 警告/进行中：忙时 spinner、权限提示、中风险操作，及 Markdown 列表标记 */
  warning: string;
  /** 特殊指示：技能、图片附件 */
  info: string;

  // ——— 基础色 ———
  /** 主文字颜色 */
  text: string;
  /** 次要文字：暗化提示，及 Markdown 引用块 */
  textDim: string;
  /** 亮色文字：强调提示 */
  textBright: string;
  /** 代码块/内联代码 */
  code: string;
  /** 边框 */
  border: string;

  // ——— 渐变 ———
  /** Logo 渐变色数组 */
  gradients: string[];
}

/** 预设主题名称 */
export type ThemePreset = "default" | "custom";

/** 主题配置（用户可配置部分） */
export type ThemeSettings = {
  /** 选择预设主题："default" 使用系统默认，"custom" 使用用户自定义 */
  preset?: ThemePreset;
  /** 覆盖部分 token（仅 preset="custom" 时生效） */
  overrides?: Partial<ThemeTokens>;
  /** 完全自定义（仅 preset="custom" 时生效，优先级高于 overrides） */
  tokens?: ThemeTokens;
};
