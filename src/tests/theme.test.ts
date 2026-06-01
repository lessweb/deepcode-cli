import { test } from "node:test";
import assert from "node:assert/strict";
import chalk from "chalk";

import {
  LIGHT_THEME,
  DARK_THEME,
  MONOKAI_THEME,
  DRACULA_THEME,
  GITHUB_LIGHT_THEME,
  GITHUB_DARK_THEME,
  PRESETS,
} from "../ui/theme";
import { resolveTheme } from "../ui/theme";
import { createThemedChalk } from "../ui/theme";
import { setCurrentTheme, getCurrentThemedChalk, getCurrentThemeTokens } from "../ui/theme";
import { resolveSettingsSources } from "../settings";
import { getScopeRiskColor } from "../ui/views/PermissionPrompt";

import type { ThemeTokens, ThemePreset } from "../ui/theme";

chalk.level = 1;

const DEFAULTS = {
  model: "test-model",
  baseURL: "https://test.example.com",
};

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

test("LIGHT_THEME has all required top-level groups", () => {
  const groups = [
    "mode",
    "text",
    "border",
    "surface",
    "brand",
    "status",
    "risk",
    "typography",
    "link",
    "inlineCode",
    "codeBlock",
    "syntax",
    "blockquote",
    "list",
    "task",
    "table",
    "hr",
    "admonition",
    "diff",
    "agent",
    "approval",
    "gradients",
  ];
  for (const key of groups) {
    assert.ok(key in LIGHT_THEME, `LIGHT_THEME is missing group: ${key}`);
  }
});

test("LIGHT_THEME brand colors match expected values", () => {
  assert.equal(LIGHT_THEME.brand.primary, "#229ac3");
  assert.equal(LIGHT_THEME.brand.secondary, "#229ac3cc");
});

test("all presets have a name field", () => {
  for (const [key, preset] of Object.entries(PRESETS)) {
    assert.ok(typeof preset.name === "string" && preset.name.length > 0, `preset "${key}" missing name`);
  }
});

test("LIGHT_THEME status colors match expected values", () => {
  assert.equal(LIGHT_THEME.status.success, "#1a7f37");
  assert.equal(LIGHT_THEME.status.danger, "#d1242f");
  assert.equal(LIGHT_THEME.status.warning, "#fa8c16");
  assert.equal(LIGHT_THEME.status.info, "#0969da");
});

test("LIGHT_THEME text colors match expected values", () => {
  assert.equal(LIGHT_THEME.text.primary, "#1F2328");
  assert.equal(LIGHT_THEME.text.secondary, "#46484b");
  assert.equal(LIGHT_THEME.text.muted, "#8b949e");
  assert.equal(LIGHT_THEME.text.inverse, "#1F2328");
});

test("PRESETS map contains all presets", () => {
  assert.ok("light" in PRESETS);
  assert.ok("dark" in PRESETS);
  assert.ok("monokai" in PRESETS);
  assert.ok("dracula" in PRESETS);
  assert.ok("github-light" in PRESETS);
  assert.ok("github-dark" in PRESETS);
  assert.ok("ansi-light" in PRESETS);
  assert.ok("ansi-dark" in PRESETS);
  assert.equal(Object.keys(PRESETS).length, 8);
  assert.equal(PRESETS.light, LIGHT_THEME);
  assert.equal(PRESETS.dark, DARK_THEME);
  assert.equal(PRESETS.monokai, MONOKAI_THEME);
  assert.equal(PRESETS.dracula, DRACULA_THEME);
});

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

test("resolveTheme returns LIGHT_THEME when settings is undefined", () => {
  const result = resolveTheme(undefined);
  assert.equal(result.brand.primary, LIGHT_THEME.brand.primary);
  assert.equal(result.status.success, LIGHT_THEME.status.success);
});

test("resolveTheme returns LIGHT_THEME for explicit 'light' preset", () => {
  const result = resolveTheme({ preset: "light" });
  assert.equal(result.brand.primary, LIGHT_THEME.brand.primary);
});

test("resolveTheme returns DARK_THEME for 'dark' preset", () => {
  const result = resolveTheme({ preset: "dark" });
  assert.equal(result.brand.primary, DARK_THEME.brand.primary);
  assert.equal(result.text.primary, DARK_THEME.text.primary);
});

test("resolveTheme returns MONOKAI_THEME for 'monokai' preset", () => {
  const result = resolveTheme({ preset: "monokai" });
  assert.equal(result.brand.primary, MONOKAI_THEME.brand.primary);
  assert.equal(result.text.primary, MONOKAI_THEME.text.primary);
});

