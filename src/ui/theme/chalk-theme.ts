import chalk, { type ChalkInstance } from "chalk";
import type { ThemeTokens } from "./types";

/**
 * 将 ThemeTokens 中的颜色 token 转换为实际的 chalk 颜色实例。
 * 对于命名颜色（如 "cyanBright"），通过 chalk 的索引访问获取对应颜色函数。
 * 对于 hex 颜色，直接用 chalk.hex()。
 */
function chalkColor(color: string): ChalkInstance {
  if (color.startsWith("#")) {
    return chalk.hex(color);
  }
  const chalkWithIndex = chalk as unknown as Record<string, ChalkInstance>;
  const instance = chalkWithIndex[color];
  if (instance) {
    return instance;
  }
  return chalk;
}

/**
 * 创建背景色 chalk 实例。
 * hex 颜色使用 chalk.bgHex()，命名颜色使用 chalk.bgXxx()。
 */
function chalkBgColor(color: string): ChalkInstance {
  if (color.startsWith("#")) {
    return chalk.bgHex(color);
  }
  const name = `bg${color.charAt(0).toUpperCase()}${color.slice(1)}`;
  const chalkWithIndex = chalk as unknown as Record<string, ChalkInstance>;
  const instance = chalkWithIndex[name];
  if (instance) {
    return instance;
  }
  return chalk;
}

type StyleFn = (text: string) => string;

/**
 * 主题化 chalk 样式函数集合。
 * 与 ThemeTokens 分组一一对应，用于 markdown 渲染、raw mode 输出等非 Ink 组件的终端输出。
 */
export interface ThemedChalk {
  // ——— text ———
  text: StyleFn;
  textSecondary: StyleFn;
  textMuted: StyleFn;
  textDisabled: StyleFn;
  textInverse: StyleFn;

  // ——— border ———
  borderDefault: StyleFn;
  borderSubtle: StyleFn;
  borderActive: StyleFn;
  borderFocus: StyleFn;

  // ——— surface ———
  surfaceDefault: StyleFn;
  surfaceElevated: StyleFn;
  surfaceMuted: StyleFn;
  surfaceCode: StyleFn;
  surfacePanel: StyleFn;
  surfaceQuote: StyleFn;
  surfaceSelection: StyleFn;

  // ——— brand ———
  brandPrimary: StyleFn;
  brandSecondary: StyleFn;
  brandAccent: StyleFn;

  // ——— status ———
  success: StyleFn;
  warning: StyleFn;
  danger: StyleFn;
  info: StyleFn;

  // ——— risk ———
  riskLow: StyleFn;
  riskMedium: StyleFn;
  riskHigh: StyleFn;
  riskCritical: StyleFn;

  // ——— typography (Markdown 渲染) ———
  heading1: StyleFn;
  heading2: StyleFn;
  heading3: StyleFn;
  heading4: StyleFn;
  heading5: StyleFn;
  heading6: StyleFn;
  paragraph: StyleFn;
  strong: StyleFn;
  emphasis: StyleFn;
  delete: StyleFn;

  // ——— link ———
  link: StyleFn;
  linkVisited: StyleFn;
  linkHover: StyleFn;

  // ——— inlineCode ———
  inlineCode: StyleFn;
  inlineCodeBg: StyleFn;
  inlineCodeBorder: StyleFn;

  // ——— codeBlock ———
  code: StyleFn;
  codeBg: StyleFn;
  codeBorder: StyleFn;
  codeTitle: StyleFn;
  lineNumber: StyleFn;
  codeHighlight: StyleFn;

  // ——— syntax ———
  syntaxKeyword: StyleFn;
  syntaxString: StyleFn;
  syntaxFunction: StyleFn;
  syntaxVariable: StyleFn;
  syntaxProperty: StyleFn;
  syntaxType: StyleFn;
  syntaxNumber: StyleFn;
  syntaxOperator: StyleFn;
  syntaxPunctuation: StyleFn;
  syntaxComment: StyleFn;
  syntaxRegexp: StyleFn;
  syntaxConstant: StyleFn;

  // ——— blockquote ———
  quote: StyleFn;
  quoteBorder: StyleFn;

  // ——— list ———
  listBullet: StyleFn;
  listOrdered: StyleFn;
  listMarker: StyleFn;

