#!/usr/bin/env bash
# CI assertion: fail if any built HTML still contains internal .md hrefs.
# Run after `pnpm docs:build`.
set -euo pipefail

DIST="${1:-views/dist}"

if [ ! -d "$DIST" ]; then
  echo "ERROR: dist directory '$DIST' not found. Run pnpm docs:build first." >&2
  exit 1
fi

# Match href="<relative>.md..." but exclude external URLs (http/https)
HITS=$(grep -rn 'href="[^"]*\.md[x]\?[^"]*"' "$DIST" | grep -v 'https\?://' || true)

if [ -n "$HITS" ]; then
  echo "ERROR: Found internal .md links in built HTML (these will 404):" >&2
  echo "$HITS" >&2
  echo "" >&2
  echo "The remarkRewriteMdLinks plugin in views/astro.config.mjs should" >&2
  echo "have rewritten these. Possible causes:" >&2
  echo "  - Stale data-store cache: rm -rf views/node_modules/.astro" >&2
  echo "  - Link is in raw HTML (not markdown [text](url) syntax)" >&2
  exit 1
fi

echo "OK: No internal .md links found in built HTML."
