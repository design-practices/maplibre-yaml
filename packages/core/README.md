# @maplibre-yaml/core

Declarative [MapLibre](https://maplibre.org/) web maps from YAML. Describe the
map (basemap, data, layers, popups, legend) in a YAML file and the `<ml-map>`
web component renders it in any HTML page: from a CDN with no build step, or
from npm with a bundler. The same package defines `<ml-scrollytelling>` for
scroll-driven story maps, and exports the parser, schemas and renderer.

[![npm version](https://img.shields.io/npm/v/@maplibre-yaml/core.svg)](https://www.npmjs.com/package/@maplibre-yaml/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**Documentation: [docs.maplibre-yaml.org](https://docs.maplibre-yaml.org)** ·
[Choose your path](https://docs.maplibre-yaml.org/getting-started/) (an HTML page, an Astro site,
a story map, a thematic map, large data)

## Quick start: a plain HTML page, no install

`index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <!-- Without this line, phones lay the page out at desktop width and the map looks tiny -->
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>My map</title>
    <link
      href="https://unpkg.com/maplibre-gl@6/dist/maplibre-gl.css"
      rel="stylesheet"
    />
    <style>
      ml-map {
        display: block;
        height: 400px;
      }
    </style>
    <!-- Tell the browser where to find maplibre-gl -->
    <script type="importmap">
      { "imports": { "maplibre-gl": "https://unpkg.com/maplibre-gl@6/dist/maplibre-gl.mjs" } }
    </script>
    <!-- Register the <ml-map> web component -->
    <script
      type="module"
      src="https://unpkg.com/@maplibre-yaml/core@0.9/register.js"
    ></script>
  </head>
  <body>
    <ml-map src="./map.yaml"></ml-map>
  </body>
</html>
```

`map.yaml`, in the same folder:

```yaml
type: map
id: earthquake-map
config:
  center: [-120, 37]
  zoom: 5
  mapStyle: "https://tiles.openfreemap.org/styles/liberty"
layers:
  - id: earthquakes
    type: circle
    source:
      type: geojson
      url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson"
    paint:
      circle-radius: 6
      circle-color: "#e74c3c"
      circle-stroke-width: 1
      circle-stroke-color: "#ffffff"
```

Serve the folder (`npx serve .`) and open the address it prints. A page opened
from disk (`file://`) cannot fetch the YAML. The number after `core@` names a
release line: the address loads the newest release in that line. Walkthrough: [Quick start](https://docs.maplibre-yaml.org/getting-started/quick-start/).
Publishing it on GitHub Pages: [Publishing & subpaths](https://docs.maplibre-yaml.org/guides/publishing/).

## With npm and a bundler

```bash
npm install @maplibre-yaml/core maplibre-gl@^6
```

In your entry file (Vite shown), register the element, load MapLibre's CSS and,
on maplibre-gl 6, tell MapLibre where its worker is. Without the worker lines
every map fails with *Worker failed to load*; on maplibre-gl 4 or 5, leave
them out.

```javascript
// src/main.js
import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "@maplibre-yaml/core/register";
import "maplibre-gl/dist/maplibre-gl.css";

setWorkerUrl(workerUrl);
```

Then `<ml-map src="./map.yaml" style="display: block; height: 400px;"></ml-map>`
in your HTML, with `map.yaml` and its data files in `public/`. See
[Installation](https://docs.maplibre-yaml.org/getting-started/installation/#using-a-bundler-vite).

## Story maps: `<ml-scrollytelling>`

The same register script defines `<ml-scrollytelling>`, which shows a
`type: scrollytelling` document as a story: a sticky map with chapter cards
scrolling over it, moving the camera, toggling layers and running actions.
On the page above, from the CDN:

```html
<ml-scrollytelling src="story.yaml"></ml-scrollytelling>
```

A complete page and story: [Story maps in plain HTML](https://docs.maplibre-yaml.org/integrations/scrollytelling-html/).

## JavaScript API

Parse and render without the element, into a `<div id="map">` with a height:

```javascript
// src/main.js
import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { YAMLParser, MapRenderer, toModel } from "@maplibre-yaml/core";
import "maplibre-gl/dist/maplibre-gl.css";

setWorkerUrl(workerUrl);

const response = await fetch("./map.yaml");
const result = YAMLParser.safeParseMapBlock(await response.text());
if (result.success) {
  MapRenderer.fromModel(document.getElementById("map"), toModel(result.data));
} else {
  console.error("Configuration errors:", result.errors);
}
```

From a CDN, import it from `https://esm.sh/@maplibre-yaml/core@0.9?external=maplibre-gl`.
See [Vanilla JavaScript](https://docs.maplibre-yaml.org/integrations/vanilla-js/)
and the [TypeScript API reference](https://docs.maplibre-yaml.org/reference/api/maplibre-yaml/core/).

## Features

- **`<ml-map>`** takes its document as `src="map.yaml"`, an inline
  `<script type="text/yaml">`, or a `config` attribute/property. `mapReady()`
  resolves with the MapLibre map.
- **A changed document updates the map in place.** Assign a new `config`
  (or call `update(doc)`) and only what differs changes; the map, its camera
  and your own layers stay. `setState()` / `getState()` read and write the
  document's `state:` values, and `ml-map:update-applied`,
  `ml-map:update-rejected` and `ml-map:state-change` report what happened
  ([`<ml-map>` reference](https://docs.maplibre-yaml.org/reference/elements/)).
- **Slots** put your own markup in a corner of the map (`top-left`,
  `top-right`, `bottom-left`, `bottom-right`, or `legend` to replace the
  built-in legend).
- **`base`** for sites under a subpath (a GitHub Pages project site):
  `<ml-map src="maps/city.yaml" base="/my-repo/">` loads every path in the
  document from under `/my-repo/`. `<ml-scrollytelling>` takes it too.
- **Mistakes show on the page.** A document that cannot render shows an
  error card with line numbers and did-you-mean hints. A layer or data file
  that fails while the rest works is listed in a notice over the map.
  Author hints (did-you-mean, misplaced keys, swapped coordinates) join it
  only while you develop (`localhost`, a bundler dev build), or anywhere
  with the `debug` attribute. The `quiet` attribute hides the notice (the
  error card always shows).
- **Data:** GeoJSON (by URL or inline), vector and raster tiles, images and
  video, with polling, Server-Sent Events and WebSocket updates
  ([Live Data](https://docs.maplibre-yaml.org/guides/live-data/)).
- **Cloud-native data, YAML only:** PMTiles archives (`url: data/x.pmtiles`
  on a `vector`/`raster`/`raster-dem` source), FlatGeobuf files
  (`url: data/x.fgb`) and GeoParquet files (`url: data/x.parquet`) on a
  `geojson` source, and Cloud Optimized GeoTIFFs (`url: data/x.tif`) on a
  `raster`/`raster-dem` source, read with range requests and no page
  JavaScript; a whole Protomaps basemap from one `.pmtiles` file
  (`mapStyle: { pmtiles: data/x.pmtiles }`)
  ([Cloud-native data](https://docs.maplibre-yaml.org/guides/cloud-native-data/)).
- **Thematic maps:** a layer's `classify:` block makes a choropleth,
  graduated circles or a category map from your data, with breaks computed
  (quantile, equal interval, Jenks) or written, named colour palettes, and a
  legend generated for it
  ([Thematic maps](https://docs.maplibre-yaml.org/guides/thematic-maps/)).
- **Interactivity:** popups, hover states, markers, legends, a parameters
  panel, and Format v2 declarative interactions.
- **Accessible, translatable maps:** `title:` and `description:` name and
  describe the map for screen readers, `locale:` translates every piece of
  text the library draws, and popup numbers follow the page's language
  ([Accessibility & languages](https://docs.maplibre-yaml.org/guides/accessibility-languages/)).
- **Export:** `mlym emit` (from `@maplibre-yaml/cli`) turns a map document
  into a standalone MapLibre `style.json`; [export classes](https://docs.maplibre-yaml.org/guides/export-classes/)
  list what carries over.
- **Validation:** Zod schemas and JSON Schemas for editor completion
  ([Editor Setup](https://docs.maplibre-yaml.org/guides/editor-setup/)).

## Entry points

| Import | What it is |
| --- | --- |
| `@maplibre-yaml/core` | Parser, renderer, data utilities, types |
| `@maplibre-yaml/core/register` | Defines `<ml-map>` and `<ml-scrollytelling>` |
| `@maplibre-yaml/core/components` | The element classes, for manual registration |
| `@maplibre-yaml/core/schemas` | Zod schemas and inferred types |
| `@maplibre-yaml/core/scrollytelling` | The story engine without the element (DOM-free) |
| `@maplibre-yaml/core/scrollytelling.css` | The story stylesheet, for server-rendered stories |
| `@maplibre-yaml/core/maplibre` | The maplibre-gl module `<ml-map>` renders with (for `addProtocol` plugins) |
| `@maplibre-yaml/core/react` | JSX types for `<ml-map>` in React ([React](https://docs.maplibre-yaml.org/integrations/react/)) |
| `@maplibre-yaml/core/schemas/json/*` | JSON Schema files (`map.schema.json`, …) |
| `register.js` (CDN) | Browser bundle of `/register`, with `maplibre-gl` left to the import map. Format readers (PMTiles, FlatGeobuf, GeoParquet, COG) and the Protomaps basemap generator load on demand from `dist/chunks/`: to self-host, copy the whole `dist/` folder |

## Compatibility

- **maplibre-gl** 4, 5 and 6 (`>= 6.4.1`, recommended). Peer range
  `^3.0.0 || ^4.0.0 || ^5.0.0 || ^6.4.1`. Keep the CSS on the same major as
  the JavaScript. PMTiles sources need maplibre-gl 4 or later, COG sources 4.5 or later.
- Modern browsers (ES2022, ES modules, import maps for CDN use).

## More

- Docs: [HTML pages: the `<ml-map>` element](https://docs.maplibre-yaml.org/integrations/web-components/) ·
  [`<ml-map>` reference](https://docs.maplibre-yaml.org/reference/elements/) ·
  [YAML reference](https://docs.maplibre-yaml.org/reference/yaml/) ·
  [Examples gallery](https://docs.maplibre-yaml.org/examples/gallery/)
- Something wrong? [Troubleshooting](https://docs.maplibre-yaml.org/troubleshooting/) ·
  Coming from an older release? [Upgrading](https://docs.maplibre-yaml.org/getting-started/upgrading/)
- [`@maplibre-yaml/astro`](https://www.npmjs.com/package/@maplibre-yaml/astro): Astro components ·
  [`@maplibre-yaml/cli`](https://www.npmjs.com/package/@maplibre-yaml/cli): scaffold, validate, preview, export ·
  [`@maplibre-yaml/effects`](https://www.npmjs.com/package/@maplibre-yaml/effects): shader effects (experimental)

## License

MIT