  // ——— task ———
  taskChecked: StyleFn;
  taskUnchecked: StyleFn;

  // ——— table ———
  tableBorder: StyleFn;
  tableHeaderFg: StyleFn;
  tableHeaderBg: StyleFn;
  tableCellFg: StyleFn;

  // ——— hr ———
  hr: StyleFn;

  // ——— admonition ———
  admonitionNote: StyleFn;
  admonitionTip: StyleFn;
  admonitionWarning: StyleFn;
  admonitionImportant: StyleFn;
  admonitionCaution: StyleFn;

  // ——— diff ———
  diffAdded: StyleFn;
  diffRemoved: StyleFn;
  diffModified: StyleFn;
  diffAddedBg: StyleFn;
  diffRemovedBg: StyleFn;
  diffModifiedBg: StyleFn;

  // ——— agent ———
  agentThinking: StyleFn;
  agentReasoning: StyleFn;
  agentToolCall: StyleFn;
  agentToolResult: StyleFn;
  agentStreaming: StyleFn;
  agentCompleted: StyleFn;

  // ——— approval ———
  approvalAllow: StyleFn;
  approvalDeny: StyleFn;
  approvalReview: StyleFn;

  // ——— chalk 修饰符（不依赖主题色） ———
  bold: StyleFn;
  italic: StyleFn;
  dim: StyleFn;
}

