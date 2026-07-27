import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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

// Build webview first (Vite → dist/webview/)
run("npm", ["run", "build:webview", "--workspace=deepcode-vscode"], "2/4 Build webview");

// Build extension (esbuild bundle + copy templates → dist/extension.js)
run("npm", ["run", "build", "--workspace=deepcode-vscode"], "3/4 Build extension");

// Package into .vsix for local verification
run("npm", ["run", "package", "--workspace=deepcode-vscode"], "4/4 Package .vsix");

console.log("\n✅  VSCode companion build complete.\n\n");