test("resolveTheme returns DRACULA_THEME for 'dracula' preset", () => {
  const result = resolveTheme({ preset: "dracula" });
  assert.equal(result.brand.primary, DRACULA_THEME.brand.primary);
  assert.equal(result.text.primary, DRACULA_THEME.text.primary);
});

test("resolveTheme applies overrides when preset is 'custom'", () => {
  const result = resolveTheme({
    preset: "custom",
    overrides: { brand: { primary: "#ff0000", secondary: "#ff0000", accent: "#ff0000" } },
  });
  assert.equal(result.brand.primary, "#ff0000");
  assert.equal(result.status.success, LIGHT_THEME.status.success);
});

test("resolveTheme full custom tokens with custom preset", () => {
  const customTokens = { ...LIGHT_THEME, brand: { primary: "#aaaaaa", secondary: "#aaaaaacc", accent: "#aaaaaa" } };
  const result = resolveTheme({ preset: "custom", tokens: customTokens });
  assert.equal(result.brand.primary, "#aaaaaa");
});

test("resolveTheme handles override with undefined fields gracefully", () => {
  const result = resolveTheme({
    preset: "custom",
    overrides: { brand: undefined } as Partial<ThemeTokens>,
  });
  assert.equal(result.brand.primary, LIGHT_THEME.brand.primary);
});

test("resolveTheme ignores overrides when preset is not custom", () => {
  const result = resolveTheme({
    preset: "light",
    overrides: { brand: { primary: "#ff0000", secondary: "#ff0000", accent: "#ff0000" } },
  });
  assert.equal(result.brand.primary, LIGHT_THEME.brand.primary);
});

test("resolveTheme returns LIGHT_THEME for custom preset without token/overrides", () => {
  const result = resolveTheme({ preset: "custom" });
  assert.equal(result.brand.primary, LIGHT_THEME.brand.primary);
});

test("resolveTheme custom with base='dark' merges overrides onto DARK_THEME", () => {
  const result = resolveTheme({
    preset: "custom",
    base: "dark",
    overrides: { brand: { primary: "#ff0000", secondary: "#ff0000", accent: "#ff0000" } },
  });
  // brand.primary should be overridden
  assert.equal(result.brand.primary, "#ff0000");
  // other tokens should come from DARK_THEME
  assert.equal(result.mode, "dark");
  assert.equal(result.text.primary, DARK_THEME.text.primary);
  assert.equal(result.status.success, DARK_THEME.status.success);
});

test("resolveTheme custom with invalid base falls back to LIGHT_THEME", () => {
  const result = resolveTheme({
    preset: "custom",
    base: "nonexistent" as ThemePreset,
    overrides: { brand: { primary: "#ff0000", secondary: "#ff0000", accent: "#ff0000" } },
  });
  assert.equal(result.brand.primary, "#ff0000");
  assert.equal(result.mode, "light"); // falls back to LIGHT_THEME
});

// ---------------------------------------------------------------------------
// createThemedChalk
// ---------------------------------------------------------------------------

test("createThemedChalk heading1 produces styled output via typography.h1", () => {
  const tc = createThemedChalk(LIGHT_THEME);
  assert.notEqual(tc.heading1("Hello"), "Hello");
});

test("createThemedChalk heading1 changes when typography.h1 changes", () => {
  const custom: ThemeTokens = { ...LIGHT_THEME, typography: { ...LIGHT_THEME.typography, h1: "#ff0000" } };
  assert.notEqual(createThemedChalk(LIGHT_THEME).heading1("test"), createThemedChalk(custom).heading1("test"));
});

test("createThemedChalk inlineCode changes when inlineCode.foreground changes", () => {
  const custom: ThemeTokens = { ...LIGHT_THEME, inlineCode: { ...LIGHT_THEME.inlineCode, foreground: "#ff0000" } };
  assert.notEqual(createThemedChalk(LIGHT_THEME).inlineCode("test"), createThemedChalk(custom).inlineCode("test"));
});

test("createThemedChalk listBullet changes when list.bullet changes", () => {
  const custom: ThemeTokens = { ...LIGHT_THEME, list: { ...LIGHT_THEME.list, bullet: "#ff0000" } };
  assert.notEqual(createThemedChalk(LIGHT_THEME).listBullet("test"), createThemedChalk(custom).listBullet("test"));
});

test("createThemedChalk quote changes when blockquote.foreground changes", () => {
  const custom: ThemeTokens = { ...LIGHT_THEME, blockquote: { ...LIGHT_THEME.blockquote, foreground: "#ff0000" } };
  assert.notEqual(createThemedChalk(LIGHT_THEME).quote("test"), createThemedChalk(custom).quote("test"));
});

