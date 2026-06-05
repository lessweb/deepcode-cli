import type { ThemeTokens } from "./types";
import type { ColorsTheme } from "./colors-theme";
import { buildThemeTokens } from "./colors-theme";

// ——— 预设色板 ———

const LIGHT_COLORS: ColorsTheme = {
  Background: "#ffffff",
  Foreground: "#1F2328",
  Gray: "#8b949e",
  LightBlue: "#0969da",
  AccentBlue: "#229ac3",
  AccentPurple: "#8250df",
  AccentCyan: "#0550ae",
  AccentGreen: "#1a7f37",
  AccentYellow: "#fa8c16",
  AccentRed: "#d1242f",
  AccentYellowDim: "#9a6700",
  AccentRedDim: "#a40e26",
  DiffAdded: "#dafbe1",
  DiffRemoved: "#ffebe9",
  Comment: "#6e7781",
  GradientColors: ["#229ac3", "#8250df"],
};

const DARK_COLORS: ColorsTheme = {
  Background: "#0d1117",
  Foreground: "#e6edf3",
  Gray: "#6e7681",
  LightBlue: "#58a6ff",
  AccentBlue: "#229ac3",
  AccentPurple: "#bc8cff",
  AccentCyan: "#79c0ff",
  AccentGreen: "#3fb950",
  AccentYellow: "#d29922",
  AccentRed: "#f85149",
  AccentYellowDim: "#d29922",
  AccentRedDim: "#f85149",
  DiffAdded: "#12261e",
  DiffRemoved: "#2d1518",
  Comment: "#8b949e",
  GradientColors: ["#229ac3", "#8250df"],
};

const GITHUB_LIGHT_COLORS: ColorsTheme = {
  Background: "#f8f8f8",
  Foreground: "#24292E",
  LightBlue: "#0086b3",
  AccentBlue: "#458",
  AccentPurple: "#900",
  AccentCyan: "#009926",
  AccentGreen: "#008080",
  AccentYellow: "#990073",
  AccentRed: "#d14",
  AccentYellowDim: "#8B7000",
  AccentRedDim: "#993333",
  DiffAdded: "#C6EAD8",
  DiffRemoved: "#FFCCCC",
  Comment: "#998",
  Gray: "#999",
  GradientColors: ["#458", "#008080"],
};

const GITHUB_DARK_COLORS: ColorsTheme = {
  Background: "#24292e",
  Foreground: "#c0c4c8",
  LightBlue: "#79B8FF",
  AccentBlue: "#79B8FF",
  AccentPurple: "#B392F0",
  AccentCyan: "#9ECBFF",
  AccentGreen: "#85E89D",
  AccentYellow: "#FFAB70",
  AccentRed: "#F97583",
  AccentYellowDim: "#8B7530",
  AccentRedDim: "#8B3A4A",
  DiffAdded: "#3C4636",
  DiffRemoved: "#502125",
  Comment: "#6A737D",
  Gray: "#6A737D",
  GradientColors: ["#79B8FF", "#85E89D"],
};

const DRACULA_THEME_COLORS: ColorsTheme = {
  Background: "#282a36",
  Foreground: "#a3afb7",
  LightBlue: "#8be9fd",
  AccentBlue: "#8be9fd",
  AccentPurple: "#ff79c6",
  AccentCyan: "#8be9fd",
  AccentGreen: "#50fa7b",
  AccentYellow: "#fff783",
  AccentRed: "#ff5555",
  AccentYellowDim: "#8B7530",
  AccentRedDim: "#8B3A4A",
  DiffAdded: "#11431d",
  DiffRemoved: "#6e1818",
  Comment: "#6272a4",
  Gray: "#6272a4",
  GradientColors: ["#ff79c6", "#8be9fd"],
};

