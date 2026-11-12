import { spawnSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// OS/tooling junk that must never end up inside the packaged extension,
// regardless of what happens to live in packages/core/templates/.
const EXCLUDED_NAMES = new Set([".DS_Store", ".AppleDouble", ".LSOverride", "Thumbs.db", "desktop.ini", "__MACOSX"]);

function run(command, args, label) {
  console.log(`\n[${label}] ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { stdio: "inherit", cwd: root, shell: true });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("=========================================");
console.log("  Deep Code — Build VSCode Companion");
console.log("=========================================");

run("npm", ["run", "build", "--workspace=@vegamo/deepcode-core"], "1/4 Build core");
run("node", ["scripts/esbuild-vscode.config.js"], "2/4 Bundle extension");

// Copy templates from core so the extension can read them at runtime via fs
const templatesSrc = join(root, "packages", "core", "templates");
const templatesDest = join(root, "packages", "vscode-ide-companion", "templates");

if (!existsSync(templatesSrc)) {
  console.error(`\n❌  Templates not found at ${templatesSrc}`);
  process.exit(1);
}

rmSync(templatesDest, { recursive: true, force: true });

let skipped = 0;
cpSync(templatesSrc, templatesDest, {
  recursive: true,
  dereference: true,
  filter: (source) => {
    if (EXCLUDED_NAMES.has(basename(source))) {
      skipped++;
      return false;
    }
    return true;
  },
});
console.log(
  `\n[3/4] Copied templates from core → vscode-ide-companion/templates/` +
    (skipped > 0 ? ` (skipped ${skipped} junk file(s))` : "")
);

run("npm", ["run", "package", "--workspace=deepcode-vscode"], "4/4 Package .vsix");

console.log("\n✅  VSCode companion build complete.\n\n");
