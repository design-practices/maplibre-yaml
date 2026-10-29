# @maplibre-yaml/astro

## 0.8.0

### Minor Changes

- 4a02789: `Map` and `FullPageMap` accept `id` and `camera` props, and `FullPageMap` follows in-place document updates. `id` lands on the rendered `<ml-map>` in place of the generated one, so a page script can reach the element (`document.getElementById(id).update(doc)`, `getMap()`, `getState()`, or listen for `ml-map:update-applied`); `camera="host"` passes through as the element's `camera` attribute for pages whose viewport is per-user, so a changed document never moves the map. With core 0.10 a changed `config` or `src` is applied in place instead of rebuilding the map, so `FullPageMap`'s reset button now re-captures its home camera when an update moves the camera (after the ease settles), and its zoom buttons re-sync with the document's own navigation control on every applied update, in-place or rebuilt — one set of zoom buttons either way. Accordingly, `@maplibre-yaml/astro` 0.8 now requires `@maplibre-yaml/core` 0.10 or later.
- dae438d: Map and story documents can now be written in JSON or TOML as well as YAML, with the same validation and the same line-and-column diagnostics in every format. `<ml-map>` and `<ml-scrollytelling>` read all three from `src` (by extension or content type), inline `<script type="application/toml">` (and the YAML and JSON types), the `config` attribute and property, and `update(text)`. The format comes from the label when there is one and is sniffed otherwise. The TOML reader is a separate chunk downloaded the first time a page meets a TOML document, so YAML and JSON pages download nothing new. Errors name their format ("JSON syntax error", "TOML syntax error"), carry a new `format` field, and TOML syntax errors use the new `toml-syntax` code; TOML gets hints for unquoted colours, `null` (omit the key) and dotted keys. Changed: the `config` attribute and `update(string)` now read text through the same parser as `src`, so they accept YAML and TOML too, and a duplicate key in JSON there is an error instead of the last value winning. New in core: `parseDocumentText(text, options)`, `convertDocument(text, { to })` (converts the authored document between the three formats, keeping key order and inline expressions, and reports comments, expanded anchors and dropped nulls), `normalizeDocumentValue(value)`, `looksLikeDocumentText(text, format)` (whether JSON or TOML text is a map or story document, by the rule `mlym validate` picks a folder's files with), `readDocumentValue(text, options)` (a document's raw value in any of the three formats, unvalidated, with the same guards and error wording), `stripBom(text)` and `UNREADABLE_CODES` (the error codes that mean the text could not be read at all). In every format a root `$schema` key is accepted (and removed before rendering), nested tables under `locale` flatten to dotted keys, and date values become text; the published JSON Schemas accept both. An inline script of an unsupported type is named in the error card instead of "No configuration provided".

  The CLI's `validate`, `preview` and `emit` read all three formats; `mlym validate <folder>` also finds JSON and TOML documents by their content (a broken one still joins the run and fails), skipping other JSON and TOML files, with `--verbose` listing what it skipped and a clear message for a folder with no documents. New: `mlym convert <file> --to yaml|json|toml [--out] [--strict] [-f json]`, whose `-f json` prints the result and its losses as one JSON object. Folder discovery also checks the end of a large JSON file (sorted keys put `type` last), and a file it cannot read joins the run and fails instead of being skipped. Astro's `loadMapConfig`, `loadScrollytellingConfig`, `loadYAML` and `loadFromGlob` pick the format by extension, dev reload watches `.toml`, and content-collection schemas normalize entries first, so TOML collection entries with nested locale tables or dates validate.

## 0.7.1

### Patch Changes

- 35e5480: `buildMultiPointMapConfig` and `buildRouteMapConfig` now apply their `padding` option. It was accepted and documented (default 50 pixels) but never reached the map, so the points or route were fitted edge to edge. The built config now carries `fitBoundsOptions: { padding }` next to `bounds`, so the map leaves that many pixels between your data and the map edge.
- 0013b82: The `astro` project template from `mlym init -t astro` now asks for Node.js 22.23.4 or later in its `package.json` `engines`, which is what Astro 7.4.2 requires. Before, it asked for 22.22, so a new project could install on a Node version that Astro then refuses to run on. The `@maplibre-yaml/astro` README now gives the same minimum for Astro 7.
- cbf0ec0: Content-collection entries validated with `getMapSchema()` or `getScrollytellingSchema()` now accept the GeoJSON shorthand (`location:`, `locations:`, `region:`, `route:` on a `type: geojson` source), just as `<Map src>` and `loadMapConfig` do. Before, the same YAML that worked as a map file failed as a collection entry with "GeoJSON source requires at least one of: url, data, or prefetchedData". The entry's data now has the shorthand expanded into `data:`, and a malformed shorthand is reported at its own path. `extendSchema()` keeps this behavior. Both helpers are now always a validating wrapper, never core's zod object itself; on Astro 6 and 7 they already were.

## 0.7.0

### Minor Changes

