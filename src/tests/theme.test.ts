import { test } from "node:test";
import assert from "node:assert/strict";
import chalk from "chalk";

import { DEFAULT_THEME, PRESETS } from "../ui/theme";
import { resolveTheme } from "../ui/theme";
import { createThemedChalk } from "../ui/theme";
import { setCurrentTheme, getCurrentThemedChalk, getCurrentThemeTokens } from "../ui/theme";
import { resolveSettingsSources } from "../settings";
import { getScopeRiskColor } from "../ui/views/PermissionPrompt";

import type { ThemeTokens } from "../ui/theme";

// Force chalk to produce ANSI escapes even in non-TTY test environments.
chalk.level = 1;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All token keys that every ThemeTokens must define. */
const REQUIRED_TOKEN_KEYS: Array<keyof ThemeTokens> = [
  "primary",
  "secondary",
  "success",
  "error",
  "warning",
  "info",
  "riskLow",
  "riskMedium",
  "riskHigh",
  "text",
  "textDim",
  "code",
  "border",
  "thinking",
  "gradients",
];

const DEFAULTS = {
  model: "test-model",
  baseURL: "https://test.example.com",
};

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

test("DEFAULT_THEME has all required token keys", () => {
  for (const key of REQUIRED_TOKEN_KEYS) {
    assert.ok(key in DEFAULT_THEME, `DEFAULT_THEME is missing key: ${key}`);
  }
});

test("DEFAULT_THEME primary matches expected brand color", () => {
  assert.equal(DEFAULT_THEME.primary, "#229ac3");
  assert.equal(DEFAULT_THEME.secondary, "#229ac3e6");
});

test("DEFAULT_THEME semantic colors match expected values", () => {
  assert.equal(DEFAULT_THEME.success, "#52c41a");
  assert.equal(DEFAULT_THEME.error, "#f5222d");
  assert.equal(DEFAULT_THEME.warning, "#fa8c16");
  assert.equal(DEFAULT_THEME.info, "#2f54eb");
  assert.equal(DEFAULT_THEME.thinking, "#ff4400");
});

test("DEFAULT_THEME base colors match expected values", () => {
  assert.equal(DEFAULT_THEME.text, "#3D4149");
  assert.equal(DEFAULT_THEME.textDim, "#646A71");
  assert.equal(DEFAULT_THEME.code, "#787f8a");
});

test("DEFAULT_THEME risk colors match expected values", () => {
  assert.equal(DEFAULT_THEME.riskLow, "#22c55e");
  assert.equal(DEFAULT_THEME.riskMedium, "#f59e0b");
  assert.equal(DEFAULT_THEME.riskHigh, "#ef4444");
});

test("PRESETS map contains default", () => {
  assert.ok("default" in PRESETS);
  assert.equal(Object.keys(PRESETS).length, 1);
  assert.equal(PRESETS.default, DEFAULT_THEME);
});

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

test("resolveTheme returns DEFAULT_THEME when settings is undefined", () => {
  const result = resolveTheme(undefined);
  assert.equal(result.primary, DEFAULT_THEME.primary);
  assert.equal(result.success, DEFAULT_THEME.success);
});

test("resolveTheme returns DEFAULT_THEME for explicit 'default' preset", () => {
  const result = resolveTheme({ preset: "default" });
  assert.equal(result.primary, DEFAULT_THEME.primary);
});

test("resolveTheme returns DEFAULT_THEME when preset is not 'custom'", () => {
  const result = resolveTheme({ preset: "default" });
  assert.equal(result.text, DEFAULT_THEME.text);
  assert.equal(result.primary, DEFAULT_THEME.primary);
});

test("resolveTheme applies overrides when preset is 'custom'", () => {
  const result = resolveTheme({
    preset: "custom",
    overrides: { primary: "#ff0000" },
  });
  assert.equal(result.primary, "#ff0000");
  assert.equal(result.success, DEFAULT_THEME.success);
});

test("resolveTheme applies multiple overrides with custom preset", () => {
  const result = resolveTheme({
    preset: "custom",
    overrides: {
      primary: "#ff6600",
      success: "greenBright",
      warning: "yellowBright",
    },
  });
  assert.equal(result.primary, "#ff6600");
  assert.equal(result.success, "greenBright");
  assert.equal(result.warning, "yellowBright");
  assert.equal(result.error, DEFAULT_THEME.error);
});

