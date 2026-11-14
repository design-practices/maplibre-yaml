# null.earth replica (spike, beads ml-nb1.1 / ml-nb1.6)

A globe of GFS wind particles and 2 m temperature after
[earth.nullschool.net](https://earth.nullschool.net), built from YAML for
everything the library declares today and page JavaScript for the rest.
`index.html` says which half each piece is in. The e2e spec
`e2e/null-earth.spec.ts` drives this page, so it is both the demo and the
regression test.

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

The blue channel is the library's no-data flag, with opposite conventions
per layer: the particle shader drops cells with B < 128, the raster shader
drops cells with B > 153.

Pixel centres sit on the 1° grid nodes, so the image bounds extend half a
cell past ±180° / ±90°. Longitudes are rolled from GFS's 0..359 to −180..179.

GFS is a US government work (public domain). Natural Earth coastlines and
lakes (110m) are public domain.
