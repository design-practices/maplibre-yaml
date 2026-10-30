# @maplibre-yaml/cli

## 0.7.1

### Patch Changes

- 37da0a7: A Parquet file whose geometry uses Parquet's native GEOMETRY (or GEOGRAPHY) type and has no `geo` metadata key (GeoParquet 2.x, geoparquet-io's `parquet-geo-only`) now has its CRS checked. A projected file, such as one in a US state plane, is refused with the same notice as GeoParquet with a `geo` key ("is in EPSG:2272; MapLibre needs longitude/latitude… Reproject it: ogr2ogr…"). Before, it loaded with no notice and nothing showed, because its coordinates landed off the map. Every CRS form the Parquet spec allows is read: none (longitude/latitude), inline PROJJSON, `projjson:<key>` pointing to a footer key, `srid:<n>`, and identifiers such as `EPSG:4326` or `OGC:CRS84`. When the code alone doesn't settle it, the column's geospatial statistics do. Such a file is now named by its code (`EPSG:4326`) rather than by its raw PROJJSON text. `mlym prepare` reads the CRS from the same place, so it reports these files' CRS and puts the reprojection command first.
- 2c1477f: An integer too large for a JavaScript number to keep exactly now warns where it is written. Past 2^53 a number no longer holds every integer, so a feature id written `12345678901234567890` was read, silently, as `12345678901234567000`, and two ids that differ only in their last digits could become one. The warning names the digits as written and as read and says to write the id as a string, at the key's line and column (at the element, inside a list). In TOML every parse warns, so `<ml-map>`, `mlym validate` and the playground all show it. In YAML and JSON, `mlym validate` warns (in every output format) and the browser does not: the check is the new core export `bigIntegerWarnings(text)`, which tooling calls and the elements don't, so the CDN build doesn't carry it. Integers a number keeps exactly, including 2^53 itself, give no warning. It is a note, not a problem warning: `mlym validate --strict` (on by default in CI) still passes a document that has one, so no build that passed before this patch fails because of it.
- Updated dependencies [37da0a7]
- Updated dependencies [2c1477f]
- Updated dependencies [2c1477f]
  - @maplibre-yaml/core@0.10.1

## 0.7.0

### Minor Changes

- a944a09: Two new CLI commands for large data files. `mlym prepare <file>` takes a GeoParquet, FlatGeobuf, GeoJSON or PMTiles file (a local path or an `http(s)` URL, read by range requests) and reports its features, size, CRS, geometry, sort order, bbox column, row groups and overview levels. It then prints the one command that makes the file draw well, following the Large data guide's size-to-format table, and the YAML source block to paste. It reads only the footer or header (GeoJSON is counted in full up to 200 MB and estimated above that), writes no data and runs nothing; each range request gives up after 30 seconds, and a FlatGeobuf whose header records no feature count is routed by its size. `mlym breaks <file> --field <name>` computes `classify:` breaks from a whole local file with core's classify math, for sources the browser reads by view. With `-f json`, both commands report failures in `mlym convert`'s shape, `errors: [{ path, message, code }]`. Core now exports the producer-command builders its large-file notices use (`sortedParquetCommand`, `indexedFlatGeobufCommand`, `pmtilesCommand`, `overviewsCommand` for an overview GeoParquet file, `commandStem`, and `LARGE_DATA_DOCS` with the Large data guide's sections), so a map's notices, `mlym prepare` and the guide print the same command for each route; `prepare` ends with a link to the guide's section for the route it recommends.
- dae438d: Map and story documents can now be written in JSON or TOML as well as YAML, with the same validation and the same line-and-column diagnostics in every format. `<ml-map>` and `<ml-scrollytelling>` read all three from `src` (by extension or content type), inline `<script type="application/toml">` (and the YAML and JSON types), the `config` attribute and property, and `update(text)`. The format comes from the label when there is one and is sniffed otherwise. The TOML reader is a separate chunk downloaded the first time a page meets a TOML document, so YAML and JSON pages download nothing new. Errors name their format ("JSON syntax error", "TOML syntax error"), carry a new `format` field, and TOML syntax errors use the new `toml-syntax` code; TOML gets hints for unquoted colours, `null` (omit the key) and dotted keys. Changed: the `config` attribute and `update(string)` now read text through the same parser as `src`, so they accept YAML and TOML too, and a duplicate key in JSON there is an error instead of the last value winning. New in core: `parseDocumentText(text, options)`, `convertDocument(text, { to })` (converts the authored document between the three formats, keeping key order and inline expressions, and reports comments, expanded anchors and dropped nulls), `normalizeDocumentValue(value)`, `looksLikeDocumentText(text, format)` (whether JSON or TOML text is a map or story document, by the rule `mlym validate` picks a folder's files with), `readDocumentValue(text, options)` (a document's raw value in any of the three formats, unvalidated, with the same guards and error wording), `stripBom(text)` and `UNREADABLE_CODES` (the error codes that mean the text could not be read at all). In every format a root `$schema` key is accepted (and removed before rendering), nested tables under `locale` flatten to dotted keys, and date values become text; the published JSON Schemas accept both. An inline script of an unsupported type is named in the error card instead of "No configuration provided".

  The CLI's `validate`, `preview` and `emit` read all three formats; `mlym validate <folder>` also finds JSON and TOML documents by their content (a broken one still joins the run and fails), skipping other JSON and TOML files, with `--verbose` listing what it skipped and a clear message for a folder with no documents. New: `mlym convert <file> --to yaml|json|toml [--out] [--strict] [-f json]`, whose `-f json` prints the result and its losses as one JSON object. Folder discovery also checks the end of a large JSON file (sorted keys put `type` last), and a file it cannot read joins the run and fails instead of being skipped. Astro's `loadMapConfig`, `loadScrollytellingConfig`, `loadYAML` and `loadFromGlob` pick the format by extension, dev reload watches `.toml`, and content-collection schemas normalize entries first, so TOML collection entries with nested locale tables or dates validate.

### Patch Changes

- ffca12d: `mlym preview` and `mlym validate --watch` no longer crash with an unhandled rejection when stopping the dev server or file watcher fails on Ctrl-C: the error is logged and the command exits 4. In core, `MapRenderer.off(event, callback)` now takes the same typed callback as `on()` instead of any `Function`; passing `off()` the callback you gave `on()` compiles as before.
- Updated dependencies [d341a28]
- Updated dependencies [a944a09]
- Updated dependencies [ffca12d]
- Updated dependencies [dae438d]
- Updated dependencies [daa117d]
- Updated dependencies [0e89a73]
- Updated dependencies [85ee765]
- Updated dependencies [2807025]
- Updated dependencies [7d4b481]
  - @maplibre-yaml/core@0.10.0

## 0.6.2

### Patch Changes

- 51e9505: `init` now prints its follow-up commands as `npx maplibre-yaml@latest …` (for example `npx maplibre-yaml@latest validate map.yaml`), and the `story` template's comment uses the same spelling. Without `@latest`, npx can silently reuse an older CLI it cached on an earlier run, so a reader following the printed steps could validate against an out-of-date schema.
- Updated dependencies [491aafc]
- Updated dependencies [1b941a4]
- Updated dependencies [b80ed39]
- Updated dependencies [b80ed39]
- Updated dependencies [b15c3bf]
- Updated dependencies [b80ed39]
  - @maplibre-yaml/core@0.9.2

## 0.6.1

### Patch Changes

