# Release

Deep Code uses three scripts to manage version releases in the monorepo:

| Script | Command | Purpose |
|--------|---------|---------|
| `scripts/version.js` | `npm run release:version` | Bump all workspace package versions + regenerate lockfile |
| `scripts/prepare-package.js` | `npm run prepare:package` | Build CLI + quality checks + publish to npm + git commit & tag |
| `scripts/prepare-vscode.js` | `npm run prepare:vscode` | Build VSCode extension + quality checks + publish to VS Code Marketplace + git commit & tag |

Release flow: bump version first, then publish CLI and VSCode extension separately.

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

Runs quality checks, builds, publishes the CLI to npm, and automatically creates a git commit with tag.

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

### Execution Flow (8 Steps)

| Step | Action | Description |
|------|--------|-------------|
| 1 | Git check | Working tree must be clean, must be on main branch (`--force` skips branch check) |
| 2 | npm auth | Checks `npm whoami`, aborts if not logged in |
| 3 | Update versions | Updates `packages/core` and `packages/cli` version fields |
| 4 | Quality checks | `npm run check` (typecheck + eslint + prettier) |
| 5 | Tests | `npm run test --workspaces` |
| 6 | Build | `npm run build` (core tsc + esbuild inlines core and all deps into `dist/cli.js`) |
| 7 | Publish CLI | Writes `dist/package.json` with `dependencies: {}`, runs `npm publish` from `dist/` |
| 8 | Git commit & tag | `chore(release): v<version>` + `git tag v<version>` |

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

### About the Core Bundling Strategy

The CLI's `package.json` keeps `"@vegamo/deepcode-core": "file:../core"` for local development (IDE type checking, monorepo workspace resolution). At build time, esbuild uses `packages: "bundle"` to inline all of core's code and its runtime dependencies (`openai`, `ejs`, `zod`, etc.) into a single `dist/cli.js` file. At publish time, the script writes a `dist/package.json` with `dependencies: {}` and publishes from the `dist/` directory, so the published CLI package has zero runtime dependencies. `@vegamo/deepcode-core` is no longer published as a separate npm package.

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

## prepare:vscode — Build and Publish VSCode Extension to Marketplace

Runs quality checks, builds, publishes the VSCode extension to the VS Code Marketplace, and automatically creates a git commit with tag.

### Prerequisites

Requires an Azure DevOps Personal Access Token (PAT) for marketplace authentication:

1. Generate a token at https://dev.azure.com/vegamo/_usersSettings/tokens
2. Set the environment variable `VSCE_PAT=<token>`

### Basic Usage

```bash
VSCE_PAT=<token> npm run prepare:vscode -- <version> [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `<version>` | **Required**. Semver version to publish |
| `--dry-run` | Preview mode, no actual writes |
| `--force` | Skip main branch check, allow publishing from other branches |

### Execution Flow (7 Steps)

| Step | Action | Description |
|------|--------|-------------|
| 1 | Git check | Working tree must be clean, must be on main branch |
| 2 | VSCE_PAT check | Environment variable must be set |
| 3 | Update versions | Updates `packages/core`, `packages/cli`, and `packages/vscode-ide-companion` version fields |
| 4 | Quality checks | `npm run check` (typecheck + eslint + prettier) |
| 5 | Tests | `npm run test --workspaces` |
| 6 | Build | `npm run build:vscode` (core tsc + esbuild bundle extension + copy templates + vsce package) |
| 7 | Publish | `vsce publish <version> --no-dependencies` to VS Code Marketplace |

### Examples

```bash
# Publish stable release
VSCE_PAT=xxx npm run prepare:vscode -- 0.1.32

# Publish pre-release
VSCE_PAT=xxx npm run prepare:vscode -- 0.1.32-beta.1

# Dry run (no actual publish)
npm run prepare:vscode -- 0.1.32 --dry-run
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

# 5. Build + quality check + publish CLI
npm run prepare:package -- 0.1.32

# 6. Publish VSCode extension
VSCE_PAT=xxx npm run prepare:vscode -- 0.1.32

# 7. Push to remote
git push && git push --tags
```

Or simplified to three steps (`prepare:package` and `prepare:vscode` each auto-commit and tag):

```bash
npm run release:version -- patch
npm run prepare:package -- 0.1.32
VSCE_PAT=xxx npm run prepare:vscode -- 0.1.32
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