- 009fbf3: The on-page notice now separates what failed from hints for the author. Failures (a data file that didn't load, a layer MapLibre rejected) always show, as before: one plain line for visitors with the fix under "Details for the site's author". Author hints — did-you-mean suggestions, keys nested under `config:`, a `fitTo` typo, coordinates that look written [latitude, longitude], a chapter naming a missing layer, a value starting with the reserved `=` — now show only while you develop: on `localhost`/`127.0.0.1`/`[::1]`/`file:` pages (and `0.0.0.0`/`[::]`, the addresses a dev server started with `--host` prints) and in bundler dev builds (`astro dev`, `vite`), so visitors to a published site no longer see them. A new `debug` attribute on `<ml-map>` and `<ml-scrollytelling>` (and `debug` prop on the Astro `Map`, `FullPageMap` and `Scrollytelling` components) shows them anywhere, for checking a deploy; `quiet` still hides everything, and the console keeps every hint. A notice holding only hints reads "Notes for this map's author". `showAuthorHints()` / `authorHintsDecision()` (from `@maplibre-yaml/core/components`) expose the rule.
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

- 3823e6d: `@maplibre-yaml/astro` now declares `@maplibre-yaml/core >=0.9.0` as its peer (was `>=0.8.0`). The components pass 0.9 options straight to core — the `debug` prop, a Protomaps `mapStyle: { pmtiles, flavor }` in the map builders, translated FullPageMap buttons — which core 0.8 ignores or rejects. Upgrade both packages together: `npm install @maplibre-yaml/astro@latest @maplibre-yaml/core@latest`.
- dc16ded: Thematic maps from YAML: a layer's new `classify:` block makes a choropleth, graduated symbols or a category map without hand-writing a `step`/`match` expression. Give explicit `breaks:` (MapLibre `step` convention: n breaks make n + 1 classes, and a value equal to a break takes the class above), or `method: quantile | equal | jenks` with `classes:` to compute breaks from a GeoJSON source's data when it loads, or `categories:` for a `match` with an `other:` colour (a `value: colour` map keeps the order you wrote, numeric codes included). Map a rate instead of a count with `normalize:` (and `multiply:`, e.g. `100000` for "per 100,000"): the division is guarded, so a missing, zero or non-numeric divisor counts as no data rather than Infinity, and breaks and legend labels are in the rate's units. Colours come from a named palette (the ColorBrewer set, `viridis`, `cividis`, `okabe-ito`; case-insensitive, with a did-you-mean that prefers the palette a short name starts) or a `colors:` list; `radius:` sizes circles per class. Missing, empty and non-numeric values draw a `noData:` colour (light grey by default) or are hidden, instead of the black MapLibre paints when a `step` input is null or a string; numeric strings from CSV-derived GeoJSON are read as numbers. `hover.highlight` works on classified layers like on any other.

  Computed breaks need the whole dataset, so vector tile sources and FlatGeobuf or GeoParquet sources read by view take explicit `breaks:`. Validation explains why for tiles and for `load: viewport` in any form. A FlatGeobuf or GeoParquet file large enough to switch itself to reading by view draws in its no-data colour, with a notice asking for `breaks:`, rather than classes computed from the features in view. When the loaded data has no usable value for `field:` or `normalize:` (a misspelt or differently capitalized name, or text under numeric classes), the console and, while you develop, the map's author notes name the field, suggest the closest property name and list the data's properties.

  A map or story with a classified layer gets a legend automatically, even without a `legend:` block (`legend: false` turns it off). It lists each class with its real edges, formatted with the shared `formatNumber` (MapLibre `number-format` option names, the page's language by default), and "No data"/"Other" lines that only appear when they occur, translatable as `maplibre-yaml.Classify.NoData`/`.Other` in `locale:`. A legend block with its own `items:` lists them first and the generated classes after them; validation and the author notes point out the combination, since hand-written items usually describe the colours a layer had before it was classified. The Astro `FullPageMap` no longer warns that such a map has no legend entries. `classify:` compiles to plain MapLibre (class `exports`) and records the classes in the layer's `metadata["maplibre-yaml:classify"]`, in v1 and v2 alike; `mlym emit` bakes computed breaks into the style, loading a `url:` source's data at export (a FlatGeobuf or GeoParquet file too, recognized by its extension or the source's `format:`) and failing clearly when it cannot. `<ml-map>` fires `ml-map:layer-classified` with the classes as drawn.

- c70afac: Every piece of text the library puts on a map can now be translated through the same `locale:` table MapLibre reads for its controls (`config.locale`, or `runtime.map.locale` in v2). The library's keys start with `maplibre-yaml.` — `maplibre-yaml.Legend.Title`, `maplibre-yaml.Notice.Title`, `maplibre-yaml.Story.Chapters`, and so on — so one table translates MapLibre's zoom buttons and the legend, the "part of this map couldn't load" notice, error-card titles, the height hint, the params panel's notice, and a story's chapter rail, legend button and missing-image note. English stays the default and the only bundled language; the new "Accessibility & languages" guide lists every key. A misspelt `maplibre-yaml.*` key is reported by validation with a did-you-mean, and also in the map's author notes while you develop. The table is exported as `DEFAULT_STRINGS` / `createStrings()`, and `<ml-map>` gains `uiString(key)` so host chrome can use the document's text. Astro's `<FullPageMap>` labels its zoom and reset buttons from the same table (MapLibre's `NavigationControl.ZoomIn`/`ZoomOut` and `maplibre-yaml.FullPageMap.ResetView`).

## 0.6.1

### Patch Changes