- 0013b82: The `astro` project template from `mlym init -t astro` now asks for Node.js 22.23.4 or later in its `package.json` `engines`, which is what Astro 7.4.2 requires. Before, it asked for 22.22, so a new project could install on a Node version that Astro then refuses to run on. The `@maplibre-yaml/astro` README now gives the same minimum for Astro 7.
- 2b0e0f2: `mlym bake crosshatch` now writes hatch textures pre-filtered for MapLibre, so they no longer shimmer when the map draws them at an angle. MapLibre samples pattern images without mipmaps, so on a pitched map the far ground showed the hatch strokes breaking up and crawling as the map moved. The earth and landuse hatches are now baked at twice Tangram's period, with softened strokes at 85 % contrast, as 512 px, 32-tone palette PNGs (declare them at `pixelRatio: 2`). The preset no longer writes `building-fallback.png`, because the crosshatch style now draws plain lit walls: a pattern on a wall is drawn edge-on and shimmers most. If you want hatched walls in a static style, the new `mlym bake crosshatch-walls` writes `building-hatch.png`, a wall hatch pre-filtered along the stroke.
- 7068c89: `preview.port`, `preview.open` and `preview.debug` in `maplibre-yaml.config.*` now take effect. Before, the built-in defaults (port 3000, open the browser, no debug panel) always won over the settings file, so `mlym preview` ignored those settings. The order is now: a flag you type (`--port 4000`, `--no-open`) wins, then the settings file, then the default. `mlym validate` follows the same order for its settings.
- 50c9ced: When `mlym emit --strict` refuses a document because a construct such as `markers` or `fitTo` needs a fallback, the message now says to export without `--strict`, which applies the fallback and prints a warning. Before, it said to re-run with `--with-fallbacks`, which is already the default and is an error next to `--strict`. The message comes from core's `projectStyle`: in its default `with-fallbacks` mode, called without the fallback step, it now names the step to run first (`lowerMarkers`, `lowerFitTo`).
- e96c3ab: `mlym emit --trust` is deprecated, because it never changed the exported file. Trust decides whether raw `!html` in popups renders and whether `click.emit` host events fire, and both are map behavior that a `style.json` cannot hold, so a trusted and an untrusted export were byte-for-byte the same. The flag is no longer listed in `mlym emit --help`. Passing it still works and exports the same style as before, and it prints a note on stderr saying it has no effect, so your scripts keep running while you remove it. A value other than `trusted` or `untrusted` no longer fails the export. A later release will remove the flag.
- b610f89: The `index.html` that `mlym init` writes for the `basic` and `story` templates no longer says `"@0.8" means the newest 0.8.x release` above a script tag that loads 0.9. The comment now names the same release line as the script URL, and both come from the `@maplibre-yaml/core` version the CLI was built with, so they stay in step with every future release.
- Updated dependencies [586f1de]
- Updated dependencies [dced079]
- Updated dependencies [50c9ced]
- Updated dependencies [82640da]
- Updated dependencies [5ae85d3]
- Updated dependencies [8b89359]
- Updated dependencies [e7e1756]
- Updated dependencies [61aed35]
- Updated dependencies [3a9b718]
- Updated dependencies [8536da4]
- Updated dependencies [7993849]
- Updated dependencies [417ce32]
  - @maplibre-yaml/core@0.9.1

## 0.6.0

### Minor Changes

- dc16ded: Thematic maps from YAML: a layer's new `classify:` block makes a choropleth, graduated symbols or a category map without hand-writing a `step`/`match` expression. Give explicit `breaks:` (MapLibre `step` convention: n breaks make n + 1 classes, and a value equal to a break takes the class above), or `method: quantile | equal | jenks` with `classes:` to compute breaks from a GeoJSON source's data when it loads, or `categories:` for a `match` with an `other:` colour (a `value: colour` map keeps the order you wrote, numeric codes included). Map a rate instead of a count with `normalize:` (and `multiply:`, e.g. `100000` for "per 100,000"): the division is guarded, so a missing, zero or non-numeric divisor counts as no data rather than Infinity, and breaks and legend labels are in the rate's units. Colours come from a named palette (the ColorBrewer set, `viridis`, `cividis`, `okabe-ito`; case-insensitive, with a did-you-mean that prefers the palette a short name starts) or a `colors:` list; `radius:` sizes circles per class. Missing, empty and non-numeric values draw a `noData:` colour (light grey by default) or are hidden, instead of the black MapLibre paints when a `step` input is null or a string; numeric strings from CSV-derived GeoJSON are read as numbers. `hover.highlight` works on classified layers like on any other.

  Computed breaks need the whole dataset, so vector tile sources and FlatGeobuf or GeoParquet sources read by view take explicit `breaks:`. Validation explains why for tiles and for `load: viewport` in any form. A FlatGeobuf or GeoParquet file large enough to switch itself to reading by view draws in its no-data colour, with a notice asking for `breaks:`, rather than classes computed from the features in view. When the loaded data has no usable value for `field:` or `normalize:` (a misspelt or differently capitalized name, or text under numeric classes), the console and, while you develop, the map's author notes name the field, suggest the closest property name and list the data's properties.

  A map or story with a classified layer gets a legend automatically, even without a `legend:` block (`legend: false` turns it off). It lists each class with its real edges, formatted with the shared `formatNumber` (MapLibre `number-format` option names, the page's language by default), and "No data"/"Other" lines that only appear when they occur, translatable as `maplibre-yaml.Classify.NoData`/`.Other` in `locale:`. A legend block with its own `items:` lists them first and the generated classes after them; validation and the author notes point out the combination, since hand-written items usually describe the colours a layer had before it was classified. The Astro `FullPageMap` no longer warns that such a map has no legend entries. `classify:` compiles to plain MapLibre (class `exports`) and records the classes in the layer's `metadata["maplibre-yaml:classify"]`, in v1 and v2 alike; `mlym emit` bakes computed breaks into the style, loading a `url:` source's data at export (a FlatGeobuf or GeoParquet file too, recognized by its extension or the source's `format:`) and failing clearly when it cannot. `<ml-map>` fires `ml-map:layer-classified` with the classes as drawn.

