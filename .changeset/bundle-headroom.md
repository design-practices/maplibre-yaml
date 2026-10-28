---
"@maplibre-yaml/core": patch
---

The `<ml-map>` script is about 23 KB gzip smaller (197.8 KB to 174.7 KB), with no change to how maps, stories, classify documents or popups load. The CDN bundle no longer carries the schema descriptions (the npm build and `index.browser.js` keep them), the story stylesheet ships minified, polling and streaming load as a small on-demand `chunks/live.js` only for sources that refresh or stream, and the FlatGeobuf, GeoParquet and COG adapters now ride inside the reader chunks those formats already download, so a cloud page still makes one request per format. `decodeFlatGeobuf` and `decodeGeoParquet` are unchanged for callers.
