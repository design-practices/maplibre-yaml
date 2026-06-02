#!/usr/bin/env bash
# Pre-publish dry-run gate (per issue #28).
#
# Runs `pnpm pack` (which rewrites workspace: protocol the same way
# `pnpm publish` does) and inspects the resulting tarball's manifest
# for any unresolved workspace: references. If any are found, exits
# non-zero -- the publish should NOT proceed.
#
# This catches the class of bug that shipped in 0.2.0 (where the
# published manifest had workspace:^ in peerDependencies, making
# `npm install` fail with EUNSUPPORTEDPROTOCOL).
#
# Usage:
#   ./scripts/check-publish.sh <package-dir>
#   ./scripts/check-publish.sh packages/core

set -euo pipefail

PKG_DIR="${1:-}"
if [ -z "$PKG_DIR" ]; then
  echo "usage: $0 <package-dir>   e.g.  $0 packages/core" >&2
  exit 2
fi

cd "$PKG_DIR"

echo "==> Packing $PKG_DIR (this rewrites workspace: like publish does)..."
TARBALL=$(pnpm pack 2>/dev/null | tail -1)
trap "rm -f '$TARBALL'" EXIT

echo "==> Inspecting tarball manifest for unresolved workspace: refs..."
MANIFEST=$(tar -xzOf "$TARBALL" package/package.json)

if echo "$MANIFEST" | grep -q '"workspace:'; then
  echo
  echo "❌ FAIL: published manifest still contains workspace: protocol references." >&2
  echo
  echo "Offending lines:" >&2
  echo "$MANIFEST" | grep -n '"workspace:' >&2
  echo
  echo "Fix: ensure the workspace dep is published at the resolved version, OR" >&2
  echo "use 'workspace:^' / 'workspace:*' in source but verify pnpm pack rewrites it." >&2
  echo "If you used 'npm publish' instead of 'pnpm publish', re-run with pnpm." >&2
  exit 1
fi

echo
echo "✓ OK: manifest is clean. Safe to publish."
echo
echo "Tarball contents (top 20 files by size):"
tar -tzvf "$TARBALL" | sort -k3 -nr | head -20