- 87cbabb: PMTiles, FlatGeobuf, GeoParquet and Cloud Optimized GeoTIFF (COG) files now work from YAML alone, with no page JavaScript — in plain HTML from the CDN, under Vite and Astro, in `<ml-map>` and `<ml-scrollytelling>`, and in v1 and v2 documents. A full basemap can come from a single `.pmtiles` file too.

  **Pointing a source at a file.** Keep `type:` as the MapLibre source type and point `url:` at the file; add `format:` only for a URL without a telling extension.
  - `.pmtiles` (or `pmtiles://`) on a `vector`, `raster` or `raster-dem` source
  - `.fgb`, `.parquet` or `.geoparquet` on a `geojson` source
  - `.tif`/`.tiff` (or `cog://`) on a `raster` or `raster-dem` source

  Core registers the `pmtiles://` and `cog://` protocols once on the maplibre-gl module it renders with, before any map is created, and keeps a page's own registration. So a basemap style loaded from a URL can use `pmtiles://` too, and relative URLs inside such a style (the file inside `pmtiles://`, TileJSON, tiles, sprite and glyphs) resolve against the style.json itself.

  **Where the files can live.** Any static host with HTTP range requests: your own site on GitHub Pages, Netlify or the like, raw.githubusercontent.com, fastly.jsdelivr.net, S3, R2, and locally `npx serve`, `astro dev` and `astro preview`. Hosts that answer a request for the end of a small file with 416 (GitHub Pages, raw.githubusercontent.com, fastly.jsdelivr.net, `npx serve`), or that don't let a page on another site read `Content-Range` (GitHub Pages), are handled, and a 416 that remains says the file was found rather than to check its name. cdn.jsdelivr.net sometimes answers range requests from a compressed copy of the file: GeoParquet is then read whole, and PMTiles and FlatGeobuf read by view get a notice that says so (use fastly.jsdelivr.net, or serve the file from your own site).

  **Protomaps basemap shorthand.** `mapStyle: { pmtiles: data/nyc.pmtiles, flavor: dark, lang: es }` builds the Protomaps basemap style in the page around a Protomaps `.pmtiles` extract — no API key, no tile server. It is also accepted as `basemap:` in v2, as `defaultMapStyle`, and by the Astro map builders' `mapStyle` option.
  - A basemap written as just the file, `mapStyle: data/nyc.pmtiles` (or a `pmtiles://` URL), is the same Protomaps basemap with its defaults — the light flavor, labels in the page's language — and validation notes how it is read.
  - Flavors: `light`, `dark`, `white`, `grayscale`, `black`, in any case.
  - Labels in `lang:`, or else in the page's language. Arabic, Hebrew, Persian and Urdu labels are drawn right to left: maplibre-gl 6.9 and later do it themselves; with an older maplibre-gl, core sets MapLibre's right-to-left text plugin, downloaded from unpkg.com the first time such a label is drawn.
  - OpenStreetMap and Protomaps attribution.
  - Protomaps' hosted fonts and icons, unless `glyphs:` and `sprite:` name your own copies. When the fonts, the icons or both can't load, the map's notice says which, names the host (or your path) and the fix; on maplibre-gl 4, whose basemap draws nothing without its fonts, the labels are left out so the rest of the basemap draws.
  - A Protomaps file cut with the older tile schema (before late 2024), which would draw only land and water, gets a notice to cut a new extract.
  - The document's layers draw on top; `before:` and story chapters can name the basemap's layers by id.

  **FlatGeobuf and GeoParquet** are read into an ordinary GeoJSON source, so popups, legends, `classify:`, `fitTo` and clustering work unchanged.
  - `load: viewport` reads only the features in view from a large file — one with a FlatGeobuf spatial index, or a GeoParquet `bbox` covering column and location-sorted row groups.
  - Size guards keep a too-big file from freezing the tab, also when the server doesn't say how big the file is.
  - GeoParquet reads only the columns the document uses — its layers, popups, labels (`{Site Name}` tokens included), filters, `classify:` and a story's chapter actions; `columns:` chooses them, `columns: all` reads every one. It usually opens a file with one request (a host that answers 416 for a small file costs a second), and reads WKB geometry from snappy, zstd, gzip, lz4 or brotli files.
  - A misspelt `classify:` field on a GeoParquet source still gets the did-you-mean and the file's column names, and a column that `columns:` leaves out is named as such.

  **COG.**
  - On a `raster` source a COG draws as imagery; on a `raster-dem` source it is elevation for `hillshade` layers and 3D `terrain:`.
  - A single band of values (a vegetation index, a temperature) is coloured with `colorRamp: { palette, min, max }`, using the `classify:` palette names or your own `colors:`; `classes:` draws flat classes, along your `colors:` too.
  - `fitTo` frames a COG's own extent, already on the first frame: `<ml-map>` reads the file's header while the page starts, within the same `fitTo` wait as a GeoJSON file (`MLMap.fitToWaitMs`, 1.5 seconds), and the reader reuses that read, so a COG's first 64 KB are requested once.
  - COGs must be in Web Mercator (EPSG:3857): a file in another projection is refused with the `gdalwarp` command that converts it, also when its header lies at the end of the file. A GeoTIFF that isn't cloud-optimized still draws, with an author hint giving the `gdal_translate -of COG` command.
  - COGs need maplibre-gl 4.5 or later.

  **GitHub Pages project sites.** `base` now applies to the file inside a `pmtiles://` or `cog://` URL and to the basemap shorthand's `pmtiles:`, `glyphs:` and `sprite:`, so relative paths work there.

  **When a file fails**, the map's notice says why in plain words, and the rest of the map still draws:
  - a server without range requests (`python -m http.server`), or CORS;
  - a wrong path that returned a web page, or a missing file;
  - a GeoParquet or FlatGeobuf file whose name doesn't say what it is (a `.pq` file, read as JSON), with the fix: rename it or add `format:`;
  - a host that compresses the parts of files it sends (cdn.jsdelivr.net);
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

  **Size.** The readers are bundled inside core, so there is nothing extra to install, but they are not part of core's main script: a page downloads a reader only when a map uses its format (see the entry on on-demand format readers). Cloud-native support adds about 24 KB gzip to `register.browser.js`. Across the whole 0.9 release (including thematic maps, translatable UI strings and number formatting), `register.browser.js` grows from about 125 KB to about 175 KB gzip (+50 KB) since 0.8.1.

### Patch Changes

- f5445e1: `mlym init` (basic and story templates) no longer says any static web server works: it says another server works if it supports range requests, which `.pmtiles`, `.tif`, `.fgb` and `.parquet` files need, and that `python -m http.server` does not.
- 51a39ed: `mlym init --template basic` and `--template story` now load core from the CDN at the release line the CLI was built with (for example `https://unpkg.com/@maplibre-yaml/core@0.9/register.js`), instead of a pin written into the template that could fall behind a release. A new project therefore always gets the features the current docs describe.
- 95bbbfc: `mlym validate` prints notes that explain how a valid value is read — a basemap written as just a `.pmtiles` file is the Protomaps basemap with its defaults, and the note shows the `{ pmtiles: …, flavor: …, lang: … }` form for choosing a flavor or language. Notes are information, not warnings: shown as `ℹ note`, not counted in the warnings summary (the file still reads `✓ valid`), `severity: "note"` with a `noteCount` in `--format json`, and SARIF level `note`; `--strict` and the CI default never turn them into errors, since nothing is wrong.
- b8c7715: `mlym emit` (and core's `projectStyle`) now writes a GeoJSON source given by `url:` the way the MapLibre style spec expects it, as `data: <url>`, for named sources and for inline sources on a layer. Before, the source was copied as `{type: geojson, url: …}`, and maplibre-gl rejected the whole emitted style over the unknown `url` property. Because the emitted source now loads its URL, a live `url:` source (`refresh:`, `stream:`) is reported as a `contract` warning (the live updates don't carry over) instead of `lossy`, so `--strict` accepts it.
- 4383762: The CDN build now loads format readers on demand, from files next to `register.js`. The PMTiles, FlatGeobuf, GeoParquet and COG readers and the Protomaps basemap style generator are not inside `dist/register.browser.js` (about 175 KB gzip). They are separate files in `dist/chunks/`, which the browser fetches relative to the script only when a map uses that format: `pmtiles.js` (about 8 KB gzip), `flatgeobuf.js` (about 12 KB), `geoparquet.js` (about 23 KB), `geoparquet-brotli.js` (about 68 KB, only for a brotli-compressed GeoParquet file), `cog.js` (about 132 KB), and `protomaps-basemap.js` (about 7 KB). Four more files hold image codecs for COGs, `cog-deflate.js`, `cog-jpeg.js`, `cog-lerc.js` and `cog-zstd.js` (about 5 to 48 KB each); they load only when an image is decoded outside the COG reader's background workers, so drawing a COG normally fetches none of them. A page without such a map downloads nothing extra, and on a map that uses one, only that format's sources wait for its reader: the rest of the map draws without it. Loading from unpkg or jsDelivr needs no change. If you host maplibre-yaml yourself, copy the whole `dist/` folder rather than a single file: when a reader can't be downloaded (a missing file, offline, a content blocker), the map's notice names the file and says what to do, and every other layer still draws; `reload()`, or the next tile the map asks for, downloads the reader again. The npm build splits the same way (`dist/formats/`, with shared code in `dist/shared/`), so Vite, Astro and webpack apps get the readers as lazy chunks of their own build; Node use (`mlym emit`, server rendering) works as before. `mlym preview` serves the reader files next to the bundle.
- Updated dependencies [009fbf3]
- Updated dependencies [7481a5e]
- Updated dependencies [009fbf3]
- Updated dependencies [bdad6ab]
- Updated dependencies [dc16ded]
- Updated dependencies [87cbabb]
- Updated dependencies [b8c7715]
- Updated dependencies [b345024]
- Updated dependencies [009fbf3]
- Updated dependencies [377e4d7]
- Updated dependencies [c70afac]
- Updated dependencies [10b7101]
- Updated dependencies [3c09355]
- Updated dependencies [4383762]
- Updated dependencies [c70afac]
- Updated dependencies [df0ea66]
- Updated dependencies [c70afac]
- Updated dependencies [009fbf3]
- Updated dependencies [dd2f167]
- Updated dependencies [c70afac]
- Updated dependencies [5f95ed6]
  - @maplibre-yaml/core@0.9.0

