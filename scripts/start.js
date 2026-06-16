import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const cliDist = join(root, "packages", "cli", "dist", "cli.js");

if (!existsSync(cliDist)) {
  console.error(`Error: ${cliDist} not found. Run 'npm run build' first.`);
  process.exit(1);
}

console.log("Starting Deep Code CLI...\n");

const child = spawn("node", [cliDist, ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: root,
});

child.on("exit", (code) => process.exit(code ?? 1));
