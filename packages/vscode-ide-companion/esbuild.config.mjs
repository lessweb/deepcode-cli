/* global console, process */
import * as esbuild from "esbuild";
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname);
const packagesRoot = join(__dirname, "..");
const coreTemplates = join(packagesRoot, "core", "templates");
const localTemplates = join(root, "templates");

// Copy templates from core for development
if (existsSync(coreTemplates)) {
  if (existsSync(localTemplates)) {
    rmSync(localTemplates, { recursive: true, force: true });
  }
  cpSync(coreTemplates, localTemplates, { recursive: true, dereference: true });
  console.log("✅  Copied core/templates/ → templates/ (for development)");
}

const isWatch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "ES2022",
  sourcemap: true,
  minify: !isWatch,
  external: ["vscode"],
  // Inject a `require` function via createRequire so that dynamic require()
  // calls from bundled CJS dependencies work in VSCode's ESM extension host.
  banner: {
    js: `import { createRequire as __deepcodeCreateRequire } from "node:module";var require = __deepcodeCreateRequire(import.meta.url);`,
  },
};

if (isWatch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await esbuild.build(options);
  console.log("\n✅  dist/extension.js  built successfully\n");
}
