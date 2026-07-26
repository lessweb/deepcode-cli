#!/usr/bin/env node
/* global require, process, console */
/**
 * Example pre-write hook — prevents accidental writes to sensitive paths.
 *
 * Receives context via stdin JSON:
 *   { phase, tool, sessionId, projectRoot, filePath, ... }
 *
 * Exit codes:
 *   0 = allow
 *   2 = block (return reason via stdout)
 *
 * Place in: .deepcode/hooks/pre-write.js or ~/.deepcode/hooks/pre-write.js
 */

const SENSITIVE_PATTERNS = [/\.env$/i, /\.git\/config$/, /package-lock\.json$/, /\/dist\//, /\/node_modules\//];

let context;
try {
  const raw = require("fs").readFileSync(0, "utf8");
  context = JSON.parse(raw);
} catch {
  // No valid JSON — allow
  process.exit(0);
}

const filePath = context.filePath || "";
for (const pattern of SENSITIVE_PATTERNS) {
  if (pattern.test(filePath)) {
    console.log(`Blocked: writing to sensitive path "${filePath}" is not allowed.`);
    process.exit(2);
  }
}

process.exit(0);
