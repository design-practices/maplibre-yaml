# Self-hosted glyphs

MapLibre signed-distance-field glyph ranges, served at
`https://docs.maplibre-yaml.org/fonts/{fontstack}/{range}.pbf`.

| Fontstack | Font | Licence |
|---|---|---|
| `Libre Baskerville Italic` | [Libre Baskerville](https://github.com/impallari/Libre-Baskerville) Italic, from google/fonts | SIL Open Font License 1.1, see `Libre Baskerville Italic/OFL.txt` |

Used by the crosshatch classic's labels; Tangram's crosshatch set its labels
in Baskerville italic. Regenerate with `sh scripts/build-glyphs.sh`, which
pins the font to a google/fonts commit, checks its sha256, and runs fontnik.
