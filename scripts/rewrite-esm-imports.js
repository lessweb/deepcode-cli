/**
 * Post-build script: rewrites extensionless relative imports in a built package's
 * dist/ output to include explicit ".js" extensions.
 *
 * tsc with moduleResolution:"bundler" emits `from "./foo"` without an extension.
 * Node.js ESM requires `from "./foo.js"`. This script bridges the gap.
 *
 * Usage:
 * - node scripts/rewrite-esm-imports.js        rewrites packages/core/dist
 * - node scripts/rewrite-esm-imports.js server rewrites packages/server/dist
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { globSync } from "glob";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const packageName = process.argv[2] ?? "core";
const allowedPackages = new Set(["core", "server"]);

if (!allowedPackages.has(packageName)) {
  throw new Error(`Unsupported package for ESM import rewrite: ${packageName}`);
}

const distDir = join(root, "packages", packageName, "dist");
if (!existsSync(distDir)) {
  throw new Error(`Cannot rewrite ESM imports because dist directory does not exist: ${distDir}`);
}

const files = globSync("**/*.js", { cwd: distDir, absolute: true });

// Match: from "./anything" or from "../anything".
// The negative lookahead skips specifiers that already end in common explicit extensions.
const IMPORT_RE = /(from\s+["'])(\.\.?\/[^"']+?)(?<!\.[a-zA-Z0-9]{1,4})(["'])/g;

let totalRewrites = 0;

for (const filePath of files) {
  const original = readFileSync(filePath, "utf8");
  let rewrites = 0;

  const updated = original.replace(IMPORT_RE, (_match, prefix, specifier, quote) => {
    rewrites++;
    return `${prefix}${specifier}.js${quote}`;
  });

  if (rewrites > 0) {
    writeFileSync(filePath, updated, "utf8");
    totalRewrites += rewrites;
  }
}

console.log(`\n✅  Rewrote ${totalRewrites} imports across ${files.length} files in ${packageName}/dist/\n`);
