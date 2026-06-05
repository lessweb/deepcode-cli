import type { ColorsTheme } from "./colors-theme";

/** 主题颜色 Token 定义 */
export interface ThemeTokens {
  /** 主题显示名称（在 /theme 选择器中展示） */
  name: string;
  /** 主题模式 */
  mode: "light" | "dark";

  // ——— 文字色 ———
  text: {
    /** 主文字 */
    primary: string;
    /** 次要文字：标签、描述 */
    secondary: string;
    /** 暗化文字：提示、占位符、引用块 */
    muted: string;
    /** 禁用文字 */
    disabled: string;
    /** 反色文字：深色背景上的亮色文字（如代码块标签） */
    inverse: string;
  };

  // ——— 边框色 ———
  border: {
    /** 默认边框 */
    default: string;
    /** 淡化边框：内部分割线 */
    subtle: string;
    /** 激活边框：选中项、下拉菜单 */
    active: string;
    /** 聚焦边框：输入框聚焦态 */
    focus: string;
  };

  // ——— 表面色 ———
  surface: {
    /** 默认背景 */
    default: string;
    /** 提升背景：弹出层、卡片 */
    elevated: string;
    /** 暗化背景：代码块、面板 */
    muted: string;
    /** 代码背景 */
    code: string;
    /** 面板背景 */
    panel: string;
    /** 引用块背景 */
    quote: string;
    /** 选中行背景 */
    selection: string;
  };

  // ——— 品牌色 ———
  brand: {
    /** 品牌主色：Logo、渐变起始色 */
    primary: string;
    /** 品牌辅色：渐变终止色 */
    secondary: string;
    /** 强调色：选中项、光标、交互态 */
    accent: string;
  };

  // ——— 状态色 ———
  status: {
    /** 成功：工具执行成功、MCP ready */
    success: string;
    /** 警告：MCP 启动/重连、进行中 */
    warning: string;
    /** 危险：错误、工具失败 */
    danger: string;
    /** 信息：技能加载、图片附件 */
    info: string;
  };

  // ——— 风险色 ———
  risk: {
    /** 低风险：read-in-cwd、query-git-log */
    low: string;
    /** 中风险：read-out-cwd、write-in-cwd、network、mcp */
    medium: string;
    /** 高风险：write-out-cwd、delete-in-cwd */
    high: string;
    /** 极高风险：delete-out-cwd、mutate-git-log */
    critical: string;
  };

  // ——— 排版色 ———
  typography: {
    h1: string;
    h2: string;
    h3: string;
    h4: string;
    h5: string;
    h6: string;
    /** 段落文字 */
    paragraph: string;
    /** 粗体 */
    strong: string;
    /** 斜体 */
    emphasis: string;
    /** 删除线 */
    delete: string;
  };

  // ——— 链接色 ———
  link: {
    /** 默认链接 */
    default: string;
    /** 已访问链接 */
    visited: string;
    /** 悬停链接 */
    hover: string;
  };

  // ——— 行内代码 ———
  inlineCode: {
    /** 前景色 */
    foreground: string;
    /** 背景色 */
    background: string;
    /** 边框色 */
    border: string;
  };

  // ——— 代码块 ———
  codeBlock: {
    /** 前景色 */
    foreground: string;
    /** 背景色 */
    background: string;
    /** 边框色 */
    border: string;
    /** 标题色 */
    title: string;
    /** 行号色 */
    lineNumber: string;
    /** 高亮行色 */
    highlight: string;
  };

  // ——— 语法高亮 ———
  syntax: {
    keyword: string;
    string: string;
    function: string;
    variable: string;
    property: string;
    type: string;
    number: string;
    operator: string;
    punctuation: string;
    comment: string;
    regexp: string;
    constant: string;
  };

  // ——— 引用块 ———
  blockquote: {
    /** 引用文字色 */
    foreground: string;
    /** 引用边框色 */
    border: string;
  };

  // ——— 列表 ———
  list: {
    /** 无序列表标记 */
    bullet: string;
    /** 有序列表标记 */
    ordered: string;
    /** 列表标记（通用） */
    marker: string;
  };

  // ——— 任务列表 ———
  task: {
    /** 已完成 */
    checked: string;
    /** 未完成 */
    unchecked: string;
  };

  // ——— 表格 ———
  table: {
    /** 表格边框 */
    border: string;
    /** 表头文字 */
    headerForeground: string;
    /** 表头背景 */
    headerBackground: string;
    /** 单元格文字 */
    cellForeground: string;
  };

  // ——— 分割线 ———
  hr: {
    /** 分割线颜色 */
    foreground: string;
  };

  // ——— 提示框 ———
  admonition: {
    note: string;
    tip: string;
    warning: string;
    important: string;
    caution: string;
  };

  // ——— Diff ———
  diff: {
    /** 新增行文字 */
    added: string;
    /** 删除行文字 */
    removed: string;
    /** 修改行文字 */
    modified: string;
    /** 新增行背景 */
    addedBackground: string;
    /** 删除行背景 */
    removedBackground: string;
    /** 修改行背景 */
    modifiedBackground: string;
  };

  // ——— Agent 状态色 ———
  agent: {
    /** 思考中 */
    thinking: string;
    /** 推理中 */
    reasoning: string;
    /** 工具调用 */
    toolCall: string;
    /** 工具结果 */
    toolResult: string;
    /** 流式输出/忙碌 */
    streaming: string;
    /** 完成 */
    completed: string;
  };

  // ——— 审批色 ———
  approval: {
    /** 允许 */
    allow: string;
    /** 拒绝 */
    deny: string;
    /** 审查 */
    review: string;
  };

  // ——— 渐变 ———
  gradients: {
    /** Banner 渐变 */
    banner: string[];
    /** Logo 渐变 */
    logo: string[];
    /** 思考状态渐变 */
    thinking: string[];
  };
}

/** 预设主题名称 */
export type ThemePreset =
  | "light"
  | "dark"
  | "monokai"
  | "dracula"
  | "github-light"
  | "github-dark"
  | "ansi-light"
  | "ansi-dark"
  | "custom";

/** 主题配置（用户可配置部分） */
export type ThemeSettings = {
  /** 选择预设主题，如 "light"、"dark" 等；"custom" 使用用户自定义 */
  preset?: ThemePreset;
  /** custom 模式下的基础预设，默认 "light"。基于此预设做 overrides 合并 */
  base?: ThemePreset;
  /** 简化色板配置（仅 preset="custom" 时生效）。系统自动推导完整 token */
  colors?: ColorsTheme;
  /** 覆盖部分 token（仅 preset="custom" 时生效，可与 colors 配合使用） */
  overrides?: Partial<ThemeTokens>;
  /** 完全自定义（仅 preset="custom" 时生效，优先级最高） */
  tokens?: ThemeTokens;
};
