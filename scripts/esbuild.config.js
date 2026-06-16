import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const cliRoot = join(root, "packages", "cli");
const entry = join(cliRoot, "src", "cli.tsx");
const outfile = join(cliRoot, "dist", "cli.js");

await build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile,
  banner: { js: "#!/usr/bin/env node" },
  jsx: "automatic",
  jsxImportSource: "react",
  packages: "external",
  logOverride: {
    "empty-import-meta": "silent",
  },
});

console.log(`\n✅  ${outfile}  built successfully\n\n`);
