# @maplibre-yaml/astro — minimal example

A bare Astro app demonstrating `@maplibre-yaml/astro` with the smallest possible surface area: no React, no UI kit, no styling framework, no extra Astro integrations. Just the API.

## What it covers

| Page | Demonstrates |
|---|---|
| [`/`](http://localhost:4321) | Landing page and navigation |
| [`/showcase`](http://localhost:4321/showcase) | One runnable example per GeoJSON geometry type (Point, MultiPoint, LineString, MultiLineString, Polygon, MultiPolygon, GeometryCollection), plus match-by-property, display overrides, the ignored-style-override warning, and the common error paths |
| [`/poas/sample`](http://localhost:4321/poas/sample) | Content-collection entry with `feature_ref` in frontmatter, rendered via `buildMapConfigFromEntry` |

## Run locally

```bash
cd examples/astro/minimal
pnpm install
pnpm dev
```

Open <http://localhost:4321>.

## Files

| Path | Purpose |
|---|---|
| `astro.config.mjs` | Astro config — no integrations |
| `src/layouts/Layout.astro` | Single layout with `<slot />`, plain CSS, top nav |
| `src/styles/global.css` | All styling — plain CSS, no framework |
| `src/config/maps.yaml` | Global map config (style URL, default center/zoom) |
| `src/lib/map-config.ts` | Loads the global config at build time |
| `src/data/sample.geojson` | One feature per GeoJSON geometry type, plus a few edge cases |
| `src/content.config.ts` | Content collection using `getCollectionItemWithFeatureRefSchema` |
| `src/content/poas/sample.md` | Example markdown entry with a `feature_ref` |
| `src/pages/index.astro` | Landing page with links |
| `src/pages/showcase.astro` | Geometry-type and feature walkthrough |
| `src/pages/poas/[slug].astro` | Dynamic content-collection renderer |

## Trying error paths

`src/pages/showcase.astro` includes a block of commented-out `error*` ref declarations. Each one demonstrates a distinct failure mode with the expected error message in a `//` comment above it. To see one in action:

1. Uncomment a single `error*` const
2. Add a matching `await buildFeatureMapConfig({ ref: errorMultiGeomColl }, globalMapConfig)` line (the ref name varies) somewhere in the frontmatter
3. Save — the dev server overlay shows the documented error
4. Revert the change

Covered: missing file, missing feature, path traversal, absolute-path opt-in default, mutual-exclusivity (`InvalidFeatureRefError`), degenerate `LineString`, and heterogeneous `GeometryCollection`.
