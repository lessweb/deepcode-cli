import { build } from "esbuild";
import { readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const vscodeRoot = join(root, "packages", "vscode-ide-companion");
const entry = join(vscodeRoot, "src", "extension.ts");
const outDir = join(vscodeRoot, "out");
const outfile = join(outDir, "extension.js");
const resolveFromExtension = createRequire(join(vscodeRoot, "package.json"));
const sharpEntry = resolveFromExtension.resolve("sharp");
const sharpPackage = JSON.parse(readFileSync(join(dirname(sharpEntry), "..", "package.json"), "utf8"));

rmSync(outDir, { recursive: true, force: true });

await build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  outfile,
  external: ["vscode", "sharp"],
  define: {
    __DEEPCODE_SHARP_VERSION__: JSON.stringify(sharpPackage.version),
  },
  sourcemap: true,
  footer: {
    js: "module.exports = { activate, deactivate };",
  },
  logOverride: {
    "empty-import-meta": "silent",
  },
});

console.log(`\n✅  ${outfile} built successfully\n\n`);