## 0.5.0

### Minor Changes

- 80ea176: Installing the CLI no longer reports known vulnerabilities. `npm install @maplibre-yaml/cli` used to print "9 vulnerabilities (8 high), no fix available"; it now reports 0. sharp moves to 0.35.5, which fixes the libvips, libheif and librsvg advisories. Vite moves to 6.4, fixing dev-server advisories and the old esbuild Vite 5 brought. chokidar moves to 4 and file matching from fast-glob to tinyglobby, because the `braces` package they used has an advisory with no fixed release. Commands and options are unchanged.

  **The CLI now needs Node.js 20.9 or later** (22 or 24 LTS recommended). sharp 0.35's security fixes don't run on older Node, and Node 18 reached end of life in 2025. On an older Node the CLI stops at once with "maplibre-yaml needs Node.js 20.9 or newer, but this is Node.js 18.x" and how to update, instead of failing later. The `maplibre-yaml` alias raises its Node minimum with it, so it moves to a minor version and `^0.1` installs on Node 18 keep the old one. This applies to the command line only: `@maplibre-yaml/core` and `@maplibre-yaml/astro` still support Node 18.

- 84c9c1f: `maplibre-yaml preview` now renders scrollytelling stories. `preview story.yaml` (for example on the `init --template story` output) used to stop at "Visual preview currently supports only "type: map" blocks"; it now shows the story with `<ml-scrollytelling>` on the same hot-reloading page, so saving `story.yaml` reloads it and a validation error shows the error overlay, as for maps.

### Patch Changes

- 286a3c3: `init --template astro` now scaffolds a current site: Astro 7 with `@maplibre-yaml/astro`'s `<Map>` component (instead of a hand-wired `<ml-map>`), `@maplibre-yaml/core` 0.8 and `@maplibre-yaml/astro` 0.6, a layout with the viewport meta tag so maps fit on phones, the optional `@maplibre-yaml/astro/integration`, commented `site`/`base` lines for GitHub Pages, a ready-to-use `.github/workflows/deploy.yml`, a `.gitignore`, and `npm run check`. A fresh scaffold installs with no `npm audit` findings (the old one pulled core 0.7 and an Astro 5 with a critical advisory). The core and astro version ranges are now taken from the packages the CLI was released with, so they no longer fall behind.
- 255b285: `maplibre-yaml preview` no longer hides the map's attribution: the status bar at the bottom of the preview page now sits below the map (and below a story's map) instead of over it, so the MapLibre/basemap credits and any bottom controls stay visible on desktop and phones. `preview --help` also describes `--no-open` correctly ("Don't open the browser"); it used to read "Open browser automatically".
- 75364f6: The `preview` status bar now shows the file relative to the folder you ran the command in (`map.yaml` instead of a full absolute path), on one line, truncated with an ellipsis if it is still too long; the full path appears on hover. On a phone-width window the absolute path used to wrap and run into "Connected". The preview also waits for a save to finish before reloading, so a file written in two steps no longer briefly shows a wrong "Unable to determine document type" error.
- 6a2f4d4: `maplibre-yaml validate` now checks every file and pattern you give it. Before, only the first argument was read: `validate a.yaml b.yaml`, an unquoted `validate *.yaml` (which the shell expands into many arguments) and several quoted patterns all reported just the first file and could exit 0 while later files were broken. Each file is now reported, the command exits non-zero if any of them fails, and an argument that matches no file is named ("No files match …") and makes the run exit non-zero instead of being skipped silently.
- 92a236d: `validate`'s terminal output now matches the docs. Files are shown relative to the folder you ran it in (`✓ my-map.yaml`, not the full path); a run with both valid and broken files prints `✓ N file(s) valid` as well as the issues line; a missing top-level key (`config: Expected object, got undefined`) no longer carries a meaningless "at line 1, column 1"; and a plain file name that doesn't exist says `File not found: missing.yaml` (a pattern that matches nothing still says "No files match"). `init` and the story template now spell the commands `npx maplibre-yaml …`, as the docs do, and the story template puts `theme` at the top level of `story.yaml`, where the story reads it (under `config:` it did nothing).
- 92a236d: `validate` reads each argument the way you meant it. A quoted pattern in a folder with a space (`validate "My Maps/*.yaml"`) is one pattern again, not two, so it no longer fails with "No files match"; the older `validate "a.yaml b.yaml"` spelling still works. A folder argument (`validate maps/`) validates every `.yaml`/`.yml` file under it. A file named directly on the command line is skipped, with a note, when your project's `validate.ignorePatterns` excludes it, as files matched by a pattern already were.
- Updated dependencies [10f3435]
- Updated dependencies [41b3bcd]
- Updated dependencies [45fa5e7]
- Updated dependencies [45fa5e7]
- Updated dependencies [e4f8760]
- Updated dependencies [45fa5e7]
- Updated dependencies [79f1211]
- Updated dependencies [187108e]
- Updated dependencies [8dd3cec]
- Updated dependencies [c6daeec]
- Updated dependencies [45fa5e7]
- Updated dependencies [bd78c8b]
- Updated dependencies [d08185d]
- Updated dependencies [9434721]
- Updated dependencies [3cdc4a2]
- Updated dependencies [84cddc7]
- Updated dependencies [220f079]
- Updated dependencies [75649c0]
- Updated dependencies [fc9e64c]
- Updated dependencies [f9f5526]
- Updated dependencies [3ce86ed]
- Updated dependencies [c832382]
- Updated dependencies [e1c5ceb]
- Updated dependencies [75649c0]
- Updated dependencies [26badbc]
- Updated dependencies [8dd3cec]
  - @maplibre-yaml/core@0.8.1

## 0.4.2

### Patch Changes

- b7a8f09: `init --template story` now scaffolds a story map that works as soon as you serve the folder: its page loads `<ml-scrollytelling>` from `@maplibre-yaml/core@0.8` on the CDN (the release that adds it), and the "not part of core 0.7 yet" notes are gone; `init` prints the same serve-and-open steps as for `basic`. Both the `basic` and `story` pages now pin core 0.8 and carry a commented `base="/my-repo/"` hint for publishing on a GitHub Pages project site, and the YAML tip no longer says paths must start with `./` (plain relative paths and `/`-paths both work).
- 6750a12: The npm READMEs are rewritten for 0.8 as short orientations that match the docs site: what the package is, how to install it, one working example per way of using it (copied from the docs and run as printed), the main features, supported versions, and links to the docs pages for everything else. The core README now pins the CDN example to `@maplibre-yaml/core@0.8`, uses the `MapRenderer.fromModel` API the docs teach, covers `<ml-scrollytelling>`, `base`, slots and the on-page error card, and includes maplibre-gl 6's `setWorkerUrl` bundler setup (the effects README and guide gained it too: without it, an effects page built with Vite failed with _Worker failed to load_). The CLI README explains when `npx maplibre-yaml`, `npx @maplibre-yaml/cli` and `mlym` work. Each package's `homepage` now points at its docs page, and the descriptions and keywords say what the package does.
- Updated dependencies [c354c2c]
- Updated dependencies [c354c2c]
- Updated dependencies [c354c2c]
- Updated dependencies [1ce286a]
- Updated dependencies [c354c2c]
- Updated dependencies [c6ad0fc]
- Updated dependencies [81e8809]
- Updated dependencies [6750a12]
- Updated dependencies [c354c2c]
- Updated dependencies [b7a8f09]
- Updated dependencies [8144227]
- Updated dependencies [8144227]
- Updated dependencies [c354c2c]
- Updated dependencies [c354c2c]
  - @maplibre-yaml/core@0.8.0

