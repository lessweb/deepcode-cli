import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const packagesRoot = join(root, "..");
const coreTemplates = join(packagesRoot, "core", "templates");
const destDir = join(root, "templates");

if (!existsSync(coreTemplates)) {
  console.error(`Templates directory not found at ${coreTemplates}`);
  process.exit(1);
}

// Remove old templates if exists
if (existsSync(destDir)) {
  rmSync(destDir, { recursive: true, force: true });
}

// Copy templates to dist/templates
mkdirSync(destDir, { recursive: true });
cpSync(coreTemplates, destDir, {
  recursive: true,
  dereference: true,
});

console.log(`✅  Copied core/templates/ → templates/`);
