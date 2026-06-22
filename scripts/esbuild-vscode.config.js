import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const vscodeRoot = join(root, "packages", "vscode-ide-companion");
const entry = join(vscodeRoot, "src", "extension.ts");
const outfile = join(vscodeRoot, "out", "extension.js");

await build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  outfile,
  external: ["vscode"],
  sourcemap: true,
  footer: {
    js: "module.exports = { activate, deactivate };",
  },
  logOverride: {
    "empty-import-meta": "silent",
  },
});

console.log(`\n✅  ${outfile}  built successfully\n\n`);
