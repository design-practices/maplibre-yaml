#!/usr/bin/env sh
# The Protomaps basemap fixtures (0.9, ml-cnv.7): a small extract of the
# Protomaps planet build, and the fonts and sprites its style uses, so the
# browser tests of `mapStyle: { pmtiles: … }` run offline.
#
# Unlike scripts/fixtures/cloud-native.py these are real data: the extract is
# derived from OpenStreetMap (© OpenStreetMap contributors, ODbL) by
# Protomaps; the fonts are Noto Sans (SIL OFL); the sprites are Protomaps'
# (github.com/protomaps/basemaps-assets). The files are committed; CI never
# runs this script.
#
# Run from the repo root (needs curl; downloads go-pmtiles into ~/.cache):
#
#     sh scripts/fixtures/protomaps-basemap.sh [YYYYMMDD]
#
# Writes:
#   docs/public/gallery-assets/protomaps/brooklyn.pmtiles   DUMBO and Brooklyn
#       Heights, z12-15 (~0.6 MB). The docs demo, and the e2e fixture at
#       /my-repo/protomaps/ (e2e/server.mjs).
#   examples/verification/base-path/site/protomaps-assets/  fonts (0-255 of
#       the three Noto Sans stacks the style uses) and the light and dark
#       sprites, at the paths Protomaps hosts them under.
set -eu

BUILD="${1:-20261019}"
BIN="$HOME/.cache/go-pmtiles/pmtiles"
VERSION=1.31.2
if [ ! -x "$BIN" ]; then
  mkdir -p "$HOME/.cache/go-pmtiles"
  curl -sL "https://github.com/protomaps/go-pmtiles/releases/download/v$VERSION/go-pmtiles_${VERSION}_Linux_x86_64.tar.gz" |
    tar xz -C "$HOME/.cache/go-pmtiles" pmtiles
fi

mkdir -p docs/public/gallery-assets/protomaps
"$BIN" extract "https://build.protomaps.com/$BUILD.pmtiles" docs/public/gallery-assets/protomaps/brooklyn.pmtiles \
  --bbox=-74.003,40.690,-73.985,40.705 --minzoom=12 --maxzoom=15

ASSETS=examples/verification/base-path/site/protomaps-assets
HOST=https://protomaps.github.io/basemaps-assets
for stack in "Noto Sans Regular" "Noto Sans Medium" "Noto Sans Italic"; do
  mkdir -p "$ASSETS/fonts/$stack"
  curl -sf -o "$ASSETS/fonts/$stack/0-255.pbf" "$HOST/fonts/$(echo "$stack" | sed 's/ /%20/g')/0-255.pbf"
done
mkdir -p "$ASSETS/sprites/v4"
for flavor in light dark; do
  for ext in json png; do
    curl -sf -o "$ASSETS/sprites/v4/$flavor.$ext" "$HOST/sprites/v4/$flavor.$ext"
  done
done
ls -l docs/public/gallery-assets/protomaps "$ASSETS"
