import { cpSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const cliRoot = join(root, "packages", "cli");
const distDir = join(cliRoot, "dist");

if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

const templatesSrc = join(root, "packages", "core", "templates");
const templatesDest = join(distDir, "templates");

if (!existsSync(templatesSrc)) {
  console.error(`Templates directory not found at ${templatesSrc}`);
  process.exit(1);
}

// 1. Copy core/templates/ → dist/templates/, excluding skills/bundled/.
//    Bundled skills are copied separately to dist/bundled/ (see step 2) and
//    getBundledSkillsRoot() resolves them from there at runtime.
rmSync(templatesDest, { recursive: true, force: true });
cpSync(templatesSrc, templatesDest, {
  recursive: true,
  dereference: true,
  filter: (src) => {
    const rel = relative(templatesSrc, src);
    // Exclude skills/bundled and everything under it
    return !(rel === join("skills", "bundled") || rel.startsWith(join("skills", "bundled") + "/"));
  },
});
console.log("\n✅  Copied core/templates/ → dist/templates/ (excluding skills/bundled/)");

// 2. Copy bundled skills to dist/bundled/
const bundledSkillsSrc = join(templatesSrc, "skills", "bundled");
const bundledSkillsDest = join(distDir, "bundled");

if (existsSync(bundledSkillsSrc)) {
  rmSync(bundledSkillsDest, { recursive: true, force: true });
  cpSync(bundledSkillsSrc, bundledSkillsDest, {
    recursive: true,
    dereference: true,
  });
  console.log("✅  Copied bundled skills → dist/bundled/");
}

console.log("\n✅  All bundle assets copied.\n");
