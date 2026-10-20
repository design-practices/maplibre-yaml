---
"@maplibre-yaml/core": minor
"@maplibre-yaml/cli": minor
"@maplibre-yaml/astro": minor
---

PMTiles, FlatGeobuf, GeoParquet and Cloud Optimized GeoTIFF (COG) files now work from YAML alone, with no page JavaScript — in plain HTML from the CDN, under Vite and Astro, in `<ml-map>` and `<ml-scrollytelling>`, and in v1 and v2 documents. A full basemap can come from a single `.pmtiles` file too.

**Pointing a source at a file.** Keep `type:` as the MapLibre source type and point `url:` at the file; add `format:` only for a URL without a telling extension.
- `.pmtiles` (or `pmtiles://`) on a `vector`, `raster` or `raster-dem` source
- `.fgb`, `.parquet` or `.geoparquet` on a `geojson` source
- `.tif`/`.tiff` (or `cog://`) on a `raster` or `raster-dem` source

Core registers the `pmtiles://` and `cog://` protocols once on the maplibre-gl module it renders with, before any map is created, and keeps a page's own registration. So a basemap style loaded from a URL can use `pmtiles://` too, and relative URLs inside such a style (the file inside `pmtiles://`, TileJSON, tiles, sprite and glyphs) resolve against the style.json itself.

**Where the files can live.** Any static host with HTTP range requests: GitHub Pages, raw.githubusercontent.com, Netlify, S3, R2, `npx serve`, `astro dev` and `astro preview`. Hosts that answer a small file's range request with 416 (GitHub Pages, jsDelivr, `npx serve`), or that don't let a page on another site read `Content-Range` (GitHub Pages), are handled, and a 416 that remains says the file was found rather than to check its name.

**Protomaps basemap shorthand.** `mapStyle: { pmtiles: data/nyc.pmtiles, flavor: dark, lang: es }` builds the Protomaps basemap style in the page around a Protomaps `.pmtiles` extract — no API key, no tile server. It is also accepted as `basemap:` in v2, as `defaultMapStyle`, and by the Astro map builders' `mapStyle` option.
- A basemap written as just the file, `mapStyle: data/nyc.pmtiles` (or a `pmtiles://` URL), is the same Protomaps basemap with its defaults — the light flavor, labels in the page's language — and validation notes how it is read.
- Flavors: `light`, `dark`, `white`, `grayscale`, `black`, in any case.
- Labels in `lang:`, or else in the page's language. Arabic, Hebrew, Persian and Urdu labels are drawn right to left: maplibre-gl 6.9 and later do it themselves; with an older maplibre-gl, core sets MapLibre's right-to-left text plugin, downloaded from unpkg.com the first time such a label is drawn.
- OpenStreetMap and Protomaps attribution.
- Protomaps' hosted fonts and icons, unless `glyphs:` and `sprite:` name your own copies. When the fonts or icons can't load, the map's notice names the host (or your path) and the fix.
- The document's layers draw on top; `before:` and story chapters can name the basemap's layers by id.

**FlatGeobuf and GeoParquet** are read into an ordinary GeoJSON source, so popups, legends, `classify:`, `fitTo` and clustering work unchanged.
- `load: viewport` reads only the features in view from a large file — one with a FlatGeobuf spatial index, or a GeoParquet `bbox` covering column and location-sorted row groups.
- Size guards keep a too-big file from freezing the tab, also when the server doesn't say how big the file is.
- GeoParquet reads only the columns the document uses — its layers, popups, labels (`{Site Name}` tokens included), filters, `classify:` and a story's chapter actions; `columns:` chooses them, `columns: all` reads every one. It opens a file with a single request, and reads WKB geometry from snappy, zstd, gzip, lz4 or brotli files.
- A misspelt `classify:` field on a GeoParquet source still gets the did-you-mean and the file's column names, and a column that `columns:` leaves out is named as such.

**COG.**
- On a `raster` source a COG draws as imagery; on a `raster-dem` source it is elevation for `hillshade` layers and 3D `terrain:`.
- A single band of values (a vegetation index, a temperature) is coloured with `colorRamp: { palette, min, max }`, using the `classify:` palette names or your own `colors:`; `classes:` draws flat classes, along your `colors:` too.
- `fitTo` frames a COG's own extent, already on the first frame: `<ml-map>` reads the file's header while the page starts, within the same `fitTo` wait as a GeoJSON file (`MLMap.fitToWaitMs`, 1.5 seconds), and the reader reuses that read.
- COGs must be in Web Mercator (EPSG:3857): a file in another projection is refused with the `gdalwarp` command that converts it, also when its header lies at the end of the file. A GeoTIFF that isn't cloud-optimized still draws, with an author hint giving the `gdal_translate -of COG` command.
- COGs need maplibre-gl 4.5 or later.

**GitHub Pages project sites.** `base` now applies to the file inside a `pmtiles://` or `cog://` URL and to the basemap shorthand's `pmtiles:`, `glyphs:` and `sprite:`, so relative paths work there.

**When a file fails**, the map's notice says why in plain words, and the rest of the map still draws:
- a server without range requests (`python -m http.server`), or CORS;
- a wrong path that returned a web page, or a missing file;
- a GeoParquet or FlatGeobuf file whose name doesn't say what it is (a `.pq` file), with the fix: rename it or add `format:`;
- a file in the wrong projection;
- a Zstandard-compressed FlatGeobuf;
- GeoArrow-encoded GeoParquet geometry (with the command that rewrites it as WKB), or a Parquet file without geometry metadata;
- a PMTiles file that isn't a Protomaps basemap, or a basemap's reader that couldn't be downloaded (the map still loads);
- a file too large to read whole;
- a Content Security Policy that refuses the COG reader's `blob:` workers (the notice names `worker-src 'self' blob:`).

**Validation** reports each of these with the fix: `type: pmtiles` / `flatgeobuf` / `geoparquet` / `cog` / `mbtiles`; a format on the wrong source type; live data (`refresh:` / `stream:`) on a FlatGeobuf or GeoParquet source; `format: parquet` (did you mean `geoparquet`); a misspelt basemap flavor, key, language or palette; a basemap `pmtiles:` that isn't a `.pmtiles` file; a GeoParquet `columns:` list that leaves out a property the map uses (a popup, label, filter, `classify:` or chapter action), naming each one; a qualitative palette (`okabe-ito`, `Set1` …) used as a smooth `colorRamp:`, a `colorRamp:` whose `max` isn't above `min` (with `reverse: true` for high-to-low colours), and a COG `tileSize` the reader doesn't draw; and, in a v2 document, a maplibre-yaml source key (`colorRamp:`, `format:`, `load:`, `columns:`) written outside the source's `runtime:`.

**`mlym emit`**
- writes PMTiles sources as `pmtiles://` URLs, a Protomaps basemap as the full style it generates, and COG sources as `cog://` URLs (with `#dem`, the `colorRamp:` as `#color:`, and `tileSize: 256`); the exported style then needs those protocols registered;
- converts FlatGeobuf and GeoParquet files to inline GeoJSON, and classify breaks computed at export read both.

**Size.** The readers are bundled inside core, so there is nothing extra to install, but they are not part of core's main script: a page downloads a reader only when a map uses its format (see the entry on on-demand format readers). Cloud-native support adds about 23 KB gzip to `register.browser.js`. Across the whole 0.9 release (including thematic maps, translatable UI strings and number formatting), `register.browser.js` grows from about 125 KB to about 174 KB gzip (+49 KB) since 0.8.1.
