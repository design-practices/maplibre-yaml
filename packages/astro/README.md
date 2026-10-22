# @maplibre-yaml/astro

Astro components for [maplibre-yaml](https://docs.maplibre-yaml.org): put a
YAML-defined MapLibre map or scroll-driven story map on an Astro page with
`<Map>`, `<FullPageMap>` and `<Scrollytelling>`. Load YAML in the browser from
`public/` or validate it at build time, and add maps to content collections
with schema helpers and map builders.

[![npm version](https://img.shields.io/npm/v/@maplibre-yaml/astro.svg)](https://www.npmjs.com/package/@maplibre-yaml/astro)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**Documentation: [docs.maplibre-yaml.org/integrations/astro](https://docs.maplibre-yaml.org/integrations/astro/)**

New project? [Quick start: Astro site on GitHub Pages](https://docs.maplibre-yaml.org/getting-started/astro/)
goes from an empty folder to a published site.

## Install

```bash
npm install @maplibre-yaml/astro @maplibre-yaml/core maplibre-gl@^6
```

The components load MapLibre's stylesheet and set maplibre-gl 6's worker URL
for you: there is no other setup.

## Quick start

`public/configs/hero-map.yaml`:

```yaml
type: map
id: hero-map
config:
  center: [-74.006, 40.7128]
  zoom: 12
  mapStyle: "https://tiles.openfreemap.org/styles/liberty"
layers:
  - id: marker
    type: circle
    source:
      type: geojson
      data:
        type: FeatureCollection
        features:
          - type: Feature
            geometry:
              type: Point
              coordinates: [-74.006, 40.7128]
            properties:
              name: "New York City"
    paint:
      circle-radius: 12
      circle-color: "#3b82f6"
      circle-stroke-width: 2
      circle-stroke-color: "#ffffff"
```

`src/pages/index.astro`:

```astro
---
import { Map } from '@maplibre-yaml/astro';
---

<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width" />
    <title>My map</title>
  </head>
  <body>
    <h1>Welcome</h1>
    <Map src="/configs/hero-map.yaml" height="500px" />
  </body>
</html>
```

`npm run dev` shows a street map of New York with a blue dot. A mistake in the
YAML shows an error card naming the field.

To validate at build time instead, so a broken map fails the build, load the
file in the frontmatter and pass `config`:

```astro
---
import { Map, loadMapConfig } from '@maplibre-yaml/astro';
const config = await loadMapConfig('./src/configs/map.yaml');
---
<Map config={config} height="600px" />
```

## Story maps

```astro
---
import { Scrollytelling, loadScrollytellingConfig } from '@maplibre-yaml/astro';
const story = await loadScrollytellingConfig('./src/stories/climate-change.yaml');
---
<Scrollytelling config={story} />
```

Or `<Scrollytelling src="/stories/cascadia.yaml" />` to load it from
`public/` in the browser. It renders core's `<ml-scrollytelling>`, so a story
file behaves the same here and in a plain HTML page.

## Features

- **`Map`**, **`FullPageMap`** (full viewport, zoom/reset controls, optional
  legend) and **`Scrollytelling`**, each from `src` or `config`. `Chapter`
  (from `@maplibre-yaml/astro/components`) lays out chapters by hand.
- **Corner slots:** `<Map src="…"><p slot="top-left">Caption</p></Map>`
  (`top-left`, `top-right`, `bottom-left`, `bottom-right`, `legend`).
- **GitHub Pages and other subpaths:** the components pass your site's
  `base` to the map, so `src` and the paths inside your YAML load from under
  it with no change. Relative paths in YAML mean "from `public/`" on every
  page; `base={false}` restores page-relative resolution for one map.
- **Content collections:** `getMapSchema()`, `LocationPointSchema` and the
  other schemas, map builders (`buildPointMapConfig`, `buildMapConfigFromEntry`,
  …) and `feature_ref` to point an entry at a feature in a GeoJSON file.
  Import schemas in `src/content.config.ts` from `@maplibre-yaml/astro/utils`:
  the main entry includes the components, which a content config cannot load.
- **Dev reload integration (optional):** add `maplibreYaml()` from
  `@maplibre-yaml/astro/integration` to `integrations` and `astro dev`
  reloads the page when a YAML or GeoJSON file the maps read changes.
- **Mistakes show on the page:** an error card for a document that can't be
  drawn, a notice for a layer or file that failed, and author hints
  (did-you-mean, misplaced keys) while you run `astro dev`. The `debug` prop
  shows the hints on a deployed site too; `quiet` hides the notice.
- **View transitions** (`<ClientRouter />`) and **effects**
  (`@maplibre-yaml/effects`) work with the components.

Two things to avoid: client directives (`client:only`, `client:load`) on these
components, which are Astro components, not framework islands; and importing
`@maplibre-yaml/core/register` in frontmatter (it needs the browser: put it
in a `<script>`).

## Compatibility

| | Supported |
| --- | --- |
| Astro | 4, 5, 6 and 7, each tested in CI (Astro 7 needs Node 22.23.4+, from Astro 7.4.2) |
| `@maplibre-yaml/core` | `>=0.9.0` (peer). Upgrade both packages together |
| maplibre-gl | 4, 5 and 6 (`>= 6.4.1`, recommended) |

On Astro 6 and 7, build collection schemas with `z` from `astro/zod`. Astro 4
needs a few content-layer settings: see
[Supported versions](https://docs.maplibre-yaml.org/integrations/astro/#supported-versions).

## Documentation

- [Quick start: Astro site on GitHub Pages](https://docs.maplibre-yaml.org/getting-started/astro/)
- [Astro](https://docs.maplibre-yaml.org/integrations/astro/):
  [component APIs](https://docs.maplibre-yaml.org/integrations/astro/#map-component-api),
  [deploying to GitHub Pages](https://docs.maplibre-yaml.org/integrations/astro/#deploying-to-github-pages-or-any-subpath),
  [editing in astro dev](https://docs.maplibre-yaml.org/integrations/astro/#editing-in-astro-dev),
  [GeoJSON feature references](https://docs.maplibre-yaml.org/integrations/astro/#geojson-feature-references),
  [troubleshooting](https://docs.maplibre-yaml.org/integrations/astro/#troubleshooting)
- [Story maps in Astro](https://docs.maplibre-yaml.org/integrations/astro-stories/) ·
  [Astro content collections](https://docs.maplibre-yaml.org/integrations/astro-collections/)
- [Publishing & subpaths](https://docs.maplibre-yaml.org/guides/publishing/) ·
  [Troubleshooting](https://docs.maplibre-yaml.org/troubleshooting/) ·
  [Upgrading](https://docs.maplibre-yaml.org/getting-started/upgrading/)
- [YAML reference](https://docs.maplibre-yaml.org/reference/yaml/) ·
  [Story file reference](https://docs.maplibre-yaml.org/schema/scrollytelling/)
- Runnable example site: [`examples/astro/site`](https://github.com/design-practices/maplibre-yaml/tree/main/examples/astro/site)

## Related packages

- [`@maplibre-yaml/core`](https://www.npmjs.com/package/@maplibre-yaml/core): the engine and the `<ml-map>` web component
- [`@maplibre-yaml/cli`](https://www.npmjs.com/package/@maplibre-yaml/cli): validate and preview YAML, export it to `style.json`

## License

MIT
