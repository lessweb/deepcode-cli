# Release

Deep Code uses two scripts to manage version releases in the monorepo:

| Script | Command | Purpose |
|--------|---------|---------|
| `scripts/version.js` | `npm run release:version` | Bump all workspace package versions + regenerate lockfile |
| `scripts/prepare-package.js` | `npm run prepare:package` | Build + quality checks + publish to npm + git commit & tag |

Use them together: bump version first, then publish.

---

## release:version — Version Bump

Works like `npm version`, supporting all standard bump types.

### Basic Usage

```bash
npm run release:version -- <bump-type | version> [options]
```

> Note: npm scripts require the `--` separator to pass arguments.

### Supported Bump Types

| Type | Current | Result | Description |
|------|---------|--------|-------------|
| `patch` | `0.1.31` | `0.1.32` | Patch version +1 |
| `minor` | `0.1.31` | `0.2.0` | Minor version +1, patch reset |
| `major` | `0.1.31` | `1.0.0` | Major version +1, minor/patch reset |
| `prepatch` | `0.1.31` | `0.1.32-0` | Pre-release patch |
| `preminor` | `0.1.31` | `0.2.0-0` | Pre-release minor |
| `premajor` | `0.1.31` | `1.0.0-0` | Pre-release major |
| `prerelease` | `0.1.31` | `0.1.32-0` | Increment pre-release number |
| `from-git` | — | Read from latest git tag | For cases where tag exists but package.json not updated |

You can also specify an exact version:

```bash
npm run release:version -- 0.2.0
```

### Pre-release Chain

`prerelease` supports chained increments:

```
0.1.31
  → prerelease → 0.1.32-beta.0
  → prerelease → 0.1.32-beta.1
  → prerelease → 0.1.32-beta.2
  → patch      → 0.1.32        (drops prerelease suffix)
```

### --preid Option

Pre-release identifier, defaults to `"0"`, customizable:

```bash
npm run release:version -- prerelease --preid beta
# 0.1.31 → 0.1.32-beta.0

npm run release:version -- premajor --preid alpha
# 0.1.31 → 1.0.0-alpha.0
```

### What It Does

1. Reads current version from `packages/core/package.json`
2. Calculates target version based on bump type
3. Updates `version` field in **all** `packages/*/package.json` (core, cli, vscode-ide-companion)
4. Deletes old `package-lock.json` and regenerates via `npm install --package-lock-only`

### Examples

```bash
# Bump patch
npm run release:version -- patch

# Bump minor
npm run release:version -- minor

# Beta pre-release
npm run release:version -- prerelease --preid beta

# Exact version
npm run release:version -- 0.2.0

# From git tag
npm run release:version -- from-git
```

After bumping, review changes and commit:

```bash
git diff
git add -A
git commit -m "chore(release): v0.1.32"
git tag v0.1.32
```

---

## prepare:package — Build and Publish to npm

Runs quality checks, builds, publishes both npm packages, and automatically creates a git commit with tag.

### Basic Usage

```bash
npm run prepare:package -- <version> [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `<version>` | **Required**. Semver version to publish |
| `--tag <dist-tag>` | npm dist-tag, default `"latest"`, commonly `beta` or `next` |
| `--dry-run` | Preview mode, no actual writes |
| `--force` | Skip main branch check, allow publishing from other branches |

### Execution Flow (9 Steps)

| Step | Action | Description |
|------|--------|-------------|
| 1 | Git check | Working tree must be clean, must be on main branch (`--force` skips branch check) |
| 2 | npm auth | Checks `npm whoami`, aborts if not logged in |
| 3 | Update versions | Updates `packages/core` and `packages/cli` version fields |
| 4 | Quality checks | `npm run check` (typecheck + eslint + prettier) |
| 5 | Tests | `npm run test --workspaces` |
| 6 | Build | `npm run build` (core tsc + cli esbuild bundle) |
| 7 | Publish core | `npm publish --workspace=@vegamo/deepcode-core --access public` |
| 8 | Publish cli | Temporarily changes cli's `@vegamo/deepcode-core` dep from `file:../core` to `^<version>`, restores after publish |
| 9 | Git commit & tag | `chore(release): v<version>` + `git tag v<version>` |

### Examples

```bash
# Publish stable release
npm run prepare:package -- 0.1.32

# Publish beta
npm run prepare:package -- 0.1.32-beta.1 --tag beta

# Dry run (no actual publish)
npm run prepare:package -- 0.1.32 --dry-run

# Publish from non-main branch
npm run prepare:package -- 0.1.32 --force
```

### About the file:../core Dependency

The CLI package uses `"file:../core"` for the `@vegamo/deepcode-core` dependency during development (monorepo local link). When publishing to npm, the script automatically replaces it with `"^<version>"` and restores it after publishing. This is transparent — no manual handling required.

### After Publishing

The script prompts you to push to remote:

```bash
git push && git push --tags
```

Verify the release:

```bash
npm view @vegamo/deepcode-cli version
npx @vegamo/deepcode-cli --version
```

---

## Typical Release Flow

A complete version release follows these steps:

```bash
# 1. Ensure clean working tree
git status

# 2. Bump version
npm run release:version -- patch

# 3. Review changes
git diff

# 4. Commit version change
git add -A
git commit -m "chore(release): v0.1.32"

# 5. Build + quality check + publish
npm run prepare:package -- 0.1.32

# 6. Push to remote
git push && git push --tags
```

Or simplified to two steps (`prepare:package` auto-commits and tags):

```bash
npm run release:version -- patch
npm run prepare:package -- 0.1.32
git push && git push --tags
```

---

## Pre-release Flow

```bash
# First beta
npm run release:version -- prerelease --preid beta
# → 0.1.32-beta.0

git add -A && git commit -m "chore(release): v0.1.32-beta.0"
npm run prepare:package -- 0.1.32-beta.0 --tag beta

# Subsequent betas
npm run release:version -- prerelease --preid beta
# → 0.1.32-beta.1

git add -A && git commit -m "chore(release): v0.1.32-beta.1"
npm run prepare:package -- 0.1.32-beta.1 --tag beta

# Stable release
npm run release:version -- patch
# → 0.1.32

git add -A && git commit -m "chore(release): v0.1.32"
npm run prepare:package -- 0.1.32
git push && git push --tags
```
