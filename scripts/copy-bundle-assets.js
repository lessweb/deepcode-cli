import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const cliRoot = join(root, "packages", "cli");
const distDir = join(cliRoot, "dist");
const bundledSkillsSrc = join(root, "packages", "core", "templates", "skills", "bundled");
const bundledSkillsDest = join(distDir, "bundled");

if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

if (!existsSync(bundledSkillsSrc)) {
  console.error(`Bundled skills directory not found at ${bundledSkillsSrc}`);
  process.exit(1);
}

rmSync(bundledSkillsDest, { recursive: true, force: true });
cpSync(bundledSkillsSrc, bundledSkillsDest, {
  recursive: true,
  dereference: true,
});

console.log("\n✅  All bundle assets copied to dist/bundled/");
