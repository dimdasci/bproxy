#!/usr/bin/env bash
# scripts/build-release.sh — Assemble the publishable npm package in dist/
#
# Usage: bash scripts/build-release.sh
#
# Requires: pnpm, node (workspace already set up)
# Output:   dist/ directory ready for `npm pack` or `npm publish`

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$REPO_ROOT/dist"

# ─── Step 1: Build workspace packages ────────────────────────────────────

echo "▸ Building @bproxy/cli..."
pnpm --filter @bproxy/cli build

echo "▸ Building @bproxy/service..."
pnpm --filter @bproxy/service build

# ─── Step 2: Create dist directory ───────────────────────────────────────

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# ─── Step 3: Copy CLI binary ────────────────────────────────────────────

if [[ ! -f "$REPO_ROOT/cli/dist/bproxy.mjs" ]]; then
  echo "ERROR: cli/dist/bproxy.mjs not found. Build failed?" >&2
  exit 1
fi
cp "$REPO_ROOT/cli/dist/bproxy.mjs" "$DIST_DIR/bproxy.mjs"

# ─── Step 4: Copy service binary ────────────────────────────────────────

if [[ ! -f "$REPO_ROOT/service/dist/index.mjs" ]]; then
  echo "ERROR: service/dist/index.mjs not found. Build failed?" >&2
  exit 1
fi
cp "$REPO_ROOT/service/dist/index.mjs" "$DIST_DIR/bproxy-service.mjs"

# ─── Step 5: Generate package.json with version from root ────────────────

ROOT_VERSION=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$REPO_ROOT/package.json','utf8')).version)")

if [[ -z "$ROOT_VERSION" ]] || [[ "$ROOT_VERSION" = "undefined" ]]; then
  echo "ERROR: Could not read version from root package.json" >&2
  exit 1
fi

node -e "
const fs = require('fs');
const tmpl = JSON.parse(fs.readFileSync('$REPO_ROOT/scripts/release-package.json', 'utf8'));
tmpl.version = '$ROOT_VERSION';
fs.writeFileSync('$DIST_DIR/package.json', JSON.stringify(tmpl, null, 2) + '\n');
"

# ─── Step 6: Copy user-facing README ────────────────────────────────────

cp "$REPO_ROOT/scripts/release-README.md" "$DIST_DIR/README.md"

# ─── Done ────────────────────────────────────────────────────────────────

echo ""
echo "✓ Release package assembled in dist/"
echo "  Version: $ROOT_VERSION"
echo "  Files:"
ls -la "$DIST_DIR"
echo ""
echo "  Next steps:"
echo "    cd dist && npm pack           # create tarball"
echo "    npm install -g ./*.tgz        # test global install"
echo "    npm publish                   # publish to registry"
