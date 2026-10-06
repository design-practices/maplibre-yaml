# @maplibre-yaml/effects

> **Experimental.** The API below may change in a minor release. Pin the version.

Shader effects for [maplibre-yaml](https://github.com/design-practices/maplibre-yaml)
documents. An effect is a named, parameterized shader that **enhances** an
ordinary layer: the document names it, page JavaScript registers it,
documents never carry GLSL. The layer it sits on is its fallback — rendered
as authored without this package, where an effect can't run (globe,
terrain, maplibre-gl 4), and in `mlym emit` output (one `lossy` warning per
effect).

Built in: **`tonal-hatch`** (the Mapzen/Tangram crosshatch: stroke density
follows light per face) and **`blueprint`** (a metre-scaled drafting grid),
both on `fill-extrusion` layers via the `extrusions` backend.

```bash
npm install @maplibre-yaml/core @maplibre-yaml/effects maplibre-gl
```

```js
import "@maplibre-yaml/core/register";
import "@maplibre-yaml/effects/register"; // built-ins + the <ml-map> hook
```

```yaml
type: map
id: blueprint
config:
  center: [-74.0118, 40.7075]
  zoom: 15.9
  pitch: 60
  mapStyle: "https://demotiles.maplibre.org/style.json"
sources:
  omt:
    type: vector
    url: "https://tiles.openfreemap.org/planet"
layers:
  - id: buildings
    type: fill-extrusion
    source: omt
    source-layer: building
    paint:
      fill-extrusion-color: "#1a56b0"
      fill-extrusion-height: ["coalesce", ["get", "render_height"], 10]
    effect:
      type: blueprint
      grid: 4
```

Your own effect:

```ts
import { registerEffect, backends, z } from "@maplibre-yaml/effects";

registerEffect({
  type: "ink-wash",
  backend: backends.extrusions,
  params: z.object({ color: z.string().default("#223344") }),
  uniforms: (p) => ({ u_color: p.color }),
  fragment: `vec4 effect_color(EffectInput i) { return vec4(u_color * (0.5 + 0.5 * i.diffuse), 1.0); }`,
  fallback: (_params, layer) => layer, // export: ship the static layer (null = doesn't export)
});
```

Full guide — `EffectInput`, helpers, export, backend limits:
https://docs.maplibre-yaml.org/guides/effects/

## Notes

- maplibre-gl 5 or 6 (`>= 6.4.1`) + WebGL2, mercator only, MVT or GeoJSON sources.
- Heights come from the static layer's own `fill-extrusion-height` /
  `-base` expressions (any schema), evaluated in a module worker
  (`dist/extrusions-worker.js`).
- The backend reads two MapLibre internals (tile managers, raw tile bytes)
  through one feature-checked adapter; if they disappear, effects declare
  absence instead of breaking.

Tangram heritage: the crosshatch look follows tangrams/tangram-sandbox
`styles/crosshatch.yaml` and the tangrams/blocks hatch filter (both MIT).

MIT