test("createThemedChalk bold / italic / dim produce styled output", () => {
  const tc = createThemedChalk(LIGHT_THEME);
  assert.notEqual(tc.bold("bold"), "bold");
  assert.notEqual(tc.italic("italic"), "italic");
  assert.notEqual(tc.dim("dim"), "dim");
});

test("createThemedChalk produces different output for different text.primary values", () => {
  const custom1: ThemeTokens = { ...LIGHT_THEME, text: { ...LIGHT_THEME.text, primary: "#ff0000" } };
  const custom2: ThemeTokens = { ...LIGHT_THEME, text: { ...LIGHT_THEME.text, primary: "#00ff00" } };
  assert.notEqual(createThemedChalk(custom1).text("test"), createThemedChalk(custom2).text("test"));
});

// ---------------------------------------------------------------------------
// current-theme (module-level state)
// ---------------------------------------------------------------------------

test("getCurrentThemedChalk returns LIGHT_THEME chalk by default", () => {
  setCurrentTheme(LIGHT_THEME);
  assert.notEqual(getCurrentThemedChalk().brandPrimary("test"), "test");
});

test("setCurrentTheme changes getCurrentThemedChalk output", () => {
  setCurrentTheme(LIGHT_THEME);
  const first = getCurrentThemedChalk().text("test");

  const custom: ThemeTokens = { ...LIGHT_THEME, text: { ...LIGHT_THEME.text, primary: "#ff0000" } };
  setCurrentTheme(custom);
  const second = getCurrentThemedChalk().text("test");

  assert.notEqual(first, second);

  setCurrentTheme(LIGHT_THEME);
});

test("setCurrentTheme changes getCurrentThemeTokens output", () => {
  setCurrentTheme(LIGHT_THEME);
  assert.equal(getCurrentThemeTokens().brand.primary, LIGHT_THEME.brand.primary);

  const custom: ThemeTokens = { ...LIGHT_THEME, brand: { ...LIGHT_THEME.brand, primary: "#ff0000" } };
  setCurrentTheme(custom);
  assert.equal(getCurrentThemeTokens().brand.primary, "#ff0000");

  setCurrentTheme(LIGHT_THEME);
});

// ---------------------------------------------------------------------------
// Settings integration
// ---------------------------------------------------------------------------

test("resolveSettingsSources includes theme field in resolved settings", () => {
  const result = resolveSettingsSources(null, null, DEFAULTS, {});
  assert.ok("theme" in result);
  assert.equal(result.theme.brand.primary, LIGHT_THEME.brand.primary);
});

test("resolveSettingsSources resolves custom theme from user settings", () => {
  const result = resolveSettingsSources(
    {
      theme: {
        preset: "custom",
        overrides: { brand: { primary: "#abcdef", secondary: "#abcdef", accent: "#abcdef" } },
      },
    },
    null,
    DEFAULTS,
    {}
  );
  assert.equal(result.theme.brand.primary, "#abcdef");
});

test("resolveSettingsSources resolves custom theme from project settings", () => {
  const result = resolveSettingsSources(
    null,
    {
      theme: {
        preset: "custom",
        overrides: { brand: { primary: "#123456", secondary: "#123456", accent: "#123456" } },
      },
    },
    DEFAULTS,
    {}
  );
  assert.equal(result.theme.brand.primary, "#123456");
});

test("resolveSettingsSources uses default theme when preset is not custom", () => {
  const result = resolveSettingsSources(
    {
      theme: { preset: "light", overrides: { brand: { primary: "#abcdef", secondary: "#abcdef", accent: "#abcdef" } } },
    },
    null,
    DEFAULTS,
    {}
  );
  assert.equal(result.theme.brand.primary, LIGHT_THEME.brand.primary);
});

// ---------------------------------------------------------------------------
// getScopeRiskColor with theme parameter
// ---------------------------------------------------------------------------

test("getScopeRiskColor returns default theme colors when no theme is passed", () => {
  assert.equal(getScopeRiskColor("read-in-cwd"), LIGHT_THEME.risk.low);
  assert.equal(getScopeRiskColor("write-in-cwd"), LIGHT_THEME.risk.medium);
  assert.equal(getScopeRiskColor("write-out-cwd"), LIGHT_THEME.risk.high);
});

test("getScopeRiskColor uses theme risk colors when theme is provided", () => {
  const custom: Partial<ThemeTokens> = {
    risk: { low: "#aaaaaa", medium: "#bbbbbb", high: "#cccccc", critical: "#dddddd" },
  };
  assert.equal(getScopeRiskColor("read-in-cwd", custom as ThemeTokens), "#aaaaaa");
  assert.equal(getScopeRiskColor("mcp", custom as ThemeTokens), "#bbbbbb");
  assert.equal(getScopeRiskColor("delete-out-cwd", custom as ThemeTokens), "#cccccc");
});
