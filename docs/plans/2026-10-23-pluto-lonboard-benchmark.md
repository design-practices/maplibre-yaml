---
title: PLUTO benchmark — can maplibre-yaml replace Lonboard for NYC tax lots? (spike)
type: design
date: 2026-10-23
topic: pluto-lonboard-benchmark
beads: ml-37r.5 (this spike; parent epic ml-37r); follow-ups ml-37r.15–ml-37r.20
target: course tooling and the Python package (ml-37r.2); library fixes for 0.9.x/0.10
status: findings — recommendations for the maintainer
---

# PLUTO benchmark: maplibre-yaml vs Lonboard (spike)

**Question (ml-37r.5, maintainer note 2026-10-23):** the course's main Lonboard
use is drawing NYC PLUTO, about 857k tax-lot polygons with about 90
attributes. Can maplibre-yaml draw it as well, from YAML, in a static site?
Which file format should students use at which scale? Which format should the
Python package (ml-37r.2) write by default for data this size? Does
maplibre-yaml need a deck.gl-backed layer type?

**Short answer.**

- **Yes, with PMTiles.** Citywide PLUTO as PMTiles (107 MB archive, one
  tippecanoe run of about 8 minutes) draws in about 1 s on a desktop and 2–3 s
  on the throttled "student laptop" profiles, reads 0.1–3 MB per view, uses a
  third to a half of Lonboard's memory, and pans at 60 fps. Its 3D view holds
  60 fps where Lonboard's extruded map drops to 28 fps. Popups and categorical
  `classify:` work. Every lot is in the tiles from zoom 14 (§4).
- **Lonboard's real advantage** is that it needs no tiling step and keeps
  every lot at every zoom. Its cost is fixed and large: the citywide map is an
  **86 MB HTML file** (62 MB gzipped) that every reader downloads and parses
  whole before anything draws: 5–6 s on the desktop (localhost), 25 s with
  DevTools throttling, and from 45 s to more than 5 minutes with the whole
  browser limited to 1.5 cores. The file is over Cloudflare's 25 MiB per-file
  limit, so the course site can't host it at all; the course's published
  Lonboard pages are small subsets (one community district is 5.5 MB).
- **Feature completeness (maintainer requirement, §4):** at block zoom every
  variant draws every lot in view (601 of 601). At borough and citywide zoom
  MapLibre generalises as expected: GeoJSON's tiler skips lots smaller than
  about a pixel (97% of lots are under one pixel at zoom 10.5), and the default
  PMTiles build merges lots below zoom 14. Nothing in maplibre-yaml caps or
  samples features. A no-drop PMTiles build (162 MB) keeps 774,689 of the
  775,200 lots in the citywide view at 2.4 s and 57 fps, so even "every lot at
  every zoom" is possible without deck.gl. One trap: tippecanoe's
  `--use-attribute-for-id` **removes** the attribute it promotes (`BBL` here),
  which is real attribute loss (§4.3).
- **The by-view formats are not a citywide answer today.** FlatGeobuf and
  GeoParquet read by view work well at block zoom (about 1 s, 1–5 MB), are
  usable at borough zoom on a desktop (5 s, 20–36 MB, 2.5–3 GB of RAM, 25 fps
  while panning) and fail at citywide zoom: the view covers the whole file, so
  FlatGeobuf reads 261 MB, needs 5 GB of RAM and pans at 8 fps, and GeoParquet
  crashes the tab. GeoParquet read whole (`load: all`) crashes the tab too,
  because the 50 MB guard counts compressed bytes. These are library bugs,
  filed below.
- **Plain GeoJSON of all of PLUTO works on a desktop** (slim columns: 359 MB
  raw, 35 MB gzipped; 22 s to first draw, 4 GB of RAM, then 60 fps) and takes
  60–90 s on the laptop profiles. The full-column file (1.7 GB) cannot be
  parsed by any browser.
- **No deck.gl layer type.** Neither performance nor completeness needs one:
  PMTiles beats Lonboard on every number except "no tiling step", and the
  earlier deck spike (ml-rzm) found deck costly to integrate (§8).
- **Six follow-ups** came out of this: hover highlight throws on vector tiles
  (ml-37r.15), the GeoParquet whole-file guard (ml-37r.16), no per-view budget
  for by-view reads (ml-37r.17), main-thread parsing (ml-37r.18), no
  continuous colour ramp (ml-37r.19), and a PMTiles recipe for parcel fabrics
  in the docs (ml-37r.20).

---

## 0. Decisions at a glance

| # | Recommendation |
|---|---|
| R1 | **Students, citywide PLUTO (any zoom from 10):** PMTiles. One tippecanoe command (§4.3), one `type: vector` source with `promoteId: { pluto: BBL }`. Lots are merged below zoom 14 and all present from 14; for every lot at every zoom use the no-drop build (162 MB, 18 MB per citywide view). |
| R2 | **Students, one borough or a few community districts at zoom 13+:** FlatGeobuf with `load: viewport` (slim columns), or GeoParquet with `load: viewport` written with **10k-row groups**. Set `load: { mode: viewport, minzoom: 13 }` until ml-37r.17 lands. On a weak laptop prefer PMTiles even here: 3–5 s instead of 15–20 s. |
| R3 | **Students, under about 50,000 lots (a community district; Manhattan with slim columns, 18 MB raw / 2 MB gzipped):** GeoJSON is fine: 2 s on the desktop, 5–6 s on the laptop profiles, 60 fps. Up to about 300k lots (Brooklyn, 10 MB gzipped) GeoJSON still works but takes 8 s on the desktop and 20–25 s on a laptop. |
| R4 | **Python package (ml-37r.2) default for PLUTO-scale data:** `write_pmtiles` when tippecanoe is available and the frame has more than about 100k features; otherwise GeoParquet with `viewport=True` and **`row_group_size=10_000`**. Never inline (the 5k-feature preview limit stays a *preview* limit and must say so). Breaks always explicit. §7. |
| R5 | **deck.gl-backed layer type:** not warranted. §8. |
| R6 | **Course migration:** every Lonboard feature the course uses has a maplibre-yaml equivalent except unclassed log-scaled colour ramps (ml-37r.19) and the hover highlight on PMTiles, which is a bug (ml-37r.15). §9. |

---

## 1. Setup

### 1.1 Data

- **MapPLUTO 26v2**, NYC Department of City Planning, File Geodatabase
  (`nyc_mappluto_26v2_fgdb.zip`, 155 MB), layer `MapPLUTO_26v2_clipped`:
  **856,687 polygons, 101 attribute columns**, EPSG:2263. Citywide; no
  subsetting was needed for disk.
- Reprojected to EPSG:4326 and **Hilbert-sorted once** (geopandas 1.2,
  `hilbert_distance()`); every file below shares that row order.
- **Slim columns** (what a typical class map uses): `LandUse`, `NumFloors`,
  `YearBuilt`, `AssessTot`, `BBL` (as int64, used as the feature id),
  `Address`. The course's notebooks use the original PLUTO capitalisation, so
  the files keep it.

### 1.2 Variants