- b3befa8: `Map`, `FullPageMap` and `Scrollytelling` accept a `quiet` prop, which renders `<ml-map quiet>` / `<ml-scrollytelling quiet>`. It hides the on-page notices for non-fatal problems, such as a data file that didn't load or the zero-height hint, so a finished site can keep them away from its visitors. The problems are still logged to the browser console, and fatal problems still show their error card. Before, an Astro site had no way to turn the notice off.
- fa50f30: In `astro dev`, `Map`, `FullPageMap` and `Scrollytelling` now print a one-time console hint when the page has no `<meta name="viewport">`. Without it, phones lay the page out about 980px wide and shrink it, so a full-page map or story comes out tiny with unreadable controls and chapter text, and nothing else points at the cause. The hint is compiled out of production builds. The docs' FullPageMap and Scrollytelling "Basic Usage" snippets are now complete pages with the viewport meta and `body { margin: 0 }`.
- 6d034fd: `FullPageMap` no longer shows two stacks of zoom buttons when the document declares its own navigation control. A YAML with `controls: { navigation: true }` already puts MapLibre's +/− in the top-right corner, and FullPageMap's own +/− appeared again under it, which looked like a bug. FullPageMap now keeps only its reset button in that case (checked on every load, so a `reload()` or new config is handled too); documents without a navigation control still get zoom in, zoom out and reset.
- 2cd9b61: `FullPageMap`'s "Reset view" button now returns to the view the map opened with. When the document uses `fitTo` on a fetched source, the map is framed on the data once it loads. Reset used to go back to the YAML's own `center`/`zoom` instead, a different view from the one the page showed. It now resets to the fitted framing.
- 8dd3cec: More validation errors are worded in plain language, the same in the browser's error card and in `maplibre-yaml validate`:

  - `center: -73.982, 40.743` (no brackets) says `center needs square brackets: center: [-73.982, 40.743]`, not `Expected array, got string`. The same goes for a marker's `at:`.
  - A value outside a fixed list (`alignment: middle`) lists the allowed values and suggests the likely one: `"middle" is not one of left, right, center, full. Did you mean "center"?`.
  - A `"` inside a `"…"` value is explained at its line (it ends the value early; use single quotes around the value, or write `\"`). It used to read `Unexpected scalar at node end`.
  - A document whose `type:` line is missing says `The document is missing type: at the top — add type: scrollytelling` (or `type: map`, going by the document's shape) wherever it is checked.
  - Astro's build-time validation error (`loadScrollytellingConfig`, `loadMapConfig`, `loadFromGlob`) prints `Chapter 3 ("summit"): …` without repeating the `chapters.2.centre` path, as `maplibre-yaml validate` does. The structured `path` on each entry is unchanged.
  - One mistake gives one message. A `centre:` typo is reported once, not again as an unknown `config:` key.

  Code that shows errors to readers can use the new `displayPath()` helper. It leaves out the 0-based `chapters.3` path when the message already names the chapter (`Chapter 4 ("brooklyn-bridge") …`); the `path` itself is unchanged for tools. This is an additive change; existing code needs no action.

- 84cddc7: A story's legend is now pinned above the chapter cards and never moves while the story scrolls. Before, cards passing over a corner covered the legend, on phones for most of each chapter. The legend sits top-left by default, opposite the chapter rail, or top-right on a wide screen whose cards are all `alignment: left`; a `legend.position` you set still wins. With the new `legend.collapsed: auto` (the story default) it is a compact button labelled "Legend" (the legend's own title heads the open panel) on phones and wherever cards pass its corner, and open everywhere else; `true` and `false` fix it either way. The button is a real button: it opens the legend as a panel above the cards, Escape closes it and returns focus to the button, a tap outside closes it on a phone, and focus is never trapped, so the map stays usable. A long legend scrolls inside the panel, and the panel does not animate under reduced motion. A `slot="legend"` child (also from Astro's `Scrollytelling`) fills the same panel. The rest of the map's chrome (scale bar, attribution, zoom buttons, corner slots, the params panel, the on-map notice) also stays put in its corner, under the cards; on phones the attribution stays a compact (i) button. Plain `<ml-map>` legends are unchanged.

  On a phone on its side (a short landscape screen), cards are narrow and short and sit on the left, with the chapter's subject beside them. Before, desktop cards were taller than the screen and a centred one covered the subject. Chapter photos and videos are capped at 40% of the screen height, so a full-width card's photo no longer fills the map, and full-width cards keep the chapter's `center` above them as centred cards do.

## 0.6.0

### Minor Changes

- 1ce286a: New optional integration, `@maplibre-yaml/astro/integration`, that makes `astro dev` reload the page when a map file changes. Add `maplibreYaml()` to `integrations` in `astro.config.mjs`. It reloads when a file read by `loadMapConfig`, `loadScrollytellingConfig`, `loadGlobalMapConfig` or a `feature_ref` changes, re-running the modules that read it. Edits to a global config loaded with a module-level `await loadGlobalMapConfig(...)` used to be ignored until the dev server restarted. It also reloads when YAML, GeoJSON or JSON under `public/` changes, and it pre-bundles maplibre-gl and `@maplibre-yaml/core` when the dev server starts, so the first page with a map no longer triggers Vite's "new dependencies optimized" reload (with _504 (Outdated Optimize Dep)_ errors in the console). It does nothing in `astro build`.
- c6ad0fc: `Map` and `FullPageMap` now put the paths inside your YAML under your site's `base`, so a site deployed to a GitHub Pages project site (`base: '/my-repo'`) works without writing the repo name into the YAML: `url: "/data/volcanoes.geojson"`, `images:` and marker `icon:` paths load from `public/` under `/my-repo/`. The components pass `import.meta.env.BASE_URL` to `<ml-map>` as its new `base` (needs `@maplibre-yaml/core` 0.8). Paths that already include the base keep working.

  **Behaviour change:** the base is passed even when it is the default `/`, so a relative path in a document (`data/x.geojson`) now means "from `public/`" on every page. Before, it resolved against the page, so on a nested page such as `/blog/post/` it asked for `/blog/post/data/x.geojson`. Paths that start with `/` and full URLs behave as before on a site without a `base`. A new `base` prop overrides the value; `base={false}` restores the old page-relative resolution for that map.

- 81e8809: Story maps now work without a build step: `@maplibre-yaml/core/register` (and the CDN bundle) defines `<ml-scrollytelling>`, which shows a `type: scrollytelling` document as a scroll-driven story in any HTML page. Give it the story as `src="story.yaml"`, an inline `<script type="text/yaml">`, or a `story` property; it renders a sticky `<ml-map>` (slots, legend and the map's own error handling included) with the chapter cards scrolling over it, and runs the chapters: camera moves, `layers.show`/`hide`, every chapter action, the marker rail, themes, alignment and the footer, dispatching `ml-scrollytelling:chapter`, `ml-scrollytelling:action` and a new `ml-scrollytelling:error`. Astro's `<Scrollytelling>` now renders this same element (same props, same classes and events), so a story behaves identically in an Astro site and a plain page. `@maplibre-yaml/astro` 0.6 therefore requires `@maplibre-yaml/core` 0.8 or later (its peer range is now `>=0.8.0`): upgrade both together. The engine is also importable on its own, DOM-free, from `@maplibre-yaml/core/scrollytelling`, with its stylesheet at `@maplibre-yaml/core/scrollytelling.css`. Fixed along the way, on both paths: the chapter rail's dots take mouse clicks (the chapter column used to cover them) and arrow keys; on phones the camera is offset so a chapter's subject shows above its card, and the rail no longer sits on the card; a `fitBounds` action frames top-down at the chapter's own pitch and bearing instead of keeping the previous chapter's tilt; under reduced motion every chapter camera move and camera action is instant on every supported maplibre-gl major; a `src` story no longer flashes `<ml-map>`'s "No configuration provided" while it loads; and a story that fails shows one error card, with line numbers and did-you-mean hints, instead of two. The story map's own pan/zoom gestures now start off (the wheel and touch scroll the story, which they effectively did before) so the rail, legend, markers and popups on the map are clickable; set `scrollZoom: true` or `dragPan: true` in the story's `config:` to turn one back on.
- b7a8f09: Stories work on a site published under a subpath, such as a GitHub Pages project site. `<ml-scrollytelling base="/my-repo/">` (attribute or `base` property, same meaning as `<ml-map base>`) resolves the story's `src`, every path in its map document (data, images, marker icons, a site-hosted style) and chapter `image`/`video` paths under the base, and hands it to the story's map. Astro's `Scrollytelling` passes the site's `base` by default (`/` included), as `Map` and `FullPageMap` do, so `/stories/tour.yaml` and `/images/photo.jpg` from `public/` load under `/<repo>/` with no change to the YAML; a standalone `Chapter`'s media does the same, and `base={false}` opts out. A story `src` that fails to load now shows the same advice as `<ml-map src>` (file not found, an HTML page instead of YAML, a page opened from disk, a missing base), in the story's single error card.

### Patch Changes

- 1ce286a: `getCollectionItemWithLocationSchema()` and the other `getCollectionItemWith*Schema()` helpers (`Locations`, `Region`, `Route`, `Geo`, `FeatureRef`) now give `entry.data` real types on Astro 6 and 7. On zod 4 every field was typed `unknown`, so the collections guide's Quick Start failed `astro check` (`Type 'unknown' is not assignable to type 'string'`); on Astro 4 and 5 the fields passed as `customFields` were missing from the type. Runtime validation is unchanged.
- 1ce286a: `<Map src>` and `<FullPageMap src>` now work on a site deployed under a base path, such as a GitHub Pages project site (`base: '/my-repo'`). A root-relative `src="/configs/map.yaml"` is prefixed with the site's base, so it loads `/my-repo/configs/map.yaml` instead of 404ing; a `src` that already includes the base, or a full `https://` URL, is used as written. The new "Deploying to GitHub Pages" docs section covers the rest of a subpath deploy.
- 1ce286a: When `loadMapConfig`, `loadScrollytellingConfig`, `loadGlobalMapConfig` or `loadYAML` cannot find their file, the error now says why it probably happened. On a server with no `src/` folder (an `output: 'server'` deploy rendering the page on request), it suggests `export const prerender = true` or importing the YAML. Inside the project it points at the path's spelling. The bare _ENOENT_ used to give no hint.
- b7a8f09: `Scrollytelling` works with `<ClientRouter />` soft navigations: MapLibre's stylesheet is now page CSS (imported in the component, as `Map` and `FullPageMap` do), so it survives the head swap in `astro dev`, and each visit to a story page gets a fresh story whose map is disposed of when you navigate away, with the chapter rail working on every visit. A standalone `Chapter` now renders active (full opacity) by default instead of dimmed; pass `isActive={false}` for the inactive look.
- 1ce286a: Maps keep working with Astro view transitions (`<ClientRouter />`). `FullPageMap`'s zoom and reset buttons used to work only on the first visit to a page and did nothing after a soft navigation back to it; they now work on every visit. Under `astro dev`, MapLibre's stylesheet was dropped after the first soft navigation (controls and attribution fell out of the map, popups were unstyled, and `<ml-map>` warned that the CSS was missing); `Map` and `FullPageMap` now load it as page CSS, so it survives navigation in dev as it already did in builds.
- 6750a12: The npm READMEs are rewritten for 0.8 as short orientations that match the docs site: what the package is, how to install it, one working example per way of using it (copied from the docs and run as printed), the main features, supported versions, and links to the docs pages for everything else. The core README now pins the CDN example to `@maplibre-yaml/core@0.8`, uses the `MapRenderer.fromModel` API the docs teach, covers `<ml-scrollytelling>`, `base`, slots and the on-page error card, and includes maplibre-gl 6's `setWorkerUrl` bundler setup (the effects README and guide gained it too: without it, an effects page built with Vite failed with _Worker failed to load_). The CLI README explains when `npx maplibre-yaml`, `npx @maplibre-yaml/cli` and `mlym` work. Each package's `homepage` now points at its docs page, and the descriptions and keywords say what the package does.

## 0.5.1

### Patch Changes

- a6ced0f: `loadMapConfig`, `loadScrollytellingConfig` and `loadFromGlob` validation errors now say where the problem is. The `astro dev` error overlay used to show only "Expected array, got undefined" with an empty stack; it now shows the file, the failing field with its line and column, and any parser warning on the same object, for example `./src/stories/trip.yaml: chapters.2.center: Expected array, got undefined (line 78, column 5). Warning: chapters.2.centre: Unknown key "centre". Did you mean "center"?`, with a code frame of the YAML line (Astro 4–7). `astro build` prints every error and warning. Each entry of `YAMLLoadError.errors` now carries that self-describing `message`; its `path`, `line` and `column` are unchanged, core's original wording is in the new `reason` field, and the entry type is exported as `YAMLLoadIssue`.

## 0.5.0

### Minor Changes

- 674351b: `@maplibre-yaml/astro` now supports Astro 6 and 7 as well as 4 and 5. The peer range is `^4 || ^5 || ^6 || ^7`, and CI builds and browser-tests the example site (`examples/astro/site`) on each of those majors. On Astro 6 and 7, every content-collection schema helper failed the build with "keyValidator._parse is not a function". Those versions ship zod 4, and the helpers were zod 3 schemas. The two cannot nest inside each other. The helpers (`LocationPointSchema`, `getCollectionItemWith*Schema`, `FeatureRefSchema`, `getMapSchema`, `extendSchema` and the rest) are now built from `astro/zod`, the zod your Astro version uses, so they nest inside your own `z.object()` on every major. `getMapSchema()`, `getScrollytellingSchema()`, `getChapterSchema()` and `getSimpleMapSchema()` are now typed `z.ZodType<…>` rather than core's zod-3 object types, and `extendSchema()` returns a schema typed with both halves. `zod` is no longer a runtime dependency.

  `<Scrollytelling src>` now works. Its loader used to import `@maplibre-yaml/core` by a bare specifier from an inline script, so every runtime story stayed on "Loading story...". The loader and the scroll controller are now one bundled script. Runtime-loaded chapters get the chapter styles, the story theme and the marker rail. Every chapter action the schema accepts now runs. `flyTo`, `easeTo` and `fitBounds` used to validate and do nothing. They now move the camera. `custom` dispatches an `ml-scrollytelling:action` event for your page to handle. Each chapter change dispatches `ml-scrollytelling:chapter`, and the container carries `data-active-chapter`. `rotateAnimation`, `spinGlobe`, the chapter `callback` (passed in that event) and the block's `className` and `style` now work too. The chapter-marker buttons used to render unstyled. They now render correctly.

  `Map`, `FullPageMap` and `Scrollytelling` now forward corner slots to `<ml-map>`. Write `<Map config={c}><p slot="top-left">…</p></Map>` and the content lands in that map corner. The `legend` slot also works. Before, Astro consumed the `slot` attribute itself, and the content never reached the map.

- 536742f: maplibre-gl 6 is now supported: the `maplibre-gl` peer range is `^3.0.0 || ^4.0.0 || ^5.0.0 || ^6.4.1` (core), `^4.0.0 || ^5.0.0 || ^6.4.1` (astro) and `^5.0.0 || ^6.4.1` (effects), so `npm install @maplibre-yaml/core maplibre-gl` no longer hits a peer conflict now that v6 is npm's `latest`. The v6 range starts at 6.4.1 because that is the first release patched for GHSA-jrc7-96c5-q579 (MapLibre's attribution sanitizer), and v6 is the recommended line for new projects; v4 and v5 keep working unchanged and stay in CI next to v6. v6 is ESM-only, so the documented import maps now point at `https://unpkg.com/maplibre-gl@6/dist/maplibre-gl.mjs` (with the CSS on `@6`), and under a bundler MapLibre needs to be told where its worker is: the `@maplibre-yaml/astro` components do that themselves, core exports `setWorkerModuleUrl()` from `@maplibre-yaml/core/maplibre` (a no-op before v6, and it never overrides a URL you set), and a map whose worker fails to load now says how to fix it in its `ml-map:error`. Map `error` events reach `onError` as real `Error` objects on every major (v6 reports plain `{ message }` objects), core no longer triggers a `"default" is not exported` warning in v6 builds, and the effects backend keeps its wall texturing seamless on v6, whose re-encoded overzoom tiles move vertices by a few units.
- d90d219: `<ml-map>` gains named slots: a child with `slot="top-left" | "top-right" | "bottom-left" | "bottom-right"` is mounted into that corner of the map on load, stacking with the built-in legend and params panel instead of overlapping them, and `slot="legend"` replaces the built-in legend. The element also stops wiping its children when it renders or shows an error card; it now removes only its own map container and error card. Slot children, the inline `<script type="text/yaml">` and any other author markup survive `reload()`, a config change, and an error-then-fix cycle. As a result, `reload()` now works for inline-YAML documents, where the script used to be destroyed on first render. If you placed non-slot content inside `<ml-map>` expecting it to be cleared, it now stays. `FullPageMap`'s zoom/reset buttons and legend now work. They previously read a `.map` property the element never had. The buttons ride the `top-right` slot, and `showLegend` now adds core's legend (a default `legend:` at `legendPosition` when a `config` document has none). With `src`, the document is loaded by `<ml-map>` itself, and `showLegend` has no effect, so declare `legend:` in the YAML.

### Patch Changes

- 87e80b6: `<Map src>` and `<Scrollytelling config>` now work in a real browser. Before, `<Map src>` never loaded: its inline loader imported `@maplibre-yaml/core` by a bare specifier that browsers cannot resolve, so the map showed "No configuration provided". `Map` now passes `src` straight to `<ml-map src>`, which fetches, validates and shows its own error card. `Scrollytelling` with `config` never drove the map: it waited for a `config` attribute it only set afterwards, read a `.map` property `<ml-map>` does not have, and would have set an invalid document. It now renders the story's map onto `<ml-map>` and waits on `mapReady()`. Chapters now overlay the sticky map. Before, the mouse wheel zoomed the map instead of scrolling the story, links and videos inside chapters could not be clicked, and `debug` outlines never showed.

## 0.4.1

### Patch Changes

- be31545: Fix the Astro loader's `!html` handling by importing core's canonical
  `YAML_PARSE_OPTIONS` (ml-0fg, PR #74). The loader carried a drifted copy of the
  parse options that had `merge` but not the `!html` tag, so `label: !html "<b>Bold</b>"`
  resolved to the `{ $html }` marker through core but to a bare string through
  Astro's `loadYAML`/`loadFromGlob`; the loader now imports the canonical options
  and the two read paths agree.
- d42afe8: `buildPolygonMapConfig` (and everything built on its region layers) now
  renders its outline. The `region-outline` layer referenced `"region-fill"`
  as its source — a _layer_ id, not a source name (the renderer names a
  layer's inline source `<layerId>-source`), so the reference resolved
  against nothing and the outline silently never drew. Both layers now carry
  their own inline source. Found by the astro release-gate smoke the moment
  renderer errors became loud.

## 0.4.0

### Minor Changes

- 328661a: Add the v2 internal model, enable YAML merge keys, and accept `state:`/`parameters:`.

  **YAML-native reuse.** Merge keys (`<<: *base`) now resolve, at every map-document parse site in core and in the Astro loader. Previously the `<<` key survived parsing as a literal, so the anchored content never merged and the stray key tripped unknown-key validation — a silent wrong answer for standard YAML. Anchors and aliases already worked and are now documented, in a new "Reusing values and blocks" guide covering the shallow-merge behavior that surprises people.

  Merge fan-out is bounded. The YAML library's alias-expansion budget does not count merge keys, so enabling them opened an expansion vector: measured, a 338-byte document took 13 seconds and grew exponentially. Fan-out is now refused in both spellings — a sequence value (`<<: [*a, *b]`) and the merge key repeated in one mapping — while single-alias chains, which are linear and are what the guide teaches, stay legal to any depth.

  **`state:` and `parameters:` are authorable** at the document root, where format v2 places them, so early adopters have nothing to move later. `state` is a style-spec root property that compiles through; `parameters` carries the label/type/range metadata a control UI needs and does not. `global-state` is registered as a known expression operator — without it the first document to use the feature would warn on every expression, and `mlym validate` promotes warnings to errors under CI.

  **A new internal model** (`normalizeMapBlock` and friends, exported from the package root) splits a document into the half that compiles to `style.json` and the half that does not. `<ml-map>` renders through it. This is the shape the forthcoming `style.json` emitter is written against; it changes no rendering behavior.

  **Also fixed:** an anchor-expansion attack previously escaped `safeParse*` as an uncaught exception rather than returning errors, on every entry point including the one `mlym validate` and the preview server use — for an API whose contract is "returns errors, never throws", on the input class most likely to be hostile.

## 0.3.3

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

## 0.3.2

### Patch Changes

- 141d3f1: Widen the `@maplibre-yaml/core` peer range to span the whole 0.x line
  (`>=0.3.0 <1.0.0`).

  The range was enumerated major-by-major (`^0.2.0 || ^0.3.0`), so every
  core minor fell outside it. Changesets bumps a peer dependent to a new
  **major** whenever its peer moves out of range, which is how the 0.4.0
  release staged `@maplibre-yaml/astro` at 1.0.0 off nothing but a
  dependency update — a 1.0 the package is not ready to make. A range that
  covers 0.x keeps core's minors in range, so astro versions on its own
  changes from here rather than on core's.

  No behavior change: astro's code is untouched, and the published range
  still refuses a future core 1.0, which would be a real compatibility
  boundary.

## 0.3.1

### Patch Changes

- 255371e: Declare `zod` and `yaml` as runtime dependencies. Both are imported at runtime by the package's utils (`loader.ts`, the collection/feature-ref schemas) but were only listed in `devDependencies`, so the package broke under strict/isolated installs (pnpm without hoisting, Yarn PnP) that don't resolve them transitively through `@maplibre-yaml/core`. Ranges match core's (`zod ^3.23.0`, `yaml ^2.4.0`).

## 0.3.0

### Minor Changes

- afe9a22: Track `@maplibre-yaml/core` 0.3: the peer dependency range is now an explicit `^0.2.0 || ^0.3.0` (previously `workspace:^`, which forced spurious major bumps in the release tooling and pinned consumers to a single core minor at publish time). The astro package uses core's runtime-inheritance fixes shipped in 0.3.0.

### Patch Changes

- d87a7c5: Global config inheritance now actually flows into built map configs.

  **Astro map builders respect `globalConfig.defaultZoom`.** All six builders (`buildPointMapConfig`, `buildMultiPointMapConfig`, `buildPolygonMapConfig`, `buildRouteMapConfig`, `buildMultiPolygonMapConfig`, `buildMultiLineStringMapConfig`) previously hardcoded a zoom fallback (`zoom ?? location.zoom ?? 12`, or a literal `10`/`12`) that fired _before_ `resolveMapConfig` could apply the global default — so setting `defaultZoom` in your global config had no effect on built maps. Zoom now resolves as: explicit option > `location.zoom` (point builder) > `globalConfig.defaultZoom` > builder default. Behavior without a global config is unchanged: the builders' built-in defaults (12 for point/polygon, 10 for bounds-fitted builders) still apply as the last resort, so no existing call site starts throwing. `defaultCenter` and `defaultMapStyle` inheritance continue to be handled by core's `resolveMapConfig`, with explicit values always winning.

  **Core `resolveMapConfig` no longer uses an unsafe `as MapConfig` cast.** The return value is now structurally verified by TypeScript via narrowed locals after the missing-fields guard, so if a new required field is ever added to `MapConfig`, the resolver fails to compile instead of silently passing invalid data. Runtime behavior (resolution precedence, `ConfigResolutionError` on missing `mapStyle`/`center`/`zoom`) is unchanged.

- f716577: README corrections: fix the core JavaScript API example to use `YAMLParser.parseMapBlock` and the real `MapRenderer` constructor signature (`container, config, layers, options, sources`), replace the fictional `interactions:`/HTML-string popup format with the actual `interactive.click.popup` tag-array DSL, and fix the astro README scrollytelling example to use flat chapter `center`/`zoom` (matching `ChapterSchema`) instead of a nested `location:` object. Source `url` examples now use absolute URLs, which is what the schema validates.

## 0.2.1

### Patch Changes

- Republish of 0.2.0. The 0.2.0 manifest on npm shipped with unresolved `workspace:^` references in `peerDependencies` and `devDependencies` because the prior release went out via `npm publish` (which doesn't rewrite the workspace protocol). Consumers running `npm install @maplibre-yaml/astro@0.2.0` hit `EUNSUPPORTEDPROTOCOL`. 0.2.1 fixes the manifest by republishing via `pnpm publish`, which rewrites `workspace:^` to a concrete version. No behavior change vs 0.2.0; 0.2.0 has been deprecated on npm.

## 0.2.0

### Minor Changes

- 91b7eb4: Add GeoJSON feature references for collection items

  A new `feature_ref` field lets a collection item reference a feature in an external GeoJSON file (matched by `featureId` or `match: { property, equals }`) instead of inlining geometry coordinates in frontmatter. At build time, the loader reads the file, finds the matching feature, detects its geometry type, and dispatches to the existing point/polygon/route builders.

  ### New exports
  - `FeatureRefSchema` -- Zod schema for the `feature_ref` field
  - `FeatureRef` -- inferred type
  - `assertValidFeatureRef(ref)` -- validates the `featureId` XOR `match` constraint at build time
  - `InvalidFeatureRefError` -- error class thrown by `assertValidFeatureRef`; discriminable via `instanceof`
  - `getCollectionItemWithFeatureRefSchema(customFields?)` -- collection-helper factory enforcing mutual exclusivity of `feature_ref` with inline `location`/`region`/`route`
  - `buildFeatureMapConfig(options, globalConfig?)` -- async convenience builder for a single feature ref
  - `buildMapConfigFromEntry(data, globalConfig?, options?)` -- async helper that absorbs the per-page geometry-type dispatch chain (precedence: `feature_ref` > `region` > `route` > `locations` > `location` > `options.fallback`)
  - `buildMultiPolygonMapConfig(options, globalConfig?)` -- builder for `MultiPolygon` geometry that renders ALL polygons (not just the first)
  - `buildMultiLineStringMapConfig(options, globalConfig?)` -- builder for `MultiLineString` geometry that renders ALL segments
  - `loadFeatureFile(srcPath)` -- async file loader (lower-level primitive)
  - `findFeature(fc, ref)` -- pure feature-lookup helper (lower-level primitive)
  - `GeoJSONLoadError` -- error class with `filePath`, `errors`, and ES2022 `cause` support
  - `clearFeatureCache()` -- test-isolation helper

  ### Features
  - **mtime-aware cache**: editing the GeoJSON file in `astro dev` invalidates the cache on next page render, no server restart needed
  - **Lazy per-property index**: built on second access for properties on files with 200+ features
  - **Full multi-geometry support**: all five geometry types (`Point`, `MultiPoint`, `LineString`, `MultiLineString`, `Polygon`, `MultiPolygon`) render fully via dedicated builders -- multi-types use `MultiPolygon`/`MultiLineString` GeoJSON Features so all rings/segments appear, not just the first
  - **GeometryCollection support**: single-member collections dispatch to the inner geometry; multi-member collections throw a clear error directing users to split into separate features
  - **Entry helper**: `buildMapConfigFromEntry(data, globalConfig?, options?)` collapses the per-page dispatch chain (`feature_ref` > `region` > `route` > `locations` > `location` > fallback) into a single async call
  - **Override precedence**: frontmatter `name`/`description`/styles win over `feature.properties`. The entry helper's `options.label` and `options.description` fill in when geometry's own fields are unset.
  - **Build-time only**: when invoked outside a build context (e.g., a deployed serverless adapter), `loadFeatureFile`'s ENOENT path detects common serverless cwd patterns and includes deployment-context hints in the error message
  - **Forward-compatible**: schema does not lock down future compound match shapes (`all`/`any`/`in`); error class accepts ES2022 `cause`; cache is private and swappable for V2 runtime resolution

  ### Hardening (post code-review)

  After a multi-agent code review surfaced 9 P1 issues, the following hardening landed before merge:
  - **Path traversal protection**: relative `feature_ref.source` paths that escape the project root via `..` are rejected before any filesystem I/O. Symlinks that live inside the project root but point OUTSIDE it are also rejected, with a post-realpath containment re-check that catches the bypass where a symlink-internal path passes the pre-realpath check but resolves outward. Absolute paths are now **rejected by default** -- pass `{ allowAbsolutePaths: true }` in `FeatureLoadOptions` for trusted callers (tests, monorepo data, controlled scripts). This secures the schema for UGC contexts where frontmatter values are not author-controlled.
  - **File-size cap**: files exceeding 100MB throw a clear error before `readFile`; files between 50MB and 100MB log a warning. Prevents OOM on memory-constrained CI runners.
  - **Symlink canonicalization**: cache key uses `realpath` so symlinks pointing at the same file share a single cache entry and the lazy property index works correctly across them.
  - **Concurrent-load dedupe**: parallel `loadFeatureFile` calls for the same file share an in-flight Promise, preventing double-parse of large files under parallel page builds.
  - **Cache-mutation safety**: `dispatchByGeometry` uses a `to2D` helper that allocates fresh tuples, so downstream mutation of returned `MapBlock` coordinates cannot poison the cached `FeatureCollection`.
  - **Z-coordinate handling**: GeoJSON 3D positions (`[lng, lat, altitude]`) are explicitly projected to 2D via `to2D` instead of unsound `as [number, number]` casts. Switch statement now ends with an exhaustiveness check that catches new geometry types at compile time.
  - **Degenerate-line validation**: `LineString` features with fewer than 2 coordinates and `MultiLineString` features with degenerate segments throw clear errors instead of producing invalid output.
  - **Error class for assertion**: `assertValidFeatureRef` now throws `InvalidFeatureRefError` (discriminable subclass) instead of plain `Error`.
  - **Removed**: vestigial `INTERNAL_ALLOW_RUNTIME` mutable module-level flag and the `_setInternalAllowRuntime` setter (V2 runtime resolution should ship as a separate builder, not via global mode switch).
  - **Removed**: vestigial `padding` field from `MultiLineStringMapOptions` (declared but never consumed).

  ### Internal cleanup (post code-review, P2 batch)

  Lower-priority code-review findings that landed in the same PR:
  - **`FeatureLoadOptions` (new)**: exported from `@maplibre-yaml/astro` and `/utils`. Threaded through `loadFeatureFile`, `buildFeatureMapConfig`, and `buildMapConfigFromEntry`. Two fields:
    - `projectRoot?: string` — override the boundary used for relative-path resolution and containment checks. Defaults to `process.cwd()`. Use this in monorepos when the build runs from a different directory than the Astro project root. The root is canonicalized via `realpath` so macOS `/var` → `/private/var` and similar symlinked-workspace shapes are handled.
    - `allowAbsolutePaths?: boolean` — opt-in to accept absolute `source` values. Defaults to `false`. Trusted callers can opt in; do NOT enable when frontmatter comes from untrusted content.
  - **`InvalidFeatureRefError` discrimination preserved**: `buildFeatureMapConfig` no longer wraps the XOR-violation error in `GeoJSONLoadError`. Callers can now correctly check `err instanceof InvalidFeatureRefError`, matching the contract advertised on the class.
  - **Irrelevant style-override warnings**: when a `feature_ref` sets a style field that doesn't apply to the resolved geometry (e.g., `markerColor` on a Polygon, `fillColor` on a Point), `buildFeatureMapConfig` now emits a deduplicated `console.warn` so authors can fix the mistake. Silent ignore-and-drop behavior is gone.

  - **YAMLLoadError parity**: `YAMLLoadError` now accepts an ES2022 `cause` field for parity with `GeoJSONLoadError`. Both classes still satisfy the same forward-compat constraint (#4): a shared base class can be introduced later without breaking the `cause` contract. All `YAMLLoadError` throw sites in `loader.ts` now thread `{ cause: error }` so the original parse/IO error is preserved as `.cause`.
  - **Stable cache debug interface**: `_getCacheEntryDebug` now returns a `CacheDebugSnapshot` (with `mtimeMs`, `indexedPropertyCount`, `hasIndexForProperty()`, `indexSizeFor()`, `accessCountFor()`) instead of the raw `CacheEntry`. Tests no longer assert on internal Map shapes -- swapping the cache storage in V2 stays internal.
  - **Schema XOR vs builder precedence**: documented that `getCollectionItemWithFeatureRefSchema`'s strict XOR check and `buildMapConfigFromEntry`'s precedence chain are intentionally different. Schema-strict is for opt-in authors who want early errors in `astro dev`; the precedence chain serves callers using the basic `getCollectionItemSchema` or rolling their own.
  - **Style-field dedupe**: introduced `PointStyleFields`, `PolygonStyleFields`, `LineStyleFields` in `collections-schemas.ts` as single source of truth. `LocationPointSchema`, `RegionPolygonSchema`, `RouteLineSchema`, and `FeatureRefSchema` all spread these now -- adding a new style field (e.g., `lineDashArray`) is a one-place edit. The `MultiRegionPolygon` and `MultiRouteLine` TS interfaces extend `Omit<RegionPolygon | RouteLine, "coordinates">` so they pick up new style fields automatically.
  - **Builder body dedupe**: extracted `buildPopupContent`, `buildPolygonLayers`, and `buildRouteLayers` as internal helpers. `buildPolygonMapConfig` + `buildMultiPolygonMapConfig` and `buildRouteMapConfig` + `buildMultiLineStringMapConfig` now share their layer construction (-~250 LOC). Public function signatures, output shape, and `MapBlock` `layers[]` structure are unchanged -- existing snapshot tests pass.

  ### Deferred (tracked as pending todos)
  - **P2-024**: `as`-casts in test files indicate weak public layer types. Fixing requires a typed-test-helper module and a substantial test rewrite (~20 sites). Tracked for a follow-up PR.
  - **P2-025**: The module-level `fileCache` has no eviction policy. Bounded growth is fine for build (process exits) but accumulates in `astro dev` sessions referencing many distinct files. `clearFeatureCache()` is the existing escape hatch. LRU/size-cap implementation tracked for a follow-up PR if growth becomes observable in practice.
  - **P2-026**: Large MultiPolygon/MultiLineString MapBlocks serialize into the `<ml-map>` HTML attribute; the right place to warn is the rendering component, not the builder utilities. Tracked for a follow-up PR alongside any other component-side telemetry.
  - **P3-028**: Grouped minor polish items (typos, JSDoc nits, etc.). Tracked for a follow-up PR.

  ### Documentation
  - New "GeoJSON Feature References" section in `packages/astro/README.md`
  - New section in `docs/src/content/docs/integrations/astro.mdx` with quick start, match strategies, performance budget, and HMR caveats
  - New guidance: when importing schemas in `src/content/config.ts`, use `@maplibre-yaml/astro/utils` rather than `@maplibre-yaml/astro`. The main entry re-exports Astro components which can't be loaded outside the component pipeline; the `/utils` subpath is safe in any Node context. All existing content-config examples in the README and docs site are updated to follow this convention.

## 0.1.3

### Patch Changes

- c24084a: Fix maplibre-gl v5 compatibility and peer dependency ranges

  ### Bug fixes
  - **`@maplibre-yaml/core`**: replaced default imports of `maplibre-gl` with named imports in `map-renderer`, `controls-manager`, and `event-handler`. maplibre-gl v5 removed the default export, which caused `SyntaxError: The requested module 'maplibre-gl' does not provide an export named 'default'` for consumers on v5. Named imports work for both v4 and v5.
  - **`@maplibre-yaml/core`**: widened `maplibre-gl` peer range from `^3.0.0 || ^4.0.0` to `^3.0.0 || ^4.0.0 || ^5.0.0`.
  - **`@maplibre-yaml/astro`**: peer dependency on `@maplibre-yaml/core` was pinned to the exact version `0.1.3-beta.1` because of `workspace:*` resolution at publish time. Changed to `workspace:^` so it resolves to a caret range (`^0.2.0`) and accepts current and future minor versions of core.
  - **`@maplibre-yaml/astro`**: widened `maplibre-gl` peer range from `^4.0.0` to `^4.0.0 || ^5.0.0`.

  These changes resolve `ERESOLVE` errors, `unmet peer dependency` warnings, and the `register.js` syntax error for projects using maplibre-gl v5.

- Updated dependencies [c24084a]
  - @maplibre-yaml/core@0.2.1

## 1.0.0

### Patch Changes

- Updated dependencies [937738a]
  - @maplibre-yaml/core@0.2.0

## 0.1.1

### Patch Changes

- Fix HTMLElement SSR crash by moving custom element registration from Astro frontmatter to client-side script tag. Add global config inheritance, map builder, and geographic collection schema documentation.

  ### Bug Fix
  - **Fix `ReferenceError: HTMLElement is not defined` during Astro SSR** — The `Map`, `FullPageMap`, and `Scrollytelling` components previously imported `@maplibre-yaml/core/register` in their frontmatter, which runs server-side where `HTMLElement` does not exist. Registration is now handled via a bundled `<script>` tag that only executes in the browser.

  ### Documentation
  - Added Global Configuration guide with `loadGlobalMapConfig` pattern
  - Added guide for adding geographic data (points, polygons, lines) to existing content collections using `LocationPointSchema`, `RegionPolygonSchema`, and `RouteLineSchema`
  - Added dynamic map-per-collection-item example with geometry type detection
  - Added troubleshooting entries for common Astro integration gotchas
  - Updated map builder examples to show `globalConfig` usage

## 0.1.0

### Patch Changes

- Updated dependencies [e7e1126]
  - @maplibre-yaml/core@0.1.0
