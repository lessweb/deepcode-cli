#!/usr/bin/env bash
# Stage the sidecar resources for a local Xcode dev build.
# Idempotent: clears the sidecar dir then copies fresh artifacts.
#
# Output:
#   apps/macos-menubar/DeepCode/Resources/sidecar/
#     ├── cli.cjs
#     ├── node_modules/   (prod-only)
#     ├── docs/tools/
#     └── node            (uses local `which node`; CI uses universal binary)

set -euo pipefail

cd "$(dirname "$0")/../../.."  # repo root
ROOT="$(pwd)"
SIDECAR="$ROOT/apps/macos-menubar/DeepCode/Resources/sidecar"

echo "[stage-sidecar] Building CLI…"
npm run build

echo "[stage-sidecar] Resetting $SIDECAR"
# Wipe the contents but keep the directory + .gitkeep so the path stays
# committed and ready for Xcode to find at build time.
if [ -d "$SIDECAR" ]; then
  find "$SIDECAR" -mindepth 1 -not -name '.gitkeep' -delete
fi
mkdir -p "$SIDECAR"
touch "$SIDECAR/.gitkeep"

cp "$ROOT/dist/cli.cjs" "$SIDECAR/cli.cjs"

echo "[stage-sidecar] Installing prod-only node_modules…"
WORK="$(mktemp -d)"
NPM_CACHE="$(mktemp -d)"
trap 'rm -rf "$WORK" "$NPM_CACHE"' EXIT
cp "$ROOT/package.json" "$ROOT/package-lock.json" "$WORK/"
( cd "$WORK" && npm ci --omit=dev --ignore-scripts --cache "$NPM_CACHE" )
cp -R "$WORK/node_modules" "$SIDECAR/node_modules"

mkdir -p "$SIDECAR/docs/tools"
cp -R "$ROOT/docs/tools/." "$SIDECAR/docs/tools/"

LOCAL_NODE="$(which node || true)"
if [[ -z "$LOCAL_NODE" ]]; then
  echo "[stage-sidecar] WARN: no system node found; bundle will be missing the runtime binary."
else
  cp "$LOCAL_NODE" "$SIDECAR/node"
  chmod +x "$SIDECAR/node"
fi

echo "[stage-sidecar] Done."
