---
"@maplibre-yaml/cli": minor
"@maplibre-yaml/core": minor
---

Two new CLI commands for large data files. `mlym prepare <file>` takes a GeoParquet, FlatGeobuf, GeoJSON or PMTiles file (a local path or an `http(s)` URL, read by range requests) and reports its features, size, CRS, geometry, sort order, bbox column, row groups and overview levels. It then prints the one command that makes the file draw well, following the Large data guide's size-to-format table, and the YAML source block to paste. It reads only the footer or header (GeoJSON is counted in full up to 200 MB and estimated above that), writes no data and runs nothing. `mlym breaks <file> --field <name>` computes `classify:` breaks from a whole local file with core's classify math, for sources the browser reads by view. Core now exports the producer-command builders its large-file notices use (`sortedParquetCommand`, `indexedFlatGeobufCommand`, `pmtilesCommand`, `commandStem`, `LARGE_DATA_DOCS`), so a map's notices and `mlym prepare` print the same command.