## 0.4.1

### Patch Changes

- 4fb7da1: `mlym preview` now renders on maplibre-gl 6, served from your own install instead of a CDN. The preview page used to load maplibre-gl 4 from unpkg and esm.sh, so it ran a different MapLibre than the docs recommend and showed a blank page offline. It now loads the maplibre-gl installed with `@maplibre-yaml/core` (and that core's browser bundle), including maplibre-gl 6's worker, so the preview matches the versions you installed and works without network access. If no maplibre-gl 6 is installed, the preview falls back to the maplibre-gl 6 CDN build and logs which one it used. Saving an edit to the YAML file now reloads the page as intended; the reload hook never fired before. Validation errors still appear in the page overlay.
- 6fc625a: `mlym init` now scaffolds projects that work as soon as they are served. The `basic` template's page loads maplibre-gl 6 through an import map (before, it stayed blank with "Failed to resolve module specifier maplibre-gl"), pins `@maplibre-yaml/core@0.7`, has a viewport meta tag and an explicit map height, and its `map.yaml` uses a free street basemap with labels. The `story` and `astro` templates get the same fixes; the `astro` template now depends on `@maplibre-yaml/core` 0.7, maplibre-gl 6 and Astro 5, and sets up the maplibre-gl 6 worker in a bundled script. `init` defaults to the `basic` template, adds `--list`, and exits with code 1, creating nothing, on an unknown template or option such as `--dir` (it used to print the template list and exit 0). The printed next steps now say how to serve the folder and use `npx @maplibre-yaml/cli` instead of a bare `maplibre-yaml` command that only exists after an install. `mlym emit --out dist/` (or an existing folder) now writes `style.json` inside that folder instead of a file named `dist`.
- Updated dependencies [a6ced0f]
- Updated dependencies [a6ced0f]
- Updated dependencies [70967e7]
- Updated dependencies [a6ced0f]
  - @maplibre-yaml/core@0.7.1

## 0.4.0

### Minor Changes

- 83016bc: New `mlym bake <preset> --out <dir>` command. It reproducibly regenerates the pattern images for the Mapzen-classic static presets: `crosshatch` derives its ink-on-paper ground, landuse, pre-lit water and building hatch from Tangram's MIT-licensed source textures, which now ship in the package with their provenance; `blueprint` generates a drafting grid. Run `mlym bake` with no preset to list the available presets.
- ac9c677: The sprite/asset pipeline — shared infrastructure for every construct
  that exports via generated raster assets (marker pins, pattern presets, effect
  fallbacks). Core describes: deterministic SVG asset descriptors with
  content-hashed names (`fx-hatch-45-8-a1b2c3d4`), a name-sorted sprite-index
  layout (duplicate names dedupe when identical, throw when they'd alias
  different images), seamless hatch tiles (requested angle/spacing snap to the
  nearest periodic lattice so strokes never jog at tile boundaries), and
  `attachSpriteAssets()`/`finalizeSpriteBaseUrl()` declaring the document
  sprite under the fixed `mlym` id in the spec's array form. `EmitResult`
  gains an optional `assets` field; `ExportLowering.assets` now shares the same
  `EmitAsset` vocabulary (the earlier placeholder asset-descriptor type is gone
  before anything consumed it).

  The CLI rasterizes: `mlym emit --out` writes the standard four-file sprite
  set (`mlym.png`/`mlym.json` + `@2x`) beside the style (sharp, pinned exact,
  loaded lazily). MapLibre rejects relative sprite URLs, so asset-bearing
  documents require `--sprite-base <url-prefix>` (the deployed location) and
  `--out` — emitting a style whose sprite could never resolve now fails loudly
  instead of shipping broken. Rasterization runs before anything is written,
  so a sharp failure never leaves a style referencing missing files. Basemap
  sprite merging is fixed in the process: basemap icons survive under
  `default` while document assets ride `mlym` (id collisions warn as lossy) —
  previously a document sprite silently clobbered the basemap's entire icon
  set. cli's `engines.node` floor rises to match sharp's
  (`^18.17.0 || ^20.3.0 || >=21`).

- e05add1: `markers:` — standalone map pins as first-class YAML, and the format's
  first construct that _exports with a fallback_. Live, each entry is a real
  `maplibregl.Marker` DOM pin: `at:` position, `color:`/`size:` on the default
  pin, `icon:` swapping in any image URL (a failed load or unsafe URL scheme
  falls back to the pin with one console note), and `popup:` carrying the same
  trust-gated structured content as layer popups. Authored at the v1 document
  root or v2 `runtime.markers` — the two normalize identically. `<ml-map>`
  surfaces marker lifecycle as `ml-map:markers-added`, `ml-map:marker-click`,
  and `ml-map:marker-icon-error` events (mirroring the layer events), and
  `MarkerSchema`/`MarkersSchema`/`MarkerConfig` are exported from the schemas
  barrel. `color:` validates as a real color, not any string.

  On export, `mlym emit --with-fallbacks` lowers markers to a symbol layer
  ("mlym-markers") with generated pin sprites through the sprite pipeline,
  reported as a `lossy` warning; `--strict` refuses marker documents, because a
  DOM marker and a symbol layer are close but not identical. Icon URLs are not
  embedded yet (that arrives with `images:`) — the emitted style substitutes
  the default pin and says so. The export-class registry carries the lowering as its `export()` hook. Three gallery examples (default marker, custom icons, marker popup) are now plain YAML.

- 42189d3: `images:` — named images for symbol layers and patterns, the format's
  first style-half construct that exports through the sprite pipeline. Each
  entry (`name: url` or `{url, sdf?, pixelRatio?}`, at the v1 document root or
  under the v2 style half) loads via `map.addImage` BEFORE layers are added,
  so `icon-image`/`*-pattern` references resolve on first render; failures
  warn once per name (with an `ml-map:image-error` event) and never kill the
  document, and an unknown referenced name gets a warn-once
  `styleimagemissing` note instead of MapLibre's per-render spam.

  On export the construct fully compiles — class `exports`, so `--strict`
  accepts it: `mlym emit` fetches every image at compile time (the pipeline's
  second networked step, beside basemap resolution), merges it into the
  document sprite next to generated assets (SDF flags carried into the sprite
  index), and rewrites literal image references to `mlym:<name>`. Marker
  `icon:` URLs ride the same pipeline, lifting the markers' icon limitation: exported
  icon markers now render their images instead of substituting default pins.
  `EmitResult` widens with `images?` (fetch-at-emit refs) for programmatic
  consumers. Reference rewriting is expression-position-aware (match labels,
  `["get"]` arguments, and operators survive name collisions); dynamic
  references and relative URLs are reported instead of silently diverging
  (relative URLs are lossy — `--strict` refuses them). Emit fetches are
  bounded (30s timeout, 20MB/1024px ceilings, batched concurrency), live
  image loads time out after 10s instead of stalling `mapReady()`, and
  `--strict` now also refuses lossy warnings added by the basemap merge.
  Three more gallery examples (add an icon, fallback image, polygon pattern) are now plain YAML.

### Patch Changes

- 4558008: Plain-language terminology: turning a document into a plain MapLibre `style.json` is now called **exporting** (it was "ejecting"), everywhere you see it — API names, warning text, CLI help and docs. The export-class API that is new in 0.7 is renamed before release: `EjectClassRegistry` → `ExportClassRegistry`, `ejectClasses` → `exportClasses`, `EjectClass` → `ExportClass`, `EjectClassDefinition` → `ExportClassDefinition`, `EjectContext` → `ExportContext`, `EjectLowering` → `ExportLowering`; a definition's `eject()` hook is now `export()`, and the `EmitWarning.ejectClass` field is now `exportClass`. The three class values are now `exports`, `exports-with-fallback` (was `fallback`) and `no-export` (was `declared-absence`). None of these names shipped in 0.6, so no released API changes. `mlym emit` keeps its name and its `--strict` / `--with-fallbacks` flags; its help text and the strict-mode failure ("Export failed in strict mode: … could not be exported to style.json …") use the new wording, as does the `lossy` warning for effects. In `@maplibre-yaml/effects` only documentation and error wording changed (a `fallback()` returning `null` means the layer doesn't export); no fields were renamed. The docs page "Eject Classes" moved to `/guides/export-classes/` (the old URL redirects), and the examples gallery badges now name what you write: YAML, YAML + JavaScript, YAML + plugin, and JavaScript.
- a780274: Three gaps from the MapLibre examples gallery can now be expressed in YAML.

  - `config.fitTo: { source, padding?, maxZoom? }` fits the initial camera to a GeoJSON source's data. In format v2 it lives at `runtime.fitTo`. Inline `data:` is framed when the map is constructed, so the camera never jumps. A `url:` source is framed once its first fetch lands; refreshes don't re-fit. Tiled sources keep the authored `center`/`zoom` and log one warning. The new `ml-map:camera-fit` event fires when the fit applies. On export `fitTo` falls back: `mlym emit --with-fallbacks` computes `center`/`zoom` from inline data for a 1024×768 reference viewport and reports it as lossy, so `--strict` refuses `fitTo` documents.
  - Root `popups:` (v2: `runtime.popups`) opens popups at coordinates, with no layer and no marker. Content goes through the same `PopupBuilder` trust gate as other popups. Each entry accepts `closeButton`, `closeOnClick` and `maxWidth`. Popups don't export (class `no-export`).
  - The `color-relief` layer type (maplibre-gl 5.6 or later) joins the layer union with `color-relief-color` and `color-relief-opacity`. On older runtimes `<ml-map>` skips these layers with one warning instead of letting MapLibre reject the document. `mlym emit --target` below 5.6 reports the layer as lossy.

  Export classes are registered for `fitTo`, `popups` and `color-relief`. `ExportContext` gains an optional `model`, and `ExportLowering` gains an optional `camera`.

