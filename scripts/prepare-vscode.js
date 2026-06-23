import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// Load .env file if VSCE_PAT is not already set
if (!process.env.VSCE_PAT) {
  const envPath = join(root, ".env");
  if (existsSync(envPath)) {
    const lines = readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (key && !process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(msg);
}

function step(n, total, msg) {
  console.log(`\n[${n}/${total}] ${msg}`);
}

function fail(msg) {
  console.error(`\n❌  ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`✅  ${msg}`);
}

function run(cmd, args, opts = {}) {
  const label = opts.label ?? `${cmd} ${args.join(" ")}`;
  if (opts.dryRun) {
    log(`  (dry-run) ${label}`);
    return { status: 0, stdout: "" };
  }
  const result = spawnSync(cmd, args, {
    stdio: opts.stdio ?? "inherit",
    cwd: opts.cwd ?? root,
    shell: true,
    env: { ...process.env, ...opts.env },
  });
  if (result.status !== 0) {
    fail(`Command failed: ${label}`);
  }
  return result;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function writeJson(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function isValidSemver(v) {
  return /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/.test(v);
}

// ── Parse args ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let version = null;
let dryRun = false;
let force = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--dry-run") {
    dryRun = true;
  } else if (arg === "--force") {
    force = true;
  } else if (!version) {
    version = arg;
  } else {
    fail(`Unknown argument: ${arg}`);
  }
}

if (!version) {
  log(`
Usage: node scripts/prepare-vscode.js <version> [options]

Arguments:
  <version>          Semver version to publish (e.g. 0.1.32, 0.2.0-beta.1)

Options:
  --dry-run          Preview all steps without executing
  --force            Skip branch check (publish from non-main branch)

Environment:
  VSCE_PAT           Required. Azure DevOps Personal Access Token for marketplace auth.
                     Generate at: https://dev.azure.com/vegamo/_usersSettings/tokens
                     Can also be set in .env file (auto-loaded).

Examples:
  VSCE_PAT=xxx node scripts/prepare-vscode.js 0.1.32
  node scripts/prepare-vscode.js 0.1.32-beta.1
  node scripts/prepare-vscode.js 0.1.32 --dry-run
`);
  process.exit(1);
}

if (!isValidSemver(version)) {
  fail(`Invalid semver version: ${version}`);
}

const TOTAL_STEPS = 7;

// ── Banner ───────────────────────────────────────────────────────────────────

log("=========================================");
log(`  Deep Code VSCode — Publish v${version}`);
log(`  dryRun=${dryRun}  force=${force}`);
log("=========================================");

// ── 1. Git checks ────────────────────────────────────────────────────────────

step(1, TOTAL_STEPS, "Checking git state...");

const gitStatus = spawnSync("git", ["status", "--porcelain"], {
  cwd: root,
  encoding: "utf-8",
  shell: true,
});
if (gitStatus.stdout.trim()) {
  fail("Working tree is not clean. Commit or stash changes first.");
}
ok("Working tree is clean");

if (!force) {
  const gitBranch = spawnSync("git", ["branch", "--show-current"], {
    cwd: root,
    encoding: "utf-8",
    shell: true,
  });
  const branch = gitBranch.stdout.trim();
  if (branch !== "main") {
    fail(`Not on main branch (current: ${branch}). Use --force to publish from another branch.`);
  }
  ok("On main branch");
}

// ── 2. VSCE_PAT check ────────────────────────────────────────────────────────

step(2, TOTAL_STEPS, "Checking VSCE_PAT...");

if (!dryRun) {
  if (!process.env.VSCE_PAT) {
    fail(
      "VSCE_PAT environment variable is not set.\n  Generate a Personal Access Token at:\n  https://dev.azure.com/vegamo/_usersSettings/tokens\n  Then: VSCE_PAT=<token> node scripts/prepare-vscode.js <version>"
    );
  }
  ok("VSCE_PAT is set");
} else {
  log("  (dry-run) skipping VSCE_PAT check");
}

// ── 3. Version bump ──────────────────────────────────────────────────────────

step(3, TOTAL_STEPS, "Updating package version...");

const vscodePkgPath = join(root, "packages", "vscode-ide-companion", "package.json");

const vscodePkg = readJson(vscodePkgPath);

const oldVersion = vscodePkg.version;

vscodePkg.version = version;

if (!dryRun) {
  writeJson(vscodePkgPath, vscodePkg);
  ok(`Updated packages/vscode-ide-companion: ${oldVersion} → ${version}`);
} else {
  log(`  (dry-run) packages/vscode-ide-companion: ${oldVersion} → ${version}`);
}

// ── 4. Quality checks ────────────────────────────────────────────────────────

step(4, TOTAL_STEPS, "Running quality checks (typecheck + lint + format)...");

run("npm", ["run", "check"], { dryRun });
ok("All checks passed");

// ── 5. Tests ──────────────────────────────────────────────────────────────────

step(5, TOTAL_STEPS, "Running tests...");

run("npm", ["run", "test", "--workspaces"], { dryRun });
ok("All tests passed");

// ── 6. Build ──────────────────────────────────────────────────────────────────

step(6, TOTAL_STEPS, "Building VSCode extension...");

run("npm", ["run", "build:vscode"], { dryRun });
ok("VSCode extension built");

// ── 7. Publish to marketplace ─────────────────────────────────────────────────

step(7, TOTAL_STEPS, "Publishing deepcode-vscode to marketplace...");

const vscodeRoot = join(root, "packages", "vscode-ide-companion");
const vsceArgs = ["vsce", "publish", version, "--no-dependencies"];
if (dryRun) vsceArgs.splice(2, 0, "--dry-run");

run("npx", vsceArgs, {
  cwd: vscodeRoot,
  env: { VSCE_PAT: process.env.VSCE_PAT },
  label: `npx ${vsceArgs.join(" ")}`,
});
ok(`Published deepcode-vscode@${version} to marketplace`);

// ── Git commit + tag ─────────────────────────────────────────────────────────

if (!dryRun) {
  log("\nCreating git commit and tag...");
  run("git", ["add", "packages/vscode-ide-companion/package.json"], {
    label: "git add packages/vscode-ide-companion/package.json",
  });
  run("git", ["commit", "-m", `chore(release): vscode v${version}`], {
    label: `git commit -m "chore(release): vscode v${version}"`,
  });
  run("git", ["tag", `vscode-v${version}`], {
    label: `git tag vscode-v${version}`,
  });
  ok(`Created commit and tag vscode-v${version}`);
} else {
  log("\n  (dry-run) git add + commit + tag");
}

// ── Done ─────────────────────────────────────────────────────────────────────

console.log("\n=========================================");
console.log(`  🎉  Published deepcode-vscode@${version} successfully!`);
console.log("=========================================");
console.log(`
  Verify:
    https://marketplace.visualstudio.com/items?itemName=vegamo.deepcode-vscode

  Push to remote:
    git push && git push --tags
`);
