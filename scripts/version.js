import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { globSync } from "glob";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const BUMP_TYPES = ["major", "minor", "patch", "premajor", "preminor", "prepatch", "prerelease", "from-git"];

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(msg);
}

function fail(msg) {
  console.error(`\n❌  ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`✅  ${msg}`);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function writeJson(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function updateLockfileVersions(packageVersions) {
  const lockPath = join(root, "package-lock.json");
  const lockfile = readJson(lockPath);
  const missing = packageVersions.filter(({ path }) => !lockfile.packages?.[path]).map(({ path }) => path);
  if (missing.length > 0) {
    fail(`package-lock.json is missing workspace entries:\n  - ${missing.join("\n  - ")}`);
  }

  for (const { path, version } of packageVersions) {
    lockfile.packages[path].version = version;
  }
  writeJson(lockPath, lockfile);
}

function isValidSemver(v) {
  return /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/.test(v);
}

function isBumpType(v) {
  return BUMP_TYPES.includes(v);
}

function runSilent(cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf-8",
    shell: true,
  });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim();
}

// ── Version bump logic ───────────────────────────────────────────────────────

function parseVersion(v) {
  const match = v.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  if (!match) fail(`Cannot parse version: ${v}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

function formatVersion({ major, minor, patch, prerelease }) {
  let v = `${major}.${minor}.${patch}`;
  if (prerelease) v += `-${prerelease}`;
  return v;
}

function bumpVersion(current, type, preid) {
  const v = parseVersion(current);

  switch (type) {
    case "major":
      return formatVersion({ major: v.major + 1, minor: 0, patch: 0, prerelease: null });

    case "minor":
      return formatVersion({ major: v.major, minor: v.minor + 1, patch: 0, prerelease: null });

    case "patch":
      if (v.prerelease) {
        // 0.1.32-beta.1 → 0.1.32 (drop prerelease)
        return formatVersion({ ...v, prerelease: null });
      }
      return formatVersion({ ...v, patch: v.patch + 1 });

    case "premajor":
      return formatVersion({
        major: v.major + 1,
        minor: 0,
        patch: 0,
        prerelease: `${preid}.0`,
      });

    case "preminor":
      return formatVersion({
        major: v.major,
        minor: v.minor + 1,
        patch: 0,
        prerelease: `${preid}.0`,
      });

    case "prepatch":
      if (v.prerelease) {
        // Already a prerelease — increment the prerelease number
        const num = Number(v.prerelease.split(".").pop());
        const base = v.prerelease.split(".").slice(0, -1).join(".");
        if (!isNaN(num)) {
          return formatVersion({ ...v, prerelease: `${base}.${num + 1}` });
        }
      }
      return formatVersion({
        ...v,
        patch: v.patch + 1,
        prerelease: `${preid}.0`,
      });

    case "prerelease":
      if (v.prerelease) {
        // 0.1.32-beta.0 → 0.1.32-beta.1
        const num = Number(v.prerelease.split(".").pop());
        const base = v.prerelease.split(".").slice(0, -1).join(".");
        if (!isNaN(num)) {
          const newPre = base ? `${base}.${num + 1}` : `${num + 1}`;
          return formatVersion({ ...v, prerelease: newPre });
        }
        // Can't parse number, append .0
        return formatVersion({ ...v, prerelease: `${v.prerelease}.0` });
      }
      // No prerelease yet — go to next patch prerelease
      return formatVersion({
        ...v,
        patch: v.patch + 1,
        prerelease: `${preid}.0`,
      });

    default:
      fail(`Unknown bump type: ${type}`);
  }
}

function resolveVersionFromGit() {
  // Get latest tag matching v*
  const tag = runSilent("git", ["describe", "--tags", "--abbrev=0"]);
  if (!tag) {
    fail("No git tags found. Cannot use 'from-git'.");
  }
  const v = tag.replace(/^v/, "");
  if (!isValidSemver(v)) {
    fail(`Latest git tag is not a valid semver: ${tag}`);
  }
  return v;
}

// ── Parse args ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let bumpArg = null;
let preid = "0";

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--help" || arg === "-h") {
    log(`
Usage: npm run release:version -- <newversion | bump-type> [--preid <id>]

Bumps the root package and all workspace package.json files, then updates their package-lock.json entries.
Works like npm version but for the entire monorepo.

Bump types:
  major         0.1.31 → 1.0.0
  minor         0.1.31 → 0.2.0
  patch         0.1.31 → 0.1.32
  premajor      0.1.31 → 1.0.0-0
  preminor      0.1.31 → 0.2.0-0
  prepatch      0.1.31 → 0.1.32-0
  prerelease    0.1.31 → 0.1.32-0   0.1.32-0 → 0.1.32-1
  from-git      Use version from latest git tag

Options:
  --preid <id>  Prerelease identifier (default: "0", e.g. "beta", "alpha")

Examples:
  npm run release:version -- patch
  npm run release:version -- minor
  npm run release:version -- 0.2.0
  npm run release:version -- prerelease --preid beta
  npm run release:version -- from-git
`);
    process.exit(0);
  } else if (arg === "--preid") {
    preid = args[++i];
    if (!preid) fail("--preid requires a value");
  } else if (!bumpArg) {
    bumpArg = arg;
  } else {
    fail(`Unknown argument: ${arg}`);
  }
}