- 4d1177a: `mlym emit --strict` now fails when the runtime gate degrades lossily —
  previously a state-using document emitted with `--strict --target 4.0.0`
  inlined its `state:` defaults (a lossy transformation) and still exited 0,
  because strictness was only enforced over the projection stage. Strict now
  means strict over the whole pipeline.
- Updated dependencies [87e80b6]
- Updated dependencies [dabadd0]
- Updated dependencies [674351b]
- Updated dependencies [b096d61]
- Updated dependencies [83016bc]
- Updated dependencies [536742f]
- Updated dependencies [74961c9]
- Updated dependencies [d90d219]
- Updated dependencies [acfeaf7]
- Updated dependencies [83016bc]
- Updated dependencies [ec6c965]
- Updated dependencies [83016bc]
- Updated dependencies [0cb1474]
- Updated dependencies [4476d6d]
- Updated dependencies [e856b60]
- Updated dependencies [4558008]
- Updated dependencies [e28d149]
- Updated dependencies [0582994]
- Updated dependencies [a780274]
- Updated dependencies [7a71f7c]
- Updated dependencies [d3fc9b7]
- Updated dependencies [9054069]
- Updated dependencies [9054069]
- Updated dependencies [4558008]
- Updated dependencies [ac9c677]
- Updated dependencies [e05add1]
- Updated dependencies [42189d3]
- Updated dependencies [a1b280c]
- Updated dependencies [81fc5a0]
  - @maplibre-yaml/core@0.7.0

## 0.3.0

### Minor Changes

