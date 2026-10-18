# @maplibre-yaml/effects

> **Experimental.** The API may change in a minor release. Pin the version.

Shader effects for [maplibre-yaml](https://docs.maplibre-yaml.org) maps. An
effect is a named, parameterized shader that enhances an ordinary
`fill-extrusion` layer: the YAML names it, page JavaScript registers it, and
documents never carry GLSL. The layer stays a complete static layer and is the
effect's fallback: it renders as written without this package, where an
effect can't run (globe, terrain, maplibre-gl 4), and in `emit` output.

Built in: **`tonal-hatch`** (the Mapzen/Tangram crosshatch: pen-stroke density
follows the light on each face) and **`blueprint`** (a drafting grid measured
in metres).

## Use

```bash
npm install @maplibre-yaml/core @maplibre-yaml/effects maplibre-gl@^6
```

In your entry file (Vite shown):

```js
import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "@maplibre-yaml/core/register";
import "@maplibre-yaml/effects/register"; // built-ins + the <ml-map> hook
import "maplibre-gl/dist/maplibre-gl.css";

setWorkerUrl(workerUrl);
```

The `setWorkerUrl` lines are maplibre-gl 6's bundler setup; on maplibre-gl 5,
leave them out.

Then put `effect:` on a `fill-extrusion` layer. `type` names the effect;
every other key is a param:

```yaml
type: map
id: blueprint
config:
  center: [-74.0118, 40.7075]
  zoom: 15.9
  pitch: 60
  # a basemap with no 3D buildings of its own, so only `buildings` draws them
  mapStyle: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
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

## Your own effect

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

## Compatibility

- maplibre-gl 5 or 6 (`>= 6.4.1`) with WebGL2; mercator projection only;
  vector-tile (MVT) or GeoJSON sources. Elsewhere the static layer renders.
- Heights come from the layer's own `fill-extrusion-height` / `-base`
  expressions, evaluated in a module worker (`extrusions-worker.js`, emitted
  by Vite and webpack 5).
- Hooks into `<ml-map>` from `@maplibre-yaml/core`; `attachEffects(map, …)`
  applies effects to a plain maplibre-gl map rendering an exported style.

The full guide covers the `EffectInput` struct, GLSL helpers, export, loading
from a CDN and the backend's limits:
[Effects (experimental)](https://docs.maplibre-yaml.org/guides/effects/).
Live examples: [Crosshatch](https://docs.maplibre-yaml.org/examples/gallery/crosshatch/)
and [Blueprint](https://docs.maplibre-yaml.org/examples/gallery/blueprint/).

The crosshatch look follows Tangram's `styles/crosshatch.yaml`
(tangrams/tangram-sandbox) and the tangrams/blocks hatch filter, both MIT.

## License

MIT
