import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

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
let tag = "latest";
let dryRun = false;
let force = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--dry-run") {
    dryRun = true;
  } else if (arg === "--force") {
    force = true;
  } else if (arg === "--tag") {
    tag = args[++i];
    if (!tag) fail("--tag requires a value");
  } else if (!version) {
    version = arg;
  } else {
    fail(`Unknown argument: ${arg}`);
  }
}

if (!version) {
  log(`
Usage: node scripts/publish.js <version> [options]

Arguments:
  <version>          Semver version to publish (e.g. 0.1.32, 0.2.0-beta.1)

Options:
  --tag <dist-tag>   npm dist-tag (default: "latest")
  --dry-run          Preview all steps without executing
  --force            Skip branch check (publish from non-main branch)

Examples:
  node scripts/publish.js 0.1.32
  node scripts/publish.js 0.1.32-beta.1 --tag beta
  node scripts/publish.js 0.1.32 --dry-run
`);
  process.exit(1);
}

if (!isValidSemver(version)) {
  fail(`Invalid semver version: ${version}`);
}

const TOTAL_STEPS = 9;

// ── Banner ───────────────────────────────────────────────────────────────────

log("=========================================");
log(`  Deep Code CLI — Publish v${version}`);
log(`  tag=${tag}  dryRun=${dryRun}  force=${force}`);
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

// ── 2. npm auth ──────────────────────────────────────────────────────────────

step(2, TOTAL_STEPS, "Checking npm authentication...");

if (!dryRun) {
  const whoami = spawnSync("npm", ["whoami"], {
    cwd: root,
    encoding: "utf-8",
    shell: true,
  });
  if (whoami.status !== 0) {
    fail("Not logged in to npm. Run `npm login` first.");
  }
  ok(`Logged in as: ${whoami.stdout.trim()}`);
} else {
  log("  (dry-run) skipping npm whoami");
}

// ── 3. Version bump ──────────────────────────────────────────────────────────

step(3, TOTAL_STEPS, "Updating package versions...");

const corePkgPath = join(root, "packages", "core", "package.json");
const cliPkgPath = join(root, "packages", "cli", "package.json");

const corePkg = readJson(corePkgPath);
const cliPkg = readJson(cliPkgPath);

const oldVersion = corePkg.version;

// Save originals for restore
const origCliPkg = JSON.stringify(cliPkg, null, 2) + "\n";

corePkg.version = version;
cliPkg.version = version;

if (!dryRun) {
  writeJson(corePkgPath, corePkg);
  writeJson(cliPkgPath, cliPkg);
  ok(`Updated packages/core: ${oldVersion} → ${version}`);
  ok(`Updated packages/cli:  ${oldVersion} → ${version}`);
} else {
  log(`  (dry-run) packages/core: ${oldVersion} → ${version}`);
  log(`  (dry-run) packages/cli:  ${oldVersion} → ${version}`);
}

// ── 4. Quality checks ────────────────────────────────────────────────────────

step(4, TOTAL_STEPS, "Running quality checks (typecheck + lint + format)...");

run("npm", ["run", "check"], { dryRun });
ok("All checks passed");

step(5, TOTAL_STEPS, "Running tests...");

run("npm", ["run", "test", "--workspaces"], { dryRun });
ok("All tests passed");

// ── 6. Build ─────────────────────────────────────────────────────────────────

step(6, TOTAL_STEPS, "Building packages...");

run("npm", ["run", "build"], { dryRun });
ok("Build complete");

// ── 7. Publish core ──────────────────────────────────────────────────────────

step(7, TOTAL_STEPS, "Publishing @vegamo/deepcode-core...");

const corePublishArgs = [
  "publish",
  "--workspace=@vegamo/deepcode-core",
  "--access",
  "public",
  "--tag",
  tag,
  "--registry",
  "https://registry.npmjs.org",
];
if (dryRun) corePublishArgs.push("--dry-run");

run("npm", corePublishArgs, { dryRun, label: `npm ${corePublishArgs.join(" ")}` });
ok(`Published @vegamo/deepcode-core@${version}`);

// ── 8. Patch CLI deps & publish ──────────────────────────────────────────────

step(8, TOTAL_STEPS, "Patching CLI dependencies and publishing @vegamo/deepcode-cli...");

// Replace file:../core with ^version for npm
const patchedCliPkg = readJson(cliPkgPath);
const coreDep = patchedCliPkg.dependencies["@vegamo/deepcode-core"];
if (coreDep && coreDep.startsWith("file:")) {
  patchedCliPkg.dependencies["@vegamo/deepcode-core"] = `^${version}`;
  if (!dryRun) {
    writeJson(cliPkgPath, patchedCliPkg);
  }
  log(`  Patched @vegamo/deepcode-core dep: "${coreDep}" → "^${version}"`);
}

const cliPublishArgs = [
  "publish",
  "--workspace=@vegamo/deepcode-cli",
  "--access",
  "public",
  "--tag",
  tag,
  "--registry",
  "https://registry.npmjs.org",
];
if (dryRun) cliPublishArgs.push("--dry-run");

run("npm", cliPublishArgs, { dryRun, label: `npm ${cliPublishArgs.join(" ")}` });
ok(`Published @vegamo/deepcode-cli@${version}`);

// Restore file:../core for local development
if (!dryRun) {
  writeJson(cliPkgPath, JSON.parse(origCliPkg));
  // But keep the new version
  const restoredCli = readJson(cliPkgPath);
  restoredCli.version = version;
  writeJson(cliPkgPath, restoredCli);
  log("  Restored @vegamo/deepcode-core dep to file:../core");
}

// ── 9. Git commit + tag ──────────────────────────────────────────────────────

step(9, TOTAL_STEPS, "Creating git commit and tag...");

if (!dryRun) {
  run("git", ["add", "packages/core/package.json", "packages/cli/package.json"], {
    label: "git add packages/*/package.json",
  });
  run("git", ["commit", "-m", `chore(release): v${version}`], {
    label: `git commit -m "chore(release): v${version}"`,
  });
  run("git", ["tag", `v${version}`], {
    label: `git tag v${version}`,
  });
  ok(`Created commit and tag v${version}`);
} else {
  log(`  (dry-run) git add + commit "chore(release): v${version}"`);
  log(`  (dry-run) git tag v${version}`);
}

// ── Done ─────────────────────────────────────────────────────────────────────

console.log("\n=========================================");
console.log(`  🎉  Published v${version} successfully!`);
console.log("=========================================");
console.log(`
  Packages published:
    • @vegamo/deepcode-core@${version}
    • @vegamo/deepcode-cli@${version}

  Verify:
    npm view @vegamo/deepcode-cli version
    npx @vegamo/deepcode-cli --version

  Push to remote:
    git push && git push --tags
`);
