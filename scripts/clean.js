import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { globSync } from "glob";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const RMRF = { recursive: true, force: true };

console.log("Cleaning build artifacts...\n");

// Root artifacts
rmSync(join(root, "node_modules"), RMRF);
console.log("  rm node_modules/");

// Generated version files
for (const pkg of ["cli", "core", "vscode-ide-companion"]) {
  rmSync(join(root, "packages", pkg, "src", "generated"), RMRF);
  console.log(`  rm packages/${pkg}/src/generated/`);
}

// All workspace dist/ and tsbuildinfo
const packageDirs = globSync("packages/*", { cwd: root, absolute: true });
for (const pkgDir of packageDirs) {
  rmSync(join(pkgDir, "dist"), RMRF);
  console.log(`  rm ${join(pkgDir, "dist")}`);
  rmSync(join(pkgDir, "tsconfig.tsbuildinfo"), { force: true });
}

// Clean up vscode-ide-companion package
rmSync(join(root, "packages/vscode-ide-companion/node_modules"), RMRF);
// VSCode .vsix files
const vsixFiles = globSync("packages/vscode-ide-companion/*.vsix", { cwd: root });
for (const vsixFile of vsixFiles) {
  rmSync(join(root, vsixFile), RMRF);
  console.log(`  rm ${vsixFile}`);
}

console.log("\n✅  Clean complete.\n\n");
