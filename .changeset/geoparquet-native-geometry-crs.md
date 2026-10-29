---
"@maplibre-yaml/core": patch
"@maplibre-yaml/cli": patch
---

A Parquet file whose geometry uses Parquet's native GEOMETRY (or GEOGRAPHY) type and has no `geo` metadata key (GeoParquet 2.x, geoparquet-io's `parquet-geo-only`) now has its CRS checked. A projected file, such as one in a US state plane, is refused with the same notice as GeoParquet with a `geo` key ("is in EPSG:2272; MapLibre needs longitude/latitude… Reproject it: ogr2ogr…"). Before, it loaded with no notice and nothing showed, because its coordinates landed off the map. Every CRS form the Parquet spec allows is read: none (longitude/latitude), inline PROJJSON, `projjson:<key>` pointing to a footer key, `srid:<n>`, and identifiers such as `EPSG:4326` or `OGC:CRS84`. When the code alone doesn't settle it, the column's geospatial statistics do. Such a file is now named by its code (`EPSG:4326`) rather than by its raw PROJJSON text. `mlym prepare` reads the CRS from the same place, so it reports these files' CRS and puts the reprojection command first.
