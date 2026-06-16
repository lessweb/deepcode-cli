import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function run(command, args, label) {
  process.stdout.write(`\n[${label}] ${command} ${args.join(" ")}\n`);
  const result = spawnSync(command, args, { stdio: "inherit", cwd: root, shell: true });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("=========================================");
console.log("  Deep Code CLI — Build");
console.log("=========================================");

run("npm", ["run", "build", "--workspace=@vegamo/deepcode-core"], "1/2");
run("npm", ["run", "bundle"], "2/2");

console.log("\n✅  Build complete.\n\n");
