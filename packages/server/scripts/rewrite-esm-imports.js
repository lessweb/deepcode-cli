/**
 * Post-build script: rewrites extensionless relative imports in the server
 * package's dist/ output to include explicit ".js" extensions.
 *
 * Keep this package-local so the server feature does not change the existing
 * root-level core rewrite script.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { globSync } from "glob";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, "..");
const distDir = join(packageRoot, "dist");

if (!existsSync(distDir)) {
  throw new Error(`Cannot rewrite server ESM imports because dist directory does not exist: ${distDir}`);
}

const files = globSync("**/*.js", { cwd: distDir, absolute: true });

// Match: from "./anything" or from "../anything"
// Negative lookahead: skip if already ends with .js, .json, .node, or is a bare specifier
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

console.log(`\n✅  Rewrote ${totalRewrites} imports across ${files.length} files in server/dist/\n`);
