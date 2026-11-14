# null.earth replica (spike, beads ml-nb1.1 / ml-nb1.6; grid source, ml-nb1.2)

A globe of GFS wind particles and 2 m temperature after
[earth.nullschool.net](https://earth.nullschool.net), built from YAML for
everything the library declares today and page JavaScript for the rest.
`index.html` says which half each piece is in. The e2e spec
`e2e/null-earth.spec.ts` drives this page, so it is both the demo and the
regression test. It is one demonstration of the `type: grid` source, not its
specification: the general, flat demo of a grid and of what a student sees
when one doesn't load is `examples/verification/grid-sources.html`
(`e2e/grid-sources.spec.ts`), which runs on maplibre-gl 4, 5 and 6.

## What is YAML, what is JS

| piece | where | how |
|---|---|---|
| globe, sky and atmosphere, Natural Earth coastlines and lakes, the globe/mercator toggle | `null-earth.yaml` | the library's own keys |
| the two data fields | `null-earth.yaml`, `sources:` | `type: grid` sources (`encoding: rg-uv` for u/v in the red and green bytes, `scalar-r` for the temperature in the red byte), with `grid:` node geometry, `range:`, `units:` and a `nodata:` rule each; core fetches and decodes each PNG once |
| sampling, the date-line wrap, no-data | core | `el.getGrid(id).sample(lngLat)`: bilinear over the four nodes, wrapping in longitude, `null` where a node has no data |
| the readout (wind speed and direction, temperature) | `index.html` | a few lines over the two samples — speed and direction from `{ u, v }`, °C from kelvin |
| the wind particles | `index.html` | custom layers through `getMap()`: the Deltares engine is handed the wind field's `values()` (u, v floats on `field.grid`; no second decode), the exif engine decodes the PNG itself from the frame URL |
| the temperature overlay | `index.html` | `mapbox-exif-layer`'s `SmoothRaster`, which decodes the PNG itself |
| stepping through forecast hours | `index.html` | a document update: the next frame's URLs in the two sources, `el.update(doc)`; the old fields keep answering until `ml-map:source-loaded` fires, then the HUD and the engine read the new ones |

What `index.html` exposes for the spec (`window.__nullEarth`): `el`, `map`,
`frames`, `fields()` (the two current fields), `readout(lngLat)`, `pin`,
`setFrame(i)` (resolves when both fields have swapped), `sampleFps`,
`engine`, `windFrames` (every wind URL handed to the engine).

Two particle engines are wired in, switched with `?engine=`:

| engine | package | trails | globe |
|---|---|---|---|
| `dsv` (default) | `@deltares/webgl-streamline-visualizer` 5.2.0, `GeographicStreamlineLayer` | particles accumulate in a fading trail texture, the technique null.earth uses | yes, and the globe/mercator transition |
| `exif` | `mapbox-exif-layer` 1.5.0, `NewParticleMotion` | each particle plus point-sprite copies at its previous positions | yes |

The first gives the null.earth look (continuous streaks, coherent
circulation); the second reads as dashes however long its trail. Tuning
knobs for the default engine are query params: `count`, `fade` (amount per
second), `speed`, `size`, `age`. Note that under software GL the default
engine's cost grows with particle count because a slow frame widens its
time step and multiplies sub-steps; measure it on a GPU before judging.

```bash
pnpm --filter @maplibre-yaml/core build
node e2e/server.mjs            # http://localhost:4174
# open /examples/verification/null-earth/index.html
```

## Data

`data/` holds three forecast hours of NOAA GFS 10 m wind and 2 m temperature
at 1° (about 150 KB a frame), baked by `tools/gfs-to-grid.py`, which reads
only the GRIB2 records it needs from NOAA's public bucket on AWS Open Data by
byte range and needs no system GDAL or wgrib2:

```bash
cd examples/verification/null-earth
uv run tools/gfs-to-grid.py --date 20261114 --cycle 00 --hours 0 3 6 --res 1p00 --out data
```

Encodings (`data/manifest.json` carries the exact ranges and bounds):

| file | channels | range |
|---|---|---|
| `*-wind-10m.png` | R = u, G = v, B = 255, A = 255 | u, v over −40..40 m/s |
| `*-temp-2m.png` | R = temperature, G = B = 0 | 193..328 K |

The blue channel is the no-data flag, with opposite conventions per file:
B < 128 marks a wind cell with no data, B > 153 a temperature cell — the
conventions the GPU layers' shaders read, declared to core as each source's
`nodata:` rule (`{ channel: b, below: 128 }` and `{ channel: b, above: 153 }`
in `null-earth.yaml`).

Pixel centres sit on the 1° grid nodes, so the image bounds extend half a
cell past ±180° / ±90°. Longitudes are rolled from GFS's 0..359 to −180..179.
The YAML declares that as node geometry, `grid: { nx: 360, ny: 181, lo1:
-180, la1: 90, dx: 1, dy: 1 }` (the manifest's `grid`); core infers that the
grid wraps from the 360 columns spanning the globe.

GFS is a US government work (public domain). Natural Earth coastlines and
lakes (110m) are public domain.
