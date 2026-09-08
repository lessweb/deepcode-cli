import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vscodeRoot = join(root, "packages", "vscode-ide-companion");
const result = spawnSync("vsce", ["package", "--no-dependencies"], {
  cwd: vscodeRoot,
  stdio: "inherit",
  shell: true,
});

process.exit(result.status ?? 1);