test("resolveTheme full custom tokens with custom preset", () => {
  const customTokens: ThemeTokens = {
    primary: "#aaaaaa",
    secondary: "#aaaaaacc",
    success: "blue",
    error: "blue",
    warning: "blue",
    info: "blue",
    riskLow: "#111111",
    riskMedium: "#222222",
    riskHigh: "#333333",
    text: "blue",
    textDim: "blue",
    code: "blue",
    border: "blue",
    thinking: "blue",
    gradients: ["#aaaaaa", "#bbbbbb"],
  };
  const result = resolveTheme({ preset: "custom", tokens: customTokens });
  assert.equal(result.primary, "#aaaaaa");
  assert.equal(result.code, "blue");
  assert.deepEqual(result.gradients, ["#aaaaaa", "#bbbbbb"]);
});

test("resolveTheme handles override with undefined fields gracefully", () => {
  const result = resolveTheme({
    preset: "custom",
    overrides: { primary: undefined, success: undefined } as Partial<ThemeTokens>,
  });
  assert.equal(result.primary, DEFAULT_THEME.primary);
  assert.equal(result.success, DEFAULT_THEME.success);
});

test("resolveTheme ignores overrides when preset is not custom", () => {
  const result = resolveTheme({
    preset: "default",
    overrides: { primary: "#ff0000" },
  });
  assert.equal(result.primary, DEFAULT_THEME.primary);
});

test("resolveTheme ignores tokens when preset is not custom", () => {
  const result = resolveTheme({
    tokens: { primary: "#ff0000" } as ThemeTokens,
  });
  assert.equal(result.primary, DEFAULT_THEME.primary);
});

test("resolveTheme returns DEFAULT_THEME for custom preset without token/overrides", () => {
  const result = resolveTheme({ preset: "custom" });
  assert.equal(result.primary, DEFAULT_THEME.primary);
});

// ---------------------------------------------------------------------------
// createThemedChalk — markdown 方法直接复用顶层 token
// ---------------------------------------------------------------------------

test("createThemedChalk heading1 produces styled output via primary", () => {
  const tc = createThemedChalk(DEFAULT_THEME);
  assert.notEqual(tc.heading1("Hello"), "Hello");
});

test("createThemedChalk heading1 changes when primary changes", () => {
  const custom: ThemeTokens = { ...DEFAULT_THEME, primary: "#ff0000" };
  assert.notEqual(createThemedChalk(DEFAULT_THEME).heading1("test"), createThemedChalk(custom).heading1("test"));
});

test("createThemedChalk inlineCode changes when code changes", () => {
  const custom: ThemeTokens = { ...DEFAULT_THEME, code: "#ff0000" };
  assert.notEqual(createThemedChalk(DEFAULT_THEME).inlineCode("test"), createThemedChalk(custom).inlineCode("test"));
});

test("createThemedChalk listBullet changes when warning changes", () => {
  const custom: ThemeTokens = { ...DEFAULT_THEME, warning: "#ff0000" };
  assert.notEqual(createThemedChalk(DEFAULT_THEME).listBullet("test"), createThemedChalk(custom).listBullet("test"));
});

test("createThemedChalk quote changes when textDim changes", () => {
  const custom: ThemeTokens = { ...DEFAULT_THEME, textDim: "#ff0000" };
  assert.notEqual(createThemedChalk(DEFAULT_THEME).quote("test"), createThemedChalk(custom).quote("test"));
});

test("createThemedChalk bold / italic / dim produce styled output", () => {
  const tc = createThemedChalk(DEFAULT_THEME);
  assert.notEqual(tc.bold("bold"), "bold");
  assert.notEqual(tc.italic("italic"), "italic");
  assert.notEqual(tc.dim("dim"), "dim");
});

test("createThemedChalk produces different output for different primary values", () => {
  const custom1: ThemeTokens = { ...DEFAULT_THEME, primary: "#ff0000" };
  const custom2: ThemeTokens = { ...DEFAULT_THEME, primary: "#00ff00" };
  assert.notEqual(createThemedChalk(custom1).primary("test"), createThemedChalk(custom2).primary("test"));
});

