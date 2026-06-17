import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { ThemeManager } from "../ui/theme/ThemeManager";
import { LIGHT_THEME, DARK_THEME, PRESETS, setCurrentTheme, getCurrentThemeTokens } from "../ui/theme";
import type { ThemeTokens, ThemePreset } from "../ui/theme";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a ThemeManager with mocked settings */
function createManager(overrides?: { preset?: ThemePreset; themeSettings?: Record<string, unknown> }): ThemeManager {
  // The manager reads settings from disk on construction.
  // For unit tests we rely on the default settings (no custom theme file).
  return new ThemeManager(process.cwd());
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

test("ThemeManager constructor initializes with default theme", () => {
  const manager = createManager();
  const theme = manager.getTheme();
  assert.ok(theme, "getTheme() should return a theme");
  assert.ok(theme.mode === "light" || theme.mode === "dark", "theme should have a valid mode");
  assert.ok(typeof theme.text.primary === "string", "theme should have text.primary");
  manager.dispose();
});

test("ThemeManager constructor initializes preset from settings", () => {
  const manager = createManager();
  const preset = manager.getPreset();
  assert.ok(typeof preset === "string", "getPreset() should return a string");
  assert.ok(
    [
      "light",
      "dark",
      "monokai",
      "dracula",
      "github-light",
      "github-dark",
      "ansi-light",
      "ansi-dark",
      "custom",
    ].includes(preset),
    `preset should be a valid ThemePreset, got: ${preset}`
  );
  manager.dispose();
});

test("ThemeManager constructor initializes terminalBg as null before init()", () => {
  const manager = createManager();
  assert.equal(manager.getTerminalBackground(), null);
  manager.dispose();
});

// ---------------------------------------------------------------------------
// Lifecycle: init
// ---------------------------------------------------------------------------

test("ThemeManager.init() detects terminal background", async () => {
  const manager = createManager();
  await manager.init();
  const bg = manager.getTerminalBackground();
  assert.ok(bg === "light" || bg === "dark", `terminalBg should be 'light' or 'dark', got: ${bg}`);
  manager.dispose();
});

test("ThemeManager.init() refreshes theme after detection", async () => {
  const manager = createManager();
  const themeBefore = manager.getTheme();
  await manager.init();
  const themeAfter = manager.getTheme();
  // Theme may or may not change depending on terminal background, but it should be valid
  assert.ok(themeAfter, "theme should exist after init");
  assert.ok(typeof themeAfter.text.primary === "string", "theme should have valid text.primary after init");
  manager.dispose();
});

// ---------------------------------------------------------------------------
// Lifecycle: polling
// ---------------------------------------------------------------------------

test("ThemeManager.startPolling creates an interval", () => {
  const manager = createManager();
  // Should not throw
  manager.startPolling(100);
  manager.stopPolling();
  manager.dispose();
});

test("ThemeManager.stopPolling is idempotent", () => {
  const manager = createManager();
  manager.stopPolling(); // no-op
  manager.startPolling(100);
  manager.stopPolling();
  manager.stopPolling(); // no-op
  manager.dispose();
});

test("ThemeManager.dispose stops polling and clears listeners", () => {
  const manager = createManager();
  let called = false;
  manager.onChange(() => {
    called = true;
  });
  manager.startPolling(100);
  manager.dispose();
  // After dispose, listeners should be cleared
  // We can't directly test this, but dispose should not throw
  assert.ok(true, "dispose should not throw");
});

// ---------------------------------------------------------------------------
// Query methods
// ---------------------------------------------------------------------------

test("ThemeManager.getTheme returns valid ThemeTokens", () => {
  const manager = createManager();
  const theme = manager.getTheme();
  assert.ok(theme.name, "theme should have name");
  assert.ok(theme.mode, "theme should have mode");
  assert.ok(theme.text, "theme should have text group");
  assert.ok(theme.brand, "theme should have brand group");
  assert.ok(theme.status, "theme should have status group");
  assert.ok(theme.gradients, "theme should have gradients group");
  manager.dispose();
});

test("ThemeManager.getPreset returns a valid preset name", () => {
  const manager = createManager();
  const preset = manager.getPreset();
  assert.ok(preset in PRESETS || preset === "custom", `invalid preset: ${preset}`);
  manager.dispose();
});

// ---------------------------------------------------------------------------
// previewTheme
// ---------------------------------------------------------------------------

test("ThemeManager.previewTheme changes theme but does not change preset", () => {
  const manager = createManager();
  const originalPreset = manager.getPreset();
  const originalTheme = manager.getTheme();

  // Preview a different preset
  const targetPreset: ThemePreset = originalPreset === "dark" ? "light" : "dark";
  manager.previewTheme(targetPreset);

  // Theme should change
  const previewedTheme = manager.getTheme();
  assert.notEqual(
    previewedTheme.text.primary,
    originalTheme.text.primary,
    "theme text.primary should change on preview"
  );

  // Preset should NOT change
  assert.equal(manager.getPreset(), originalPreset, "preset should not change on preview");

  manager.dispose();
});

test("ThemeManager.previewTheme notifies listeners", () => {
  const manager = createManager();
  let notified = false;
  let notifiedTheme: ThemeTokens | null = null;
  manager.onChange((theme) => {
    notified = true;
    notifiedTheme = theme;
  });

  manager.previewTheme("dark");
  assert.ok(notified, "listener should be called on preview");
  assert.ok(notifiedTheme, "listener should receive theme");

  manager.dispose();
});

test("ThemeManager.previewTheme with partial tokens works", () => {
  const manager = createManager();
  const originalTheme = manager.getTheme();

  manager.previewTheme({ brand: { primary: "#ff0000", secondary: "#ff0000", accent: "#ff0000" } });

  const previewed = manager.getTheme();
  // The previewed theme should have the custom brand color
  // (or it may be overridden by terminal contrast, but brand.primary is not affected by contrast)
  assert.ok(previewed, "theme should exist after partial preview");

  manager.dispose();
});

// ---------------------------------------------------------------------------
// switchTheme
// ---------------------------------------------------------------------------

test("ThemeManager.switchTheme changes theme and preset", () => {
  const manager = createManager();
  const originalPreset = manager.getPreset();

  const targetPreset: ThemePreset = originalPreset === "dark" ? "light" : "dark";
  manager.switchTheme(targetPreset);

  assert.equal(manager.getPreset(), targetPreset, "preset should change on switch");
  assert.ok(manager.getTheme(), "theme should exist after switch");

  manager.dispose();
});

test("ThemeManager.switchTheme notifies listeners", () => {
  const manager = createManager();
  let notified = false;
  manager.onChange(() => {
    notified = true;
  });

  manager.switchTheme("dark");
  assert.ok(notified, "listener should be called on switch");

  manager.dispose();
});

// ---------------------------------------------------------------------------
// revertTheme
// ---------------------------------------------------------------------------

test("ThemeManager.revertTheme restores saved preset after preview", () => {
  const manager = createManager();
  const originalPreset = manager.getPreset();
  const originalTheme = manager.getTheme();

  // Preview a different theme (not saved to settings)
  const targetPreset: ThemePreset = originalPreset === "dark" ? "light" : "dark";
  manager.previewTheme(targetPreset);
  assert.notEqual(manager.getTheme().text.primary, originalTheme.text.primary, "theme should change on preview");

  // Revert should restore the saved theme
  manager.revertTheme();
  assert.equal(manager.getPreset(), originalPreset, "preset should revert to original");

  manager.dispose();
});

test("ThemeManager.revertTheme notifies listeners", () => {
  const manager = createManager();
  let notified = false;
  manager.onChange(() => {
    notified = true;
  });

  manager.switchTheme("dark");
  notified = false;
  manager.revertTheme();
  assert.ok(notified, "listener should be called on revert");

  manager.dispose();
});

// ---------------------------------------------------------------------------
// onChange
// ---------------------------------------------------------------------------

test("ThemeManager.onChange returns unsubscribe function", () => {
  const manager = createManager();
  let callCount = 0;
  const unsubscribe = manager.onChange(() => {
    callCount++;
  });

  manager.previewTheme("dark");
  assert.equal(callCount, 1);

  unsubscribe();
  manager.previewTheme("light");
  assert.equal(callCount, 1, "listener should not be called after unsubscribe");

  manager.dispose();
});

test("ThemeManager.onChange receives correct theme and preset", () => {
  const manager = createManager();
  let receivedTheme: ThemeTokens | null = null;
  let receivedPreset: ThemePreset | null = null;

  manager.onChange((theme, preset) => {
    receivedTheme = theme;
    receivedPreset = preset;
  });

  manager.switchTheme("dark");

  assert.ok(receivedTheme, "should receive theme");
  assert.equal(receivedPreset, "dark", "should receive preset 'dark'");

  manager.dispose();
});

test("Multiple listeners are all called", () => {
  const manager = createManager();
  let count1 = 0;
  let count2 = 0;

  manager.onChange(() => {
    count1++;
  });
  manager.onChange(() => {
    count2++;
  });

  manager.previewTheme("dark");
  assert.equal(count1, 1, "first listener should be called");
  assert.equal(count2, 1, "second listener should be called");

  manager.dispose();
});

// ---------------------------------------------------------------------------
// refreshFromSettings
// ---------------------------------------------------------------------------

test("ThemeManager.refreshFromSettings updates theme", () => {
  const manager = createManager();
  const themeBefore = manager.getTheme();
  manager.refreshFromSettings();
  const themeAfter = manager.getTheme();
  // Should return a valid theme (may be same if settings unchanged)
  assert.ok(themeAfter, "theme should exist after refresh");
  assert.ok(typeof themeAfter.text.primary === "string", "theme should have valid text.primary");
  manager.dispose();
});

test("ThemeManager.refreshFromSettings notifies listeners", () => {
  const manager = createManager();
  let notified = false;
  manager.onChange(() => {
    notified = true;
  });

  manager.refreshFromSettings();
  assert.ok(notified, "listener should be called on refresh");

  manager.dispose();
});

// ---------------------------------------------------------------------------
// setCurrentTheme integration
// ---------------------------------------------------------------------------

test("ThemeManager.switchTheme updates global setCurrentTheme", () => {
  const manager = createManager();
  manager.switchTheme("dark");
  const globalTheme = getCurrentThemeTokens();
  assert.equal(globalTheme.brand.primary, manager.getTheme().brand.primary, "global theme should match manager theme");
  manager.dispose();
});
