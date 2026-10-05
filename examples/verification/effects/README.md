# Effects demo + browser fixture (`@maplibre-yaml/effects`, experimental)

`index.html` is both the demo and the fixture `e2e/effects.spec.ts` drives
(demos-as-regression-tests): the crosshatch and blueprint classics over the
vendored lower-Manhattan tile fixture, with the `tonal-hatch` / `blueprint`
effects attached by `<ml-map>` once `@maplibre-yaml/effects/register` is
loaded.

```bash
pnpm --filter @maplibre-yaml/core build && pnpm --filter @maplibre-yaml/effects build
pnpm verify:serve            # or VERIFY_PORT=4201 pnpm verify:serve
open http://localhost:4174/examples/verification/effects/index.html
```

Query params: `doc=crosshatch|blueprint`, `fx=0` (no effects package: the
static fallback), `tiles=live` (OpenFreeMap instead of the fixture), and
`z`, `b`, `p`, `lng`, `lat` camera overrides. The HUD switches documents and
effect on/off, shows fps, and runs the tour (rotate 360°, zoom out to z14,
in to z17.5).

## Assets and attribution

| File | Source |
|---|---|
| `crosshatch/hatch-atlas.png` | tangrams/blocks `filter/imgs/hatch.png` — the 3×3 tonal hatch atlas (MIT), verbatim |
| `crosshatch/earth.png`, `landuse.png`, `building-fallback.png` | baked from tangrams/tangram-sandbox `styles/imgs/hatch_0.png` / `hatch_2.png` (crosshatch style by @patriciogv, 2015, MIT): ink-on-paper recolouring |
| `crosshatch/water.png` | baked from tangram-sandbox `styles/imgs/normal-0031.jpg` lit under the crosshatch style's fixed lights |
| `blueprint/grid.png` | generated drafting grid |
| `../data/omt/` | OpenStreetMap data (ODbL), see its README |

The bake scripts live on the U12 spike branch (`spike/07-u12-deck-hatch`,
`packages/spike-deck-hatch/scripts/bake-*.ts`); U10′ owns making them a
reproducible tool.