- 0972d93: Parse format-v2 documents into the internal model (ml-dsu, PR #72). A second
  parser front end reads a `version: 2` document — the explicit `style:` /
  `runtime:` split, per-source and per-layer `runtime:` blocks, and the v2 renames
  (`basemap`, root-level camera, `runtime.container.style`) — into the same
  `MapModel` a v1 document produces. A `toModel(result)` dispatcher selects the v1
  or v2 front end by the detected version, so the renderer, emitter, and extension
  registry are untouched: a v2 document is indistinguishable from its v1 twin
  downstream (AE2). Inline `source.data` is now validated as real RFC 7946 GeoJSON
  (a hard error under v2, still lenient under v1). `mlym validate` accepts and
  strictly validates v2 documents through the same path.

### Patch Changes

- 25a98cc: Renderer/schema contract audit: schema-valid documents now render or fail
  loudly, never silently. Four observable changes: (1) legend `collapsed:`
  is implemented — the legend renders as a native `<details>` with the title
  as its toggle, starting closed when `collapsed: true` (the field previously
  did nothing; an untitled legend gets a "Legend" summary). (2) Schema-accepted
  fields the engine does not implement yet (scrollytelling `spinGlobe`,
  `rotateAnimation`, `callback`, and the `fitBounds`/`custom`/`flyTo`/`easeTo`
  chapter actions) now emit `kind: "unimplemented"` warnings — visible in
  `mlym validate` output but never promoted to errors, since the document is
  not wrong. (3) `<ml-map>` logs render errors to the console in addition to
  dispatching `ml-map:error`, so a document failure is visible without a
  listener; a throw during named-source registration is now routed to that
  error path instead of being swallowed inside MapLibre's load handler.
  (4) A layer whose source object the renderer cannot resolve (an unresolved
  `$ref` passed programmatically, or an unknown source shape) throws a clear
  error naming the layer instead of silently adding nothing.
- Updated dependencies [8d5c7c3]
- Updated dependencies [25a98cc]
- Updated dependencies [2545477]
- Updated dependencies [2692ab0]
- Updated dependencies [8e850aa]
- Updated dependencies [8455c47]
- Updated dependencies [0972d93]
- Updated dependencies [d484c10]
- Updated dependencies [0972d93]
- Updated dependencies [0420dd8]
- Updated dependencies [43dbb14]
- Updated dependencies [d595a87]
- Updated dependencies [0972d93]
  - @maplibre-yaml/core@0.6.0

## 0.3.0-alpha.1

### Patch Changes

- 25a98cc: Renderer/schema contract audit: schema-valid documents now render or fail
  loudly, never silently. Four observable changes: (1) legend `collapsed:`
  is implemented — the legend renders as a native `<details>` with the title
  as its toggle, starting closed when `collapsed: true` (the field previously
  did nothing; an untitled legend gets a "Legend" summary). (2) Schema-accepted
  fields the engine does not implement yet (scrollytelling `spinGlobe`,
  `rotateAnimation`, `callback`, and the `fitBounds`/`custom`/`flyTo`/`easeTo`
  chapter actions) now emit `kind: "unimplemented"` warnings — visible in
  `mlym validate` output but never promoted to errors, since the document is
  not wrong. (3) `<ml-map>` logs render errors to the console in addition to
  dispatching `ml-map:error`, so a document failure is visible without a
  listener; a throw during named-source registration is now routed to that
  error path instead of being swallowed inside MapLibre's load handler.
  (4) A layer whose source object the renderer cannot resolve (an unresolved
  `$ref` passed programmatically, or an unknown source shape) throws a clear
  error naming the layer instead of silently adding nothing.
- Updated dependencies [8d5c7c3]
- Updated dependencies [25a98cc]
- Updated dependencies [2545477]
- Updated dependencies [8e850aa]
- Updated dependencies [d484c10]
- Updated dependencies [0420dd8]
  - @maplibre-yaml/core@0.6.0-alpha.1

## 0.3.0-alpha.0

### Minor Changes

- 0972d93: Parse format-v2 documents into the internal model (ml-dsu, PR #72). A second
  parser front end reads a `version: 2` document — the explicit `style:` /
  `runtime:` split, per-source and per-layer `runtime:` blocks, and the v2 renames
  (`basemap`, root-level camera, `runtime.container.style`) — into the same
  `MapModel` a v1 document produces. A `toModel(result)` dispatcher selects the v1
  or v2 front end by the detected version, so the renderer, emitter, and extension
  registry are untouched: a v2 document is indistinguishable from its v1 twin
  downstream (AE2). Inline `source.data` is now validated as real RFC 7946 GeoJSON
  (a hard error under v2, still lenient under v1). `mlym validate` accepts and
  strictly validates v2 documents through the same path.

### Patch Changes

- Updated dependencies [2692ab0]
- Updated dependencies [8455c47]
- Updated dependencies [0972d93]
- Updated dependencies [0972d93]
- Updated dependencies [43dbb14]
- Updated dependencies [d595a87]
- Updated dependencies [0972d93]
  - @maplibre-yaml/core@0.6.0-alpha.0

## 0.2.2

### Patch Changes

- Updated dependencies [328661a]
  - @maplibre-yaml/core@0.5.0

## 0.2.1

### Patch Changes

- 95ea3f1: Harden every HTML sink: shared attribute-safe escaping, a popup tag allowlist, and URL scheme guards.

  A document may be authored by someone other than the person whose browser renders it, and feature properties come from fetched data that is never trusted. Escaping was applied unevenly across the sinks, and three vectors were live.

  **New `escapeHtml` / `safeUrl` in core** (exported from the package root). One escaper, attribute-safe — quotes included — and DOM-free, so it works during SSR where the previous `document.createElement` approach did not. It replaces two divergent private copies: the popup builder's regex version escaped quotes, the `<ml-map>` error card's `textContent` version did not, which is exactly the difference between safe and unsafe in attribute position.

  **Popup builder.** Three fixes:
  - _Tag allowlist._ Popup content is `z.record(...)`, so the tag is a YAML **key** and nothing constrained it: `script:` emitted a real `<script>` block, and a key carrying attributes (`img src=x onerror=...`) injected them wholesale. Only the documented tags render now; anything else is dropped with a console warning. `iframe` is deliberately excluded — the builder never emitted one with a `src`, so nothing that worked stops working.
  - _URL scheme guards._ `javascript:alert(1)` contains no character escaping touches, and zod's `.url()` accepts it as well-formed, so it reached `href` intact and executed on click. `href` and `src` now pass through a scheme allowlist (http, https, mailto, tel, plus scheme-less relative references); an unsafe link degrades to its text, an unsafe image is dropped. The guard strips control characters first, because browsers do the same before resolving a scheme — `java\nscript:` navigates as `javascript:`.
  - _`target` and `rel`._ `target` is passthrough in the schema and was raw-interpolated into the attribute, so `_blank" onmouseover="…` broke out. It is now allowlisted to the four legal values, and `_blank` links carry `rel="noopener noreferrer"`.

  **Astro components.** The `Map`, `FullPageMap`, and `Scrollytelling` error cards interpolated validation messages and thrown-error text into `innerHTML` completely unescaped. Scrollytelling additionally interpolated chapter `title`, `id`, `image`, and `video` into markup and attributes. All escaped; media URLs get the scheme guard. These inline scripts carry a small deliberate copy of the escaper rather than importing it — they are `is:inline`, and the only import route sits inside the very `try` whose `catch` renders the error card.

  **CLI preview.** The debug panel rendered event type and payload — which carry feature properties from fetched sources — into `innerHTML` unescaped.

  Not addressed here, and deliberately so: `chapter.description` and `footer` are documented as HTML-bearing (`"HTML/markdown supported"`, `"Footer content (HTML)"`). Escaping them would break documented behavior, and choosing between an allowlist sanitizer and a trusted-author contract is a product decision, tracked separately. Both sites are now commented to say so.

- Updated dependencies [95ea3f1]
- Updated dependencies [f4c4bab]
  - @maplibre-yaml/core@0.4.1

## 0.2.0

### Minor Changes

- 141d3f1: Add a deprecation warning channel, and deprecate the interaction `action` fields (schema-truthfulness U8).

  `click.action`, `mouseenter.action`, and `mouseleave.action` are accepted by the schema but have never been dispatched at runtime. Rather than remove them and break existing documents, they now emit a deprecation warning naming the event to listen for instead, and are scheduled for removal in v2. The config still parses.

  **core:** `ValidationWarning` gains `kind: "deprecation"`. The hardcoded legacy-refresh check is replaced by a deprecation table — `field` plus an `applies` predicate — so deprecating a field is a data change rather than another special case in the walk; the legacy top-level `refreshInterval`/`updateStrategy`/`updateKey` warnings fold into it unchanged and now carry the new kind. The rules are scoped to `interactive.{click,mouseenter,mouseleave}.action`, so scrollytelling chapter actions, which share the field name, are untouched.

  **cli:** deprecations are exempt from strict promotion. `mlym validate` promotes warnings to errors under CI, and without this exemption 0.4.0 would hard-fail the build of every existing user of `click.action` on the release that deprecates it — defeating the point of a warning window. A new `--strict-deprecations` flag opts back in. The exemption is narrow: unknown-key and expression warnings still promote under CI exactly as before. The kind survives into both JSON output and the SARIF property bag, so deprecations are distinguishable in code-scanning results rather than only in message text.

- 141d3f1: Publish the YAML contract as machine-readable JSON Schema and ship the agent- and editor-facing affordances built on top of it. The Zod schemas already carried rich `.describe()` annotations; this converts and publishes them so authors get in-editor autocomplete and validation for free, and agents get a stable contract to generate against.

  **core: emit per-block JSON Schema at build time.** A new build step (`scripts/emit-json-schema.ts`, run by `pnpm build` after `tsup`) converts the Zod source into draft-07 JSON Schema documents — `map.schema.json` (`MapBlockSchema`), `scrollytelling.schema.json`, `root.schema.json` (the `pages:` document), and `any.schema.json` (a `oneOf` over the three, mirroring the Phase-1 `safeParseAny` dispatcher). `root.schema.json` emitted cleanly (~157 KB pretty-printed; the recursive `MixedBlock` is handled by `$ref` reuse, not inlined), so nothing was deferred. Per decision D7 these are generate-on-build: `packages/core/schemas/*.json` is git-ignored and regenerated by CI/build, never committed. They ship in the npm package (added to `files`) and are importable via a new `"./schemas/json/*"` export (e.g. `@maplibre-yaml/core/schemas/json/map.schema.json`).

  Per decision D8 the emitted schemas describe the **strict** shape — enumerated object nodes get `additionalProperties: false` plus a `patternProperties: {"^x-": {}}` escape hatch, so editors flag typo'd keys while `x-*` extensions stay legal. The Zod `.passthrough()` objects (`MapConfigSchema`'s arbitrary MapLibre options and the source schemas) are kept permissive to match the runtime, so the JSON Schema never rejects what `mlym validate` accepts; they tighten automatically when the validation-ergonomics work flips passthrough to warn-on-unknown. JSON Schema is advisory authoring assistance — `mlym validate` (Zod) remains the source of truth, since `.refine()`/`.superRefine()` cross-field rules do not convert.

  **cli: new `mlym schema [map|scrollytelling|root|any]` command.** Prints the JSON Schema resolved from the _installed_ `@maplibre-yaml/core` package, guaranteeing it matches the version `mlym validate` enforces; `--out <file>` writes it (creating parent directories). This is the offline / air-gapped path and the natural hook for future migration tooling.

  **Editor integration (zero-install).** Every CLI scaffold template and every canonical config in the docs now carries a `# yaml-language-server: $schema=...` modeline as its first line, so opening one in any `yaml-language-server`-backed editor (VS Code's Red Hat YAML extension, Neovim, JetBrains) gives autocomplete, hover docs, and inline validation with no project setup. New docs pages cover the modeline convention, the VS Code `yaml.schemas` settings-block alternative, and the generate → `mlym validate -f json` → repair agent loop with its structured `{ path, message, line, column }` error contract.

  **Agent resources.** The docs build now generates stable schema URLs (`/schema/latest/<block>.schema.json` plus versioned `/schema/v<major.minor>/`) and `llms.txt` / `llms-full.txt` from the same sources as the human docs, so they can never go stale. The content states explicitly the three things agents got wrong: `<ml-map src>` expects a `type: map` block (not a `pages:` root document), popups use the tag-array DSL (with a complete example), and named sources are referenced by bare name.

  Guarding all of it: snapshot tests over the generated schemas (regenerate with `pnpm --filter @maplibre-yaml/core test -- -u`) and a round-trip converter-fidelity test that validates every docs config and CLI template against _both_ the Zod parser and the generated JSON Schema via `ajv`.

- 141d3f1: Validation now delivers what it promised: real source positions, actionable type errors, and a warn-first typo channel.

  **Line/column positions, end to end.** The parser now reads YAML through the `yaml` document API with a `LineCounter`, so every error carries `{ line, column }`. YAML syntax errors copy the library's `linePos`; Zod errors map each issue `path` back to a source position via `doc.getIn(path, true)` → node range → `LineCounter` (falling back to the nearest ancestor node, and finally the document root, when a node is missing — e.g. a missing required key). Positions flow through the parser `ParseError`, the CLI human formatter (`at line 12, column 7`), and JSON/SARIF output (`region.startLine`/`startColumn`).

  **Discriminated layer union with did-you-mean.** The layer schema is now a `z.discriminatedUnion("type", …)`, so `type: circl` yields `Unknown layer type "circl". Valid types: circle, line, fill, symbol, raster, fill-extrusion, heatmap, hillshade, background. Did you mean "circle"?` instead of "Value does not match any of the expected formats". The same treatment covers unknown **source** types and the block-type dispatcher (`safeParseAny`). Suggestions use a small hand-rolled Levenshtein (distance ≤ 2, no new dependency).

  **Warn-first unknown-key detection (new `warnings` channel).** `ParseResult` gains a `warnings: ValidationWarning[]` channel alongside `errors`. After normal validation, a schema-aware walk diffs authored keys against each schema's known keys and emits **warnings** (never hard errors) for unknowns, with did-you-mean suggestions — so `circle-radis: 8` is finally caught. `x-*`-prefixed keys are always exempt at every level (the extension escape hatch). The intentional MapLibre `config` passthrough is not flagged. This is additive and warn-only; it does not flip to hard-strict by default.

  **Deprecation warning for the legacy refresh fields.** Using top-level `refreshInterval` / `updateStrategy` / `updateKey` on a GeoJSON source now emits a deprecation warning pointing at the `refresh:` block equivalent. The legacy fields still work; docs now teach only the nested form.

  **Bounded expression validation.** The expression operator (first array element) is checked against the known MapLibre operator list with did-you-mean, and obvious arity-zero mistakes are flagged — both as warnings. Full expression type-checking remains out of scope.

  **Root-level `$ref` sources are reachable.** A layer's `source:` now accepts `{ $ref: "#/sources/name" }`, resolved against the root `sources:` map at parse time; a dangling reference errors with a did-you-mean suggestion and the list of defined sources.

  **`<ml-map>` developer diagnostics.** Parser warnings are logged to `console.warn` (never the on-map error card). Two classic silent-blank-map failures are also detected on the console: a zero-height host element, and a missing MapLibre stylesheet (probed via the `.maplibregl-canary` technique).

  **CLI: CI-strict by default.** `mlym validate` now promotes warnings to errors automatically when `CI` is truthy (overridable with `--no-strict`); `--strict` still forces promotion anywhere. Warnings are printed in human, JSON, and SARIF output with line/column, as `warning`-level results.

### Patch Changes

- Updated dependencies [141d3f1]
- Updated dependencies [141d3f1]
- Updated dependencies [141d3f1]
- Updated dependencies [f012d2c]
- Updated dependencies [141d3f1]
- Updated dependencies [141d3f1]
- Updated dependencies [0a605d1]
- Updated dependencies [141d3f1]
- Updated dependencies [ff94d4f]
- Updated dependencies [fda8aad]
- Updated dependencies [141d3f1]
  - @maplibre-yaml/core@0.4.0

## 0.1.13

### Patch Changes

- 8511427: The CLI now validates and previews every block type it scaffolds, and preview renders with the locally installed core instead of a stale CDN pin.

  **core: new `YAMLParser.safeParseAny(yaml)` block dispatcher (also exported as `safeParseAny`).** Core exposed `safeParseMapBlock` / `safeParseScrollytellingBlock` / `safeParse` but no "detect `type:` and validate" entry point, so every consumer had to guess which schema a document needed. `safeParseAny` dispatches on the document's top-level `type:` field (`map` → MapBlockSchema, `scrollytelling` → ScrollytellingBlockSchema, no `type:` but `pages:` → RootSchema) and returns a discriminated `{ blockType, result }`. An unrecognized `type:` produces a clear error listing the valid values instead of a cryptic literal mismatch. Never throws.

  **cli: `validate` accepts everything `init` scaffolds.** `mlym validate story.yaml` on the CLI's own story template (`type: scrollytelling`) failed with a type-literal error because the validator called `safeParseMapBlock` unconditionally; root `pages:` documents were equally unsupported. Both now validate via `safeParseAny`. Exit-code semantics are unchanged.

  **cli: `preview` serves the locally installed core.** The preview page's import map hardcoded `https://esm.sh/@maplibre-yaml/core@0.1.2/dist/register.js` — preview rendered with a core two minors behind the one that validated the config. Preview now resolves the installed `@maplibre-yaml/core` and serves its browser register bundle through the dev server; only if local resolution fails does it fall back to esm.sh pinned to the _installed_ version read from the package's own package.json. Previewing a non-map document (e.g. the story template) now shows "visual preview currently supports only `type: map` blocks" instead of a misleading validation error, and the error overlay reflects the latest reload instead of the first load.

  **cli: SARIF output reports the real CLI version.** `--format sarif` hardcoded `version: '0.1.0'`; it now reads the version from the CLI's package.json like the `--version` flag does.

  **cli: astro template accuracy.** The template is described as what it is — an Astro project rendering the `<ml-map>` web component — its `@maplibre-yaml/core` dependency is pinned to `^0.2.0` instead of `latest`, and `init` next-steps text now matches what each template actually supports.

- Updated dependencies [ab8ba89]
- Updated dependencies [8511427]
- Updated dependencies [4ed6c5e]
- Updated dependencies [1daaee2]
- Updated dependencies [291f852]
- Updated dependencies [d87a7c5]
- Updated dependencies [f716577]
  - @maplibre-yaml/core@0.3.0

## 0.1.12

### Patch Changes

- Updated dependencies [937738a]
  - @maplibre-yaml/core@0.2.0

## 0.1.0

### Patch Changes

- Updated dependencies [e7e1126]
  - @maplibre-yaml/core@0.1.0