if (!bumpArg) {
  log(`
Usage: npm run release:version -- <newversion | bump-type> [--preid <id>]
       Run with --help for details.
`);
  process.exit(1);
}

// ── Resolve target version ───────────────────────────────────────────────────

const corePkgPath = join(root, "packages", "core", "package.json");
const currentVersion = readJson(corePkgPath).version;

let version;

if (bumpArg === "from-git") {
  version = resolveVersionFromGit();
  log(`Resolved from git tag: v${version}`);
} else if (isBumpType(bumpArg)) {
  version = bumpVersion(currentVersion, bumpArg, preid);
} else if (isValidSemver(bumpArg)) {
  version = bumpArg;
} else {
  fail(`Invalid argument: "${bumpArg}". Expected a bump type (${BUMP_TYPES.join(", ")}) or a semver version.`);
}

// ── Banner ───────────────────────────────────────────────────────────────────

log("=========================================");
log(`  Deep Code — Bump Version`);
log(`  ${currentVersion} → ${version}`);
log("=========================================\n");

// ── Find root and workspace package.json files ───────────────────────────────

const rootPkgPath = join(root, "package.json");
const pkgPaths = globSync("packages/*/package.json", { cwd: root, absolute: true });

if (pkgPaths.length === 0) {
  fail("No workspace packages found under packages/");
}

const packageEntries = [
  { path: "", pkgPath: rootPkgPath },
  ...pkgPaths.map((pkgPath) => ({
    path: dirname(pkgPath).replace(root + "/", ""),
    pkgPath,
  })),
];

// ── Update versions ──────────────────────────────────────────────────────────

log("Updating package.json files:\n");

for (const { path, pkgPath } of packageEntries) {
  const pkg = readJson(pkgPath);
  const oldVersion = pkg.version;
  pkg.version = version;
  writeJson(pkgPath, pkg);
  const short = path || "package.json";
  log(`  ${short}: ${oldVersion} → ${version}`);
}

// ── Update lockfile ──────────────────────────────────────────────────────────

log("\nUpdating package-lock.json package versions...\n");
updateLockfileVersions(
  packageEntries.map(({ path }) => ({
    path,
    version,
  }))
);
ok("package-lock.json package versions updated");

// ── Done ─────────────────────────────────────────────────────────────────────

console.log("\n=========================================");
log(`  🎉  Version bumped to v${version}`);
console.log("=========================================");
console.log(`
  Updated ${packageEntries.length} package.json files. Next steps:
    git add -A && git commit -m "chore(release): v${version}"
    git tag v${version}
    git push && git push --tags
`);
