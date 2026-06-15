#!/usr/bin/env bash
# scripts/smoke-release.sh — Verify the assembled release package installs and runs.
#
# Usage: bash scripts/smoke-release.sh
#
# Requires: dist/ assembled by build-release.sh
# Validates: both binaries resolve all imports after a fresh global install.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$REPO_ROOT/dist"

if [[ ! -d "$DIST_DIR" ]]; then
  echo "ERROR: dist/ not found. Run 'bash scripts/build-release.sh' first." >&2
  exit 1
fi

# Create an isolated install prefix (cleaned up on exit)
PREFIX="$(mktemp -d)"
trap 'rm -rf "$PREFIX"' EXIT

echo "▸ Installing release package into isolated prefix..."
npm install --global --prefix "$PREFIX" "$DIST_DIR" 2>&1

export PATH="$PREFIX/bin:$PATH"

echo "▸ Smoke-testing CLI binary (bproxy --help)..."
bproxy --help >/dev/null 2>&1

echo "▸ Smoke-testing service binary (bproxy service status)..."
bproxy service status >/dev/null 2>&1

echo ""
echo "✓ Release smoke test passed — both binaries resolve all imports."