| Variant | File | Size | Notes |
|---|---|---|---|
| GeoJSON, full, citywide | — | **1,693 MB** raw / 104 MB gzip | Not served: larger than V8's maximum string length (about 512 MiB), so no browser can `JSON.parse` it. |
| GeoJSON, slim, citywide (`geojson-slim`) | `pluto_slim.geojson` | 359 MB / **35 MB gzip** | 6 decimals, RFC 7946. Served gzipped, as GitHub Pages and Cloudflare do. |
| GeoJSON, slim, Brooklyn (`geojson-bk-slim`) | `bk_slim.geojson` | 112 MB / 10.4 MB gzip | 275,628 lots |
| GeoJSON, slim, Manhattan (`geojson-mn-slim`) | `mn_slim.geojson` | 17.9 MB / 1.9 MB gzip | 42,023 lots |
| GeoJSON, full, Manhattan (`geojson-mn-full`) | `mn_full.geojson` | 95 MB / 6.5 MB gzip | all 101 columns |
| GeoParquet 1.1, Portolan-like (`gpq100k`) | `pluto_full_rg100k.parquet` | 126 MB | all columns, WKB, `bbox` covering column, Hilbert, ZSTD, **100k-row groups** (9 groups) |
| GeoParquet 1.1, fine (`gpq10k`) | `pluto_full_rg10k.parquet` | 130 MB | same, **10k-row groups** (86 groups) |
| FlatGeobuf, slim (`fgb`) | `pluto_slim.fgb` | 286 MB (273 MiB) | spatial index; the full-column FlatGeobuf is 870 MB and was not served |
| PMTiles, default (`pmtiles`) | `pluto.pmtiles` | **107 MB** | tippecanoe, lots merged below zoom 14, §1.3 |
| PMTiles, no-drop (`pmtiles-nodrop`) | `pluto_nodrop.pmtiles` | 162 MB | every lot at every zoom, §1.3 |
| Lonboard, citywide | `lonboard_{city,borough,block}.html` | **86.0 MB / 61.9 MB gzip** | slim columns, `PolygonLayer`, §1.4 |
| Lonboard, `LandUse` only | — | 67.2 MB / 48.1 MB gzip | the notebook-07 pattern (`df[["LandUse", "geometry"]]`) |
| Lonboard, Brooklyn CD 307 | `lonboard_cd307.html` | 5.5 MB / 1.9 MB gzip | 13,262 lots: the size of the course's published Lonboard pages (4.6–7.4 MB) |

GeoParquet keeps all 101 columns because core reads only the columns the map
uses (7 here: 6 attributes and geometry); FlatGeobuf is row-oriented, so it
was written slim.

### 1.3 PMTiles builds

Two builds from the slim FlatGeobuf, tippecanoe v2.82.0 (felt) in an Alpine
container on a 6-core i7-8700:

```bash
# default ("pmtiles"): merge dense lots at low zoom, keep tiles under 500 KB
tippecanoe -o pluto.pmtiles -l pluto -Z10 -z16 --use-attribute-for-id=BBL \
  --coalesce-densest-as-needed --extend-zooms-if-still-dropping pluto_slim.fgb
# no-drop ("pmtiles-nodrop"): every lot in every tile, no size or count limit
tippecanoe -o pluto_nodrop.pmtiles -l pluto -Z10 -z16 --use-attribute-for-id=BBL \
  --no-feature-limit --no-tile-size-limit --no-tiny-polygon-reduction pluto_slim.fgb
```

| Zoom | Default: tiles / bytes / largest tile | Default: distinct lots | No-drop: bytes / largest tile | No-drop: distinct lots |
|---|---|---|---|---|
| 10 | 5 / 1.2 MB / 494 KB | 11,166 | 17.7 MB / **8.4 MB** | 856,135 |
| 11 | 13 / 1.9 MB / 457 KB | 27,008 | 18.3 MB / 5.7 MB | 856,490 |
| 12 | 32 / 5.4 MB / 460 KB | 133,901 | 19.7 MB / 2.1 MB | 856,627 |
| 13 | 100 / 15.6 MB / 437 KB | 557,224 | 21.5 MB / 669 KB | 856,652 |
| 14 | 330 / 23.5 MB / 220 KB | **856,578** | 24.0 MB / 228 KB | 856,664 |
| 15 | 1,177 / 27.2 MB / 77 KB | 856,624 | 27.7 MB / 79 KB | 856,671 |
| 16 | 4,268 / 32.7 MB / 26 KB | 856,661 | 33.2 MB / 27 KB | 856,672 |
| **Archive** | **107 MB, 7 min 47 s** | | **162 MB, 5 min 10 s** | |

"Distinct lots" counts distinct feature ids in all tiles of that zoom
(`tippecanoe-decode`), out of 856,687. What the flags do and what they cost
in completeness is in §4.3.

### 1.4 Lonboard

- Lonboard **0.17.0** (the course pins 0.16.0) in a uv venv with geopandas
  1.2 and pyarrow 26.