/** ANSI Light 终端色主题（浅色背景） */
const ANSI_LIGHT_COLORS: ColorsTheme = {
  Background: "white",
  Foreground: "#444",
  LightBlue: "blue",
  AccentBlue: "blue",
  AccentPurple: "purple",
  AccentCyan: "cyan",
  AccentGreen: "green",
  AccentYellow: "orange",
  AccentRed: "red",
  AccentYellowDim: "orange",
  AccentRedDim: "red",
  DiffAdded: "#E5F2E5",
  DiffRemoved: "#FFE5E5",
  Comment: "gray",
  Gray: "gray",
  GradientColors: ["blue", "green"],
};

/** ANSI Dark 终端色主题（深色背景） */
const ANSI_DARK_COLORS: ColorsTheme = {
  Background: "black",
  Foreground: "white",
  LightBlue: "bluebright",
  AccentBlue: "blue",
  AccentPurple: "magenta",
  AccentCyan: "cyan",
  AccentGreen: "green",
  AccentYellow: "yellow",
  AccentRed: "red",
  AccentYellowDim: "yellow",
  AccentRedDim: "red",
  DiffAdded: "#003300",
  DiffRemoved: "#4D0000",
  Comment: "gray",
  Gray: "gray",
  GradientColors: ["cyan", "green"],
};

/** Monokai 色板（text.primary 使用品牌色而非前景色，需 overrides） */
const MONOKAI_COLORS: ColorsTheme = {
  Background: "#272822",
  Foreground: "#f8f8f2",
  Gray: "#75715e",
  LightBlue: "#66d9ef",
  AccentBlue: "#f92672",
  AccentPurple: "#ae81ff",
  AccentCyan: "#66d9ef",
  AccentGreen: "#a6e22e",
  AccentYellow: "#fd971f",
  AccentRed: "#f92672",
  AccentYellowDim: "#fd971f",
  AccentRedDim: "#f92672",
  DiffAdded: "#2d3a1f",
  DiffRemoved: "#3d1a25",
  Comment: "#75715e",
  GradientColors: ["#f92672", "#ae81ff"],
};

// ——— 通过 ColorsTheme 自动推导的预设 ———

/** 浅色主题（默认） */
export const LIGHT_THEME: ThemeTokens = buildThemeTokens(LIGHT_COLORS, "light", "Light");

/** 暗色主题 */
export const DARK_THEME: ThemeTokens = buildThemeTokens(DARK_COLORS, "dark", "Dark");

/** GitHub Light 主题 */
export const GITHUB_LIGHT_THEME: ThemeTokens = buildThemeTokens(GITHUB_LIGHT_COLORS, "light", "GitHub Light");

/** GitHub Dark 主题 */
export const GITHUB_DARK_THEME: ThemeTokens = buildThemeTokens(GITHUB_DARK_COLORS, "dark", "GitHub Dark");

/** Dracula 主题 */
export const DRACULA_THEME: ThemeTokens = buildThemeTokens(DRACULA_THEME_COLORS, "dark", "Dracula");

/** ANSI Light 终端色主题 */
export const ANSI_LIGHT_THEME: ThemeTokens = buildThemeTokens(ANSI_LIGHT_COLORS, "light", "ANSI Light");

/** ANSI Dark 终端色主题 */
export const ANSI_DARK_THEME: ThemeTokens = buildThemeTokens(ANSI_DARK_COLORS, "dark", "ANSI Dark");

/** Monokai 主题（text.primary 使用品牌色，typography 使用前景色） */
export const MONOKAI_THEME: ThemeTokens = buildThemeTokens(MONOKAI_COLORS, "dark", "Monokai");

/** 预设主题映射表 */
export const PRESETS: Record<string, ThemeTokens> = {
  light: LIGHT_THEME,
  dark: DARK_THEME,
  monokai: MONOKAI_THEME,
  dracula: DRACULA_THEME,
  "github-light": GITHUB_LIGHT_THEME,
  "github-dark": GITHUB_DARK_THEME,
  "ansi-light": ANSI_LIGHT_THEME,
  "ansi-dark": ANSI_DARK_THEME,
};
