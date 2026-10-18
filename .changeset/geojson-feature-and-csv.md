---
"@maplibre-yaml/core": patch
---

A data file that holds a single GeoJSON `Feature` or a bare geometry (what geojson.io, a tutorial or a copied feature often gives you) now loads, read as a one-feature collection, instead of showing "it isn't GeoJSON". JSON that really isn't GeoJSON now says "it is JSON but not GeoJSON (expected "type": "FeatureCollection")", and a CSV file (a `.csv` path, a Google Sheet published as CSV, or a text/csv response) says "CSV files aren't supported — convert it to GeoJSON (e.g. geojson.io or QGIS)" with a link to the docs, instead of "it isn't JSON".