- `PolygonLayer.from_geopandas(gdf, get_fill_color=apply_categorical_cmap(gdf["LandUse"], cmap=…), pickable=True, auto_highlight=True, stroked=False)`,
  `Map(layer, view_state=…, height=800, show_tooltip=True)`, then
  `m.to_html(…)`. The tooltip on hover and the side panel on click are both
  on (the course's exports have the side panel only), so Lonboard gets hover
  and click behaviour comparable to maplibre-yaml's.
- The extruded variant adds `extruded=True, get_elevation=NumFloors * 14`,
  exactly as notebook 07 does.
- Lonboard's default basemap is CARTO Positron (no labels). The maplibre-yaml
  maps use the **same basemap style URL**, so both draw the same tiles.

### 1.5 maplibre-yaml documents

Published `@maplibre-yaml/core@0.9.1` and `maplibre-gl@6.15.0`, both served
locally (import map), so the measured bytes are the same on any host. One
document per variant and view, identical except for the source:

```yaml
type: map
config:
  center: [-73.95, 40.66]   # per view, see below
  zoom: 13
  mapStyle: "https://basemaps.cartocdn.com/gl/positron-nolabels-gl-style/style.json"
sources:
  lots:
    type: geojson                      # or vector, for .pmtiles
    url: /data/pluto_full_rg10k.parquet
    promoteId: BBL                     # geojson sources only
    load: viewport                     # the by-view variants only
layers:
  - id: lots
    type: fill                         # fill-extrusion for the 3D view
    source: lots
    # source-layer: pluto              # PMTiles only
    paint: { fill-opacity: 0.9 }
    classify:
      field: LandUse
      categories: { "01": "#f2c84b", "02": "#f08a24", …, "11": "#8a5a2b" }
      other: "#cccccc"
    interactive:
      hover: { cursor: pointer, highlight: true }
      click:
        popup:
          - strong: [{ property: Address, else: "(no address)" }]
          - p: [{ str: "Land use: " }, { property: LandUse }]
          - p: [{ str: "Floors: " }, { property: NumFloors }]
          - p: [{ str: "Built: " }, { property: YearBuilt }]
          - p: [{ str: "Assessed: " }, { property: AssessTot, format: { currency: USD, max-fraction-digits: 0 } }]
          - p: [{ str: "BBL: " }, { property: BBL }]
```

A second set replaced the categories with
`classify: { field: NumFloors, method: quantile, classes: 5, palette: YlOrRd }`
to test computed breaks (§5). On the PMTiles builds the popup's `BBL` line
was blank, because `--use-attribute-for-id` removed the attribute (§4.3).

**Views** (the same in Lonboard's `view_state`):

| View | Centre | Zoom | What is in it |
|---|---|---|---|
| city | −73.94, 40.70 | 10.5 | all five boroughs, ~850k lots |
| borough | −73.95, 40.66 | 13 | central Brooklyn, ~94k lots |
| block | −73.985, 40.755 | 16 | Midtown, ~600 lots |
| extrude | −73.99, 40.73 | 13, pitch 45, bearing 13 | Lower Manhattan, 3D |

### 1.6 Harness and hardware

- **Machine:** Intel i7-8700 (6 cores, 12 threads), 14 GB RAM, **Intel UHD
  630 integrated GPU**. Chromium 1223 (Playwright 1.60 headless shell) in the
  `mcr.microsoft.com/playwright:v1.60.0-noble` container with `/dev/dri`
  passed through and `--use-gl=angle --use-angle=gl-egl`; WebGL reports
  `ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL ES 3.2)`.
  **Real GPU, not software rendering.** Viewport 1280×800 at 1×.
- **Server:** a small Node static server on localhost with HTTP range
  requests, and gzip for `.geojson` and `.html` (precompressed, as a CDN
  would). Data bytes therefore cross no real network on the desktop profile.
- **Profiles:**
  - **desktop**: no throttling.
  - **laptop**: Chrome DevTools CPU throttling 4× and network throttling 40
    Mbit/s down, 10 up, 20 ms latency. **Caveat:** DevTools throttles the
    page's main thread only; the protocol refuses CPU throttling on workers
    ("Operation is only supported for pages, not workers"). MapLibre parses
    tiles and GeoJSON in workers and Lonboard decodes on the main thread, so
    this profile flatters MapLibre's worker work. Hence a third profile:
  - **laptop (cgroup)**: the whole browser (main thread, workers, GPU
    process) limited to **1.5 CPU cores** by the container, same network
    throttling, no DevTools CPU throttle.
- **One run** = a fresh browser, one page, then:
  1. load until idle, with a screenshot every ~0.4 s. *First render* is the
     first screenshot with at least half of the final amount of coloured
     (lot) pixels; *idle* is when coloured pixels, the network and long tasks
     have all been quiet for 1.5 s;
  2. bytes from the DevTools network log (page and workers), split into data
     (`/data/…`), library/page files and the external basemap;
  3. JS heap after a forced GC (main thread only), and the **peak RSS** of
     the renderer process (page plus workers) and the GPU process, sampled
     every 250 ms from `/proc`;
  4. hover: the pointer moves from an empty pixel onto a lot; click: time
     from the click to the popup (or Lonboard side panel) text appearing; for
     maplibre-yaml, the hovered feature's `feature-state`;
  5. pan/zoom: four 300/200 px drags and seven wheel steps (zoom +1.05 and
     back −1.4), paced at 60 Hz, about 7 s; rAF frame intervals give FPS and
     p95 frame time; long tasks are counted from `PerformanceObserver`.
- Desktop cells are the **median of 3 runs** (fewer where a run crashed the
  tab, and 1 for the no-drop PMTiles build and the 3D view); laptop cells are
  1 run, except Lonboard on the cgroup profile (2 runs, both shown, because
  they differed by minutes).
- **Completeness pass** (§4): a separate load per variant and view that calls
  `map.queryRenderedFeatures({ layers: ["lots"] })` after idle and counts
  distinct lots (by `BBL`, or the feature id where the tiles carry it), against
  the lots intersecting the same bounds in the source data (geopandas
  `sindex.query`).

---

## 2. Results

### 2.1 Desktop with GPU (UHD 630), no throttling

Median of 3 runs. *Data MB* is what the map downloaded from `/data/` until
idle (the library, page and CARTO basemap add about 2.5 MB to every row).
*Peak RAM* is the renderer process (page plus workers) and the GPU process.
*Pan* is the 7 s scripted drag-and-wheel sequence. *Popup ms* is click to
popup text (Lonboard: click to side-panel text). *Lots drawn / in view* is
from the completeness pass (§4); a dash means not measured for that variant.

| Variant | View | First render s | Idle s | Data MB | Peak RAM MB (renderer + GPU) | Pan FPS | Pan p95 ms | Pan long tasks (n / ms) | Popup ms | Lots drawn / in view | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| pmtiles | city | 1.2 | 1.2 | 1.2 | 329 + 150 | 60 | 17 | 0 / 0 | 24 | 9,753 / 775,200 | hover highlight throws (ml-37r.15) |
| pmtiles-nodrop | city | 2.4 | 2.4 | 17.7 | 1,600 + 160 | 57 | 17 | 2 / 483 | 27 | 774,689 / 775,200 | hover highlight throws (ml-37r.15) |
| gpq10k-view | city | 25.5 | 26.6 | 79.3 | – | – | – | – / – | 24 | – | drew after 25 s, then **tab crashed** while panning |
| gpq100k-view | city | 27.2 | 28.4 | 80.0 | – | – | – | – / – | 29 | – | drew after 27 s, then **tab crashed** while panning |
| gpq100k-all | city | – | – | 50.1 | – | – | – | – / – | – | – | **tab crashed** |
| fgb-view | city | 29.5 | 30.4 | 261.4 | 5,305 + 153 | 8 | 167 | 23 / 35,265 | 28 | 106,153 / 775,200 |  |
| fgb-all | city | 29.1 | 29.9 | 261.4 | 5,224 + 151 | 8 | 150 | 21 / 33,086 | 27 | 106,153 / 775,200 | auto by-view (>50 MB) |
| geojson-mn-slim | city | 2.0 | 2.0 | 1.9 | 491 + 144 | 60 | 17 | 0 / 0 | – | 11,810 / 40,203 |  |
| geojson-bk-slim | city | 7.1 | 7.3 | 10.4 | 1,508 + 144 | 60 | 17 | 0 / 0 | 24 | 23,989 / 275,628 |  |
| geojson-slim | city | 22.6 | 23.4 | 34.9 | 4,010 + 152 | 59 | 17 | 0 / 0 | 39 | 106,168 / 775,200 |  |
| lonboard | city | 5.6 | 6.1 | 61.9 | 978 + 163 | 58 | 17 | 3 / 220 | 75 | all 856,687 uploaded |  |
| pmtiles | borough | 1.0 | 1.5 | 3.3 | 455 + 152 | 59 | 17 | 0 / 0 | 27 | 46,820 / 94,127 | hover highlight throws (ml-37r.15) |
| pmtiles-nodrop | borough | 1.3 | 2.3 | 5.4 | 825 + 163 | 59 | 17 | 0 / 0 | 21 | 94,120 / 94,127 | hover highlight throws (ml-37r.15) |
| gpq10k-view | borough | 5.2 | 6.1 | 20.2 | 2,982 + 156 | 25 | 117 | 9 / 5,277 | 24 | 94,000 / 94,127 |  |
| gpq100k-view | borough | 8.1 | 9.0 | 51.4 | 3,759 + 160 | 13 | 267 | 7 / 8,865 | 46 | – |  |
| gpq100k-all | borough | – | – | 50.1 | – | – | – | – / – | – | – | **tab crashed** |
| fgb-view | borough | 5.0 | 5.8 | 35.9 | 2,526 + 157 | 26 | 133 | 9 / 5,400 | 25 | 94,000 / 94,127 |  |
| fgb-all | borough | 5.0 | 6.0 | 35.9 | 2,422 + 155 | 25 | 117 | 10 / 5,283 | 28 | 94,000 / 94,127 | auto by-view (>50 MB) |
| geojson-bk-slim | borough | 8.3 | 10.4 | 10.4 | 2,290 + 162 | 60 | 17 | 0 / 0 | 26 | 94,000 / 94,124 |  |
| geojson-slim | borough | 23.1 | 26.2 | 34.9 | 3,968 + 155 | 58 | 17 | 0 / 0 | 24 | 94,003 / 94,127 |  |
| lonboard | borough | 5.7 | 5.7 | 61.9 | 981 + 170 | 59 | 17 | 3 / 196 | 84 | all 856,687 uploaded |  |
| pmtiles | block | 0.8 | 0.8 | 0.1 | 258 + 148 | 60 | 17 | 0 / 0 | 23 | 601 / 601 | hover highlight throws (ml-37r.15) |
| pmtiles-nodrop | block | 1.0 | 1.0 | 0.1 | 256 + 150 | 59 | 17 | 0 / 0 | 23 | 601 / 601 | hover highlight throws (ml-37r.15) |
| gpq10k-view | block | 1.5 | 1.5 | 5.1 | 750 + 149 | 55 | 17 | 5 / 457 | 25 | 601 / 601 |  |
| gpq100k-view | block | 2.6 | 2.6 | 19.6 | 2,066 + 149 | 22 | 217 | 8 / 2,916 | 24 | – |  |
| gpq100k-all | block | – | – | 50.1 | 2,609 + 138 | – | – | – / – | – | – | **tab crashed** |
| fgb-view | block | 0.8 | 0.8 | 1.0 | 314 + 148 | 60 | 17 | 0 / 0 | 23 | 601 / 601 |  |
| fgb-all | block | 0.9 | 0.9 | 1.0 | 320 + 149 | 60 | 17 | 0 / 0 | 26 | 601 / 601 | auto by-view (>50 MB) |
| geojson-mn-slim | block | 2.1 | 2.1 | 1.9 | 536 + 149 | 60 | 17 | 0 / 0 | 26 | 601 / 601 |  |
| geojson-mn-full | block | 4.0 | 4.2 | 6.5 | 813 + 148 | 60 | 17 | 0 / 0 | 21 | – |  |
| geojson-slim | block | 22.1 | 22.1 | 34.9 | 3,957 + 149 | 60 | 17 | 0 / 0 | 26 | 601 / 601 |  |
| lonboard | block | 5.0 | 5.5 | 61.9 | 999 + 163 | 59 | 17 | 3 / 191 | 79 | all 856,687 uploaded |  |

Rows omitted: the Manhattan file at the Brooklyn view and the Brooklyn file
at the Midtown view (nothing of theirs is in view).

### 2.2 Student-laptop profiles

1 run each (Lonboard on the cgroup profile: 2 runs, both shown). Left:
DevTools CPU throttling 4× (main thread only) + 40/10 Mbit/s, 20 ms. Right:
the whole browser limited to 1.5 cores + the same network. Columns marked –
were not run on that profile.

| Variant | View | DevTools 4× CPU: first render s | idle s | pan FPS | 1.5-core cgroup: first render s | idle s | pan FPS | Notes |
|---|---|---|---|---|---|---|---|---|
| pmtiles | city | 2.5 | 2.5 | 59 | 3.4 | 3.8 | 53 |  |
| pmtiles-nodrop | city | 5.3 | 6.7 | 57 | 7.4 | 7.4 | 45 |  |
| gpq10k-view | city | 68.4 | 69.2 | – | – | – | – | drew after 68 s, then **tab crashed** |
| gpq100k-view | city | 74.5 | 75.4 | – | – | – | – | **tab crashed** |
| gpq100k-all | city | – | – | – | – | – | – | **tab crashed** |
| fgb-view | city | 139.8 | 140.7 | 54 | 136.0 | 136.0 | 10 | no frame for 30 s or more during load |
| fgb-all | city | 139.9 | 140.8 | 55 | – | – | – | no frame for 30 s or more during load |
| geojson-mn-slim | city | 5.4 | 5.4 | 59 | 6.2 | 6.2 | 50 |  |
| geojson-bk-slim | city | 20.2 | 20.2 | 60 | 17.6 | 18.6 | 41 |  |
| geojson-slim | city | 60.9 | 62.3 | 60 | 90.7 | 97.1 | 41 | no frame for 30 s or more during load |
| lonboard | city | 25.6 | 27.9 | 51 | 195, > 300 | – | 54 | no frame while the HTML parsed; one run gave up at 300 s |
| pmtiles | borough | 2.7 | 3.2 | 56 | 4.4 | 5.3 | 49 |  |
| pmtiles-nodrop | borough | 3.3 | 4.3 | 56 | 5.7 | 7.5 | 47 |  |
| gpq10k-view | borough | 14.4 | 15.0 | 12 | 16.6 | 18.1 | 12 |  |
| gpq100k-view | borough | 24.2 | 25.3 | 8 | – | – | – |  |
| gpq100k-all | borough | – | – | – | – | – | – | **froze, then crashed** |
| fgb-view | borough | 17.7 | 18.7 | 54 | 19.1 | 21.1 | 24 |  |
| fgb-all | borough | 18.1 | 19.2 | 53 | – | – | – |  |
| geojson-bk-slim | borough | 21.0 | 23.1 | 58 | 25.6 | 35.9 | 34 |  |
| geojson-slim | borough | 60.6 | 64.5 | 55 | 88.8 | 127.1 | 17 | no frame for 30 s or more during load |
| lonboard | borough | 25.9 | 28.2 | 43 | 48, > 300 | – | 54 | no frame while the HTML parsed; one run gave up at 300 s |
| pmtiles | block | 1.9 | 1.9 | 59 | 2.5 | 2.5 | 49 |  |
| pmtiles-nodrop | block | 2.0 | 2.0 | 59 | 3.2 | 3.2 | 51 |  |
| gpq10k-view | block | 4.1 | 4.1 | 34 | 5.1 | 5.1 | 32 |  |
| gpq100k-view | block | 8.5 | 8.5 | 17 | – | – | – |  |
| gpq100k-all | block | – | – | – | – | – | – | **tab crashed** |
| fgb-view | block | 2.5 | 2.5 | 58 | 3.6 | 3.6 | 51 |  |
| fgb-all | block | 2.5 | 2.5 | 59 | – | – | – |  |
| geojson-mn-slim | block | 5.0 | 5.0 | 60 | 6.4 | 6.4 | 56 |  |
| geojson-mn-full | block | 11.8 | 12.2 | 59 | – | – | – |  |
| geojson-slim | block | 58.5 | 58.5 | 60 | 87.2 | 87.2 | 32 |  |
| lonboard | block | 25.1 | 27.2 | 50 | 45, 274 | – | 52 | no frame while the HTML parsed |
| pmtiles | extrude | 2.7 | 3.2 | 44 | 5.2 | 6.0 | 44 |  |
| gpq10k-view | extrude | 13.5 | 14.5 | 9 | – | – | – |  |
| geojson-mn-slim | extrude | 5.2 | 5.7 | 56 | – | – | – |  |
| lonboard | extrude | 24.9 | 28.2 | 30 | 50.0 | 50.0 | 29 |  |

### 2.3 3D (fill-extrusion vs Lonboard `extruded=True`), Lower Manhattan, pitch 45

Notebook 07's map: land-use colours, height `NumFloors × 14` m.

| Variant | Profile | First render s | Data MB | Peak RAM MB (renderer + GPU) | Pan FPS | Pan p95 / max frame ms | Pan long tasks (n / ms) |
|---|---|---|---|---|---|---|---|
| pmtiles | desktop | 1.3 | 2.6 | 550 + 172 | **60** | 17 / 50 | 1 / 57 |
| geojson-mn-slim | desktop | 2.5 | 1.9 | 676 + 164 | 60 | 17 / 33 | 0 / 0 |
| gpq10k-view | desktop | 5.0 | 18.8 | 4,160 + 170 | 17 | 133 / 2,483 | 10 / 9,261 |
| lonboard | desktop | 5.0 | 62.2 | 1,055 + 170 | **28** | 200 / 900 | 9 / 3,056 |
| pmtiles | laptop (4×) | 2.7 | 2.6 | 544 + 171 | 44 | 33 / 150 | 2 / 217 |
| lonboard | laptop (4×) | 24.9 | 62.2 | 1,053 + 172 | 30 | 83 / 267 | 116 / 9,421 |
| pmtiles | laptop (1.5 cores) | 5.2 | 2.6 | 558 + 169 | 44 | 67 / 183 | 18 / 1,452 |
| lonboard | laptop (1.5 cores) | 50.0 | 62.2 | 989 + 166 | 29 | 183 / 567 | 14 / 2,728 |

The two renders are visually the same map (same view, colours and heights).

### 2.4 Bytes while panning

The pan sequence moves about 600 px and zooms in a level and back out.

| Variant, view | Data MB during the 7 s pan | Requests |
|---|---|---|
| pmtiles, city | 2.2 | 9 |
| pmtiles-nodrop, city | 13.6 | 6 |
| pmtiles, borough | 3.5 | 19 |
| gpq10k-view, borough | **126** | 867 |
| fgb-view, borough | **267** | 187 |
| fgb-view, city | **1,158** | 166 |
| geojson, lonboard (any) | 0 | 0 |

By-view sources re-read everything in view on every camera move; at borough
and city zoom that is most of the file each time (ml-37r.17).

---

## 3. What the numbers say

### 3.1 PMTiles is the only format that is fast at every zoom

- About 1 s to first render on the desktop and 2–5 s on both laptop
  profiles, at every view, with 0.1–3.3 MB per view. Memory stays at 260–460
  MB for the renderer, a third to a half of Lonboard's.
- Panning holds 59–60 fps on the desktop and 49–59 fps on the laptops, with
  no main-thread long tasks on the desktop: MapLibre parses tiles in workers.
- The cost is a build step (8 minutes for PLUTO, done once by whoever
  publishes the data) and generalisation below zoom 14 in the default build
  (§4). The no-drop build keeps every lot at every zoom for 18 MB per citywide
  view and 2.4 s.
- The one functional failure is hover highlight (ml-37r.15), which throws on
  every mouse move on a vector source. Popups work (20–30 ms).

### 3.2 GeoJSON: fine up to a few tens of thousands of lots

| File | Lots | gzip | Desktop first render | Laptop (4× / 1.5 cores) | Peak renderer RAM |
|---|---|---|---|---|---|
| Manhattan, slim | 42,023 | 1.9 MB | 2.0 s | 5.0 / 6.4 s | 0.5 GB |
| Manhattan, all 101 columns | 42,023 | 6.5 MB | 4.0 s | 11.8 s / – | 0.8 GB |
| Brooklyn, slim | 275,628 | 10.4 MB | 7–8 s | 20 / 18–26 s | 1.5–2.3 GB |
| Citywide, slim | 856,687 | 34.9 MB | 22 s | 59–61 / 87–91 s | 4.0 GB |

- Once loaded, every GeoJSON map pans at 58–60 fps on the desktop: MapLibre's
  worker tiles the data once and then behaves like vector tiles.
- The load cost is mostly maplibre-yaml's, not MapLibre's: core fetches and
  `JSON.parse`s the file **on the main thread**, keeps the parsed copy (443 MB
  of JS heap for citywide PLUTO), then clones it to MapLibre's worker. The
  citywide load is one **9.4 s main-thread long task** on the desktop, during
  which the page cannot paint or respond (ml-37r.18). Handing MapLibre the URL
  would move all of that to the worker.
- All 101 columns cost 3.4× the bytes and 2× the time of the 6 slim columns
  for the same map. Slimming columns is the cheapest win for GeoJSON and
  FlatGeobuf; GeoParquet does it automatically.

### 3.3 FlatGeobuf and GeoParquet read by view: good at block zoom only

- **Block zoom (601 lots):** FlatGeobuf 0.8 s / 1 MB, GeoParquet (10k-row
  groups) 1.5 s / 5 MB, both 55–60 fps. As good as PMTiles.
- **Borough zoom (94k lots):** 5 s and 20–36 MB on the desktop, 2.5–3 GB of
  renderer RAM, and **25 fps while panning** with 5 s of long tasks, because
  every camera move re-reads and re-decodes the view on the main thread (126
  MB of GeoParquet and 267 MB of FlatGeobuf downloaded during one 7 s pan). On
  the laptop profiles, 15–20 s to first render and 12–54 fps while panning.
- **Citywide zoom:** the view is the whole city. FlatGeobuf read 261 MB, took
  30 s (136–140 s on the laptops), peaked at 5.3 GB and panned at **8 fps**,
  downloading another 1.16 GB during the pan. GeoParquet drew after 25 s and
  then **crashed the tab**. `load: viewport`'s default `minzoom` (10) does not
  protect a dataset this dense (ml-37r.17).
- **Row-group size matters a lot for GeoParquet.** At block zoom 100k-row
  groups (Portolan's default) read 19.6 MB and used 2.1 GB to show 601 lots;
  10k-row groups read 5.1 MB and used 0.75 GB. At borough zoom: 51 vs 20 MB.
  This confirms the Portolan spike's advice (10k–20k-row groups) and ml-37r.11.
- **GeoParquet `load: all` (no `load:` key) crashed or froze the tab at every
  view.** The map reads 7 of 101 columns, which the footer says are 47 MB
  compressed, just under the 50 MB guard, so core decodes 857k rows on the main
  thread. The only message is a console warning ("may take a few seconds");
  no on-map notice (ml-37r.16). FlatGeobuf over 50 MB switches itself to by-view
  reading with a console note, which is safer, but at citywide zoom that is the
  261 MB read above.

### 3.4 3D

maplibre-yaml's `fill-extrusion` on PMTiles held **60 fps** (desktop) and 44
fps (both laptops) in notebook 07's 3D view. Lonboard's extruded
`PolygonLayer` managed **28–30 fps** on every profile, with frames up to 0.9 s
and 3–9 s of main-thread long tasks during the pan. This is the one place
where the comparison is about rendering rather than loading, and MapLibre
wins it clearly on this GPU.

### 3.5 Lonboard

- **Size:** the HTML embeds the GeoParquet of every row plus about 3 MB of
  JavaScript, so it grows with the data, not the view: 86 MB for citywide
  slim, 67 MB with only `LandUse`, 5.5 MB for one community district.
- **Load:** the reader downloads and parses all of it before the first frame:
  5–6 s on the desktop, 25 s with DevTools throttling (12 s of which is the
  download at 40 Mbit/s), and **45 s, 48 s, 195 s, 274 s, and more than 300 s twice**
  in six runs on the 1.5-core profile, during which the page produced no
  frame at all. maplibre-yaml's worst *working* case on that profile (citywide
  GeoJSON, 87–91 s) is in the same range; PMTiles is 3–5 s.
- **After loading** it is smooth for flat maps: 58–59 fps on the desktop,
  43–54 fps on the laptops, about 1 GB of renderer memory at every view.
- **Interaction:** tooltips on hover and the side panel on click worked;
  click-to-panel 75–85 ms on the desktop, 160–220 ms on the throttled profile
  (maplibre-yaml popups: 20–30 ms and 65–105 ms).
- **Hosting:** 86 MB is over Cloudflare Workers' 25 MiB per-asset limit, so the
  course site could not publish this map; that matches what the course repo
  shows (notebook 07's four citywide PLUTO maps were never exported).

### 3.6 What the map said

- No on-map notice appeared in any run except the `classify` refusals (§5).
- The FlatGeobuf auto-switch and the GeoParquet 47 MB warning are console-only.
  A student whose tab crashes on a GeoParquet file sees no explanation
  (ml-37r.16, ml-37r.17).
- The vector-tile highlight error was logged 338 times across the PMTiles runs
  (once per mouse move).

---

## 4. Feature completeness

**The requirement (maintainer, 2026-10-24):** no dropping beyond what you'd
expect from MapLibre. Ordinary generalisation is fine: lots smaller than a
pixel vanishing at citywide zoom, simplification, tippecanoe merging tiny
lots at low zoom. Analysis happens in Python first; the map has to represent
the data. **Not acceptable:** a library- or tool-imposed cap or sampling that
silently loses data, such as a fixed feature limit.

**Verdict:** no maplibre-yaml path caps or samples features. Every variant
that loads draws **every lot in view at block zoom**, and the PMTiles default
build has every lot from zoom 14. What disappears at lower zooms is MapLibre's
and tippecanoe's ordinary generalisation, sized below. Two things *are*
losses and need care: tippecanoe's `--use-attribute-for-id` drops the
attribute it promotes, and about 26 sliver lots (each under 0.2 m²) never
appear in any tile.

### 4.1 How small the lots are

| View | Zoom | Lots in view | Under 1 px² | Under ¼ px² | Median lot size |
|---|---|---|---|---|---|
| city | 10.5 | 775,200 | **754,580 (97%)** | 638,971 | 0.14 px² |
| borough | 13 | 94,127 | 491 (0.5%) | 183 | 3.8 px² |
| block | 16 | 601 | 0 | 0 | 732 px² |

At citywide zoom almost every lot is smaller than a pixel. Whatever the
renderer, what the reader sees there is the colour of blocks and
neighbourhoods, not lots: a GPU only shades a pixel whose centre a polygon
covers, so Lonboard's 857k sub-pixel triangles and MapLibre's generalised
tiles produce much the same picture.

### 4.2 Lots drawn per variant

Distinct lots returned by `queryRenderedFeatures` over the whole viewport
after idle, against the lots intersecting the same bounds (for a borough
file, against that borough's lots in view).

| Variant | Citywide (z10.5) | Borough (z13) | Block (z16) | Meets "no drop beyond MapLibre's"? | Cost of that completeness |
|---|---|---|---|---|---|
| PMTiles, default build | 9,753 / 775,200 (merged shapes) | 46,820 / 94,127 (merged) | 601 / 601 | **Yes**: all lots from zoom 14; merging below is tippecanoe's generalisation | 1.2 / 3.3 / 0.1 MB per view; 60 fps |
| PMTiles, no-drop build | **774,689 / 775,200** | 94,120 / 94,127 | 601 / 601 | Yes, and nearly every lot at every zoom | 17.7 MB citywide view (8.4 MB z10 tiles), 2.4 s, 1.6 GB renderer RAM, 57 fps; laptops 5–7 s, 45–57 fps |
| GeoJSON (MapLibre default `tolerance: 0.375`) | 106,168 / 775,200 | 94,003 / 94,127 | 601 / 601 | **Yes**: geojson-vt skips rings below about a pixel at each zoom | as §3.2 |
| GeoJSON, Manhattan, `tolerance: 0` | 40,203 / 40,203 | – | 601 / 601 | Yes, every lot | 3.0 s vs 2.0 s, 878 vs 523 MB |
| GeoJSON, `tolerance: 0`, Brooklyn or citywide | page froze or crashed | page froze or crashed | crashed | – | not usable above ~100k lots |
| FlatGeobuf / GeoParquet by view (default tolerance) | 106,153 / 775,200 (FlatGeobuf; GeoParquet crashed) | 94,000 / 94,127 | 601 / 601 | Yes (same tiler as GeoJSON) | as §3.3 |
| FlatGeobuf / GeoParquet by view, `tolerance: 0` | froze | **94,124 / 94,127** | 601 / 601 | Yes | +1 s, +0.7 GB at borough zoom |
| Lonboard | all 856,687 rows uploaded to the GPU | same | same | Yes (nothing is dropped, sub-pixel lots rasterise to nothing) | 62 MB per reader, every view |

- **`tolerance` passes through.** maplibre-yaml forwards a GeoJSON source's
  `tolerance` (and `buffer`) to MapLibre, also for FlatGeobuf and GeoParquet
  sources (the style's source spec showed `tolerance: 0`), and the schema
  accepts it. No bead needed. `tolerance: 0` does stop geojson-vt from
  skipping sub-pixel rings (Manhattan at citywide zoom: 11,810 → 40,203 lots
  drawn), but on 275k+ lots it made the tab freeze or crash, so it is a knob
  for small files only. `buffer` only changes how far features extend past a
  tile edge; it doesn't drop or keep features.
- **No library cap exists in core today.** The only feature cap in the
  ecosystem is the planned Python inline preview (5,000 per source, ml-37r.2
  D10). It must stay a *preview* and say so on the map ("Showing 5,000 of
  20,000 features"), which the design already specifies; the site path never
  samples.

### 4.3 PMTiles settings for parcels

| Flag | What it does to completeness | Verdict for parcels |
|---|---|---|
| `--coalesce-densest-as-needed` | Merges neighbouring lots into one shape (one lot's attributes) until tiles fit 500 KB. Here: lots merged below zoom 14, all back at 14. | **Recommended default.** No holes in the fabric; generalisation only. A click at zoom 10–13 reports one lot of a merged block. |
| `--extend-zooms-if-still-dropping` | Adds zooms past `-z` until nothing is dropped at the max zoom. | Keep: guarantees completeness at the top zoom. |
| `--drop-densest-as-needed` / `--drop-fraction-as-needed` | Drops lots (leaves holes) at low zooms; they return at higher zooms. | Acceptable by the rule, but holes in a parcel fabric look like vacant land; prefer coalescing. |
| `--no-feature-limit --no-tile-size-limit` | Keeps every lot in every tile. | Use when the citywide view itself must be lot-accurate: 162 MB archive, 8.4 MB z10 tiles, 18 MB per citywide view, still 57 fps. |
| `--no-tiny-polygon-reduction` | Stops tippecanoe replacing sub-pixel polygons with representative squares at low zoom. | Only matters with the no-drop build; harmless. |
| `--use-attribute-for-id=BBL` | Moves `BBL` into the feature id and **removes it from the properties**. A popup or filter on `BBL` gets nothing. | **Avoid: real attribute loss.** Keep `BBL` as a property and set `promoteId: { pluto: BBL }` on the vector source (the schema accepts `promoteId` on vector sources; not exercised in this bench). |
| `-z16` (max zoom 16) | 26 sliver lots (each under 0.2 m², 24 of them land use `11`) collapse to nothing at the tile grid of zoom 16 and appear in no tile. The no-drop build loses 15 (all under 3.4 m²). | Expected generalisation; `-z17` or `--full-detail` would keep them if it matters. |

Recommended command for course parcel data:

```bash
tippecanoe -o pluto.pmtiles -l pluto -Z10 -z16 \
  --coalesce-densest-as-needed --extend-zooms-if-still-dropping \
  pluto_slim.fgb          # BBL stays a property; promoteId: { pluto: BBL } in the YAML
```

### 4.4 Does anything need deck.gl for completeness?

No. The no-drop PMTiles build already draws 774,689 of the 775,200 lots in
the citywide view through plain MapLibre, faster than Lonboard (2.4 s vs
5.6 s, 1.6 GB vs 1.0 GB renderer RAM, 57 vs 58 fps). Per the maintainer's
clarification, sub-pixel lots disappearing at citywide zoom is expected, so
completeness is not a reason to revisit ml-rzm; performance isn't either (§8).

---

## 5. `classify:` and computed breaks

Every variant was also loaded at borough zoom with
`classify: { field: NumFloors, method: quantile, classes: 5, palette: YlOrRd }`.

| Source | Result |
|---|---|
| GeoJSON (Brooklyn, 275k lots) | **Works.** Breaks computed in the browser over all 275,628 lots (10,638 without a value). Quantiles of `NumFloors` collapse (most lots have 2 or 3 floors), so 5 requested classes became 3 (`breaks: [2, 3]`), as the thematic-maps guide says can happen. |
| PMTiles | **Refused by validation**, whole map replaced by the error card: "`method:` computes breaks from the whole dataset, and layer "lots" draws from a vector source: the browser only ever sees the tiles in view… Write the class thresholds yourself with `breaks:`…" |
| FlatGeobuf / GeoParquet with `load: viewport` | **Refused by validation**, same error card: "…layer "lots"'s source loads only the features in view (`load: viewport`)… Use `load: all`, or write `breaks:` yourself." |
| FlatGeobuf over 50 MB without `load:` (auto by-view) | **Refused at load time** with the on-map notice "Layer lots can't compute its classes: source fgb-all is read by view… Write the class thresholds yourself with `breaks:`, for example `breaks: [10, 25, 50]`." The rest of the map draws; the layer doesn't. |
| GeoParquet without `load:` | Never got that far: the tab crashed decoding the file (ml-37r.16). |

Categorical `classify:` (the land-use map) needs no data scan and worked on
every source, PMTiles included, with an automatic legend.

The refusals are right and well worded. For the course they mean the same
thing the Python design already concluded: **compute breaks in the notebook
(mapclassify, on the full data) and write them as `breaks:`**. That keeps the
classes identical across analysis, preview and site, and it is the only way
to classify a PMTiles or by-view layer. One rough edge: a `method:` on a
by-view source is a validation error that blanks the whole map, while the
same mistake on an auto-by-view FlatGeobuf is a notice that blanks only the
layer. Both are defensible; the difference is worth a sentence in the
notebooks guide (ml-37r.4).

---

## 6. Recommendation for students

| What you're mapping | Use | Why (this benchmark) |
|---|---|---|
| **PLUTO citywide**, or anything over ~300k polygons, viewed from zoom 10 up | **PMTiles** (§4.3 command), `type: vector`, `promoteId`, categorical `classify:` or explicit `breaks:` | 1 s on a desktop, 2–5 s on a weak laptop, 60 fps, 0.1–3 MB per view; every lot from zoom 14. The only format that is good at citywide zoom. |
| **One borough** (~100k–300k lots), viewed at zoom 13+ | **GeoParquet by view with 10k-row groups**, or **FlatGeobuf by view** (slim columns), with `load: { mode: viewport, minzoom: 13 }` | No build step; 5 s on a desktop at borough zoom, ~1 s at block zoom. On a weak laptop or when the map opens at borough zoom, PMTiles is still 4× faster. |
| **A community district or a few neighbourhoods** (under ~50k lots, ~20 MB raw) | **GeoJSON** (or a whole-file FlatGeobuf/GeoParquet) | 2 s desktop, 5–6 s laptop, 60 fps, `classify: method:` works. Keep only the columns you show. |
| Up to ~300k lots as GeoJSON | Works, but 8 s desktop / 20–25 s laptop and 2 GB of RAM | Prefer the by-view formats or PMTiles. |
| **Never** | GeoParquet citywide without `load:` (crashes the tab); any by-view source opened at citywide zoom (5 GB, 8 fps, or a crash); full-column GeoJSON (1.7 GB, unparseable) | ml-37r.16, ml-37r.17 |

In one sentence for the course: *PLUTO citywide: PMTiles; a borough:
GeoParquet (10k-row groups) or FlatGeobuf read by view from zoom 13; under
about 50,000 lots: GeoJSON is fine.*

---

## 7. The Python package's default writer

The package design (PR #204) makes GeoParquet the default writer and caps the
inline preview at 5,000 features. For PLUTO-scale frames:

1. **Default to PMTiles above about 100k features** when `tippecanoe` is on
   the PATH, with the §4.3 settings (`-Z10 -z16 --coalesce-densest-as-needed
   --extend-zooms-if-still-dropping`, no `--use-attribute-for-id`; write
   `promoteId` for the id column) and the frame's columns limited to those the
   map uses. Measured cost: 8 minutes for 857k lots on 6 cores, which belongs in
   a "build data" cell, not the map cell; print the time estimate.
2. **Otherwise GeoParquet with `viewport=True`, `row_group_size=10_000`**
   (not the 100k Portolan default: 4× the bytes and 3× the memory per view),
   Hilbert-sorted, `bbox` covering column, ZSTD, and **`load: { mode:
   viewport, minzoom: 13 }`** in the YAML. Emit a warning that the map is
   blank below zoom 13, and that PMTiles is the citywide answer.
3. **Whole-file GeoParquet only under about 100k features** (and whole-file
   GeoJSON under about 50k) until ml-37r.16/ml-37r.18 land: the 47 MB
   PLUTO file crashes the tab today.
4. **Never inline PLUTO-scale data** in the notebook output; the 5,000-feature
   preview is fine as long as the preview says it is a sample and the site
   build reads the full file (D10 already says so).
5. **Breaks from mapclassify, written as `breaks:`**, always (§5).

Pass the decision into `explore()` too: `explore(pluto)` on 857k rows should
write PMTiles (or warn and write by-view GeoParquet), not a whole-file
GeoParquet that crashes the preview.

---

## 8. Is a deck.gl-backed layer type warranted?

**No.** The case for deck.gl would be "MapLibre can't draw PLUTO-scale
data; deck.gl can". The measurements say otherwise:

- **MapLibre draws PLUTO fine once the data is tiled.** PMTiles is faster to
  first render, smaller in memory, lighter on the network and smoother to
  pan than Lonboard at every view measured, and its 3D view (MapLibre
  `fill-extrusion`) holds 60 fps where Lonboard's extruded `PolygonLayer`
  drops to about 28 fps with 0.9 s stalls (§3.4).
- **Even untiled, MapLibre's own GeoJSON path handles all 857k lots** on a
  desktop (60 fps after loading). What hurts is the *loading*: core parses
  on the main thread and holds a copy (ml-37r.18). That is a core fix, not a
  renderer change.
- **What deck/Lonboard really offers is "no tiling step"**: binary GeoArrow
  in, every feature drawn at every zoom. In the course that matters only
  inside a live notebook, where a student explores a fresh GeoDataFrame
  before writing any file. The Python design already routes that case to
  anywidget in Phase 2 (`[widget]` extra, §7.1 of the package design), which
  streams GeoParquet bytes to core; and Lonboard itself stays available in
  notebooks for exploration. Neither needs a deck layer type inside
  maplibre-yaml documents.
- **The earlier deck spike (ml-rzm, PR #114, closed as a bead 2026-10-04)**
  measured deck.gl's integration cost in this codebase: about 241–307 KB
  gzipped of deck/luma/loaders (lazy loading mandatory); `MapLibreOverlay`
  silently losing interleaving when attached before `isStyleLoaded()`; deck's
  animation loop polling rAF 60×/s while idle; loaders.gl fetching its worker
  from unpkg at runtime (CSP/offline/privacy); tiles fetched twice (once by
  MapLibre, once by deck); no recovery from WebGL context loss; and an
  apache-arrow dependency that changed the workspace's `@types/node`. Plan
  Amendment A1 (D-A1) dropped deck as the effects backend in favour of a
  MapLibre custom layer, and general deck layer types stayed "deferred until
  demand shows". Picking/hover was never tested in that spike, so a deck
  layer would also need its own popup/highlight wiring to match
  `interactive:`.

**When to re-open:** if the course (or map-party) needs to show more than
about 1M features *without* a tiling or by-view step in a published page,
for example point clouds or trips animations, or GeoArrow-native GeoParquet
read straight into GPU buffers (ml-cnv.13). Even then, the first thing to try
is a MapLibre custom layer fed from GeoArrow (the route that won ml-rzm), not
deck.gl.

PR #114 is still open as a draft although its bead is closed; it can be
closed as stale housekeeping.

---

## 9. Lonboard and Folium features the course uses, mapped

From every notebook in `mapping-systems/cdp-mapping-systems@main`
(`content/Tutorials/*.ipynb`), its `requirements.txt` (lonboard 0.16.0,
folium 0.20.0, leafmap 0.62.0, mapclassify 2.10.0) and its build script.
**Lonboard is the course's interactive map tool, and only its simple parts
are used:** `PolygonLayer`, colour by column, 3D extrusion, a camera. Folium
is pinned but never imported; `geopandas.explore()` appears once.

| Course feature | Where | Lonboard / Folium API | maplibre-yaml equivalent | Status |
|---|---|---|---|---|
| Polygon layer from a GeoDataFrame | 01, 07, 08 | `PolygonLayer.from_geopandas(df[["LandUse","geometry"]], …)` | a `fill` layer on a source from a file (`.parquet`, `.fgb`, `.geojson`, `.pmtiles`); Python: `Map.add(gdf)` writes the file (ml-37r.2) | ✓ |
| Categorical fill by column | 07, 08 | `get_fill_color=apply_categorical_cmap(df["LandUse"], cmap={…})` | `classify: { field: LandUse, categories: { "01": "#…", … }, other: "#ccc" }` | ✓, with a legend Lonboard doesn't have. Codes show as `01`…`11` in the legend unless the data carries names or the top-level `legend.items` relabels them. |
| Continuous fill, log-scaled | 01, 07 | `get_fill_color=apply_continuous_cmap(LogNorm(1, max)(v), PuRd_9)` | classed: `classify: { method: quantile, palette: PuRd }` or explicit `breaks:`; unclassed: hand-written `["interpolate", ["linear"], ["ln", ["get", …]], …]` in `paint:` | ◐ classed works; unclassed log ramp with a legend is **ml-37r.19** |
| Constant RGBA fill | 08 | `get_fill_color=[240,240,240,155]` | `paint: { fill-color: "#f0f0f0", fill-opacity: 0.6 }` | ✓ |
| 3D extrusion by column | 01, 07, 08 | `extruded=True, get_elevation=df["NumFloors"]*14` | `type: fill-extrusion`, `paint: { fill-extrusion-height: ["*", ["get", "NumFloors"], 14] }`; `classify:` colours it | ✓, 60 fps vs Lonboard's 28 (§3.4) |
| Wireframe, layer opacity | 01 | `wireframe=True, opacity=0.5` | `fill-extrusion-opacity`; an outline is a second `line` layer (no wireframe for extrusions) | ◐ no extrusion wireframe; not worth a bead |
| Camera with pitch and bearing | 01, 07, 08 | `view_state={longitude, latitude, zoom, pitch, bearing}` | `config: { center, zoom, pitch, bearing }` | ✓ |
| Two layers on one map | 01, 08 | `Map([layer, layer_tract])` | two entries in `layers:`; `label:` adds a layer toggle the course never had | ✓ |
| Click → attribute panel | 08 (Lonboard default) | `pickable=True` → side panel | `interactive.click.popup:` listing chosen properties, formatted | ✓ (popups opened in 20–30 ms vs 75–85 ms for Lonboard's panel) |
| Hover tooltip | Lonboard 0.16 default off in exports | `show_tooltip` | `interactive.hover.popup:` | ✓ |
| Hover highlight | not used (`auto_highlight` false in exports) | `auto_highlight=True` | `interactive.hover.highlight: true` | ✓ on GeoJSON/FlatGeobuf/GeoParquet; **broken on PMTiles (ml-37r.15)** |
| Basemap | all (default only) | Lonboard default CARTO Positron no-labels | `config.mapStyle:` any style URL (same CARTO URL works), OpenFreeMap, or a Protomaps `.pmtiles` | ✓ |
| Basemap switching | not used | — | none built in (one `mapStyle` per map) | not needed by the course; no bead |
| Layer control / toggles | not used | — | `label:` on a layer gives a checkbox panel | ✓ |
| Legend | none on interactive maps (only matplotlib) | — | automatic for `classify:`; `legend:` block | ✓ (an improvement) |
| mapclassify schemes | 01, 02 (static `.plot()` only) | `gdf.plot(scheme="quantiles" / "naturalbreaks")` | `method: quantile | equal | jenks`, or the Python helper writes mapclassify's `bins` as `breaks:` | ✓ |
| `to_html` → iframe in the site | build script | `Map.to_html("public/maps/…/map-NNN.html")`, 4.6–7.4 MB each | `<ml-map src=…>` (a few KB of YAML) plus a data file read in parts | ✓; 86 MB for citywide PLUTO in Lonboard vs 1–3 MB per view from PMTiles |
| `geopandas.explore()` | 08 (one bbox polygon) | Folium | Python `explore(gdf)` → `Map` (ml-37r.2), inline preview | ✓ (planned) |
| leafmap raster + colorbar | 09 (not exported to the site) | `m.add_raster(img, cmap="PiYG", vmin, vmax)`, `add_colormap` | a COG `raster` source with `colorRamp:` and a legend entry | ✓ for display; not part of this benchmark |

---

## 10. Follow-up beads

All under the epic ml-37r, unlabeled for triage.

| Bead | Kind | Summary |
|---|---|---|
| **ml-37r.15** | bug, P2 | `hover.highlight` on a vector (PMTiles) source throws on every mouse move: `setFeatureState` is called without `sourceLayer` (`interactions/built-ins.ts`). |
| **ml-37r.16** | bug, P2 | GeoParquet `load: all`: the 50 MB guard counts compressed column bytes; citywide PLUTO (857k rows, 47 MB) passes and hangs or crashes the tab with no notice. Guard on `num_rows` and uncompressed sizes; fall back to by-view or refuse. |
| **ml-37r.17** | bug, P2 | `load: viewport` has no budget per view: at citywide zoom PLUTO reads the whole file (FlatGeobuf 261 MB + 1.16 GB while panning, 5 GB, 8 fps; GeoParquet crashes). Estimate the view's cost before reading and show "zoom in" instead. |
| **ml-37r.18** | feature, P2 | GeoJSON `url:` is fetched and parsed on the main thread, kept, and cloned to the worker (9.4 s long task, 443 MB heap for citywide PLUTO); FlatGeobuf and GeoParquet decode on the main thread too. Let MapLibre's worker fetch GeoJSON; decode the cloud formats in a worker. |
| **ml-37r.19** | feature, P3 | `classify:` has no unclassed continuous ramp (the course's `apply_continuous_cmap(LogNorm(...))`); add one with a gradient legend and a log scale. |
| **ml-37r.20** | docs, P3 | PMTiles guide: a recipe for parcel fabrics (§4.3 settings, `promoteId` instead of `--use-attribute-for-id`, what low zooms generalise). |

Not filed: a deck.gl layer type (§8), a basemap switcher (the course doesn't
use one), an extrusion wireframe, and `tolerance` passthrough (it already
works). Comments with this benchmark's numbers were added to ml-37r.2 (writer
defaults) and ml-37r.11 (row-group pruning).

---

## Appendix: reproducing

The bench lived in a scratch directory and was deleted with the data (it is
throwaway). To rebuild it:

1. **Data.** Download
   `https://s-media.nyc.gov/agencies/dcp/assets/files/zip/data-tools/bytes/mappluto/nyc_mappluto_26v2_fgdb.zip`.
   In Python (uv venv: `lonboard geopandas pyarrow pyogrio`):
   ```python
   gdf = pyogrio.read_dataframe("MapPLUTO26v2.gdb", layer="MapPLUTO_26v2_clipped", use_arrow=True).to_crs(4326)
   gdf["BBL"] = gdf["BBL"].astype("int64")
   gdf = gdf.iloc[gdf.geometry.hilbert_distance().argsort()]
   gdf.to_parquet("pluto_full_rg10k.parquet", schema_version="1.1.0", write_covering_bbox=True,
                  compression="zstd", row_group_size=10_000)       # and 100_000
   slim = gdf[["LandUse","NumFloors","YearBuilt","AssessTot","BBL","Address","geometry"]]
   pyogrio.write_dataframe(slim, "pluto_slim.fgb", driver="FlatGeobuf", layer_options={"SPATIAL_INDEX": "YES"})
   pyogrio.write_dataframe(slim, "pluto_slim.geojson", driver="GeoJSON",
                           layer_options={"COORDINATE_PRECISION": "6", "RFC7946": "YES"})
   ```
   PMTiles: the tippecanoe command in §1.3 (tippecanoe built from
   `github.com/felt/tippecanoe` in an `alpine:3.20` container: `build-base
   sqlite-dev zlib-dev`). Lonboard: §1.4.
2. **Pages.** `npm pack @maplibre-yaml/core@0.9.1 maplibre-gl@6.15.0`, an HTML
   page with the import map pointing at the local `maplibre-gl.mjs` and
   `register.js`, and `<ml-map src="configs/<variant>--<view>.yaml">`. Serve
   with any server that answers range requests and gzips `.geojson`/`.html`.
3. **Browser.** `docker run --network host --device /dev/dri --group-add
   <render gid> --group-add <video gid> mcr.microsoft.com/playwright:v1.60.0-noble`
   with Chromium flags `--use-gl=angle --use-angle=gl-egl
   --ignore-gpu-blocklist --enable-gpu` (Vulkan ANGLE falls back to llvmpipe
   or SwiftShader on this box). Check
   `WEBGL_debug_renderer_info` says UHD 630 before trusting numbers. The
   cgroup profile adds `--cpus=1.5`.
4. **Measurements** as described in §1.6: screenshots with a saturated-pixel
   count for first render (the basemap is grey, the land-use palette is
   saturated), CDP `Network.loadingFinished` for bytes (workers attached via
   `Target.attachToTarget`), `/proc/<pid>/status` VmRSS for memory,
   `PerformanceObserver` (`longtask`, `event`) and a rAF loop for frames.
   Wrap every `page.evaluate` in a timeout: a page whose main thread is stuck
   decoding never answers.
