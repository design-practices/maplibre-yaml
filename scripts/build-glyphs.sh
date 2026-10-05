#!/usr/bin/env sh
# Build the self-hosted glyph PBFs the docs site serves under /fonts/.
#
# MapLibre renders text from pre-built signed-distance-field glyph ranges
# (`glyphs: .../{fontstack}/{range}.pbf`), not from font files. The crosshatch
# classic labels in a serif italic (Tangram's crosshatch used Baskerville
# italic), so the docs host one OFL-licensed fontstack of their own:
#
#   docs/public/fonts/Libre Baskerville Italic/{0-255,...,65280-65535}.pbf
#   docs/public/fonts/Libre Baskerville Italic/OFL.txt
#
# Reproducible: the font is pinned to a google/fonts commit and checked by
# sha256, and the generator is fontnik pinned exact (it ships prebuilt
# binaries; nothing compiles). All 256 ranges are written — empty ones are a
# few bytes — so no label character ever 404s a range request.
#
#   sh scripts/build-glyphs.sh
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
FONTSTACK="Libre Baskerville Italic"
OUT="$ROOT/docs/public/fonts/$FONTSTACK"
GF_COMMIT=9e63336c5ec724faa1e1e394745b33dcbb58a9c9
GF_BASE="https://raw.githubusercontent.com/google/fonts/$GF_COMMIT/ofl/librebaskerville"
FONT_SHA256=223959683dc73ec4437bd61fabaa4b3f22209e22855ffd3aee36ba61a5116e97
FONTNIK=fontnik@0.7.7

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

curl -fsSL -o "$WORK/font.ttf" "$GF_BASE/LibreBaskerville-Italic%5Bwght%5D.ttf"
curl -fsSL -o "$WORK/OFL.txt" "$GF_BASE/OFL.txt"
echo "$FONT_SHA256  $WORK/font.ttf" | sha256sum -c -

rm -rf "$OUT"
mkdir -p "$OUT"
npx -y -p "$FONTNIK" build-glyphs "$WORK/font.ttf" "$OUT"
cp "$WORK/OFL.txt" "$OUT/OFL.txt"
echo "built $(ls "$OUT" | grep -c '\.pbf$') glyph ranges → $OUT"
