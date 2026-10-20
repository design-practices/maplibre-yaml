---
"@maplibre-yaml/cli": patch
---

`mlym validate` prints notes that explain how a valid value is read — a basemap written as just a `.pmtiles` file is the Protomaps basemap with its defaults, and the note shows the `{ pmtiles: …, flavor: …, lang: … }` form for choosing a flavor or language. Notes are never turned into errors by `--strict` or the CI default, since nothing is wrong.
