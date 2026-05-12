# @maplibre-yaml/astro — minimal example

A bare Astro app demonstrating `@maplibre-yaml/astro` with the smallest possible surface area: no React, no UI kit, no styling framework, no extra Astro integrations. Just the API.

## What it covers

| Page | URL | Demonstrates |
|---|---|---|
| Landing | `/` | Index, navigation |
| Showcase | `/showcase` | Every GeoJSON geometry type via `buildFeatureMapConfig`. One section per scenario; matches the `testing-criteria-pr20.md` checklist |
| Content example | `/poas/sample` | Content-collection entry with `feature_ref` resolved by `buildMapConfigFromEntry` |

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
| `src/data/sample.geojson` | 11-feature fixture covering all geometry types + edge cases |
| `src/content.config.ts` | Content collection using `getCollectionItemWithFeatureRefSchema` |
| `src/content/poas/sample.md` | One example entry; demonstrates `feature_ref` precedence |
| `src/pages/index.astro` | Landing page with links |
| `src/pages/showcase.astro` | Per-scenario walkthrough |
| `src/pages/poas/[slug].astro` | Dynamic content-collection renderer |

## Testing error paths

`src/pages/showcase.astro` has a block of commented-out `errorRefs.*` declarations at the top. To exercise an error:

1. Uncomment one `error*Ref` const
2. Add `await buildFeatureMapConfig({ ref: errorMultiGeomColl }, globalMapConfig)` (or whichever ref name) anywhere in the frontmatter
3. Save — the dev server should reject with the documented error message
4. Revert before testing the next one

Scenarios covered: path traversal, absolute-path opt-in default, missing file, missing feature, both `featureId` and `match` (`InvalidFeatureRefError`), neither, degenerate `LineString`, heterogeneous `GeometryCollection`.
