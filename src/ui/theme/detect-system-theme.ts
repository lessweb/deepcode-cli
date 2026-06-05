import { execSync } from "child_process";

export type DetectedTheme = "dark" | "light";

// ---------------------------------------------------------------------------
// OSC 11 – query terminal background color
// ---------------------------------------------------------------------------

const OSC11_TIMEOUT_MS = 200;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Normalises a variable-length hex colour component (1–4 hex digits) to
 * the [0, 1] range.
 */
function hexComponent(hex: string): number {
  const max = 16 ** hex.length - 1;
  return parseInt(hex, 16) / max;
}

/**
 * Parses an XParseColor RGB string returned by OSC 11.
 *
 * Accepted formats:
 *   - `rgb:RRRR/GGGG/BBBB` (1–4 hex digits per component)
 *   - `#RRGGBB` or `#RRRRGGGGBBBB` (equal-length triplets)
 */
export function parseOscRgb(data: string): Rgb | undefined {
  const rgbMatch = /^rgba?:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})/i.exec(data);
  if (rgbMatch) {
    return {
      r: hexComponent(rgbMatch[1]!),
      g: hexComponent(rgbMatch[2]!),
      b: hexComponent(rgbMatch[3]!),
    };
  }

  const hashMatch = /^#([0-9a-f]+)$/i.exec(data);
  if (hashMatch && hashMatch[1]!.length % 3 === 0) {
    const hex = hashMatch[1]!;
    const n = hex.length / 3;
    return {
      r: hexComponent(hex.slice(0, n)),
      g: hexComponent(hex.slice(n, 2 * n)),
      b: hexComponent(hex.slice(2 * n)),
    };
  }

  return undefined;
}

/**
 * Converts an OSC 11 colour response into a dark/light theme decision
 * using ITU-R BT.709 relative luminance.
 */
export function themeFromOscColor(data: string): DetectedTheme | undefined {
  const rgb = parseOscRgb(data);
  if (!rgb) return undefined;
  const luminance = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
  return luminance > 0.5 ? "light" : "dark";
}

/**
 * Sends an OSC 11 query (`ESC ] 11 ; ? BEL`) to the terminal and waits
 * for the response containing the background colour.
 *
 * Returns `undefined` when stdin/stdout is not a TTY or when no response
 * arrives within OSC11_TIMEOUT_MS.
 */
export function detectOsc11Theme(): Promise<DetectedTheme | undefined> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.resolve(undefined);
  }

  return new Promise<DetectedTheme | undefined>((resolve) => {
    const stdin = process.stdin;
    let resolved = false;
    let buffer = "";

    const finish = (result: DetectedTheme | undefined) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      stdin.removeListener("data", onData);
      resolve(result);
    };

    const timer = setTimeout(() => finish(undefined), OSC11_TIMEOUT_MS);

    const onData = (data: Buffer) => {
      buffer += data.toString();
      // OSC response: ESC ] 11 ; <data> BEL  or  ESC ] 11 ; <data> ST
      const match = /\x1b\]11;(.*?)(?:\x07|\x1b\\)/.exec(buffer);
      if (match) {
        finish(themeFromOscColor(match[1]!));
      }
    };

    stdin.on("data", onData);
    process.stdout.write("\x1b]11;?\x07");
  });
}

// ---------------------------------------------------------------------------
// Synchronous detection helpers
// ---------------------------------------------------------------------------

/**
 * Detects the macOS system appearance using `defaults read -g AppleInterfaceStyle`.
 * Returns 'dark' if Dark Mode is active, 'light' when the key is missing
 * (the canonical macOS Light Mode signal), and undefined for any other failure
 * so the caller can continue its fallback chain.
 * Returns undefined on non-macOS platforms.
 */
export function detectMacOSTheme(): DetectedTheme | undefined {
  if (process.platform !== "darwin") {
    return undefined;
  }

  try {
    const result = execSync("defaults read -g AppleInterfaceStyle", {
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    return result.toLowerCase() === "dark" ? "dark" : "light";
  } catch (error) {
    const err = error as { stderr?: string | Buffer; message?: string };
    const stderr = typeof err.stderr === "string" ? err.stderr : (err.stderr?.toString?.() ?? "");
    const message = err.message ?? "";
    // Only the explicit "… does not exist" error confirms Light Mode.
    if (/does not exist/i.test(stderr) || /does not exist/i.test(message)) {
      return "light";
    }
    return undefined;
  }
}

/**
 * Detects theme from the COLORFGBG environment variable.
 *
 * COLORFGBG format: "foreground;background" where values are ANSI color indices (0-15).
 * Index 7 (light gray) and 9-15 → light. 0-6, 8 → dark.
 */
export function detectFromColorFgBg(): DetectedTheme | undefined {
  const colorFgBg = process.env["COLORFGBG"];
  if (!colorFgBg) {
    return undefined;
  }

  const parts = colorFgBg.split(";");
  const bgStr = parts[parts.length - 1];
  if (bgStr === undefined) {
    return undefined;
  }

  const bg = parseInt(bgStr, 10);
  if (isNaN(bg)) {
    return undefined;
  }

  if (bg === 7 || (bg >= 9 && bg <= 15)) {
    return "light";
  }

  return "dark";
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * Synchronous theme detection (for theme dialog live-preview).
 *
 * Order: COLORFGBG → macOS system appearance → default dark.
 */
export function detectSystemTheme(): DetectedTheme {
  return detectFromColorFgBg() ?? detectMacOSTheme() ?? "dark";
}

/**
 * Asynchronous theme detection (for startup).
 *
 * Checks cheap synchronous sources first (COLORFGBG) so we never pay the
 * ~200 ms OSC 11 timeout when a fast answer is already available.
 *
 * Order: COLORFGBG → OSC 11 → macOS system appearance → default dark.
 */
export async function detectTerminalThemeAsync(): Promise<DetectedTheme> {
  const colorFgBgResult = detectFromColorFgBg();
  if (colorFgBgResult) return colorFgBgResult;

  const osc11Result = await detectOsc11Theme();
  if (osc11Result) return osc11Result;

  return detectMacOSTheme() ?? "dark";
}
