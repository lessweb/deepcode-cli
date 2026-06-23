import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const cliRoot = join(root, "packages", "cli");
const entry = join(cliRoot, "src", "cli.tsx");

await build({
  entryPoints: [entry],
  bundle: true,
  outdir: join(cliRoot, "dist"),
  entryNames: "[name]",
  chunkNames: "chunks/[name]-[hash]",
  splitting: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: { js: "#!/usr/bin/env node" },
  jsx: "automatic",
  jsxImportSource: "react",
  packages: "bundle",
  inject: [join(__dirname, "esbuild-shims.js")],
  alias: {
    // react-devtools-core is a browser-only package pulled in by ink's
    // devtools support.  It cannot run in a Node.js CLI, so we replace it
    // with an empty shim so esbuild doesn't bundle the real (broken) code.
    "react-devtools-core": join(__dirname, "empty-shim.js"),
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  logOverride: {
    "empty-import-meta": "silent",
  },
  metafile: true,
  write: true,
  keepNames: true,
});

console.log(`\n✅  ${join(cliRoot, "dist", "cli.js")}  built successfully\n\n`);
