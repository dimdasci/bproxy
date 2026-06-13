#!/usr/bin/env bash
# CI assertion: fail if generated component SVGs are missing from the built site.
# Run after `pnpm docs:build`.
set -euo pipefail

DIST="${1:-views/dist}"
AUTO_DIR="$DIST/views/auto"
EXPECTED=(
  "cli-components.svg"
  "extension-components.svg"
  "service-components.svg"
)

if [[ ! -d "$AUTO_DIR" ]]; then
  echo "ERROR: component SVG directory '$AUTO_DIR' not found." >&2
  echo "Expected docs:build to copy docs/public/views/auto/*.svg into the built site." >&2
  exit 1
fi

missing=()
for file in "${EXPECTED[@]}"; do
  if [[ ! -f "$AUTO_DIR/$file" ]]; then
    missing+=("$file")
  fi
done

if [[ "${#missing[@]}" -gt 0 ]]; then
  echo "ERROR: Missing component SVG(s) in built site:" >&2
  for file in "${missing[@]}"; do
    echo "  - $AUTO_DIR/$file" >&2
  done
  echo "" >&2
  echo "Run pnpm views:regen and ensure docs/public/views/auto/*.svg is committed." >&2
  exit 1
fi

echo "OK: Component SVGs present in built site."
