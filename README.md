# maplibre-yaml

Declarative [MapLibre](https://maplibre.org/) web maps from YAML. Describe a
map (basemap, data, layers, popups, legend) or a scroll-driven story map in a
YAML file and put it on a page with one HTML element, from a CDN with no
build step, or with Astro components. Made for anyone who wants a working
map without writing map code: writers and journalists, researchers,
developers prototyping a map, and people learning web mapping.

[![npm](https://img.shields.io/npm/v/@maplibre-yaml/core.svg)](https://www.npmjs.com/package/@maplibre-yaml/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**Documentation: [docs.maplibre-yaml.org](https://docs.maplibre-yaml.org)**

## Quick start

`index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
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

`map.yaml`, next to it:

```yaml
type: map
id: my-map
config:
  center: [-90, 38]
  zoom: 3.5
  mapStyle: "https://tiles.openfreemap.org/styles/liberty"
layers:
  - id: rivers
    type: line
    source:
      type: geojson
      url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_rivers_lake_centerlines.geojson"
    paint:
      line-color: "#2563eb"
      line-width: 2
```

Serve the folder (`npx serve .`) and open the address it prints. Or let the
CLI write both files: `npx maplibre-yaml init my-map`.

In Astro:

```astro
---
import { Map } from '@maplibre-yaml/astro';
---
<Map src="/configs/hero-map.yaml" height="500px" />
```

## Packages

| Package | What it is |
| --- | --- |
| [`@maplibre-yaml/core`](https://www.npmjs.com/package/@maplibre-yaml/core) | The engine: `<ml-map>` and `<ml-scrollytelling>` web components, YAML parser, schemas, renderer |
| [`@maplibre-yaml/astro`](https://www.npmjs.com/package/@maplibre-yaml/astro) | Astro components (`Map`, `FullPageMap`, `Scrollytelling`), loaders, content-collection helpers |
| [`@maplibre-yaml/cli`](https://www.npmjs.com/package/@maplibre-yaml/cli) | `init`, `validate`, `preview`, `emit` (export to `style.json`), `schema` |
| [`maplibre-yaml`](https://www.npmjs.com/package/maplibre-yaml) | Runs the CLI as `npx maplibre-yaml …` |
| [`@maplibre-yaml/effects`](https://www.npmjs.com/package/@maplibre-yaml/effects) | Shader effects on 3D buildings (experimental) |

## Features

- **Maps from YAML:** every MapLibre layer type, GeoJSON and tile sources,
  popups, hover, markers, legends, a parameters panel. Works with maplibre-gl
  4, 5 and 6.
- **Thematic maps:** a layer's `classify:` block makes a choropleth,
  graduated circles or a category map, with a legend generated for it.
- **Large data, YAML only:** PMTiles, FlatGeobuf, GeoParquet and Cloud
  Optimized GeoTIFF files read in parts from any static host, and a whole
  Protomaps basemap from one `.pmtiles` file, with no API key.
- **Accessible and translatable:** `title:`/`description:` for screen
  readers, and `locale:` for every piece of text the library draws.
- **Story maps:** `<ml-scrollytelling>` turns a `type: scrollytelling` YAML
  file into a scroll-driven story, in a plain HTML page or in Astro.
- **Live data:** polling, Server-Sent Events and WebSocket updates.
- **Mistakes explained on the page:** error cards with line numbers and
  did-you-mean hints, a notice for a layer or file that didn't load, and
  author hints while you develop (or anywhere with `debug`).
- **Export:** `emit` writes a standalone MapLibre `style.json`
  ([export classes](https://docs.maplibre-yaml.org/guides/export-classes/)).
- **Examples:** the [MapLibre example gallery](https://docs.maplibre-yaml.org/examples/gallery/)
  rebuilt in maplibre-yaml, each marked YAML, YAML + JavaScript or YAML + plugin.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm presubmit   # build, typecheck, lint, test, docs snippet check
```

See [CONTRIBUTING.md](https://github.com/design-practices/maplibre-yaml/blob/main/CONTRIBUTING.md).
Releases go through [changesets](https://github.com/changesets/changesets).

## License

MIT
