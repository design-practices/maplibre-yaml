---
"@maplibre-yaml/cli": patch
---

`mlym init` (basic and story templates) no longer says any static web server works: it says another server works if it supports range requests, which `.pmtiles`, `.tif`, `.fgb` and `.parquet` files need, and that `python -m http.server` does not.
