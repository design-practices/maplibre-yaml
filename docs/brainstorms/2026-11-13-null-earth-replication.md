# Replicating earth.nullschool.net with maplibre-yaml

**Status:** requirements draft v0.1 · **Date:** 2026-11-13
**Scope:** `@maplibre-yaml/core` (sources, layers, controls, state), `@maplibre-yaml/effects`, `@maplibre-yaml/cli`, examples and e2e
**Tracking:** beads epic ml-nb1 (children ml-nb1.1 to ml-nb1.7); this document is the requirements record the plan will cite.

---

## 1. Why

The maintainer is dogfooding the library on projects and prototyping with
students, and wants to know how far YAML can go toward Cameron Beccario's
[earth.nullschool.net](https://earth.nullschool.net): an animated globe of wind
and ocean currents with color-ramped scalar overlays, a time stepper, and a
value readout under the pointer. It is a reference point students recognise,
and it exercises three things the library has never done: gridded
(non-feature) data, animated particle rendering, and a time dimension.

## 2. What null.earth is, mechanically

Facts established from the MIT-licensed source (`cambecc/earth`, 2013), the
site's about page, and the nullschool news archive:

- **Not a tiled web map.** D3 geographic projections draw Natural Earth
  coastlines to SVG. Two canvases sit on top: one for particles, one for the
  colored overlay. The live site added tiled coastlines in May 2026 but kept
  the architecture.
- **Data.** GFS from NOAA NOMADS (four runs a day, three-hourly steps) for
  wind, temperature, humidity, pressure, precipitable water, cloud water.
  OSCAR and Copernicus for currents; OISST/OSTIA/RTGSST for sea surface
  temperature; WAVEWATCH III for waves; GEOS-5 and CAMS for aerosols and
  chemistry; OVATION for aurora; FIRMS for fires. Each feed has its own
  cadence, format and licence.
- **Conversion.** `grib2json` emits a header (`lo1`, `la1`, `dx`, `dy`,
  `nx`, `ny`, scan mode 0) plus a flat array per field. Wind is two arrays
  (u, v). Historically 1° grids; 0.25° today.
- **Rendering.** Every frame the browser inverts each screen pixel to
  lon/lat, bilinearly interpolates the grid (the first column is duplicated
  as the last so the date line wraps), scales the vector by the projection's
  local distortion, and advances `7 × viewport width` particles with
  `MAX_PARTICLE_AGE = 100`, 40 ms frames, and a `destination-in` fade at
  0.95 alpha. Scalars go through segmented color scales (temperature 193 K
  to 328 K, pressure 920 hPa to 1050 hPa, currents 0 to 1.5 m/s) into an
  `ImageData` at 40 % alpha.
- **HUD.** Click reads the interpolated vector and scalar at that point,
  with unit togglers. State (`param`, `surface`, `level`, `date`, `hour`,
  `projection`, `overlayType`, `orientation`) lives in the URL hash.

The decisive architectural choice: everything samples an **equirectangular
lat/lon grid**, so the poles work and the particle math is projection
agnostic. Web Mercator tiles cannot give you that; anything we build should
sample the grid directly rather than go through Mercator tiles.

## 3. Fit today

| null.earth element | Library today | Gap |
|---|---|---|
| Globe, dark space, atmosphere | `projection: globe` + `sky` (maplibre-gl 5+) | none |
| Coastline-only basemap | Natural Earth as PMTiles, `line` layers over `background` | example + data only |
| Rotatable globe, auto-spin | drag works; `spinGlobe` only inside story chapters | minor |
| Projection picker | `controls.globe` toggles globe/mercator | orthographic, Winkel, Waterman etc. are not possible in MapLibre; accept globe + mercator |
| Scalar overlay (temperature, pressure) | single-band COG + `colorRamp`; or terrain-RGB tiles + `color-relief` | COG reader is Mercator-only (no polar caps, ml-cnv.8); no `raster-color` |
| Continuous color-bar legend | discrete swatch legends only | new legend type |
| Wind / current particles | nothing; effects backend is fill-extrusion and mercator only | **the main gap** |
| Time stepping | `parameters` range slider → `global-state`, so filters and paint only | cannot swap a source URL or image per step |
| Value HUD under pointer | `layer-hover` for vector features only | no raster or grid sampling |
| Deep-linkable state | `setState`/`getState`, `state-change` event | no URL-hash sync |
| Gridded data input | geojson, vector, raster, raster-dem, image, video, COG, FlatGeobuf, GeoParquet | no GRIB, NetCDF, Zarr, or u/v field decoding |

Related open beads: ml-chh.20 (globe-capable effects backends via the
`projectTile` shader prelude), ml-cnv.8 (in-browser COG reprojection).
Existing plans state that custom WebGL stays "eject to JS plus slots"
(`docs/plans/2026-07-08-001-feat-quality-adoption-release-train-plan.md`,
`docs/plans/docs-positioning-and-examples.md`). This work revisits that policy
for one well-bounded case: a declarative flow-field layer.

## 4. Ecosystem survey (MapLibre side)

- **mapbox-exif-layer** (MIT): `NewParticleMotion`, `SmoothRaster`,
  `RgbGeoTiff`. The only open-source particle layer that renders under
  MapLibre globe (`mapRuntime: 'maplibre'`, v1.2.0+). Input is a PNG/JPEG
  with u in red and v in green plus bounds and min/max (EXIF or option), or
  a two-band float32 EPSG:4326 GeoTIFF (optional `geotiff` peer). GPU
  transform feedback; options for count, speed, age, trail, color stops.
- **Deltares webgl-streamline-visualizer** (MIT): `GeographicStreamlineLayer`
  works in Mercator, globe and the transition; input is RG-encoded 8-bit
  GeoTIFF or WMS-T. Water-domain focus.
- **maplibre-gl-wind**, **@sakitam-gis/maplibre-wind**, **windgl-maplibre**:
  Mercator only.
- **weatherlayers-gl**: deck.gl based, commercial data catalog, heavy
  dependency; not a fit for core.
- **MapLibre custom layers on globe**: `render(gl, args)` gives
  `args.shaderData.vertexShaderPrelude` + `define` and `projectTile()`;
  variants keyed by `shaderData.variantName`; uniforms from
  `args.defaultProjectionData` (`mainMatrix`, `fallbackMatrix`,
  `clippingPlane`, `projectionTransition`). Same contract ml-chh.20 names.
- **color-relief** (maplibre-gl 5.6+): native GPU ramp over `raster-dem`
  tiles; usable as a scalar-overlay hack if the field is encoded as terrain
  RGB, Mercator only.

## 5. Requirements

Ordered by leverage. R1 is a spike with no library change; R2 to R5 are the
expansion; R6 is data tooling.

### R1 — Replica demo with the JS escape hatch (spike)

An e2e page (per the repo convention that demos double as regression tests)
that is YAML for everything the library already covers, plus page JS waiting
on `mapReady()` and calling `getMap().addLayer(...)` with mapbox-exif-layer
particles and a `SmoothRaster` temperature overlay from pre-baked GFS frames.
Time stepping and a readout are page JS reading the same frames. Output: a
screenshot-worthy globe, a list of the knobs a student would want in YAML,
and a measured frame budget on a phone. Decides whether to vendor, depend on,
or reimplement the particle layer in R3.

### R2 — `grid` source

A source kind for an equirectangular scalar or vector field:

```yaml
sources:
  wind:
    type: grid
    url: /data/gfs/{time}/wind-10m.png     # see R4 for {time}
    encoding: rg-uv                        # | band-uv | nullschool-json | scalar-png
    bounds: [-180, -90, 180, 90]           # cell edges, [west, south, east, north]; or grid: { nx, ny, lo1, la1, dx, dy } for node geometry
    range: [-40, 40]                       # m/s, the min/max the bytes map to
    units: m/s
```

Core decodes once (worker when large), keeps a typed array, and exposes
`sample(lngLat) → number | [u, v, speed]` with bilinear interpolation and
date-line wrap. No GRIB/NetCDF decoding in the browser; conversion is an
offline step (R6). Also the basis for R3 and R5.

### R3 — `flow` and `field` layers

`flow` renders particles from a vector `grid` source: `count` (absolute or
per-viewport-width), `speed`, `maxAge`, `trail` (fade), `color` ramp over
speed, `opacity`. `field` colorizes a scalar `grid` source with an
`interpolate` ramp and opacity, sampling the equirectangular texture
directly so the poles are covered. Both must render under `projection:
globe` and the globe/mercator transition. Implementation is a
`CustomLayerInterface` using the projection prelude (ml-chh.20); whether it
lives in core or in `@maplibre-yaml/effects` is a plan decision, with the
constraint that a document never carries GLSL. Declares absence cleanly on
maplibre-gl < 5 and without WebGL2.

### R4 — Time dimension

Either or both: source `url` templates filled from `global-state`
(`{time}` above) with a `parameters` entry of a new `type: time` or a list
of discrete values; and a `frames:` list on `image`, `raster` and `grid`
sources. A `controls.playback` (play/pause, step, speed) drives the
parameter. Prefetch the next frame; swap without flicker. Useful well beyond
weather (satellite image series, census years).

### R5 — Readout control and continuous legend

`controls.readout` shows sampled `grid` values under the pointer (or at a
click, sticky), with unit conversion tables (m/s, km/h, kn, mph; K, °C, °F;
hPa, inHg). A `legend` entry type for a continuous ramp with min/max and tick
labels, generated from a `field` or `flow` color ramp.

### R6 — Data pipeline tooling and a sample dataset

A documented, scriptable conversion from GFS to the R2 encodings. Node has no
credible GRIB decoder, so this wraps GDAL or Python (xarray + cfgrib), either
as a recipe in docs or an `mlym` command that shells out. Acquisition options,
cheapest first: pre-baked frames hosted statically (enough for teaching); the
dynamical.org GFS Zarr on Source Cooperative (analysis and forecast, includes
10 m u/v) as the conversion input; a three-hourly scheduled job against the
NOMADS grib filter for live data. Publish one small sample set (a few
timesteps of 10 m wind and 2 m temperature at 1°, roughly 100 KB per frame)
with provenance and licence notes, used by the gallery and the e2e page.
Open-Meteo is point-based and does not help. Copernicus products need an
account and redistribution review.

### Out of scope

Non-globe projections (orthographic variants, Winkel, Waterman); the full
null.earth product catalogue; a hosted live data service; porting the D3
canvas renderer (its mask-canvas approach only works with D3 projections).

## 6. Decisions (maintainer, 2026-11-14)

1. **Core, not the effects package.** The `grid` source goes in core now.
   `flow` and `field` go in core behind a lazy-loaded module (the shader and
   decoder are imported only when a document declares such a layer), marked
   experimental in the docs for one minor cycle.
2. **Own shader, forked from the Deltares geographic visualiser (MIT).**
   Keep its geographic particle state, fade pass and spawn table; drop the
   WMS and geotiff halves and the hard maplibre-gl dependency; add pole
   coverage by sampling the equirectangular texture directly. The spike is
   the reference for look and globe behaviour.
3. **Fixture frames are committed** (three 1° frames, ~500 KB), refreshed
   only when the encoding changes. No hosted sample set is required.
4. `mlym emit` behaviour for grid-backed layers and the URL-hash sync
   question (R7) stay open for the R2/R3 plans.
5. `bounds` follows MapLibre's `[west, south, east, north]`; the example in
   R2 was corrected.

## 7. Sources

cambecc/earth README and `earth.js` / `products.js`; earth.nullschool.net
about page; nullschool news (map improvements, 2026-05-28; archive);
mapbox-exif-layer README; "Assessing packages for mapping wind as particle
motion layer in MapLibre" (Medium); MapLibre examples "add a simple custom
layer on a globe" and "add a color relief layer"; Deltares
webgl-streamline-visualizer; WeatherLayers data-sources docs; dynamical.org
NOAA GFS on Source Cooperative and the AWS Open Data registry.

## 8. Spike findings (R1, 2026-11-14)

The replica exists at `examples/verification/null-earth/` with
`e2e/null-earth.spec.ts` (six checks, all green under maplibre-gl 6.12 and
SwiftShader). Data from `tools/gfs-to-grid.py`: three GFS forecast hours at
1°, about 500 KB in the repo. What the spike established:

- **It works on the globe today.** mapbox-exif-layer 1.5.0 renders particles
  and a scalar overlay under `projection: globe` on maplibre-gl 6, added via
  `getMap().addLayer()` after `mapReady()`. `setLayoutProperty(id,
  "visibility")` and `setSource(url)` work on these custom layers, so an
  overlay toggle and time stepping are a few lines.
- **Gotchas the YAML layer must hide.** `readyForDisplay` defaults to false
  (nothing draws until set); the blue channel is the no-data flag with
  opposite conventions per layer (particles need B ≥ 128, raster discards
  B > 153); latitude bounds past ±90 produce NaN Mercator y and squash the
  image; the library has no value query, so the readout decodes the PNG on
  a canvas and samples it bilinearly itself; the equirectangular image is
  placed through Mercator y, so nothing draws poleward of ~85° on the globe
  either. An own `flow`/`field` shader that samples the equirectangular
  texture directly (R3) would cover the poles.
- **Registration.** Grid nodes sit at pixel centres, so the image bounds
  overshoot by half a cell; the GPU layers get the latitude clamped to ±90
  (at most half a cell off at the poles), the readout keeps exact bounds.
- **Frame rate.** 8.5 fps under SwiftShader with the library's default
  particle count. Not a budget; the phone number is still to be measured
  (serve the repo and open the page over Tailscale).
- **Knobs the YAML surface needs** (what a student would reach for first):
  the source URL, bounds, value range and units; particle count, speed,
  trail and a speed color ramp; overlay ramp and opacity; the frame list and
  a play control; the readout and its units; the continuous legend; a
  coastline-only basemap preset. Each maps onto R2 to R5.

### Engine comparison (R1 follow-up, 2026-11-14)

The first cut used mapbox-exif-layer, whose trails are point-sprite copies
of each particle at its previous positions. That can only produce dashes:
null.earth's look comes from never clearing the canvas (multiply the last
frame by 0.95, draw the new heads on top), so a trail is a continuous
streak that decays smoothly. The spike now carries both engines behind
`?engine=`:

