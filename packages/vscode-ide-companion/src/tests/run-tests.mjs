// Test runner for @vegamo/deepcode-vscode
import { globSync } from "glob";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testFiles = globSync("*.test.ts", { cwd: __dirname });
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-vscode-tests-home-"));
let status = 1;
try {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...testFiles], {
    stdio: "inherit",
    cwd: __dirname,
    env: { ...process.env, HOME: tempHome, USERPROFILE: tempHome },
  });
  status = result.status ?? 1;
} finally {
  fs.rmSync(tempHome, { recursive: true, force: true });
}
process.exit(status);
