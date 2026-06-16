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

run("npm", ["run", "build", "--workspace=@vegamo/deepcode-core"], "1/3 Build core");
run("node", ["scripts/esbuild-vscode.config.js"], "2/3 Bundle extension");
run("npm", ["run", "package", "--workspace=deepcode-vscode"], "3/3 Package .vsix");

console.log("\n✅  VSCode companion build complete.\n\n");