- **@deltares/webgl-streamline-visualizer 5.2.0** (MIT), whose
  `GeographicStreamlineLayer` shipped on 2026-11-04: persistent fade
  framebuffers, geographic (lon/lat) particle state, a `RegularVelocityChunk`
  built straight from our u/v arrays with cell centres on the grid nodes
  (no half-cell fudge), works on the globe and through the globe/mercator
  transition, no spawning past ±85°. This is the null.earth look and the new
  default. Costs: a hard dependency on maplibre-gl ^6.16 (a second copy next
  to ours), geotiff, an 800 KB dist (mostly geotiff decoders, lazy-loaded),
  and under SwiftShader a per-particle cost that balloons because a slow
  frame widens dt and multiplies sub-steps (0.7 fps at 3500 particles, 4 fps
  at 500; viewport size does not matter). A GPU measurement is still owed.
- **mapbox-exif-layer 1.5.0** stays as `?engine=exif`, tuned to its longest
  trail (24 copies, slow size decay): strokes, not streaks; 10 fps under
  SwiftShader.
- **deck.gl 9.3 + weatherlayers-gl** was assessed and not tried: deck now
  supports MapLibre globe in interleaved mode and weatherlayers' particle
  layer is visually the closest off the shelf, but it brings deck core,
  layers and luma for every consumer and a dual MPL-2.0 / terms-of-use
  licence; ADR-001 already declined the deck seam for core.

**Blend modes.** maplibre-gl 6.18.0 added `fill-layer-blend`,
`line-layer-blend` and `raster-layer-blend` (normal, multiply, screen,
overlay, color, luminosity, plus-lighter) alongside `*-layer-opacity`.
These composite a layer onto what is below it within one frame; MapLibre
still clears the framebuffer every frame, so they cannot stand in for
null.earth's canvas persistence. The accumulation has to live in a retained
texture inside the custom layer, which is what Deltares and webgl-wind do.
Where blend modes do help: compositing the trail layer onto the basemap
(screen or plus-lighter over a dark map for the glow), and the scalar
overlay onto imagery (multiply). Both are worth exposing on `flow` and
`field` once R3 exists, and `*-layer-blend` is a cheap schema addition for
the existing layer types in its own right.

**Implication for R3.** Own the shader, start from the Deltares geographic
visualiser (MIT) rather than from scratch: keep its geographic particle
state, fade pass and spawn table; drop the WMS and geotiff halves and the
hard maplibre-gl dependency; add the pole coverage by sampling the
equirectangular texture directly.
