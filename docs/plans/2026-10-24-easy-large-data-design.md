---
title: Easy large data — geo:overviews GeoParquet, tylertoo and freestiler (spike)
type: design
date: 2026-10-24
topic: easy-large-data
beads: ml-cnv.20 (this spike; parent epic ml-cnv); follow-ups listed in §12
target: core 0.10 (reader, notices, docs), the Python package (ml-37r.2, PR #204), the CLI
status: findings — recommendations for the maintainer
builds-on: PLUTO benchmark (PR #205), 0.9.2 limits (PR #206), Python package design (PR #204), Portolan compatibility (PR #203)
---

# Easy large data (spike)

**Goal (maintainer, 2026-10-24):** an author points maplibre-yaml at their
data and it works at every zoom, with no format expertise: fast, interactive
(popups, hover, `classify:`, legend), no tab crashes, and no "zoom in" wall
when a reasonable overview is possible. For any user, not just the course.

**Question (ml-cnv.20):** two new Rust tools could help.
[tylertoo](https://github.com/geoparquet-io/tylertoo) (GeoParquet to PMTiles,
by the geoparquet-io org) writes a `geo:overviews` GeoParquet file: a
GeoParquet file that carries its own zoom pyramid.
[freestiler](https://github.com/walkerke/freestiler) (Kyle Walker) tiles
in memory and also writes MapLibre Tiles (MLT). Can core read the overview
level that matches the zoom? Can either tool replace tippecanoe for building
PMTiles? What is the easy path for each audience?

**Short answer.**

- **Reading `geo:overviews` is cheap and worth doing.** The levels are row
  groups, listed in one footer key, so choosing a level costs nothing beyond
  the footer core already reads. A prototype of about 100 added lines in
  core's GeoParquet reader (§3) turns citywide PLUTO from 0.9.2's "zoom in" line into
  a map that draws in **1.7–1.8 s from 2.3 MB at 0.7 GB, panning at 52 fps**.
  Block zoom is unchanged (601 of 601 lots, 1.7 s). Popups, hover highlight
  and `promoteId` work at every level, because each overview row is a real
  feature with all its attributes.
- **But the overview is only as good as the producer's generalisation.**
  tylertoo 0.8.0's defaults (the release on PyPI) keep the *largest* lots at
  coarse levels and drop the rest. On a parcel fabric this draws parks and
  institutions and loses the residential fabric: **19% of the screen coloured
  at citywide zoom against 37% for PMTiles**, and holes at borough zoom (61%
  against 75%). Turning the thinning off fills borough zoom (75%) but then costs
  as much as the plain by-view read (6.5 s, 3 GB, 25 fps). Placeholder squares
  (tylertoo main's new default) fill citywide zoom but put 224,000 features in
  that view, over core's per-view budget. With the budget raised it takes
  9.9 s, 3.5 GB and pans at 15 fps. For **dense polygon coverages
  (parcels, buildings), PMTiles is still the citywide answer.** Overviews are
  the safety net that removes the wall, and the right format for sparser data
  or when the GeoParquet file itself is the deliverable.
- **tylertoo replaces tippecanoe for building PMTiles.** On PLUTO it builds a
  parcel archive in **21 s and 1.4 GB of memory, against tippecanoe's
  8 min 40 s and 3.2 GB.** The archive is 111 MB (tippecanoe: 125 MB). The
  citywide view draws in 2.7 s from 7.3 MB at 60 fps, with the same coloured
  coverage as tippecanoe (36.5% against 37.1%). Every lot is present at z14
  (856,554 of 856,687; tippecanoe has 856,578), and `BBL` stays a property, so
  `promoteId` and popups work. It ships wheels for Linux (x86-64, arm64,
  musl), macOS (Intel, Apple) and Windows, with no Python dependencies. **The
  0.8.0 defaults need two settings for parcels** (§5.2): placeholder squares
  on, and the tile size cap off. With its 500 KB cap, 0.8.0 *drops* features
  from oversized tiles. That leaves 40,047 lots missing at its top zoom, and
  holes at every zoom.
- **freestiler is a good engine with the wrong defaults for this job.** It
  thins nothing by default, so every lot is in every tile (179 MB archive,
  14.5 MB tiles at z10, 31 MB and 6.5 s for the citywide view). Its 0.3.0
  wheels can't read zstd GeoParquet with their own reader, and there are no
  Intel-Mac or Linux-arm wheels. It stays the R-world recommendation.
- **MLT works in MapLibre today except for 64-bit integers.** maplibre-gl
  6.12 and 6.15 draw freestiler's MLT archive when the source says
  `encoding: mlt`, which maplibre-yaml already passes through. The archive is
  41% smaller and the citywide view reads 44% fewer bytes than MVT. But any
  int64 column (`BBL`) makes every tile fail with "Do not know how to serialize
  a BigInt", in plain MapLibre too. That is an upstream bug.
- **The easy path** is a docs page that picks the format by size with one
  command each, tylertoo as the PMTiles builder everywhere, a `format="auto"`
  writer in the Python package, and notices that name the fix (§8).

---

## 0. Decisions at a glance

| # | Decision |
|---|---|
| D1 | **Core reads `geo:overviews` automatically when it reads GeoParquet by view.** It picks the finest level whose `zoom` is at most the map's zoom, rounded down. That is the zoom a PMTiles archive would serve. It reads only that level's row groups in view and checks the per-view budget against that level. **No YAML change:** `url: data/pluto.parquet` just works. Experimental in 0.10, version-gated to spec major 0 (§3, §7). |
| D2 | **Core must handle an overview file correctly even before D1 is complete.** A whole-file read, `classify:` breaks and `mlym emit` read only the canonical level, and the whole-file guards count only its rows. A reader that ignores the key draws each lot several times: 2,201 features for 601 lots at block zoom on 0.9.2 (§3.4). This ships with D1 and is the part that can't wait. |
| D3 | **One escape hatch, no other knobs:** `load: { overviews: false }` reads the canonical rows only, for debugging or for a producer whose coarse levels look wrong. No level bias or per-level options in 0.10. |
| D4 | **For dense polygon coverages, PMTiles stays the citywide recommendation.** tylertoo 0.8.0's coarse levels drop most of the fabric (§4.2). Overviews are recommended for points, lines, sparse polygons, and for the case where the GeoParquet file is the deliverable. Re-measure on tylertoo's next release, whose new defaults (placeholder squares, coverage fill) target exactly this. |
| D5 | **Budget-aware level choice (after 0.10):** when the zoom's level holds more than `maxFeatures` in view, read the next coarser level that fits instead of showing "zoom in". Only when no level fits does the wall appear. |
| D6 | **tylertoo is the recommended PMTiles builder** in the docs and the Python package. Parcel recipe for 0.8.0: `collapse_square=True` and `tile_size_limit=None` (§5.2). 21 s, 1.4 GB, 111 MB, every lot at z14, `BBL` kept; the citywide view takes 2.7 s and 7.3 MB at 60 fps, with tippecanoe's coverage. The 0.8.0 default cap drops features, so it must be off. tippecanoe remains documented as the reference tool. |
| D7 | **freestiler is not the default** (§5.4). Mention it for R users, and for MLT once MapLibre reads int64. |
| D8 | **MLT:** core sets `encoding: mlt` itself when the PMTiles header says MLT (tile type 6), and turns the BigInt decode failure into a notice that names the fix. Don't recommend MLT until maplibre-gl reads int64 columns (report upstream). |
| D9 | **`classify: method:` on GeoParquet read by view:** compute the breaks from a column-only read of the canonical rows instead of refusing. PLUTO: 0.3–2 MB and about 0.5 s per numeric column (§7.3). |
| D10 | **Docs first, a Node advisor second, no bundled tiler.** One "Large data" guide picks the format by size and gives one command per path (§8.1). `mlym prepare <file>` inspects a file and prints the recommended command; `--run` (later) shells out to tylertoo only when it is installed. |
| D11 | **Python package (PR #204):** `add(gdf)` gets `format="auto"`, which decides by size: whole GeoParquet up to 50,000 features, by-view GeoParquet up to 250,000, and PMTiles built by tylertoo above that or for dense polygon coverages. tylertoo goes in the `[geo]` extra (a 10–12 MB wheel with no dependencies), pinned to a minor version. tippecanoe is only used when asked for (§8.2). |
| D12 | **Notices name the fix.** The reader's line stays "zoom in". The author hint behind it gains the command for the source's format (overviews or PMTiles), and there are new hints for an overview level that is itself too dense, an unknown spec version, and MLT int64 (§8.3). |
| D13 | **Spec risk is contained, not avoided.** Draft 0.2.0, one writer, standardisation not yet filed (tylertoo#701), stability promise not yet declared (#441), defaults that changed after the last release. The reader depends only on the layout (levels as row-group ranges, which hasn't changed since 0.1.0). It also accepts the planned `geo.overviews` location and refuses an unknown major version. The docs pin the recipe flags and call the feature experimental (§10). |

---

## 1. Setup

Same data, machine and harness as the PLUTO benchmark (PR #205, §1), rebuilt
for this spike:

- **Data:** MapPLUTO 26v2, 856,687 lots. Reprojected to EPSG:4326,
  Hilbert-sorted, and written as GeoParquet 1.1 with a bbox covering column,
  ZSTD and 10k-row groups. "Full" keeps all 101 columns (146 MB). "Slim" keeps
  the 6 columns the maps use (`LandUse`, `NumFloors`, `YearBuilt`,
  `AssessTot`, `BBL` as int64, `Address`) and is 81 MB.
- **Machine:** i7-8700 (6 cores, 12 threads), 14 GB, Intel UHD 630. Chromium
  from the Playwright 1.60 headless shell with the real GPU (WebGL reports
  `ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL ES 3.2)`),
  1280×800. The box was shared with other work during the spike (load average
  3–10), so treat build times as ±20%.
- **Library:** core from the 0.9.2 branch (PR #206, `b80ed39`), which has the
  whole-file limits and the per-view budget. The prototype patch is §3,
  applied to a scratch copy only. maplibre-gl 6.12.0, plus 6.15.0 for the MLT
  check.
- **Harness:** a fresh browser per run. Screenshots until stable give *first
  render* (half the final count of saturated pixels) and *idle*. Data bytes
  are the `/data/` responses. *Peak RSS* is the renderer and GPU processes from
  `/proc`. Hover is a pointer moved onto a lot, then the feature's
  `feature-state`. *Popup* is click to popup text, including a 50 ms settle.
  *Pan* is four drags and seven wheel steps at 60 Hz with rAF frame timing.
  *Lots* is the number of distinct `BBL` values from `queryRenderedFeatures`
  after idle. *Coverage* is the share of the 1280×800 frame that is
  land-use-coloured: the fabric a reader actually sees. It includes the
  legend swatches, about 0.7%. Two runs per cell on
  the desktop profile; one run on the "laptop" profile (the whole browser
  limited to 1.5 cores by the container).
- **Document:** the benchmark's land-use map with categorical `classify:`, a
  popup with `Address`/`LandUse`/`BBL`, and `hover: { highlight: true }`.
  `promoteId: BBL` on GeoJSON-backed sources and `promoteId: { pluto: BBL }` on
  PMTiles.
- **Views:** city (−73.94, 40.70, z10.5, 775,200 lots in view), borough
  (−73.95, 40.66, z13, 94,127), block (−73.985, 40.755, z16, 601).

---

## 2. What a `geo:overviews` file is

Spec: [`context/OVERVIEWS_SPEC.md`](https://github.com/geoparquet-io/tylertoo/blob/main/context/OVERVIEWS_SPEC.md),
version **0.2.0, draft**, CC BY 4.0, rendered at
<https://geoparquet-io.github.io/tylertoo/spec/overviews/>.

### 2.1 Encoding

- **Levels are rows, not columns.** Each level is a generalised copy of the
  dataset (`duplicating` mode, the default), or each feature appears once at
  its coarsest meaningful level (`partitioning` mode). Levels are written
  coarse to fine. **Each level is a contiguous run of row groups**, and no row
  group mixes levels.
- **One footer key, `geo:overviews`**, holds JSON: `version`, `mode`,
  `canonical_level` (the finest level in `duplicating` mode, `null` in
  `partitioning`), and `levels[]` of `{ row_group_end, gsd, zoom }`. The `gsd`
  value is metres; `zoom` is the Web Mercator zoom it was built for. An
  optional `generalization` block records how each level was made
  (informative). On standardisation the object is meant to move verbatim to
  `geo.overviews`.
- **A visible `level` INT32 column** carries the same assignment for SQL
  readers (`WHERE level = 4` gives the exact source data back). tylertoo also
  writes a `coalesced_count` column, even for polygons (it is used for lines).
- Within a level, rows are Hilbert-sorted and the GeoParquet 1.1 `bbox`
  covering column keeps per-row-group statistics, so ordinary bbox pruning
  works inside a level.
- **What a plain GeoParquet reader sees:** a valid GeoParquet 1.1 file with
  every level's rows. PLUTO has 1,814,537 rows for 856,687 lots, plus two
  extra columns. DuckDB, pandas and core 0.9.x all see the duplicates unless
  they filter on `level`.

PLUTO slim, `tylertoo.overview(min_zoom=10, max_zoom=14)` (0.8.0 defaults):

```json
{ "version": "0.2.0", "mode": "duplicating", "canonical_level": 4,
  "levels": [
    { "row_group_end": 2,   "gsd": 38.22, "zoom": 10 },
    { "row_group_end": 14,  "gsd": 19.11, "zoom": 11 },
    { "row_group_end": 46,  "gsd": 9.55,  "zoom": 12 },
    { "row_group_end": 98,  "gsd": 4.78,  "zoom": 13 },
    { "row_group_end": 184, "gsd": 2.39,  "zoom": 14 } ] }
```

| Overview file (PLUTO) | Build | Peak RSS | Size (source) | Rows per level, z10 / 11 / 12 / 13 / 14 | Footer |
|---|---|---|---|---|---|
| slim, 0.8.0 defaults | **2.4 s** | 0.9 GB | 151 MB (81 MB) | 19,840 / 105,442 / 313,693 / 518,875 / 856,687 | 266 KB |
| full (101 columns), 0.8.0 defaults | 4.7 s | 1.9 GB | 295 MB (146 MB) | same | **2.0 MB** |
| slim, `density_drop=False, polygon_thinning=0` | 3.9 s | ~1 GB | 207 MB | 20,025 / 125,570 / 820,910 / 854,108 / 856,687 | — |
| slim, `collapse_square=True` | 3.6 s | 1.0 GB | 272 MB | 254,155 / 701,848 / 852,290 / 855,236 / 856,687 | 510 KB |

A duplicating file is about **twice the source**. Its footer grows with
columns × row groups. Opening the 101-column file costs 2 MB before any data,
against 266 KB for the slim one. That is the 1.5 MB difference between the
full and slim rows in §4.

### 2.2 Maturity

- **Spec:** draft 0.2.0. v0.1.0's design was approved by the tylertoo
  maintainer on 2026-07-02, and 0.2.0 (2026-07-03) added the clustering and
  line-coalescing extensions. Changes since then are additive and optional.
  **The layout core depends on (levels as row-group ranges, `zoom`/`gsd`,
  `mode`, `canonical_level`) hasn't changed since 0.1.0.** Not settled: the key
  name (it may move into `geo`), the 1.0 stability promise (tylertoo#441,
  open), and the GeoParquet submission (tylertoo#701, open, "no submission has
  been filed yet").
- **Implementations:** one writer (tylertoo) and one validator
  (`tylertoo validate`). The `partitioning` mode is concept-compatible with
  the third-party COGP draft. ESRI's proprietary "Spatially Optimized Parquet"
  solves the same problem with per-scale geometry columns.
- **Producer:** tylertoo 0.8.0 (2026-10-07) is the latest release. `main` has
  carried internal versions 0.8–0.11 since then and **has changed the polygon
  defaults** (placeholder squares on, density budget off for polygons,
  `--coverage-fill`, `--size-valve`). The next release will write
  different coarse levels from the same command. The repo is eight months old,
  with 84 stars and a handful of contributors (Apache-2.0).

---

## 3. Prototype: read the level that matches the zoom

### 3.1 The patch

Applied to a scratch copy of the 0.9.2 branch. The diff is posted on PR #207
as a comment (not committed, no tests). The 0.9.2 code is untouched.

- `formats/geoparquet.ts`:
  - `geoInfo()` parses the `geo:overviews` key into levels with row-group and
    row ranges (`rowStart`/`rowEnd`, from the footer's `num_rows`). It refuses
    anything inconsistent (gaps, a non-final last level, an unknown major
    version) and treats such a file as plain GeoParquet.
  - `overviewBand(ov, zoom)`: `duplicating` picks the finest level with
    `zoom ≤ floor(mapZoom)` (else the coarsest); `partitioning` picks the
    prefix `0..that level`. Without `zoom` it derives one from `gsd`
    (`log2(40075016.69 / 1024 / gsd)`, the spec's mapping).
  - `rowsInView(source, view, band)`: the per-view estimate counts only that
    band's row groups.
  - `readBbox(…, { band })` passes `rowStart`/`rowEnd` to hyparquet, which
    plans only the row groups in that range. Inside them the bbox filter prunes
    as before.
  - `readAll()` reads only the canonical band (D2).
  - The `level`, `coalesced_count` and `point_count` columns are kept out of
    the attribute list.
- `renderer/cloud-sources.ts` (`GeoParquetLoader`): `estimate()` and
  `readView()` use the band for the current zoom. For an overview file the
  `minzoom` floor is 0, because the coarsest level serves every zoom below it.

That is about 100 added lines. **Level selection costs no request:** the
levels come from the footer core already reads on open, and hyparquet's
planner skips row groups outside `rowStart..rowEnd` before any fetch. The
0.9.2 budget then works as intended. At citywide zoom the estimate counts
level 0's 2 row groups (19,840 rows), not the file's 1.8 million.

### 3.2 What the reader picks

| Map zoom | Level read (0.8.0 defaults) | Rows in the level | Rows in the borough-sized view |
|---|---|---|---|
| < 11 | 0 (z10) | 19,840 | all of them at city view |
| 11–11.99 | 1 (z11) | 105,442 | ≤ 105,442 |
| 12–12.99 | 2 (z12) | 313,693 | about 40,000–80,000 (footer estimate, not measured) |
| 13–13.99 | 3 (z13) | 518,875 | 50,492 (measured) |
| ≥ 14 | 4 (canonical) | 856,687 | 601 at block view |

With the 0.8.0 defaults, no measured view of PLUTO went over the 150,000
budget, and the footer estimates for z11–z12 views stay under it too, so the
"zoom in" wall doesn't appear.

### 3.3 Why `floor(zoom)`

tylertoo's PMTiles export writes level *k* as tile zoom *k*, and MapLibre
shows tile zoom *k* between map zoom *k* and *k+1*. Choosing the same level
means the GeoParquet and PMTiles views of one overview file show the same
generalisation. The spec's own rule ("finest level whose `gsd ≥ target_gsd`",
§5.1) uses metres per screen pixel, so it depends on latitude and on
`gsd_base`. It is kept as the fallback when `zoom` is absent.

### 3.4 A reader that ignores the key

Core 0.9.2, unpatched, opening the same file (`load: viewport`, measured):

| View | 0.9.2 on the overview file | Prototype on the same file |
|---|---|---|
| block | **2,201 features drawn for 601 lots**: every level's copy, overlaid. 11.5 MB, 1.24 GB, 41 fps | 662 features, 601 lots, 3.7 MB, 0.53 GB, 55 fps |
| borough | "zoom in" (165,582 rows estimated in view) | drawn, level z13 |
| city | "zoom in" (1,624,340 rows estimated) | drawn, level z10 |

Without `load:`, the 250,000-row guard switches it to reading by view, with
the same result. A file written for faster maps is therefore *worse* in a
reader that doesn't know the key. Hence D2: the canonical-band rule ships with
D1.

---

## 4. Measurements in Chromium

### 4.1 Desktop (UHD 630, no throttling)

Each cell is the median of 2 runs; where they differed by more than 10% the
range is shown, and the freestiler city rows use the complete run (noted). *Data MB* is what the map read from `/data/` until
idle. *RSS* is renderer + GPU. *Pan MB* is what the 7 s pan read.

| Variant | View | First render s | Idle s | Data MB | RSS MB | Pan fps / p95 ms | Pan MB | Lots drawn / in view | Coverage | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| GeoParquet by view, plain (0.9.2) | city | – | 1.0 | 1.1 | 284 + 151 | 60 / 17 | 0 | 0 / 775,200 | 0.7% | "Too many features to show here — zoom in to see them." |
| GeoParquet by view, plain | borough | 5.2 | 6.6 | 18.4 | 3,177 + 170 | 27 / 108 | 82.3 | 94,000 / 94,127 | 74.7% | |
| GeoParquet by view, plain | block | 1.8 | 1.8 | 4.7 | 650 + 157 | 55 / 17 | 15.6 | 601 / 601 | 65.8% | |
| **Overview, slim** (prototype) | city | **1.8** | 2.3 | **2.3** | 690 + 157 | 52 / 17 | 10.7 | 17,198 (level z10) | **18.9%** | |
| **Overview, slim** | borough | **3.8** | 4.1 | 10.4 | 1,880 + 168 | 37 / 50 | 42.7 | 49,515 (level z13) | 61.3% | holes in the fabric |
| **Overview, slim** | block | 1.7 | 1.7 | 3.7 | 530 + 157 | 55 / 17 | 13.9 | **601 / 601** | 65.8% | canonical level |
| Overview, full 101 columns | city | 2.1 | 2.4 | 3.7 | 706 + 158 | 53 / 17 | 10.7 | 17,198 | 18.9% | 2 MB footer |
| Overview, full | borough | 4.1 | 4.1 | 11.9 | 1,876 + 166 | 37 / 83 | 45.6 | 49,515 | 61.3% | |
| Overview, full | block | 1.7 | 1.7 | 5.2 | 705 + 158 | 56 / 17 | 15.6 | 601 / 601 | 65.8% | |
| Overview, no polygon thinning | city | 2.3 | 2.3 | 2.3 | 647 + 157 | 48 / 17 | 12.6 | 17,344 | 19.0% | |
| Overview, no polygon thinning | borough | 6.5 | 7.3 | 14.3 | 3,043 + 170 | 25 / 117 | 59.8 | 93,794 | **74.7%** | as costly as the plain read |
| Overview, no polygon thinning | block | 1.9 | 1.9 | 3.7 | 553 + 159 | 53 / 17 | 17.1 | 601 / 601 | 65.8% | |
| Overview, placeholder squares | city | – | 1.0 | 0.5 | 269 + 151 | – | – | 0 | – | "zoom in": about 224,000 squares in view |
| Overview, squares, `maxFeatures: 300000` | city | 9.9 | 11.9 | 17.8 | 3,549 + 172 | 15 / 150 | 99.2 | 224,174 | 36.5% | 4.1 s of long tasks per pan |
| PMTiles, tippecanoe (benchmark recipe) | city | 1.7 | 1.7 | 1.1 | 382 + 160 | 60 / 17 | 0 | 8,078 merged shapes | **37.1%** | |
| PMTiles, tippecanoe | borough | 1.8 | 2.2 | 3.3 | 511 + 161 | 60 / 17 | 1.6 | 36,740 merged | **74.7%** | |
| PMTiles, tippecanoe | block | 0.9 | 0.9 | 0.06 | 267 + 154 | 60 / 17 | 0.2 | 601 / 601 | 65.8% | |
| PMTiles, tylertoo 0.8.0 defaults | city | 1.6 | 1.6 | 0.7 | 297 + 156 | 60 / 17 | 0 | 13,721 | 18.1% | |
| PMTiles, tylertoo 0.8.0 defaults | borough | 1.7 | 1.7 | 2.1 | 463 + 158 | 60 / 17 | 1.2 | 24,365 | **40.8%** | holes |
| PMTiles, tylertoo 0.8.0 defaults | block | 0.9 | 0.9 | 0.65 | 280 + 155 | 60 / 17 | 1.1 | 599 / 601 | 65.8% | 2 slivers lost at z14 |
| PMTiles, tylertoo, no tile cap | city | 1.5 | 1.5 | 0.9 | 319 + 156 | 60 / 17 | 0 | 17,199 | 19.0% | |
| PMTiles, tylertoo, no tile cap | borough | 1.7 | 2.5 | 3.9 | 612 + 162 | 60 / 17 | 3.4 | 49,515 | 61.3% | |
| PMTiles, tylertoo, no tile cap | block | 0.9 | 1.5 | 0.65 | 298 + 159 | 60 / 17 | 1.1 | 599 / 601 | 65.8% | |
| PMTiles, **tylertoo parcel recipe** (squares, no tile cap; §5.2) | city | **2.7** | 3.3 | **7.3** | 856 + 163 | 60 / 17 | 0 | 224,186 | **36.5%** | complete fabric |
| PMTiles, **tylertoo parcel recipe** | borough | **2.2** | 4.0 | 6.4 | 960 + 166 | 58 / 17 | 8.7 | 93,631 | 65.1% | thin slivers between lots |
| PMTiles, **tylertoo parcel recipe** | block | 1.0 | 1.0 | 0.65 | 284 + 154 | 60 / 17 | 1.1 | 599 / 601 | 65.8% | |
| PMTiles, tylertoo squares, 500 KB cap, `max_zoom=15` | city | 1.6 | 1.6–2.3 | 0.95 | 372 + 156 | 60 / 17 | 0 | 18,987 | **13.8%** | the cap drops features |
| PMTiles, tylertoo squares, 500 KB cap, z15 | borough | 1.7 | 1.7 | 2.0 | 468 + 157 | 60 / 17 | 1.1 | 21,339 | **31.6%** | holes |
| PMTiles, tylertoo squares, 500 KB cap, z15 | block | 1.0 | 1.0 | 0.22 | 270 + 154 | 60 / 17 | 0.3 | 600 / 601 | 65.8% | |
| PMTiles, tylertoo squares, `simplify_factor=0.25`, no cap | city | 5.3 | 6.2 | 20.5 | 2,630 + 171 | 60 / 17 | 0 | 771,879 | 34.3% | close to every lot at z10 |
| PMTiles, tylertoo squares, `simplify_factor=0.25`, no cap | borough | 1.7 | 3.1 | 6.5 | 920 + 167 | 58 / 17 | 8.7 | 93,765 | 62.4% | |
| PMTiles, tylertoo squares, `simplify_factor=0.25`, no cap | block | 0.9 | 1.4 | 0.65 | 302 + 157 | 60 / 17 | 1.1 | 599 / 601 | 65.8% | |
| PMTiles, freestiler MVT | city | 6.5 | 7.7 | 31.4 | 1,740 + 189 | 54 / 17 | 0 | **775,236** | 37.1% | every lot; one of two runs was measured before the 14 MB tiles finished |
| PMTiles, freestiler MVT | borough | 1.8 | 3.4 | 8.8 | 1,030 + 170 | 58 / 17 | 12.4 | 94,125 | 74.7% | |
| PMTiles, freestiler MVT | block | 0.9 | 1.2 | 0.8 | 288 + 156 | 60 / 17 | 1.3 | 601 / 601 | 65.8% | |
| PMTiles, freestiler **MLT** (`BBL` as double) | city | 5.7 | 8.7 | **17.5** | 3,303 + 189 | 58 / 17 | 0 | 775,236 | 37.1% | as above |
| PMTiles, freestiler MLT | borough | 1.8 | 3.3 | 5.1 | 1,428 + 166 | 56 / 17 | 7.1 | 94,125 | 74.7% | 0.3–0.45 s long tasks |
| PMTiles, freestiler MLT | block | 1.0–1.5 | 1.5 | 0.5 | 326 + 158 | 60 / 17 | 0.8 | 601 / 601 | 65.8% | |

Every variant that drew showed the popup with the right `BBL` (click to text
in 90–150 ms with the 50 ms settle) and set `feature-state: { hover: true }`
on the hovered lot, with **no console errors**. 0.9.2's vector-tile highlight
fix holds for all three PMTiles builders. `queryRenderedFeatures` never
returned a lot without `BBL`.

### 4.2 What the numbers say

- **The overview removes the wall cheaply.** Citywide PLUTO from GeoParquet
  goes from nothing (0.9.2) or a crashed tab (0.9.1) to 1.8 s, 2.3 MB, 0.7 GB
  and 52 fps: in the same range as PMTiles' 1.6–1.7 s, though it reads twice
  the bytes and pans at 52 rather than 60 fps.
- **At borough zoom it trades completeness for cost.** With 0.8.0 defaults it
  is 1.4 s faster than the plain read, with half the bytes, 60% of the memory
  and 37 rather than 27 fps. But it draws 49,515 of 94,127 lots, and the gaps
  show (61% against 75% coverage). Without the thinning it draws them all and
  costs as much as the plain read. GeoParquet decoded on the main thread
  (ml-37r.18) and re-read on every pan (43–60 MB per 7 s pan) is the limit here,
  not the level. PMTiles draws the full fabric at 60 fps from 3.3 MB.
- **At citywide zoom, 0.8.0's levels misrepresent a parcel fabric.** The
  screenshot shows parks, cemeteries, airports and large institutions. The
  residential lots, the majority land use (`01`), are almost absent: the
  coarse levels keep the largest lots per cell (`size-fallback` ranking, a
  density budget that applies to polygons in 0.8.0). tippecanoe's
  `--coalesce-densest-as-needed` merges neighbours instead, and
  draws a complete fabric from 8,078 merged shapes. For a choropleth that
  matters more than speed.
- **Squares fix the look and break the budget.** Placeholder squares (one
  per dropped small lot, area-dithered) give PMTiles a tippecanoe-like
  citywide coverage (36.5% against 37.1%). As GeoParquet, though, level z10
  holds 254,155 squares. That is over the budget. With the budget raised to
  300,000 it draws the same picture as the PMTiles build, but takes 9.9 s,
  3.5 GB and pans at 15 fps: core's main-thread decode is the limit.
- **Every PMTiles builder pans at 58–60 fps;** what differs is bytes and
  completeness. The no-thinning builds (freestiler, tylertoo with
  `simplify_factor=0.25`) move the cost into tile size: 20–31 MB and 5–6.5 s
  for the citywide view. tylertoo's squares without a cap sit between those
  builds and tippecanoe: 7.3 MB and 2.7 s.

### 4.3 The laptop profile (1.5 cores for the whole browser)

The browser container limited to 1.5 CPUs, the benchmark's "laptop (cgroup)"
profile, but **without** its 40 Mbit/s network throttle (the server is local).
One run each.

| Variant | View | First render s | Idle s | Pan fps / p95 ms | Pan long tasks |
|---|---|---|---|---|---|
| GeoParquet by view, plain (0.9.2) | borough | 12.1 | 12.9 | 10 / 300 | 10.6 s |
| Overview, slim (prototype) | city | **4.1** | 4.1 | 32 / 83 | 0.5 s |
| Overview, slim | borough | 8.4 | 9.2 | 17 / 183 | 1.6 s |
| Overview, slim | block | 3.3 | 3.3 | 46 / 50 | 0.2 s |
| Overview, no polygon thinning | borough | 11.6–11.8 | 12.4–13.4 | 12–15 / 200 | 7.3–10.4 s |
| PMTiles, tippecanoe | city | 2.6 | 3.4 | 60 / 17 | 0 |
| PMTiles, tippecanoe | borough | 3.3 | 3.3 | 59 / 17 | 0 |
| PMTiles, tippecanoe | block | 1.9 | 1.9 | 58 / 17 | 0.3 s |
| PMTiles, tylertoo parcel recipe | city | 6.0 | 6.6 | 60 / 17 | 0 |
| PMTiles, tylertoo parcel recipe | borough | 4.9 | 6.8 | 52 / 17 | 0.2 s |
| PMTiles, tylertoo, no tile cap (no squares) | borough | 3.6 | 4.3 | 52 / 17 | 0.5 s |
| PMTiles, tylertoo squares, `simplify_factor=0.25` | borough | 5.4 | 7.4 | 51 / 17 | 0.3 s |

On a weak machine the order holds. **tippecanoe's archive is the fastest at
every zoom** (2.6–3.3 s). The tylertoo recipe is 2× slower citywide (6 s,
because its z10 tiles are larger) but pans at 52–60 fps. The overview
GeoParquet is usable citywide (4.1 s) but not at borough zoom (8.4 s, 17 fps),
where the main-thread decode dominates, as it does for the plain by-view read
(12 s, 10 fps).

---

## 5. PMTiles without tippecanoe

### 5.1 Builds

From the slim GeoParquet (tippecanoe from the slim FlatGeobuf, as in the
benchmark). Wall time and peak RSS are from `/usr/bin/time -v`. Distinct lots
are the distinct `BBL` values over all tiles of a zoom, out of 856,687.

| Builder and settings | Wall time | Peak RSS | Archive | z10: distinct lots / bytes / largest tile | z13 distinct lots | Top zoom: distinct lots | `BBL` |
|---|---|---|---|---|---|---|---|
| tippecanoe 2.82, benchmark recipe (`-Z10 -z16 --coalesce-densest-as-needed --extend-zooms-if-still-dropping`, no `--use-attribute-for-id`) | **8 min 40 s** | 3.2 GB | 125 MB | 9,267 / 1.1 MB / 481 KB | 454,770 | z14: 856,578 | property ✓ |
| tylertoo 0.8.0 defaults (`overview` z10–14 + `export_pmtiles`) | **13.0 s** | 0.9 GB | 52.6 MB | 16,027 / 0.7 MB / 265 KB | 377,872 | z14: **816,640** | property ✓ |
| tylertoo, no tile cap (`tile_size_limit=None`) | 12.8 s | 0.9 GB | 67.5 MB | 19,840 / 0.9 MB / 362 KB (z11: 1.06 MB) | 518,866 | z14: 856,554 | property ✓ |
| **tylertoo parcel recipe:** `collapse_square=True`, `tile_size_limit=None` | **20.5 s** | 1.4 GB | **110.9 MB** | 254,155 / 7.6 MB / 3.2 MB (z11: 5.5 MB) | 855,227 | z14: 856,554 | property ✓ |
| tylertoo, `collapse_square=True`, `max_zoom=15`, default 500 KB cap | 31.3 s | ~1 GB | 84.9 MB | 34,097 / 1.0 MB / 227 KB | 413,820 (holes, §4.1) | z15: 856,637 | property ✓ |
| tylertoo, `collapse_square=True`, `simplify_factor=0.25`, no cap | 26.9 s | 2.1 GB | 129.4 MB | 853,166 / 21.4 MB / 9.7 MB | 856,427 | z14: 856,554 | property ✓ |
| freestiler 0.3.0, MVT, z10–14 (DuckDB query input) | 20.3 s | 2.5 GB | 178.8 MB | **856,687 / 32.9 MB / 14.5 MB** | 856,687 | z14: 856,687 | property ✓ |
| freestiler 0.3.0, MVT, from a GeoDataFrame (`freestile(gdf)`) | 33.5 s (+1.3 s read) | 4.2 GB | 178.8 MB | same | same | same | property ✓ |
| freestiler 0.3.0, **MLT**, z10–14 | 18.9 s | 2.2 GB | **105.0 MB** | every lot | every lot | every lot | as double (§6) |

- **tylertoo is 17–40× faster than tippecanoe** (13–31 s against 520 s),
  with a third to a half of the memory. The tippecanoe time is with the box
  shared; the benchmark's quiet-box run took 7 min 47 s.
- **Attribute retention:** all three builders keep every column as a tile
  property. None removes `BBL` the way tippecanoe's `--use-attribute-for-id`
  does (benchmark §4.3). tylertoo and freestiler also write sequential MVT
  feature ids, which `promoteId: { pluto: BBL }` overrides. tylertoo's
  `feature_id=` option sets the id from an integer column instead.
- **Dropping.** In 0.8.0, tylertoo's 500 KB tile cap **drops** an oversized
  tile's features; it does not merge them. tippecanoe's
  `--coalesce-densest-as-needed` merges them into a neighbour, so the fabric
  stays filled, and `--extend-zooms-if-still-dropping` adds zooms until nothing
  is merged at the top. tylertoo has no equivalent to either, so its defaults
  leave **40,047 lots missing at z14**, the top zoom, and so at every zoom
  overzoomed from it. They also leave holes at z10–13: 41% coverage at borough
  zoom against 75%. Adding a level (`max_zoom=15`) completes the top zoom
  (856,637 lots) but not the holes below it (14% and 32% coverage). **Turning
  the cap off is the fix**; the cost is bigger coarse tiles (3.2 MB at z10,
  5.5 MB at z11 with squares). tylertoo main's new `--size-valve merge`
  (unreleased) is the tippecanoe behaviour and should make the cap usable
  again (ml-cnv.30).
- **Placeholder squares** (`collapse_square=True`) replace each lot too small
  for a level with a small square that carries its area and attributes. That
  is what draws the residential fabric at z10–12 (36.5% coverage citywide
  against 18–19% without). At z13, simplifying each lot on its own leaves thin
  slivers between neighbours (65% against 75%), which tylertoo's tuning guide
  documents. `simplify_factor=0.25` was meant to close them; on PLUTO it kept
  nearly every lot at z10 (9.7 MB tiles) without improving borough coverage.
- **The few lots missing at the top zoom** (50–133 of 856,687, depending on
  the build) are slivers that collapse at the tile grid. tippecanoe loses 109
  at z14 and 26 at z16 (benchmark §4.3).

### 5.2 The tylertoo parcel recipe (0.8.0)

```python
import tylertoo
tylertoo.overview("pluto.parquet", "pluto-ov.parquet", min_zoom=10, max_zoom=14, collapse_square=True)
tylertoo.export_pmtiles("pluto-ov.parquet", "pluto.pmtiles", layer_name="pluto", tile_size_limit=None)
```

```bash
# The same as one command, with nothing installed but uv
uv run --with tylertoo==0.8.0 python -c "import tylertoo as t; t.overview('pluto.parquet','pluto-ov.parquet',min_zoom=10,max_zoom=14,collapse_square=True); t.export_pmtiles('pluto-ov.parquet','pluto.pmtiles',layer_name='pluto',tile_size_limit=None)"
```

```bash
# CLI (0.8.0 release binary, or cargo install tylertoo); the pip wheel has no CLI
tylertoo overview pluto.parquet pluto-ov.parquet --min-zoom 10 --max-zoom 14 --collapse-square
tylertoo export-pmtiles pluto-ov.parquet pluto.pmtiles --layer-name pluto --tile-size-limit 0
```

The 0.8.0 CLI reference says it plainly: "A tile over the cap drops features
until it fits". `main` splits the cap in two (`--max-compressed-tile-size
500K`, `--tile-size-limit 2M`) and adds `--size-valve merge`, so the recipe
will change with the next release (ml-cnv.30).

```yaml
sources:
  lots:
    type: vector
    url: data/pluto.pmtiles
    promoteId: { pluto: BBL }     # BBL stays a property: popups and filters see it
```

- **Input:** GeoParquet in EPSG:4326 or 3857, ideally Hilbert-sorted. tylertoo
  doesn't read GeoJSON or FlatGeobuf, so convert first (`ogr2ogr -f Parquet`,
  GeoPandas, DuckDB, or `gpio convert`).
- tylertoo's next release turns `--collapse-square` on by default and adds
  `--coverage-fill` (which fills the gaps between squares at coarse zooms)
  and `--size-valve merge`. None of these could be measured here: they are
  unreleased, and building `main` needs a Rust toolchain that didn't fit the
  disk budget.
- `min_zoom=10, max_zoom=14` matches the benchmark. MapLibre overzooms z14
  tiles for z15+, which is how the block view drew 599–601 of 601 lots.

### 5.3 Install effort

| | tylertoo 0.8.0 | freestiler 0.3.0 | tippecanoe |
|---|---|---|---|
| Python | `pip install tylertoo`: one **abi3** wheel per platform (cp39+), **no dependencies**, 10–12 MB | `pip install freestiler`: per-Python wheels (cp39–cp314), 13–18 MB, needs geopandas, shapely, pyproj and numpy | `pip install tippecanoe`: **2.72.0 from 2024-12** (upstream is 2.82), no Windows wheel |
| Linux x86-64 / arm64 / musl | ✓ / ✓ / ✓ | ✓ (manylinux_2_28) / ✗ / ✗ | ✓ / ✓ / ✓ (pip); or build from source |
| macOS Intel / Apple | ✓ / ✓ | ✗ / ✓ | ✓ / ✓ (pip), Homebrew |
| Windows | ✓ | ✓ | ✗ (WSL or Docker) |
| CLI | release binaries for Linux (gnu, musl), macOS (both), Windows; `cargo install tylertoo`. **The pip wheel has no CLI.** | R and Python only | native binary |
| Licence | Apache-2.0 | MIT and ISC | BSD-2 |
| Inputs | GeoParquet (local, http, s3, gs; globs) | GeoDataFrame, any GDAL file, DuckDB SQL; **its native GeoParquet reader can't read zstd** ("Disabled feature at compile time: zstd") | GeoJSON, FlatGeobuf, CSV |

### 5.4 Why not freestiler by default

- Its defaults are "keep everything": no thinning and no tile size cap, so z10
  tiles reach 14.5 MB and the citywide view reads 31 MB (6.5 s, 1.7–2.1 GB).
  That is the benchmark's no-drop tippecanoe build. Setting `drop_rate` thins
  points and polygons alike, which leaves holes in a fabric. There is no
  coalescing for polygons.
- The zstd gap means the GeoParquet that GeoPandas, gpio and Portolan write
  by default has to go through DuckDB or a GeoDataFrame. The GeoDataFrame path
  peaked at 4.2 GB for PLUTO.
- The wheel matrix misses Intel Macs and Linux arm64. The project is R-first,
  with a single maintainer.
- It is the only one of the three that writes **MLT** (§6), and its R package
  is the natural recommendation for R users.

---

## 6. MLT (MapLibre Tiles)

- **MapLibre GL JS reads MLT** from version 5.x onward: a vector source with
  `encoding: "mlt"` (`TileEncoding = "mlt" | "mvt"` in 6.12's types; the
  decoder is `@maplibre/mlt` 1.3.0, already in core's dependency tree). The
  `pmtiles` package knows tile type 6 (`.mlt`) but doesn't tell MapLibre, so
  the source needs `encoding: mlt` explicitly.
- **maplibre-yaml passes it through today:** `encoding: mlt` on a `type:
  vector` source reaches MapLibre unchanged (the schema is passthrough).
- **The int64 bug:** with freestiler's PLUTO archive, every tile failed with
  `Do not know how to serialize a BigInt`, in plain maplibre-gl 6.12.0 and
  6.15.0 with no maplibre-yaml involved. The MLT decoder returns 64-bit integer
  columns (here `BBL`) as BigInt, and MapLibre's worker can't serialise them.
  Casting `BBL` to double before writing makes the archive draw: city 5.7 s,
  17.5 MB; borough 1.8 s, 5.1 MB; block 1.0–1.5 s, 0.5 MB; popups and hover
  work. No upstream issue was found; one should be filed (§12).
- **What it buys:** 41% smaller than freestiler's MVT build (105 against
  179 MB), and 44% fewer bytes for the citywide view. On this GPU it used more
  renderer memory (3.3 against 1.7–2.1 GB citywide) and had 0.3–0.45 s long
  tasks at borough zoom. Worth it for bandwidth, not yet for memory.
- **What core should do (D8):** read the PMTiles header core already fetches,
  set `encoding: mlt` when the tile type is 6, and recognise the BigInt error
  so the notice says "MLT tiles with 64-bit integer columns can't be drawn by
  this MapLibre version; write that column as a double or string, or build
  MVT". Don't recommend MLT in the docs until MapLibre handles int64.

---

## 7. The YAML and API

### 7.1 Nothing changes for the author

```yaml
sources:
  lots:
    type: geojson
    url: data/pluto.parquet        # an overview file: read by view, the level for each zoom
layers:
  - id: lots
    type: fill
    source: lots
    classify: { field: LandUse, categories: { "01": "#f2c84b", … } }
    interactive:
      hover: { highlight: true }
      click: { popup: [ { strong: [ { property: Address } ] } ] }
```

- An overview file is **read by view whatever `load:` says**. A whole-file
  read is still allowed when the canonical level alone fits the whole-file
  limits (250,000 features, 150 MB decoded); it reads only that level.
- `load: { mode: viewport, minzoom, maxFeatures }` keep their meaning.
  `minzoom` now defaults to "the coarsest level serves every zoom below it" for
  an overview file, instead of 10.
- **One new key, `load: { overviews: false }`** (default `true`): ignore the
  pyramid and read the canonical level only, by view. It exists for debugging
  and for a producer whose coarse levels misrepresent the data. Rejected:
  `overviews: { bias: +1 }` (pick a finer level). It is the same as rebuilding
  with a larger `gsd_base`, and it makes the budget harder to reason about.
  Revisit if authors ask.
- Validation: `overviews:` is only valid on a GeoParquet source. An unknown
  spec major version is a notice at load time, not a validation error (the
  file is still valid GeoParquet; core reads the canonical level).

### 7.2 Interactions

| Feature | With an overview file | Status in the prototype |
|---|---|---|
| Popups | Each row of every level is a real lot with **all its attributes** (duplicating mode, polygons: no merging). A click at a coarse level reports that lot, not a merged block. | ✓ measured |
| `promoteId` | The id column is unique within a level, so it works. The spec doesn't promise a feature's identity across levels (§8 of the spec). A lot hovered across a level switch keeps its `feature-state`, because MapLibre keys state by id, which is harmless. | ✓ measured |
| Hover highlight | As for any GeoJSON source. | ✓ measured, no errors |
| Categorical `classify:` | Needs no data scan; legend as usual. | ✓ measured |
| `classify: method:` | Today refused for by-view sources. Proposed (D9): breaks from a column-only read of the canonical band, the same rows a whole read would see. Coarse levels must not be used: they are biased toward large features. | follow-up |
| Points: clustering extension | Coarse rows carry `point_count` and optionally accumulated attributes. A popup should show `point_count`; core would have to document that a coarse row stands for several points. | not measured (no point data) |
| Lines: coalescing extension | Coarse rows can be several segments merged, keeping one segment's attributes and `coalesced_count`. Popups at coarse zooms describe the merged line. | not measured |
| `fitTo` | Uses the `geo` metadata bbox, as for any by-view GeoParquet. | unchanged |
| Stories | Each chapter's camera move ends in a `moveend`, so the level for the chapter's zoom is read then (debounced 250 ms). A fly from zoom 10 to 16 reads two levels, not one per frame. Prefetching the next chapter's level is a later improvement. | unchanged |
| `mlym emit` | Must inline the **canonical level only** (D2). For an overview file over the whole-file limits, emit should say `lossy` and suggest `tylertoo export-pmtiles`, which turns the same file into PMTiles in seconds (10–26 s for PLUTO). | follow-up |
| Python preview (`blob:` URL) | Works unchanged, because it reads through the same reader. | not measured |

### 7.3 Computed breaks from one column

Column-only read of the canonical rows with hyparquet in Node (the browser
reader is the same library):

| Column | Bytes read | Time | Quintile breaks |
|---|---|---|---|
| `NumFloors` | 0.30 MB | 0.45 s | 2, 2, 2, 3 |
| `AssessTot` | 1.96 MB | 0.60 s | 45,060 · 57,120 · 76,950 · 184,500 |
| `LandUse` | 0.18 MB | 0.44 s | (categorical) |

The plain 10k-row-group file costs the same. **This lifts the `method:`
refusal for every GeoParquet source read by view**, not only overview files,
so it is filed separately (ml-cnv.24). FlatGeobuf and PMTiles can't do this and
keep the refusal.

---

## 8. Making it easy

### 8.1 (a) YAML authors with a GeoParquet, GeoJSON or FlatGeobuf file

**One docs page, "Large data"** (`guides/large-data.mdx`), linked from
"Which format?" in `cloud-native-data.mdx`, from the GeoParquet, FlatGeobuf
and PMTiles pages, and from every size notice:

| You have | Do | Why |
|---|---|---|
| Under about 50,000 features (about 10 MB of GeoJSON) | Nothing: use the file as it is | 2 s on a desktop, 5–6 s on a weak laptop (benchmark R3) |
| 50,000–250,000 features | GeoParquet read by view: `ogr2ogr -f Parquet out.parquet in.geojson -lco WRITE_COVERING_BBOX=YES -lco SORT_BY_BBOX=YES -lco ROW_GROUP_SIZE=10000`, then `load: viewport` | No build step; ~1–5 s by view |
| More, or a dense polygon coverage (parcels, buildings) seen citywide | **PMTiles with tylertoo** (§5.2 recipe, two Python lines or one command) | 1–3 s at every zoom on a desktop, 58–60 fps, the fabric drawn at every zoom |
| More, and the GeoParquet file is the deliverable (analysis, download, a catalog) | **Overviews with tylertoo**: `tylertoo.overview(in, out, min_zoom=10, max_zoom=14)`, same YAML as before | One file, every zoom, no wall; generalised coarse zooms (§4.2) |

- The page leads with the decision, then **one command per row**, then the
  details (what generalisation does at low zooms, `promoteId` instead of
  `--use-attribute-for-id`). The tippecanoe recipe from ml-37r.20 moves into
  this page as the alternative.
- The commands run with `uv run --with tylertoo python -c "…"` or after
  `pip install tylertoo`, so nothing needs Rust. The CLI form is offered for
  people who already have the release binary.

**A CLI helper, in two steps:**

1. **`mlym prepare <file>` (0.10): an advisor.** Node, in the existing CLI.
   It reads what core's readers already read (a GeoParquet footer, a
   FlatGeobuf header, a GeoJSON file's size, sampled for count) and reports
   the feature count, size, CRS, whether the file is sorted, whether it has a
   bbox column and overviews, and the row-group size. Then it prints **the one
   recommended command** from the table above, with the file names filled in,
   and the YAML source block to paste. It never writes data.
2. **`mlym prepare <file> --run` (later): it does the conversion when it can.**
   It shells out to `tylertoo` when the binary is on PATH, or to `python -c
   "import tylertoo…"` when a Python with tylertoo is found, and to `ogr2ogr`
   for the GeoJSON/FlatGeobuf → GeoParquet step. Otherwise it prints the
   install line. No bundled Rust, no optional npm peer with native binaries:
   the CLI stays a pure Node install. Pin the tylertoo flags it passes
   (§5.2), because the defaults move between releases.

Rejected: a WebAssembly tiler inside the CLI (none exists for tylertoo, and
the npm install would grow by tens of MB for a minority path), and an optional
npm peer wrapping a native binary (the platform matrix is the same problem
pip already solves).

### 8.2 (b) Python users: feed into PR #204

Recommendation for the package design (ml-37r.2):

1. **`add(gdf, format="auto")` becomes the default**, deciding on the frame:

   | Frame | Writes | YAML |
   |---|---|---|
   | ≤ 50,000 features | GeoParquet, whole | `url:` |
   | 50,000–250,000, or any frame whose map opens at zoom ≥ 13 | GeoParquet, Hilbert-sorted, bbox column, 10k-row groups | `load: viewport` |
   | > 250,000 (core's whole-file limit), or polygons whose median size at the map's opening zoom is under about 4 px² | **PMTiles via tylertoo** (§5.2 recipe; `min_zoom` = the map's zoom − 2, `max_zoom="auto"` capped at 14, `layer_name` = the source id) | `type: vector`, `promoteId: { <layer>: <id column> }` when the frame has a unique integer or string id column |

   Explicit `format=` always wins. `format="pmtiles", engine="tippecanoe"`
   keeps tippecanoe for those who want it.
2. **`write_pmtiles` uses tylertoo, not tippecanoe.** PLUTO takes 21 s and
   1.4 GB, so the build can run inside `save()` with a one-line progress
   message, without a separate "build data" cell (the benchmark's 8 minutes
   needed one). The GeoDataFrame goes to a temporary GeoParquet (the package
   already writes one), then `overview` and `export_pmtiles`. Keep the id
   column as a property; never `feature_id=` unless asked.
3. **Dependency:** tylertoo goes in `[geo]`, pinned `tylertoo>=0.8,<0.9` (bump
   deliberately: §2.2). It is a 10–12 MB abi3 wheel with no dependencies on
   every platform the course uses, Windows included. tippecanoe becomes
   optional and isn't needed on Colab or Windows.
4. **Overview GeoParquet as an opt-in, once core 0.10 reads it:**
   `add(gdf, format="geoparquet", overviews=True)` writes the overview file
   through tylertoo. Not the default, for the reasons in §4.2.
5. **Preview:** the inline preview size guard (D10 of PR #204) is unchanged.
   Above 50 MiB, the note can offer `m.save()` (which now builds PMTiles in
   seconds) alongside `m.widget()`.

### 8.3 (c) What the notices should say

The reader's line stays as 0.9.2 shipped it ("Too many features to show here
— zoom in to see them."): a reader can't rebuild the file. The **author hint**
(console, and the page while developing) names the fix for that source:

| Situation | Author hint (proposed) |
|---|---|
| GeoParquet by view, view over `maxFeatures`, no overviews | "`pluto.parquet` has about 781,031 features in view, over `maxFeatures` (150,000): nothing is drawn until the map is zoomed in. To draw it at every zoom, build overviews (`pip install tylertoo`, then `tylertoo.overview("pluto.parquet", "pluto-ov.parquet", min_zoom=10, max_zoom=14)`) or convert it to PMTiles: <docs>/guides/large-data/." |
| FlatGeobuf by view, over budget | Same, with PMTiles only, and the GeoParquet step first: "…convert it to PMTiles (see <docs>/guides/large-data/; tylertoo reads GeoParquet, so convert with `ogr2ogr -f Parquet` first)." |
| Overview file, the zoom's level over budget, no coarser level fits | "`x.parquet`'s coarsest overview level (zoom 10) has about 223,920 features in view, over `maxFeatures`: rebuild the overviews with fewer features at coarse zooms (tylertoo: `--no-collapse`), or convert to PMTiles." |
| Overview file, unknown major version | "`x.parquet` has overviews in a newer format (geo:overviews 1.x) than this version reads: drawing its full-detail level only." |
| Whole-file guard on an overview file | The 0.9.2 text, counting canonical rows only. |
| MLT tile with int64 | "`x.pmtiles` holds MLT tiles with 64-bit integer columns, which this MapLibre version can't draw. Write those columns as doubles or strings, or build MVT tiles." |

Every hint links the Large data page. The reader line gets no tool names.

---

## 9. Phasing

**0.10 (next minor):**

1. D2, the canonical-band rule for whole-file reads, `classify:` and emit,
   plus the guards counting canonical rows. It could be a 0.9.x patch, but no
   overview files are known to be in use, so 0.10 is fine.
2. D1, level selection when reading by view, labelled experimental in the
   docs, with D3's `load.overviews: false`. Accept `geo:overviews` and
   `geo.overviews`; refuse major ≠ 0.
3. D9, computed breaks from a column scan, for all GeoParquet read by view.
4. The Large data docs page, the tylertoo parcel recipe, and the hint wording
   (D10, D12). This also closes ml-37r.20 (the tippecanoe parcel recipe).
5. `mlym prepare` as an advisor (D10, step 1).
6. MLT: `encoding` from the PMTiles header, and the int64 notice (D8).
7. Python v0 (its own schedule): `format="auto"` and the tylertoo writer
   (D11).

**After 0.10, when the spec and producer settle:**

- D5, budget-aware fallback to a coarser level.
- Re-measure tylertoo's next release (squares and coverage fill on by
  default): does a GeoParquet level at z10 stay under the budget, and does it
  draw a complete fabric? If yes, D4 relaxes and overview GeoParquet can become
  the Python default for frames over 250,000 features.
- `mlym prepare --run`.
- `partitioning` mode (prefix reads, with already-read row groups kept across
  zooms) and a row-group cache across pans for any by-view GeoParquet. Pans
  re-read 11–60 MB per 7 s today.
- Decode in a worker (ml-37r.18): the borough-zoom ceiling for every by-view
  format.
- Once tylertoo#441 declares the 1.0 stability promise: drop "experimental"
  and accept major 1.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| **Draft spec changes.** Key renamed into `geo`, levels reshaped, or a 1.0 that breaks 0.x. | Read only the layout facts (row-group ranges, zoom/gsd, mode, canonical level), which have been stable since 0.1.0. Accept both key locations, refuse an unknown major and fall back to the canonical level. The constant lives in one place, as the spec asks. |
| **Producer defaults move.** tylertoo main already changed the polygon defaults since 0.8.0, and with squares on, a PLUTO z10 level is 254k features. | Pin flags in every recipe; pin the Python dependency to a minor; D5 fallback; the "level too dense" hint. Re-measure on each tylertoo minor. |
| **Overview files look wrong at coarse zooms** for dense coverages (§4.2), and authors blame the map. | D4: the docs recommend PMTiles for that case and say what coarse zooms show. `load.overviews: false` for comparison. |
| **Duplicates in readers that don't know the key.** Older maplibre-yaml, naive DuckDB `count(*)`, pandas. | D2 in core. The docs say an overview file is for maps, and analysis filters `level = canonical` (the spec's one-predicate rule). |
| **Twice the storage** (151 against 81 MB) and a large footer with many columns (2 MB at 101 columns). | Recommend slim columns for overview files (tylertoo `--include-property`). The footer cost is per open, once. |
| **One producer, young project** (tylertoo: eight months, 84 stars, a handful of contributors). | Nothing in core is tylertoo-specific; the reader follows the spec. PMTiles (tippecanoe, tylertoo, freestiler, GDAL) remains the stable path. |
| **The main-thread decode limits by-view reads** at borough zoom (25–37 fps). | ml-37r.18 (worker decode). Overviews reduce the volume but don't remove the cost. |
| **MLT int64** fails silently except for console errors. | D8 notice; upstream report. |
| **tylertoo's pip wheel has no CLI.** Docs that say `tylertoo …` fail after `pip install`. | Docs lead with the Python form (`uv run --with tylertoo python -c …`) and name the release binaries for the CLI. |

---

## 11. Open questions for the maintainer

1. **Default-on in 0.10?** The recommendation is to read overviews by
   default, marked experimental, with `load.overviews: false` as the escape
   hatch. The alternative is opt-in (`overviews: true`) until tylertoo#441
   lands.
2. **Course PLUTO:** this spike keeps PMTiles as the citywide answer for
   parcels and makes tylertoo the builder. Is "one GeoParquet file that also
   draws citywide" worth the coarse-zoom look, for the course's analysis
   notebooks?
3. **Python dependency:** tylertoo in `[geo]` (`add(gdf)` just works) or in a
   separate `[tiles]` extra (a smaller `[geo]`)?
4. **`mlym prepare`:** an advisor in the CLI, or docs only?
5. **The per-view budget's unit:** features (today) or decoded bytes/vertices?
   Squares are 5 vertices each; 254k squares cost less to draw than 254k
   parcels, but the main-thread decode doesn't care.
6. **Upstream:** ask tylertoo for a "by-view GeoParquet" profile (coarse
   levels that cover the fabric within a feature budget: merged blocks rather
   than per-lot squares), and file the MLT int64 issue against
   maplibre-gl-js. Both are cheap to ask; should we?
7. **map-party:** its worker also tiles MapPLUTO with tippecanoe, under a
   per-tile byte budget (vault `status/mp-mpluto-5mb-retile.md`). tylertoo's
   build time (seconds instead of minutes) may matter more there than here.
   That is out of scope for this library spike; worth a map-party bead if the
   maintainer agrees.

---

## 12. Follow-up beads

Filed unlabeled for triage.

| Bead | Parent | Kind | Summary |
|---|---|---|---|
| **ml-cnv.21** | ml-cnv | bug, P2 | An overview file is read with every level's rows. Whole-file reads, `classify:` breaks and `mlym emit` read the canonical level only, and the guards count its rows (D2). |
| **ml-cnv.22** | ml-cnv | feature, P2 | Read the overview level that matches the zoom when reading by view (experimental), plus `load: { overviews: false }` (D1, D3). Depends on .21. |
| ml-cnv.23 | ml-cnv | feature, P3 | Budget-aware level choice: fall back to a coarser level before "zoom in" (D5). Depends on .22. |
| ml-cnv.24 | ml-cnv | feature, P3 | `classify: method:` on GeoParquet read by view: breaks from a column-only read (D9). |
| ml-cnv.25 | ml-cnv | feature, P3 | PMTiles MLT: `encoding: mlt` from the header, and a notice for the int64/BigInt failure, plus an upstream report (D8). |
| **ml-cnv.26** | ml-cnv | task, P2 | Docs: the "Large data" guide, the tylertoo parcel recipe and overview files (D6, D10). |
| ml-cnv.27 | ml-cnv | feature, P3 | CLI: `mlym prepare <file>` advisor; `--run` later (D10). |
| ml-cnv.28 | ml-cnv | task, P3 | Author hints name the fix; new hints for a too-dense level and an unknown spec version (D12). |
| ml-cnv.29 | ml-cnv | feature, P3 | GeoParquet by view: keep decoded row groups across pans; prefix reuse for `partitioning` mode. |
| ml-cnv.30 | ml-cnv | task, P3 | Re-measure tylertoo's next release (squares, coverage fill, size valve) on PLUTO, and revisit D4 and the recipe. |
| **ml-37r.21** | ml-37r | feature, P2 | Python: `write_pmtiles` through tylertoo with the parcel recipe; tylertoo in `[geo]` (D6, D11). |
| **ml-37r.22** | ml-37r | feature, P2 | Python: `add(gdf, format="auto")` decides by size and polygon density (D11). Depends on .21. |
| ml-37r.23 | ml-37r | feature, P3 | Python: an opt-in overview GeoParquet writer once core reads overviews. Depends on ml-cnv.22. |

Comments: ml-cnv.20 (this PR), ml-37r.2 (the §8.2 writer recommendation),
ml-37r.20 (the parcel recipe now has a tylertoo form).

---

## Appendix: reproducing

The scratch directory was deleted with the data, as before. To rebuild:

1. **Data:** as in the PLUTO benchmark appendix (MapPLUTO 26v2 → EPSG:4326 →
   Hilbert sort → GeoParquet 1.1, ZSTD, `row_group_size=10_000`; slim = the
   six columns).
2. **Tools:** `uv venv -p 3.12 && uv pip install tylertoo==0.8.0
   freestiler==0.3.0 geopandas pyarrow duckdb pmtiles mapbox-vector-tile`.
   tippecanoe 2.82 built from `felt/tippecanoe` in `alpine:3.20`.
3. **Overviews:** `tylertoo.overview(src, out, mode="duplicating",
   min_zoom=10, max_zoom=14, **variant)`, where `variant` is `{}`,
   `{"density_drop": False, "polygon_thinning": 0}` or
   `{"collapse_square": True}`.
4. **PMTiles:** §5.1's settings. freestiler from DuckDB:
   `freestile_query("SELECT … FROM read_parquet('pluto_slim.parquet')", out,
   layer_name="pluto", tile_format="mvt"|"mlt", min_zoom=10, max_zoom=14)`;
   for MLT, `CAST(BBL AS DOUBLE)`.
5. **Core prototype:** the patch from PR #207's comment, applied to
   `fix/0.9.2-core` (`b80ed39`) and built with `pnpm build`.
6. **Browser:** the benchmark's container (`playwright:v1.60.0-noble`,
   `/dev/dri`, `--use-gl=angle --use-angle=gl-egl`), a Node static server with
   streamed range requests, one page per variant × view, and the harness in
   §1. Check that `WEBGL_debug_renderer_info` reports the UHD 630.
