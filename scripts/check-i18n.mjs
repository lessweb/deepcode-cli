#!/usr/bin/env node

/**
 * check-i18n.mjs
 *
 * Validates i18n translation files:
 * 1. Reads all *.json files from en/ and zh-CN/ directories
 * 2. Checks that every flattened key in en/ exists in zh-CN/
 * 3. Reports missing keys
 * 4. Exits with code 1 if there are missing keys, 0 otherwise
 */

import { readFileSync, existsSync, readdirSync } from "fs";
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
  const localePath = resolve(localesDir, locale);
  if (!existsSync(localePath)) {
    console.log(`[check-i18n] ${locale}/ directory not found, skipping.`);
    return {};
  }

  const merged = {};
  const files = readdirSync(localePath)
    .filter((f) => f.endsWith(".json"))
    .sort();

  if (files.length === 0) {
    console.log(`[check-i18n] No JSON files found in ${locale}/.`);
    return {};
  }

  for (const file of files) {
    const filePath = resolve(localePath, file);
    try {
      const content = JSON.parse(readFileSync(filePath, "utf8"));
      Object.assign(merged, flattenKeys(content));
    } catch (err) {
      console.error(`[check-i18n] Error reading ${locale}/${file}: ${err.message}`);
    }
  }

  return merged;
}

const enKeys = Object.keys(loadLocale("en"));
const zhKeys = new Set(Object.keys(loadLocale("zh-CN")));

const missing = enKeys.filter((key) => !zhKeys.has(key));

if (missing.length === 0) {
  console.log(`[check-i18n] \u2705 All ${enKeys.length} keys match between en/ and zh-CN/.`);
  process.exit(0);
}

console.log(`[check-i18n] \u274c Missing ${missing.length} keys in zh-CN/ (compared to en/):`);
for (const key of missing) {
  console.log(`  - ${key}`);
}
process.exit(1);
