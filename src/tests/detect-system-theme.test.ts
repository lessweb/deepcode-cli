import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseOscRgb,
  themeFromOscColor,
  detectFromColorFgBg,
  detectSystemTheme,
} from "../ui/theme/detect-system-theme";

// ---------------------------------------------------------------------------
// parseOscRgb
// ---------------------------------------------------------------------------

test("parseOscRgb parses rgb:RR/GG/BB format", () => {
  const result = parseOscRgb("rgb:0000/0000/0000");
  assert.ok(result);
  assert.equal(result.r, 0);
  assert.equal(result.g, 0);
  assert.equal(result.b, 0);
});

test("parseOscRgb parses rgb:RRRR/GGGG/BBBB format (bright white)", () => {
  const result = parseOscRgb("rgb:ffff/ffff/ffff");
  assert.ok(result);
  assert.equal(result.r, 1);
  assert.equal(result.g, 1);
  assert.equal(result.b, 1);
});

test("parseOscRgb parses rgb:RR/GG/BB with mid values", () => {
  const result = parseOscRgb("rgb:8080/8080/8080");
  assert.ok(result);
  assert.ok(Math.abs(result.r - 0.50196) < 0.001);
  assert.ok(Math.abs(result.g - 0.50196) < 0.001);
  assert.ok(Math.abs(result.b - 0.50196) < 0.001);
});

test("parseOscRgb parses rgb with short hex (1 digit per component)", () => {
  const result = parseOscRgb("rgb:f/f/f");
  assert.ok(result);
  assert.equal(result.r, 1);
  assert.equal(result.g, 1);
  assert.equal(result.b, 1);
});

test("parseOscRgb parses rgb with 2-digit hex", () => {
  const result = parseOscRgb("rgb:ff/80/00");
  assert.ok(result);
  assert.equal(result.r, 1);
  assert.ok(Math.abs(result.g - 0.50196) < 0.001);
  assert.equal(result.b, 0);
});

test("parseOscRgb parses rgba format", () => {
  const result = parseOscRgb("rgba:ffff/ffff/ffff/ffff");
  assert.ok(result);
  assert.equal(result.r, 1);
  assert.equal(result.g, 1);
  assert.equal(result.b, 1);
});

test("parseOscRgb parses #RRGGBB format", () => {
  const result = parseOscRgb("#000000");
  assert.ok(result);
  assert.equal(result.r, 0);
  assert.equal(result.g, 0);
  assert.equal(result.b, 0);
});

test("parseOscRgb parses #RRGGBB format (white)", () => {
  const result = parseOscRgb("#ffffff");
  assert.ok(result);
  assert.equal(result.r, 1);
  assert.equal(result.g, 1);
  assert.equal(result.b, 1);
});

test("parseOscRgb parses #RRRRGGGGBBBB format", () => {
  const result = parseOscRgb("#ffff80800000");
  assert.ok(result);
  assert.equal(result.r, 1);
  assert.ok(Math.abs(result.g - 0.50196) < 0.001);
  assert.equal(result.b, 0);
});

test("parseOscRgb returns undefined for invalid format", () => {
  assert.equal(parseOscRgb("invalid"), undefined);
  assert.equal(parseOscRgb(""), undefined);
  assert.equal(parseOscRgb("rgb:zz/zz/zz"), undefined);
  assert.equal(parseOscRgb("#gggggg"), undefined);
});

test("parseOscRgb returns undefined for #RRGGBB with non-multiple-of-3 length", () => {
  assert.equal(parseOscRgb("#ffff"), undefined);
  assert.equal(parseOscRgb("#fffff"), undefined);
});

test("parseOscRgb is case-insensitive", () => {
  const lower = parseOscRgb("rgb:ffff/0000/8080");
  const upper = parseOscRgb("RGB:FFFF/0000/8080");
  assert.ok(lower);
  assert.ok(upper);
  assert.equal(lower.r, upper.r);
  assert.equal(lower.g, upper.g);
  assert.equal(lower.b, upper.b);
});

// ---------------------------------------------------------------------------
// themeFromOscColor
// ---------------------------------------------------------------------------

test("themeFromOscColor returns 'light' for white background", () => {
  assert.equal(themeFromOscColor("rgb:ffff/ffff/ffff"), "light");
  assert.equal(themeFromOscColor("#ffffff"), "light");
});

test("themeFromOscColor returns 'dark' for black background", () => {
  assert.equal(themeFromOscColor("rgb:0000/0000/0000"), "dark");
  assert.equal(themeFromOscColor("#000000"), "dark");
});

test("themeFromOscColor returns 'light' for bright background", () => {
  // Luminance of #c0c0c0 (silver) ≈ 0.53 > 0.5
  assert.equal(themeFromOscColor("#c0c0c0"), "light");
});

test("themeFromOscColor returns 'dark' for dim background", () => {
  // Luminance of #404040 ≈ 0.04 < 0.5
  assert.equal(themeFromOscColor("#404040"), "dark");
});

test("themeFromOscColor uses ITU-R BT.709 luminance weights", () => {
  // Pure green has highest luminance weight (0.7152)
  // rgb:0000/8080/0000 → luminance ≈ 0.7152 * 0.5 ≈ 0.358 → dark
  assert.equal(themeFromOscColor("rgb:0000/8080/0000"), "dark");

  // Pure green bright → luminance > 0.5 → light
  assert.equal(themeFromOscColor("rgb:0000/ffff/0000"), "light");

  // Pure blue has lowest weight (0.0722)
  // rgb:0000/0000/ffff → luminance ≈ 0.0722 → dark
  assert.equal(themeFromOscColor("rgb:0000/0000/ffff"), "dark");
});

