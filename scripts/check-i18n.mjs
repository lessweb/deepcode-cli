#!/usr/bin/env node

/**
 * check-i18n.mjs
 *
 * Validates i18n translation files:
 * 1. Checks that every key in en/index.json exists in zh-CN/index.json
 * 2. Reports missing keys
 * 3. Exits with code 1 if there are missing keys, 0 otherwise
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const localesDir = resolve(__dirname, "..", "locales");

function flattenKeys(obj, prefix = "") {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      result[newKey] = value;
    } else if (value && typeof value === "object") {
      Object.assign(result, flattenKeys(value, newKey));
    }
  }
  return result;
}

function loadLocale(locale) {
  const filePath = resolve(localesDir, locale, "index.json");
  if (!existsSync(filePath)) {
    console.log(`[check-i18n] ${locale}/index.json not found, skipping.`);
    return {};
  }
  const raw = JSON.parse(readFileSync(filePath, "utf8"));
  return flattenKeys(raw);
}

const enKeys = Object.keys(loadLocale("en"));
const zhKeys = new Set(Object.keys(loadLocale("zh-CN")));

const missing = enKeys.filter((key) => !zhKeys.has(key));

if (missing.length === 0) {
  console.log(`[check-i18n] ✅ All ${enKeys.length} keys match between en/ and zh-CN/.`);
  process.exit(0);
}

console.log(`[check-i18n] ❌ Missing ${missing.length} keys in zh-CN/ (compared to en/):`);
for (const key of missing) {
  console.log(`  - ${key}`);
}
process.exit(1);
