---
"@maplibre-yaml/cli": patch
---

`mlym validate` prints notes that explain how a valid value is read — a basemap written as just a `.pmtiles` file is the Protomaps basemap with its defaults, and the note shows the `{ pmtiles: …, flavor: …, lang: … }` form for choosing a flavor or language. Notes are information, not warnings: shown as `ℹ note`, not counted in the warnings summary (the file still reads `✓ valid`), `severity: "note"` with a `noteCount` in `--format json`, and SARIF level `note`; `--strict` and the CI default never turn them into errors, since nothing is wrong.