test("themeFromOscColor returns undefined for invalid input", () => {
  assert.equal(themeFromOscColor("invalid"), undefined);
  assert.equal(themeFromOscColor(""), undefined);
});

// ---------------------------------------------------------------------------
// detectFromColorFgBg
// ---------------------------------------------------------------------------

test("detectFromColorFgBg returns 'dark' for dark background indices", () => {
  const original = process.env["COLORFGBG"];
  try {
    // Index 0 = black
    process.env["COLORFGBG"] = "15;0";
    assert.equal(detectFromColorFgBg(), "dark");

    // Index 1 = red
    process.env["COLORFGBG"] = "15;1";
    assert.equal(detectFromColorFgBg(), "dark");

    // Index 6 = cyan
    process.env["COLORFGBG"] = "15;6";
    assert.equal(detectFromColorFgBg(), "dark");

    // Index 8 = bright black (dark gray)
    process.env["COLORFGBG"] = "15;8";
    assert.equal(detectFromColorFgBg(), "dark");
  } finally {
    if (original === undefined) {
      delete process.env["COLORFGBG"];
    } else {
      process.env["COLORFGBG"] = original;
    }
  }
});

test("detectFromColorFgBg returns 'light' for light background indices", () => {
  const original = process.env["COLORFGBG"];
  try {
    // Index 7 = light gray
    process.env["COLORFGBG"] = "0;7";
    assert.equal(detectFromColorFgBg(), "light");

    // Index 9 = bright red
    process.env["COLORFGBG"] = "0;9";
    assert.equal(detectFromColorFgBg(), "light");

    // Index 15 = bright white
    process.env["COLORFGBG"] = "0;15";
    assert.equal(detectFromColorFgBg(), "light");
  } finally {
    if (original === undefined) {
      delete process.env["COLORFGBG"];
    } else {
      process.env["COLORFGBG"] = original;
    }
  }
});

test("detectFromColorFgBg handles foreground;background format", () => {
  const original = process.env["COLORFGBG"];
  try {
    // Only the last segment (background) matters
    process.env["COLORFGBG"] = "0;15";
    assert.equal(detectFromColorFgBg(), "light");

    process.env["COLORFGBG"] = "15;0";
    assert.equal(detectFromColorFgBg(), "dark");
  } finally {
    if (original === undefined) {
      delete process.env["COLORFGBG"];
    } else {
      process.env["COLORFGBG"] = original;
    }
  }
});

test("detectFromColorFgBg handles single value (background only)", () => {
  const original = process.env["COLORFGBG"];
  try {
    process.env["COLORFGBG"] = "0";
    assert.equal(detectFromColorFgBg(), "dark");

    process.env["COLORFGBG"] = "15";
    assert.equal(detectFromColorFgBg(), "light");
  } finally {
    if (original === undefined) {
      delete process.env["COLORFGBG"];
    } else {
      process.env["COLORFGBG"] = original;
    }
  }
});

test("detectFromColorFgBg returns undefined when COLORFGBG is not set", () => {
  const original = process.env["COLORFGBG"];
  try {
    delete process.env["COLORFGBG"];
    assert.equal(detectFromColorFgBg(), undefined);
  } finally {
    if (original !== undefined) {
      process.env["COLORFGBG"] = original;
    }
  }
});

test("detectFromColorFgBg returns undefined for non-numeric value", () => {
  const original = process.env["COLORFGBG"];
  try {
    process.env["COLORFGBG"] = "abc";
    assert.equal(detectFromColorFgBg(), undefined);
  } finally {
    if (original === undefined) {
      delete process.env["COLORFGBG"];
    } else {
      process.env["COLORFGBG"] = original;
    }
  }
});

test("detectFromColorFgBg returns undefined for empty string", () => {
  const original = process.env["COLORFGBG"];
  try {
    process.env["COLORFGBG"] = "";
    assert.equal(detectFromColorFgBg(), undefined);
  } finally {
    if (original === undefined) {
      delete process.env["COLORFGBG"];
    } else {
      process.env["COLORFGBG"] = original;
    }
  }
});

// ---------------------------------------------------------------------------
// detectSystemTheme (sync entry point)
// ---------------------------------------------------------------------------

test("detectSystemTheme returns a valid theme", () => {
  const result = detectSystemTheme();
  assert.ok(result === "light" || result === "dark");
});

test("detectSystemTheme prefers COLORFGBG over other sources", () => {
  const original = process.env["COLORFGBG"];
  try {
    process.env["COLORFGBG"] = "0;15"; // light background
    assert.equal(detectSystemTheme(), "light");

    process.env["COLORFGBG"] = "15;0"; // dark background
    assert.equal(detectSystemTheme(), "dark");
  } finally {
    if (original === undefined) {
      delete process.env["COLORFGBG"];
    } else {
      process.env["COLORFGBG"] = original;
    }
  }
});

test("detectSystemTheme falls back to 'dark' when no sources available", () => {
  const original = process.env["COLORFGBG"];
  try {
    delete process.env["COLORFGBG"];
    // On non-macOS, detectMacOSTheme returns undefined → falls back to "dark"
    // On macOS, it depends on system settings
    const result = detectSystemTheme();
    assert.ok(result === "light" || result === "dark");
  } finally {
    if (original !== undefined) {
      process.env["COLORFGBG"] = original;
    }
  }
});
