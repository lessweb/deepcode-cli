import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// --------------- Types ---------------

export type Locale = "en" | "zh-CN";

// Translation key type — dot-notation string like "ui.messageView.thinking"
// Runtime validates against loaded locale JSON; missing keys fall back to key itself.
export type TranslationKey = string;

// --------------- Internal State ---------------

const localeCache = new Map<string, Record<string, string>>();

let currentLocale: Locale = "en";
let thinkingLocale: Locale = "en";
let replyLocale: Locale = "en";

// --------------- Helpers ---------------

function getExtensionRoot(): string {
  // Prefer __dirname which is available in the CJS bundle output.
  // Fall back to import.meta.url for ESM test environments.
  if (typeof __dirname !== "undefined") {
    return path.resolve(__dirname, "..");
  }
  const currentFile = fileURLToPath(import.meta.url);
  // In the ESM bundle (dist/cli.js), go up 1 level to reach project root.
  // In tsx dev mode (src/common/i18n.ts), go up 2 levels.
  const levels = currentFile.replace(/\\/g, "/").includes("/dist/") ? 1 : 2;
  return levels === 1
    ? path.resolve(path.dirname(currentFile), "..")
    : path.resolve(path.dirname(currentFile), "..", "..");
}

function flattenKeys(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      result[newKey] = value;
    } else if (value && typeof value === "object") {
      Object.assign(result, flattenKeys(value as Record<string, unknown>, newKey));
    }
  }
  return result;
}

function loadLocaleDir(locale: string): Record<string, string> {
  if (localeCache.has(locale)) {
    return localeCache.get(locale)!;
  }

  const localesDir = path.resolve(getExtensionRoot(), "locales", locale);
  if (!fs.existsSync(localesDir)) {
    localeCache.set(locale, {});
    return {};
  }

  const merged: Record<string, string> = {};
  const files = fs
    .readdirSync(localesDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  for (const file of files) {
    const filePath = path.join(localesDir, file);
    try {
      const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
      Object.assign(merged, flattenKeys(content));
    } catch {
      // Skip malformed files silently
    }
  }

  localeCache.set(locale, merged);
  return merged;
}

function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key];
    return value !== undefined ? String(value) : `{${key}}`;
  });
}

/**
 * Detect the best locale from the environment.
 * Checks LANG env var, then falls back to "en".
 */
function detectLocale(): Locale {
  const lang = process.env.LANG ?? "";
  if (lang.toLowerCase().includes("zh_CN") || lang.toLowerCase().includes("zh-cn")) {
    return "zh-CN";
  }
  return "en";
}

// --------------- Public API ---------------

/**
 * Initialize i18n by loading translations for the given locale.
 * Also loads en/ as fallback.
 * Options: thinkingLocale and replyLocale default to main locale if not set.
 */
export function initI18n(locale: Locale, options?: { thinkingLocale?: Locale; replyLocale?: Locale }): void {
  currentLocale = locale;
  thinkingLocale = options?.thinkingLocale ?? locale;
  replyLocale = options?.replyLocale ?? locale;

  // Pre-load main locale and fallback (en/)
  loadLocaleDir(locale);
  if (locale !== "en") {
    loadLocaleDir("en");
  }
}

/**
 * Translate a key to the current locale's string.
 * @param key       - Translation key (dot-notation, auto-completed via TranslationKey)
 * @param params    - Optional placeholder values for {placeholder} in the string
 * @param localeOverride - Optional: look up from a different locale (for system prompt language instructions)
 */
export function t(key: TranslationKey, params?: Record<string, string | number>, localeOverride?: Locale): string {
  // Determine which locale to read from
  const targetLocale = localeOverride ?? currentLocale;

  // Try target locale
  const targetMessages = localeCache.get(targetLocale);
  if (targetMessages && key in targetMessages) {
    const msg = targetMessages[key];
    return params ? interpolate(msg, params) : msg;
  }

  // Fallback to en/ (unless we already tried en)
  if (targetLocale !== "en") {
    const enMessages = localeCache.get("en");
    if (enMessages && key in enMessages) {
      const msg = enMessages[key];
      return params ? interpolate(msg, params) : msg;
    }
  }

  // Not found in any locale — return key as self-documentation
  return key;
}

/** Get the current UI locale. */
export function getLocale(): Locale {
  return currentLocale;
}

/** Get the current thinking (reasoning) locale. */
export function getThinkingLocale(): Locale {
  return thinkingLocale;
}

/** Get the current reply locale. */
export function getReplyLocale(): Locale {
  return replyLocale;
}

/** Set the thinking (reasoning) locale. */
export function setThinkingLocale(locale: Locale): void {
  thinkingLocale = locale;
}

/** Set the reply locale. */
export function setReplyLocale(locale: Locale): void {
  replyLocale = locale;
}

/** Reset i18n state (for testing). */
export function resetI18n(): void {
  localeCache.clear();
  currentLocale = "en";
  thinkingLocale = "en";
  replyLocale = "en";
}

/** Detect locale from environment. */
export function getDetectedLocale(): Locale {
  return detectLocale();
}