test("createThemedChalk handles hex colors correctly", () => {
  const hexTheme: ThemeTokens = {
    ...DEFAULT_THEME,
    primary: "#ff6600",
    warning: "#ffcc00",
    code: "#00ccff",
  };
  const tc = createThemedChalk(hexTheme);
  assert.notEqual(tc.heading1("test"), "test");
  assert.notEqual(tc.inlineCode("test"), "test");
});

// ---------------------------------------------------------------------------
// current-theme (module-level state)
// ---------------------------------------------------------------------------

test("getCurrentThemedChalk returns DEFAULT_THEME chalk by default", () => {
  setCurrentTheme(DEFAULT_THEME);
  assert.notEqual(getCurrentThemedChalk().primary("test"), "test");
});

test("setCurrentTheme changes getCurrentThemedChalk output", () => {
  setCurrentTheme(DEFAULT_THEME);
  const first = getCurrentThemedChalk().primary("test");

  const custom: ThemeTokens = { ...DEFAULT_THEME, primary: "#ff0000" };
  setCurrentTheme(custom);
  const second = getCurrentThemedChalk().primary("test");

  assert.notEqual(first, second);

  setCurrentTheme(DEFAULT_THEME);
});

test("setCurrentTheme changes getCurrentThemeTokens output", () => {
  setCurrentTheme(DEFAULT_THEME);
  assert.equal(getCurrentThemeTokens().primary, DEFAULT_THEME.primary);

  const custom: ThemeTokens = { ...DEFAULT_THEME, primary: "#ff0000" };
  setCurrentTheme(custom);
  assert.equal(getCurrentThemeTokens().primary, "#ff0000");

  setCurrentTheme(DEFAULT_THEME);
});

// ---------------------------------------------------------------------------
// Settings integration
// ---------------------------------------------------------------------------

test("resolveSettingsSources includes theme field in resolved settings", () => {
  const result = resolveSettingsSources(null, null, DEFAULTS, {});
  assert.ok("theme" in result);
  assert.equal(result.theme.primary, DEFAULT_THEME.primary);
});

test("resolveSettingsSources resolves custom theme from user settings", () => {
  const result = resolveSettingsSources(
    { theme: { preset: "custom", overrides: { primary: "#abcdef" } } },
    null,
    DEFAULTS,
    {}
  );
  assert.equal(result.theme.primary, "#abcdef");
});

test("resolveSettingsSources resolves custom theme from project settings", () => {
  const result = resolveSettingsSources(
    null,
    { theme: { preset: "custom", overrides: { primary: "#123456" } } },
    DEFAULTS,
    {}
  );
  assert.equal(result.theme.primary, "#123456");
});

test("resolveSettingsSources uses default theme when preset is not custom", () => {
  const result = resolveSettingsSources(
    { theme: { preset: "default", overrides: { primary: "#abcdef" } } },
    null,
    DEFAULTS,
    {}
  );
  assert.equal(result.theme.primary, DEFAULT_THEME.primary);
});

// ---------------------------------------------------------------------------
// getScopeRiskColor with theme parameter
// ---------------------------------------------------------------------------

test("getScopeRiskColor returns dark theme defaults when no theme is passed", () => {
  assert.equal(getScopeRiskColor("read-in-cwd"), "#22c55e");
  assert.equal(getScopeRiskColor("write-in-cwd"), "#f59e0b");
  assert.equal(getScopeRiskColor("write-out-cwd"), "#ef4444");
});

test("getScopeRiskColor uses theme risk colors when theme is provided", () => {
  const custom: Partial<ThemeTokens> = {
    riskLow: "#aaaaaa",
    riskMedium: "#bbbbbb",
    riskHigh: "#cccccc",
  };
  assert.equal(getScopeRiskColor("read-in-cwd", custom as ThemeTokens), "#aaaaaa");
  assert.equal(getScopeRiskColor("mcp", custom as ThemeTokens), "#bbbbbb");
  assert.equal(getScopeRiskColor("delete-out-cwd", custom as ThemeTokens), "#cccccc");
});