export function createThemedChalk(theme: ThemeTokens): ThemedChalk {
  // text
  const txPrimary = chalkColor(theme.text.primary);
  const txSecondary = chalkColor(theme.text.secondary);
  const txMuted = chalkColor(theme.text.muted);
  const txDisabled = chalkColor(theme.text.disabled);
  const txInverse = chalkColor(theme.text.inverse);

  // border
  const brDefault = chalkColor(theme.border.default);
  const brSubtle = chalkColor(theme.border.subtle);
  const brActive = chalkColor(theme.border.active);
  const brFocus = chalkColor(theme.border.focus);

  // surface (background)
  const sfDefault = chalkBgColor(theme.surface.default);
  const sfElevated = chalkBgColor(theme.surface.elevated);
  const sfMuted = chalkBgColor(theme.surface.muted);
  const sfCode = chalkBgColor(theme.surface.code);
  const sfPanel = chalkBgColor(theme.surface.panel);
  const sfQuote = chalkBgColor(theme.surface.quote);
  const sfSelection = chalkBgColor(theme.surface.selection);

  // brand
  const brBrandPrimary = chalkColor(theme.brand.primary);
  const brBrandSecondary = chalkColor(theme.brand.secondary);
  const brBrandAccent = chalkColor(theme.brand.accent);

  // status
  const stSuccess = chalkColor(theme.status.success);
  const stWarning = chalkColor(theme.status.warning);
  const stDanger = chalkColor(theme.status.danger);
  const stInfo = chalkColor(theme.status.info);

  // risk
  const rkLow = chalkColor(theme.risk.low);
  const rkMedium = chalkColor(theme.risk.medium);
  const rkHigh = chalkColor(theme.risk.high);
  const rkCritical = chalkColor(theme.risk.critical);

  // typography
  const h1 = chalkColor(theme.typography.h1);
  const h2 = chalkColor(theme.typography.h2);
  const h3 = chalkColor(theme.typography.h3);
  const h4 = chalkColor(theme.typography.h4);
  const h5 = chalkColor(theme.typography.h5);
  const h6 = chalkColor(theme.typography.h6);
  const strong = chalkColor(theme.typography.strong);
  const em = chalkColor(theme.typography.emphasis);
  const del = chalkColor(theme.typography.delete);

  // link
  const lnk = chalkColor(theme.link.default);
  const lnkVisited = chalkColor(theme.link.visited);
  const lnkHover = chalkColor(theme.link.hover);

  // inlineCode
  const icFg = chalkColor(theme.inlineCode.foreground);
  const icBg = chalkBgColor(theme.inlineCode.background);
  const icBorder = chalkColor(theme.inlineCode.border);

  // codeBlock
  const cbFg = chalkColor(theme.codeBlock.foreground);
  const cbBg = chalkBgColor(theme.codeBlock.background);
  const cbBorder = chalkColor(theme.codeBlock.border);
  const cbTitle = chalkColor(theme.codeBlock.title);
  const cbLineNo = chalkColor(theme.codeBlock.lineNumber);
  const cbHighlight = chalkColor(theme.codeBlock.highlight);

  // syntax
  const synKeyword = chalkColor(theme.syntax.keyword);
  const synString = chalkColor(theme.syntax.string);
  const synFunction = chalkColor(theme.syntax.function);
  const synVariable = chalkColor(theme.syntax.variable);
  const synProperty = chalkColor(theme.syntax.property);
  const synType = chalkColor(theme.syntax.type);
  const synNumber = chalkColor(theme.syntax.number);
  const synOperator = chalkColor(theme.syntax.operator);
  const synPunctuation = chalkColor(theme.syntax.punctuation);
  const synComment = chalkColor(theme.syntax.comment);
  const synRegexp = chalkColor(theme.syntax.regexp);
  const synConstant = chalkColor(theme.syntax.constant);

  // blockquote
  const bqFg = chalkColor(theme.blockquote.foreground);
  const bqBorder = chalkColor(theme.blockquote.border);

  // list
  const lsBullet = chalkColor(theme.list.bullet);
  const lsOrdered = chalkColor(theme.list.ordered);
  const lsMarker = chalkColor(theme.list.marker);

  // task
  const tkChecked = chalkColor(theme.task.checked);
  const tkUnchecked = chalkColor(theme.task.unchecked);

  // table
  const tblBorder = chalkColor(theme.table.border);
  const tblHeaderFg = chalkColor(theme.table.headerForeground);
  const tblHeaderBg = chalkBgColor(theme.table.headerBackground);
  const tblCellFg = chalkColor(theme.table.cellForeground);

  // hr
  const hrFg = chalkColor(theme.hr.foreground);

  // admonition
  const admNote = chalkColor(theme.admonition.note);
  const admTip = chalkColor(theme.admonition.tip);
  const admWarning = chalkColor(theme.admonition.warning);
  const admImportant = chalkColor(theme.admonition.important);
  const admCaution = chalkColor(theme.admonition.caution);

  // diff
  const dfAdded = chalkColor(theme.diff.added);
  const dfRemoved = chalkColor(theme.diff.removed);
  const dfModified = chalkColor(theme.diff.modified);
  const dfAddedBg = chalkBgColor(theme.diff.addedBackground);
  const dfRemovedBg = chalkBgColor(theme.diff.removedBackground);
  const dfModifiedBg = chalkBgColor(theme.diff.modifiedBackground);

  // agent
  const agThinking = chalkColor(theme.agent.thinking);
  const agReasoning = chalkColor(theme.agent.reasoning);
  const agToolCall = chalkColor(theme.agent.toolCall);
  const agToolResult = chalkColor(theme.agent.toolResult);
  const agStreaming = chalkColor(theme.agent.streaming);
  const agCompleted = chalkColor(theme.agent.completed);

  // approval
  const apAllow = chalkColor(theme.approval.allow);
  const apDeny = chalkColor(theme.approval.deny);
  const apReview = chalkColor(theme.approval.review);

  return {
    // text
    text: (t) => txPrimary(t),
    textSecondary: (t) => txSecondary(t),
    textMuted: (t) => txMuted(t),
    textDisabled: (t) => txDisabled(t),
    textInverse: (t) => txInverse(t),

    // border
    borderDefault: (t) => brDefault(t),
    borderSubtle: (t) => brSubtle(t),
    borderActive: (t) => brActive(t),
    borderFocus: (t) => brFocus(t),

    // surface (background)
    surfaceDefault: (t) => sfDefault(t),
    surfaceElevated: (t) => sfElevated(t),
    surfaceMuted: (t) => sfMuted(t),
    surfaceCode: (t) => sfCode(t),
    surfacePanel: (t) => sfPanel(t),
    surfaceQuote: (t) => sfQuote(t),
    surfaceSelection: (t) => sfSelection(t),

    // brand
    brandPrimary: (t) => brBrandPrimary(t),
    brandSecondary: (t) => brBrandSecondary(t),
    brandAccent: (t) => brBrandAccent(t),

    // status
    success: (t) => stSuccess(t),
    warning: (t) => stWarning(t),
    danger: (t) => stDanger(t),
    info: (t) => stInfo(t),

    // risk
    riskLow: (t) => rkLow(t),
    riskMedium: (t) => rkMedium(t),
    riskHigh: (t) => rkHigh(t),
    riskCritical: (t) => rkCritical(t),

    // typography
    heading1: (t) => chalk.bold(h1(t)),
    heading2: (t) => chalk.bold(h2(t)),
    heading3: (t) => chalk.bold(h3(t)),
    heading4: (t) => chalk.bold(h4(t)),
    heading5: (t) => chalk.bold(h5(t)),
    heading6: (t) => chalk.bold(h6(t)),
    paragraph: (t) => txPrimary(t),
    strong: (t) => chalk.bold(strong(t)),
    emphasis: (t) => chalk.italic(em(t)),
    delete: (t) => del(t),

    // link
    link: (t) => lnk(t),
    linkVisited: (t) => lnkVisited(t),
    linkHover: (t) => lnkHover(t),

    // inlineCode
    inlineCode: (t) => icFg(t),
    inlineCodeBg: (t) => icBg(t),
    inlineCodeBorder: (t) => icBorder(t),

    // codeBlock
    code: (t) => cbFg(t),
    codeBg: (t) => cbBg(t),
    codeBorder: (t) => cbBorder(t),
    codeTitle: (t) => cbTitle(t),
    lineNumber: (t) => cbLineNo(t),
    codeHighlight: (t) => cbHighlight(t),

    // syntax
    syntaxKeyword: (t) => synKeyword(t),
    syntaxString: (t) => synString(t),
    syntaxFunction: (t) => synFunction(t),
    syntaxVariable: (t) => synVariable(t),
    syntaxProperty: (t) => synProperty(t),
    syntaxType: (t) => synType(t),
    syntaxNumber: (t) => synNumber(t),
    syntaxOperator: (t) => synOperator(t),
    syntaxPunctuation: (t) => synPunctuation(t),
    syntaxComment: (t) => synComment(t),
    syntaxRegexp: (t) => synRegexp(t),
    syntaxConstant: (t) => synConstant(t),

    // blockquote
    quote: (t) => chalk.italic(bqFg(t)),
    quoteBorder: (t) => bqBorder(t),

    // list
    listBullet: (t) => lsBullet(t),
    listOrdered: (t) => lsOrdered(t),
    listMarker: (t) => lsMarker(t),

    // task
    taskChecked: (t) => tkChecked(t),
    taskUnchecked: (t) => tkUnchecked(t),

    // table
    tableBorder: (t) => tblBorder(t),
    tableHeaderFg: (t) => tblHeaderFg(t),
    tableHeaderBg: (t) => tblHeaderBg(t),
    tableCellFg: (t) => tblCellFg(t),

    // hr
    hr: (t) => hrFg(t),

    // admonition
    admonitionNote: (t) => admNote(t),
    admonitionTip: (t) => admTip(t),
    admonitionWarning: (t) => admWarning(t),
    admonitionImportant: (t) => admImportant(t),
    admonitionCaution: (t) => admCaution(t),

    // diff
    diffAdded: (t) => dfAdded(t),
    diffRemoved: (t) => dfRemoved(t),
    diffModified: (t) => dfModified(t),
    diffAddedBg: (t) => dfAddedBg(t),
    diffRemovedBg: (t) => dfRemovedBg(t),
    diffModifiedBg: (t) => dfModifiedBg(t),

    // agent
    agentThinking: (t) => agThinking(t),
    agentReasoning: (t) => agReasoning(t),
    agentToolCall: (t) => agToolCall(t),
    agentToolResult: (t) => agToolResult(t),
    agentStreaming: (t) => agStreaming(t),
    agentCompleted: (t) => agCompleted(t),

    // approval
    approvalAllow: (t) => apAllow(t),
    approvalDeny: (t) => apDeny(t),
    approvalReview: (t) => apReview(t),

    // chalk 修饰符
    bold: (t) => chalk.bold(t),
    italic: (t) => chalk.italic(t),
    dim: (t) => chalk.dim(t),
  };
}
