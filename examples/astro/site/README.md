# Ring of Fire — the `@maplibre-yaml/astro` example site

A small Astro site about the Pacific's volcanoes, built only from YAML map
documents and the `@maplibre-yaml/astro` components. It is also the
integration's release check: CI builds it and drives it in a browser on every
supported Astro major (4, 5, 6 and 7).

| Page | Shows |
|---|---|
| `/` | `<Map config>` from `loadMapConfig`, `<Map src>` (runtime), corner slots |
| `/explore` | `<FullPageMap>`: zoom/reset controls, `showLegend`, markers, a parameters panel, hover popups, a slotted caption |
| `/story` | `<Scrollytelling config>`: chapters move the camera, toggle layers, run `setFilter` / `setPaintProperty` / `fitBounds` / `flyTo` / `custom` actions |
| `/story-runtime` | `<Scrollytelling src>`: the story is fetched and validated in the browser |
| `/volcanoes` | A Markdown content collection (`glob()` + `LocationPointSchema`); one page per entry via `buildMapConfigFromEntry` |
| `/gallery` | A YAML content collection of whole map documents (`extendSchema(getMapSchema(), …)`) |

## Run it

From the repository root:

```bash
pnpm install
pnpm build
pnpm --filter @maplibre-yaml/example-astro-site dev
```

The workspace copy runs on Astro 5. To build and test it on another major the
way CI does (packed tarballs, an npm install outside the workspace, then
`astro check`, `astro build`, Playwright against `astro preview`, and a smoke
test under `astro dev`):

```bash
node scripts/astro-matrix.mjs --majors 7      # or 4,5,6,7
```

The Playwright suite is `e2e/site.spec.ts`. It stubs the basemap style so CI
never depends on a tile server; set `ASTRO_SITE_LIVE_TILES=1` to see the real
basemap.

## Files worth reading

| Path | What it shows |
|---|---|
| `src/content.config.ts` | Collections that work on Astro 4–7: `z` from `astro/zod`, `glob()` bases outside `src/content/`, `generateId` |
| `src/content/config.ts` | The one-line re-export Astro 4 needs |
| `astro.config.mjs` | The Astro 4 `contentLayer` flag, switched on by version |
| `src/maps/*.yaml` | Build-time map documents |
| `public/maps/`, `public/stories/` | Runtime (`src`) documents |
| `src/stories/ring-of-fire.yaml` | A story that uses every chapter action |

Basemaps are [OpenFreeMap](https://openfreemap.org) styles. Volcano positions
are approximate. Eruption years are from the Smithsonian Global Volcanism
Program.
