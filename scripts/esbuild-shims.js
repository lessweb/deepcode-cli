/**
 * Shims for esbuild ESM bundles.
 *
 * When esbuild bundles CJS modules into ESM output, it replaces require()
 * calls with a __require shim that throws for non-bundled modules.  This
 * file provides a real require() via createRequire() so Node.js built-in
 * modules (assert, events, zlib, etc.) resolve correctly at runtime.
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const _require = createRequire(import.meta.url);

if (typeof globalThis.require === "undefined") {
  globalThis.require = _require;
}

export const require = _require;
export const __filename = fileURLToPath(import.meta.url);
export const __dirname = dirname(__filename);
