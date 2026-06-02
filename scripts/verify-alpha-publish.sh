#!/usr/bin/env bash
# Verify a freshly published alpha release works in a real consumer
# environment. Run AFTER `pnpm publish --tag alpha` and BEFORE
# `pnpm changeset pre exit` + stable publish.
#
# Checks:
#   1. npm install @maplibre-yaml/core@alpha resolves cleanly (no
#      EUNSUPPORTEDPROTOCOL or peer-dep errors)
#   2. The new top-level register.js is reachable via unpkg with CORS
#   3. The data-vs-url schema validation rejects path strings
#   4. The schema still accepts inline FCs + remote URLs
#
# Exits 0 if all checks pass, non-zero with a clear message otherwise.
#
# Usage:
#   ./scripts/verify-alpha-publish.sh
#   ./scripts/verify-alpha-publish.sh @maplibre-yaml/core   # default
#   ./scripts/verify-alpha-publish.sh @maplibre-yaml/astro  # if testing astro alpha

set -euo pipefail

PKG="${1:-@maplibre-yaml/core}"
echo "==> Verifying $PKG@alpha"

# Fetch the alpha version string from the registry
ALPHA_VERSION=$(npm view "${PKG}@alpha" version 2>/dev/null || true)
if [ -z "$ALPHA_VERSION" ]; then
  echo "❌ FAIL: no alpha-tagged version found on npm for $PKG" >&2
  echo "   Did you run 'pnpm publish --tag alpha --access public'?" >&2
  exit 1
fi
echo "    alpha tag points to: $ALPHA_VERSION"

# Fresh scratch directory for the install test
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT
cd "$TMPDIR"

echo
echo "==> Step 1/4: scratch-install $PKG@alpha"
npm init -y >/dev/null
if ! npm install "${PKG}@alpha" 2>&1 | tail -5; then
  echo "❌ FAIL: npm install rejected. Inspect the error above." >&2
  exit 1
fi
echo "    ✓ installed cleanly"

# Step 2: unpkg /register reachable with CORS (core only)
if [ "$PKG" = "@maplibre-yaml/core" ]; then
  echo
  echo "==> Step 2/4: GET https://unpkg.com/$PKG@$ALPHA_VERSION/register"
  HEADERS=$(curl -sI -L "https://unpkg.com/${PKG}@${ALPHA_VERSION}/register" 2>&1)
  STATUS=$(echo "$HEADERS" | head -1 | grep -oE "[0-9]{3}" | head -1)
  ACAO=$(echo "$HEADERS" | grep -i "access-control-allow-origin" | head -1 || true)
  echo "    status: $STATUS"
  echo "    $ACAO"
  if [ "$STATUS" != "200" ]; then
    echo "❌ FAIL: expected 200, got $STATUS. The top-level register.js shim isn't being served." >&2
    exit 1
  fi
  if [ -z "$ACAO" ]; then
    echo "❌ FAIL: no Access-Control-Allow-Origin header. CDN consumers will hit CORS errors." >&2
    exit 1
  fi
  echo "    ✓ unpkg serves /register with CORS"
else
  echo
  echo "==> Step 2/4: skipped (not core)"
fi

# Step 3 + 4: schema behavior (core only)
if [ "$PKG" = "@maplibre-yaml/core" ]; then
  echo
  echo "==> Step 3/4: schema rejects path-like strings in source.data"
  REJECT_OUTPUT=$(node --input-type=module -e "
    import { GeoJSONSourceSchema } from '${PKG}/schemas';
    const r = GeoJSONSourceSchema.safeParse({
      type: 'geojson',
      data: './src/data/foo.geojson',
    });
    if (r.success) {
      console.log('UNEXPECTED_ACCEPT');
      process.exit(1);
    }
    const issue = r.error.errors.find(e => e.path[0] === 'data');
    if (!issue) { console.log('NO_DATA_PATH_ISSUE'); process.exit(1); }
    console.log('REJECTED:', issue.message.slice(0, 60));
  " 2>&1)
  if echo "$REJECT_OUTPUT" | grep -q "UNEXPECTED_ACCEPT\|NO_DATA_PATH_ISSUE"; then
    echo "❌ FAIL: schema did not reject ./src/data/foo.geojson correctly" >&2
    echo "$REJECT_OUTPUT" >&2
    exit 1
  fi
  echo "    $REJECT_OUTPUT"
  echo "    ✓ path-string in data rejected with data-path-attributed issue"

  echo
  echo "==> Step 4/4: schema accepts legitimate shapes (inline FC + url:)"
  ACCEPT_OUTPUT=$(node --input-type=module -e "
    import { GeoJSONSourceSchema } from '${PKG}/schemas';
    const inline = GeoJSONSourceSchema.safeParse({
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    const urlForm = GeoJSONSourceSchema.safeParse({
      type: 'geojson',
      url: 'https://example.com/data.geojson',
    });
    if (!inline.success) { console.log('REJECTED_INLINE_FC:', inline.error.message); process.exit(1); }
    if (!urlForm.success) { console.log('REJECTED_URL:', urlForm.error.message); process.exit(1); }
    console.log('ACCEPTED_BOTH');
  " 2>&1)
  if ! echo "$ACCEPT_OUTPUT" | grep -q "ACCEPTED_BOTH"; then
    echo "❌ FAIL: schema rejected a legitimate shape" >&2
    echo "$ACCEPT_OUTPUT" >&2
    exit 1
  fi
  echo "    ✓ inline FC and url: both accepted"
else
  echo
  echo "==> Steps 3/4 + 4/4: skipped (not core)"
fi

echo
echo "========================================"
echo "✓ All checks passed for $PKG@$ALPHA_VERSION"
echo "========================================"
echo
echo "Safe to proceed:"
echo "  cd /Users/marioag/Documents/GitHub/maplibre-yaml"
echo "  pnpm changeset pre exit"
echo "  pnpm changeset version          # collapses to stable 0.2.3"
echo "  git add . && git commit -m 'release: @maplibre-yaml/core v0.2.3' && git push"
echo "  ./scripts/check-publish.sh packages/core   # final dry-run gate"
echo "  cd packages/core && pnpm publish --access public"
