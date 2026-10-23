---
title: Portolan / STAC compatibility — can maplibre-yaml read a Portolan catalog? (spike)
type: design
date: 2026-10-23
topic: portolan-stac
beads: ml-37r.6 (this spike; parent epic ml-37r); follow-ups ml-37r.8–ml-37r.14
target: course data platform (no package release needed for the findings)
status: findings — catalog-aware source syntax awaits a maintainer decision (§6)
---

# Portolan / STAC compatibility (spike)

**Question (ml-37r.6):** students in a future course will build a Portolan
catalog holding the course datasets, and their maplibre-yaml maps must read
from it. Do the files Portolan publishes load in `<ml-map>` 0.9 from YAML
alone? What must the host do? Should maplibre-yaml name STAC assets instead of
object URLs?

**Short answer.** Yes, with two exceptions that are both about projections.
Portolan's GeoParquet (WKB, lon/lat, bbox covering column, Hilbert-sorted,
zstd), its PMTiles and its Web Mercator COGs all load from YAML, whole and by
view, on a local range server and on a real public Portolan catalog
(source.coop). Portolan **keeps the source CRS** of both vectors and rasters, so
a state-plane GeoParquet or a lon/lat or UTM COG is refused, with a notice that
gives the reprojection command. The host requirements in the Portolan spec are
a superset of what maplibre-yaml needs. A catalog-aware `stac:` key on a source
is worth building, and its design is sketched in §6.

Context: map-party evaluated Portolan on 2026-09-16 and decided to hold it as a
backend and borrow its conventions, because Portolan is designed for open data
and map-party's data is private (vault: `entities/portolan.md`,
`decisions/2026-09-16-portolan-evaluation-vs-existing-import-queue.md`;
map-party `docs/solutions/tooling-decisions/portolan-adoption-hold-borrow-conventions.md`).
The course is the opposite case: public course data with no server, which is
the use Portolan is designed for.

## 1. What Portolan is

- **Repos:** the `portolan-sdi` GitHub organisation ([portolan-sdi.org](https://www.portolan-sdi.org/)).
  [`portolan-spec`](https://github.com/portolan-sdi/portolan-spec) holds the
  specification, [`portolan-cli`](https://github.com/portolan-sdi/portolan-cli)
  the Python CLI (`pip install portolan-cli`, **0.8.0** on PyPI, 2026-08-31,
  pre-1.0), [`rashid`](https://github.com/portolan-sdi/rashid) the validator
  behind `portolan check`, and
  [`portolan-registry`](https://github.com/portolan-sdi/portolan-registry) a
  list of published catalogs. There are also `portolan-browser` (a fork of the
  Vue STAC Browser), `portolan-skills` (agent skills) and
  `portolan-catalog-template` (a git-backed catalog with CI).
- **What it publishes:** a **static STAC 1.1.0 catalog**: plain files in object
  storage with no server, no database and no API. The spec says "there is no
  'Portolan API' like the STAC API". A "Portolan server" for the course is
  therefore a bucket plus a CLI workflow, not a running service. Every
  catalog and collection carries `catalog.json`/`collection.json`, `README.md`
  and `AGENTS.md`, and declares the Portolan STAC extension
  (`https://schemas.portolan-sdi.org/portolan/v0.2.0/schema.json`).
- **Layout:** catalogs can nest; collections are always leaves, with IDs that
  are POSIX paths (`environment/air-quality`). A single-file collection keeps
  its data as **collection-level assets** (`<id>.parquet`, `<id>.pmtiles`,
  `styles/*.json`, a thumbnail). A multi-scene raster collection has one
  **item** per scene, plus an `items.parquet` stac-geoparquet "item mirror".
  Old versions are kept as `version-YYYY-MM-DD` assets with the role `archive`.
- **Hosting:** `portolan push s3://…` (also GCS, Azure and S3-compatible
  storage via `PORTOLAN_S3_ENDPOINT`, which covers R2 and MinIO). **Portolan
  doesn't configure CORS or public access.** It tells the publisher to make
  the files public, and `portolan check --live --url <public base>` probes the
  published host for range and CORS support. Source Cooperative offers free
  hosting for Portolan catalogs; most registry entries are on
  `data.source.coop`.
- **Asset hrefs:** relative or absolute; an absolute one must be `https` (not
  `s3://`, "since browsers cannot fetch `s3` URLs directly"). Media types and
  roles are mandatory on every asset.

### Formats and conversion settings

| | Spec says | CLI 0.8.0 writes (observed) |
|---|---|---|
| Vector data | GeoParquet 1.1 or 2.0, distribution best practices; **spatially ordered** rows; per-row-group spatial stats (a `bbox` covering column **with** min/max stats, or native 2.x `GeospatialStatistics`); **≤150,000 rows per row group**; zstd recommended | GeoParquet **1.1.0, WKB**, `bbox` covering column, **Hilbert-sorted**, **ZSTD**, through `geoparquet-io` 1.4. **CRS kept from the source** (an EPSG:2272 GeoPackage became an EPSG:2272 GeoParquet). Row groups of about 100k rows (a 400k-row file had 4); there is no setting for row-group size. |
| Vector visualisation | PMTiles **SHOULD**, registered as a `rel: "pmtiles"` collection link (web-map-links 1.3.0, `pmtiles:layers`), plus a MapLibre style asset (`styles/*.json`, roles `style`/`default`, `sources.data.url: pmtiles://../x.pmtiles`) | **Off by default** (`pmtiles.enabled: false`; needs `tippecanoe`, and `pip install tippecanoe` works). With `--pmtiles`: tippecanoe through geoparquet-io, gzip MVT, zoom range picked by tippecanoe (`-zg`: z0–6 for 96 tracts, z0–11 for 400k points), reprojected to lon/lat. Writes `styles/default.json`, a `visual` asset and the `rel: pmtiles` link. |
| Raster | A valid COG (OGC 21-026) plus the Optimized GeoTIFF class: square tiles (512), **internal overviews**, embedded per-band stats. **No CRS requirement.** | `rio-cogeo` `cog_translate`: **DEFLATE**, 512×512 tiles, predictor 2 for integers and **3 for floats**, overviews (nearest by default). **CRS kept from the source**: EPSG:4326 and EPSG:32618 inputs stayed EPSG:4326 and EPSG:32618. |
| Item mirror | `items.parquet` (stac-geoparquet), Portolan's GeoParquet rules apply | GeoParquet 1.1, WKB, EPSG:4326, bbox, snappy |
| FlatGeobuf | Not a Portolan primary format (GeoParquet is required) | An `.fgb` input is "already cloud-native": kept and registered as-is (`application/vnd.flatgeobuf`) unless `conversion.convert: [fgb]` |

Real catalogs agree with this. On source.coop, `nlebovits/phl-housing-demo`
(the CLI tutorial's published catalog) has GeoParquet 1.1, WKB, CRS84, bbox
column and ZSTD, with 12 row groups for 546k building footprints (103 MB), and
PMTiles of 210 MB. Its COG collections keep their source CRS:
`epoch/jrc-global-forest-cover-2020` is EPSG:4326, and `nlebovits/ghsl` is
ESRI:54009 (Mollweide), compressed with LERC_ZSTD.

## 2. Method

- `portolan-cli` 0.8.0 and `tippecanoe` 2.72.0 from PyPI, in a throwaway venv
  (since removed).
- **Inputs:** the docs sample data (`docs/public/data/classify/sample-tracts.geojson`
  and `world-cities.geojson`); the tracts reprojected to EPSG:2272 as a
  GeoPackage; world cities as FlatGeobuf; 400k random points over Philadelphia
  (shuffled, GeoPackage). Rasters: 1024² RGB in EPSG:4326 and EPSG:3857, a
  1024² float32 DEM in EPSG:32618 and in EPSG:3857, and a 4096² RGB (67 MB COG)
  in EPSG:3857, all striped GeoTIFFs with no overviews, so that Portolan has to
  convert them.
- **Workflow:** `portolan init` and `portolan add --pmtiles --thumbnails`, then
  `portolan check --fix`. Metadata findings such as providers and READMEs were
  left alone because they don't affect reading.
- **Hosting:** a range-capable Node server (port 5031) serving the catalog
  under four header profiles: `/full/` (Portolan's spec'd CORS),
  `/noexpose/` (no `Access-Control-Expose-Headers`), `/norange/` (ignores
  `Range`) and `/nocors/`. `npx serve --cors` (port 5032) was also used, since
  the Portolan skills use it to preview a catalog. The test page came from
  another origin (port 5030), so every data read was cross-origin.
- **Client:** Chromium (Playwright 1.62) loading `<ml-map>` from
  `https://unpkg.com/@maplibre-yaml/core@0.9/register.js` (resolved to
  **0.9.1**) and maplibre-gl 6.15 from unpkg, with no page JavaScript beyond
  recording `ml-map:*` events, console output and network ranges.
- **Remote:** the same documents pointed at `data.source.coop/nlebovits/phl-housing-demo`.

## 3. Results: formats

| Asset as Portolan published it | Result in 0.9.1 | Why / what was observed |
|---|---|---|
| GeoParquet 1.1, WKB, CRS84, bbox, ZSTD, Hilbert, whole file (96 tracts) | **Works** | 1 request (5 KB); `fitTo` frames it |
| Same, `load: viewport`, 400k points / 19 MB / 4 row groups of 100k | **Works** | At z14: footer plus 3 row groups, 4 requests, **5.4 MB**. The same data written with 10k-row groups costs **1.7 MB** for that view |
| Same 19 MB file, default `load: all` | **Works** | Reads only the geometry column chunks (about 5 MB) |
| `load: viewport` on a small single-row-group file | **Works** (read whole) | The console note is misleading: "…isn't spatially sorted (each row group spans most of the file)… Sort it before writing". The file *is* sorted; it has one row group. → **ml-37r.9** |
| GeoParquet in EPSG:2272 (Portolan keeps the source CRS) | **Fails, clear notice** | "Layer tracts has no data: …/tracts-stateplane.parquet is in EPSG:2272; MapLibre needs longitude/latitude (EPSG:4326). Reproject it: `ogr2ogr -t_srs EPSG:4326 out.parquet tracts-stateplane.parquet`." → **ml-37r.12** |
| GeoParquet **2.0** (native `GEOMETRY` type plus `geo` key, WKB) | **Works** | Also refused correctly when projected |
| Native Parquet `GEOMETRY`, **no `geo` key**, lon/lat | **Works** | |
| Same, **projected** | **Fails silently** | `layer-data-loaded`, no notice, nothing visible: the CRS in the logical type is ignored. → **ml-37r.8** (bug) |
| GeoParquet 1.1 with GeoArrow encoding (`geoparquet-io` option, not Portolan's default) | **Fails, clear notice** | "…stores its geometry as GeoArrow (polygon), which maplibre-yaml doesn't read yet…" (ml-cnv.13) |
| GeoParquet 2.0 with native stats only, no `bbox` column, `load: viewport` (the spec allows it) | **Fails, clear notice** | "…has no bbox covering column, so it can't be read one part at a time…". `load: all` works. → **ml-37r.11** |
| `items.parquet` item mirror, as a `geojson` source | **Works** | Draws the collection's scene footprints, which is a cheap catalog overview layer |
| PMTiles (tippecanoe, gzip MVT) on a `vector` source | **Works** | Tracts (z0–6, overzoomed) and 400k points (z0–11) |
| Portolan's own `styles/default.json` as `mapStyle:` | **Works** | Its relative `pmtiles://../tracts.pmtiles` resolves against the style URL (0.9's basemap URL resolver) |
| COG in EPSG:3857, DEFLATE, 512 tiles, overviews (RGB) | **Works** | 2 requests, 196 KB; the 67 MB COG costs 0.85 MB at z10 and 3.3 MB at z15 |
| COG float32, predictor 3 (Portolan's float default), EPSG:3857, `raster-dem` plus `colorRamp` | **Works** | Hillshade and colour ramp |
| COG compressed with LERC_ZSTD (as in the GHSL catalog) and ZSTD/LZW | **Works** | |
| COG in **EPSG:4326** (kept by Portolan) | **Fails, clear notice** | "Source img didn't load: …/rgb-4326.tif is in EPSG:4326; a COG must be in Web Mercator (EPSG:3857) to be drawn. Reproject it: `gdalwarp -t_srs EPSG:3857 -of COG -co COMPRESS=DEFLATE rgb-4326.tif out.tif` (GDAL 3.1 or later)." (ml-cnv.8) |
| COG in **EPSG:32618** (UTM, kept) as `raster-dem` | **Fails, clear notice** | Same wording with EPSG:32618 (ml-cnv.8) |
| FlatGeobuf (kept as-is by Portolan) | **Works** | 1 request |

**On the public catalog** (`data.source.coop/nlebovits/phl-housing-demo`, a
real Portolan publication):

- Council districts GeoParquet (116 KB) works whole, framed by `fitTo`.
- The 103 MB building footprints with `load: viewport` work at z16, but cost
  **14.6 MB** in 5 requests (about 7 s): each row group is about 8.5 MB.
- The same file without `load:` switches itself to reading by view, with the
  console note "…the columns this map reads are 67 MB, too large to load whole;
  reading only the part in view instead…".
- The 210 MB PMTiles works (0.8 MB at z15), and so does the catalog's own
  `styles/default.json` as `mapStyle` (MapLibre warns about null `approx_hgt`
  values in the data's step expression; that is a data issue).

## 4. Results: hosting

| Host behaviour | GeoParquet (whole) | GeoParquet (`viewport`) | PMTiles | COG | FlatGeobuf |
|---|---|---|---|---|---|
| Portolan spec'd CORS + ranges | ✓ | ✓ | ✓ | ✓ | ✓ |
| `ACAO: *` but **no `Expose-Headers`** (S3/R2 when `ExposeHeaders` is omitted; also `npx serve --cors`) | ✓ | ✓ (one extra `HEAD` for the size) | ✓ | ✓ (same ranges as with headers exposed, checked on the 67 MB COG) | ✓ |
| **No range support** (200 + whole body) | ✓ (small) | Read whole, with "…this server doesn't support range requests, so `load: viewport` reads the whole file instead…"; refused over 50 MB | ✗ "…was served without range-request support…" | ✗ same | ✓ (small) |
| **No CORS** | ✗ "The browser couldn't read …: the server didn't allow this page to load it (CORS), or it couldn't be reached…" | ✗ | ✗ | ✗ | ✗ |
| source.coop (HTTP/2, ranges, `ACAO: *`, `Expose-Headers: *`) | ✓ | ✓ | ✓ | (not tested) | (none published) |

Every failure arrives as the map's non-fatal notice ("Part of this map
couldn't load"), in the console, and as `ml-map:layer-data-error` or
`ml-map:error`, while the rest of the map still draws. The hidden
`Content-Range` case, which the task listed as a likely failure, is handled by
0.9's shared range reader (`formats/http.ts`): it is not a failure.

### Host requirements

Portolan's spec (`core.md` › Data Storage) already requires more than
maplibre-yaml needs, so **a host that passes `portolan check --live` serves
maplibre-yaml**:

| | Portolan requires | maplibre-yaml needs |
|---|---|---|
| Range requests | Honour `Range`, `206`, `Accept-Ranges: bytes`, accurate `Content-Length` on `HEAD`; nothing that compresses or transforms responses | Same (a host that compresses range replies, like jsDelivr's Cloudflare leg, is reported) |
| CORS origin/methods | `Access-Control-Allow-Origin: *`, `GET`, `HEAD` | Same |
| Allowed request headers | `Range`, `If-Match`, `If-Modified-Since`, `If-None-Match`, `If-Unmodified-Since` | `Range` |
| Exposed headers | `Content-Type`, `Content-Length`, `Content-Range`, `Accept-Ranges`, `ETag` | `Content-Range` recommended (saves a `HEAD`); none strictly required |
| Metadata files | CORS on `catalog.json`/`collection.json` too | Only needed for catalog-aware sources (§6) |

Bucket CORS for the course host:

```json
[{
  "AllowedOrigins": ["*"],
  "AllowedMethods": ["GET", "HEAD"],
  "AllowedHeaders": ["Range", "If-Match", "If-Modified-Since", "If-None-Match", "If-Unmodified-Since"],
  "ExposeHeaders": ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag"],
  "MaxAgeSeconds": 3600
}]
```

This is the S3 `PutBucketCors` shape; R2 accepts it through its S3 API, and the
same rules can be entered in the R2 dashboard. For GCS, `gcloud storage
buckets update --cors-file` takes `origin`/`method`/`responseHeader` lists,
where `responseHeader` covers both allowed and exposed headers. Hosts to
avoid: Cloudflare Workers static assets don't answer range requests
(ml-37r.1); `python -m http.server` has no ranges; GitHub Pages works but
caps files at 100 MB and hides `Content-Range`.

## 5. Where Portolan's defaults trip maplibre-yaml

1. **Projected vectors (likely with city data).** Portolan doesn't reproject
   GeoParquet, and US city and state data is usually in a state plane. This is
   refused with a clear notice. Fix in the pipeline (`ogr2ogr -t_srs
   EPSG:4326`, GeoPandas `to_crs(4326)` before `portolan add`) or in the
   library (**ml-37r.12**, in-browser reprojection).
2. **COGs not in Web Mercator (likely with any real raster).** Portolan doesn't
   reproject COGs, and the real catalogs checked are EPSG:4326 and Mollweide.
   This is refused with a clear notice. Fix in the pipeline (`gdalwarp -t_srs
   EPSG:3857 -of COG`) or in the library (**ml-cnv.8**). For a course this is
   the single most likely failure.
3. **Large row groups.** They work, but viewport reads are coarse: up to 150k
   rows per group, about 8.5 MB per group in the source.coop footprints, and
   Portolan has no setting to change it. Fix in the pipeline (write GeoParquet
   with `row_group_size` 10k–20k before `portolan add`; Portolan rewrites a
   GeoParquet only when it lacks a bbox covering column, so such a file is
   kept as it is) or in the library (**ml-37r.11**, page-index
   pruning). For large layers, PMTiles is the better answer anyway.
4. **PMTiles is off by default.** Without `--pmtiles` or
   `pmtiles.enabled: true` (and tippecanoe installed) a large vector collection
   has only GeoParquet.
5. **Spec latitude.** Portolan allows GeoParquet 2.x with native stats and no
   `bbox` column (refused for `load: viewport`, **ml-37r.11**) and
   native-geometry files without a `geo` key (a projected one fails silently,
   **ml-37r.8**). Neither is the CLI 0.8.0 default. `portolan-cli` on `main`
   already requires `geoparquet-io >= 1.6` ("keeps CRS, native geometry and
   bbox covering on every write path"), so re-check this when CLI 0.9 ships.
6. **Private data.** Portolan has no access control yet (a v1.0 roadmap item),
   and maplibre-yaml has no request hook for headers or signing.
   **ml-37r.13**.

Also seen with CLI 0.8.0 (Portolan-side issues, worth knowing when writing
the course's instructions; not filed here):

- `portolan add .` registered the **source GeoJSON** as the collection's data
  asset and left the converted `.parquet` unregistered; we had to remove the
  sources and re-add.
- Rasters must sit in `collection/item/` folders (`add` refuses a COG at
  collection level), while `check` then reports PTL-COL-001 ("single-file
  collections carry their data at collection level").
- The COGs it wrote lacked the embedded statistics its own `check` requires
  (PTL-DAT-009).

## 6. Catalog-aware sources (design sketch)

**Is it worth it?** Yes, for a course especially:

- Students would write collection IDs instead of 100-character object URLs.
- Re-publishing a collection, or moving the bucket, doesn't break every map.
- `fitTo` gets the extent from metadata, so the data needn't be read (and
  PMTiles finally gets a `fitTo`, ml-cnv.9).
- Attribution and license come from the catalog's `providers` and `license`.
- A map can pin a dataset version.

Everything needed is in static JSON that Portolan already requires to be served
with CORS. Tracked as **ml-37r.10**; the syntax below needs a decision first.

The format rules stay as they are: **`type:` is MapLibre's source type**, and
the format comes from the resolved URL, or the asset's media type, or
`format:`. The source type also picks which asset to use, which is what makes
a short form possible.

### Option A (recommended): a `stac:` key on a source

```yaml no-validate
sources:
  footprints:
    type: geojson          # geojson → the collection's "data" asset (GeoParquet, then FGB, then GeoJSON)
    stac: https://data.source.coop/nlebovits/phl-housing-demo/li_building_footprints/collection.json
    load: viewport
  footprints-tiles:
    type: vector           # vector → the rel: "pmtiles" link, else a PMTiles asset (visual, then data)
    stac: https://data.source.coop/nlebovits/phl-housing-demo/li_building_footprints/collection.json
  orthos:
    type: raster           # raster / raster-dem → the COG asset
    stac:
      href: https://data.example.edu/course/catalog.json
      collection: imagery/orthos-2026   # a Portolan collection ID (a POSIX path), found through child links
      item: tile-07                     # optional: an item of that collection
      asset: visual                     # optional: an asset key or a role; the default comes from type:
      version: 2026-08-26               # optional: a "version-…" archive asset (reproducible course maps)
```

- `stac:` is a string (the href of a catalog, collection or item JSON) or an
  object. `url:` and `stac:` are mutually exclusive.
- **Resolution, at load:** fetch the JSON, follow `child` links to
  `collection:` if given, then `item` links to `item:`. Pick the asset, then
  resolve its `href` against the JSON's own URL (Portolan uses both
  `./x.parquet` and absolute `https://` hrefs). The result is the source's
  `url`, and the existing cloud-native path takes over unchanged.
- **Format:** `format:` wins, then the asset `type`
  (`application/vnd.apache.parquet` → geoparquet, `application/vnd.pmtiles`,
  `image/tiff; application=geotiff; profile=cloud-optimized` → cog,
  `application/vnd.flatgeobuf`), then the href's extension.
- **Wrong or ambiguous picks** are errors in the usual voice: "collection
  `li_building_footprints` has no asset `visual` for a geojson source; it has:
  `li_building_footprints` (GeoParquet, data), `li_building_footprints-tiles`
  (PMTiles, visual) …", with did-you-mean on keys. A `vector` source whose
  layers lack `source-layer` gets a hint naming `pmtiles:layers`.
- **Extent:** collection `extent.spatial.bbox[0]` or item `bbox` feeds
  `fitTo` before any data is read. **Attribution:** from `providers`
  (producer and host) plus `license`, unless the source sets `attribution:`.

### Option B: a URL scheme, `url: stac+https://…/collection.json#asset`

```yaml no-validate
sources:
  footprints:
    type: geojson
    url: "stac+https://data.source.coop/nlebovits/phl-housing-demo/li_building_footprints/collection.json#li_building_footprints"
```

This is compact and follows the `pmtiles://`/`cog://` precedent. But:

- The fragment carries only an asset key, so `item:` and `version:` need more
  invented URL syntax.
- Format detection currently drops fragments.
- A `stac+https:` URL looks like something MapLibre should understand, and it
  can't.
- `mlym emit` and the JSON Schema can't describe the parts.

**Not recommended**, except perhaps later as an alias of A's string form.

### Option C: named catalogs, then IDs (an extension of A)

```yaml no-validate
catalogs:
  course: https://data.example.edu/course-2027/catalog.json
sources:
  parcels:
    type: geojson
    stac: { from: course, collection: dor_parcel }
```

One line switches every map from a staging bucket to production, and students
write only collection IDs. Ideally `catalogs:` lives in the course site's
shared config (the global-config-inheritance plan,
`docs/plans/feat-global-config-inheritance.md`) rather than in each
document. Ship A first; C is additive.

### Behaviour around it

- **Static catalog vs STAC API.** Portolan is static only. Resolution that
  reads one JSON document and its `assets` also works against a STAC API,
  because `/collections/{id}` and `/collections/{id}/items/{item}` return the
  same Collection and Item JSON, so `href:` may point at those. Looking up
  `collection:` from a root differs (child links vs `/collections/{id}`, told
  apart by the root's `conformsTo`). Search (`/search`, CQL2) is out of scope;
  a map names data, it doesn't query for it.
- **Auth.** Course catalogs will be public, since Portolan has no access
  control yet. For private ones, never put tokens in YAML (documents are
  public files). The hook is a URL signer: a STAC-style signing endpoint
  (`stac: { …, sign: https://…/sign }`, the Planetary Computer pattern) or the
  JS request hook from **ml-37r.13**, applied to the resolved asset href.
  Presigned GET URLs already work as `url:`, with one trap noted in
  ml-37r.13: the `HEAD` size fallback when `Content-Range` is hidden.
- **Caching.** Keep one in-memory promise per absolute JSON URL per page,
  shared by every source, map and story chapter. Leave revalidation to the
  browser's HTTP cache (Portolan requires `ETag` and the conditional
  headers). Nothing persists in `localStorage`. Resolution failures and
  timeouts become the same non-fatal notice as a missing file.
- **`mlym validate`** stays offline by default: it checks only the schema
  (`stac:` shape, `url`/`stac` exclusivity). `--resolve` fetches the catalog
  and checks that the collection, item and asset exist and that the media
  type fits `type:`. The Astro content loader could run the same check at
  build.
- **`mlym emit`** must resolve, because a `style.json` has no STAC. It writes
  the resolved href; GeoParquet and FGB are then inlined as GeoJSON as today,
  and PMTiles becomes `pmtiles://…`. Without network access it fails clearly,
  and `--strict` refuses. A `mlym resolve` (or `emit --format yaml`) that
  writes the document back with plain `url:`s pins a site to today's
  hrefs.
- **Format v2.** The source keeps `url:` for what MapLibre reads, so `stac:`
  belongs under the source's `runtime:` alongside `format:`/`load:`/`columns:`,
  with `url:` omitted; emitted v2 output carries the resolved `url:`.
- **Python package (ml-37r.2, designed in its own spike).** The only
  touch-point is that the helper should accept a `pystac`
  Collection/Item/Asset and write a `stac:` reference (or its resolved
  `url:`), using the same asset-selection rules. Spec those rules once, in
  the JSON Schema descriptions and a small shared fixture catalog that both
  test suites resolve.
- **Later, not v1:** the catalog's style assets. `mapStyle:` pointing at a
  Portolan `styles/*.json` already works today. A `stac:` form for
  `mapStyle`, or importing a style asset's layers into a document, can wait.

## 7. Recommendations

**For the course (no library change needed):**

1. **Host:** an R2 or S3 bucket made public with the CORS rules in §4, or
   Source Cooperative. Add `portolan check --live --url <public base>` to the
   catalog repo's CI (`portolan-catalog-template` already runs rashid on PRs).
   Don't serve the data through Cloudflare Workers static assets.
2. **Prepare data before `portolan add`**, because Portolan won't:
   - vectors to EPSG:4326;
   - rasters to a Web Mercator COG (`gdalwarp -t_srs EPSG:3857 -of COG -co
     COMPRESS=DEFLATE`), ideally with `-stats` so `portolan check` passes;
   - large vector layers written with 10k–20k-row groups;
   - `portolan config set pmtiles.enabled true` with `pip install tippecanoe`
     for anything big or dense.

   The Python helper (ml-37r.2) is the natural home for a `prepare_for_web()`
   step.
3. **In YAML today:** copy the asset `href` from `collection.json` (absolute
   `https`). For a quick look, `mapStyle:` can point at a collection's
   `styles/default.json`. A collection's `items.parquet` is a ready-made
   footprint layer.

**For the library, in order:**

1. ml-37r.8: silent failure on a projected native-geometry file (bug, small).
2. ml-37r.14: docs page for Portolan/STAC catalogs and bucket CORS.
3. ml-37r.9: correct the "isn't spatially sorted" wording.
4. ml-37r.10: decide the syntax (A, plus C later), then build catalog-aware
   sources.
5. ml-cnv.8 and ml-37r.12: reprojection. Portolan makes this a course-level
   question, not an edge case.
6. ml-37r.11 and ml-37r.13: as demand appears.

## 8. Open questions for the maintainer

1. **Static only?** Is "Portolan server" a bucket plus CLI (what Portolan is),
   or will students also stand up a STAC API? That decides whether ml-37r.10
   v1 includes API lookups.
2. **Who reprojects?** Should the course pipeline enforce EPSG:4326 and
   EPSG:3857, or should maplibre-yaml reproject (ml-cnv.8, ml-37r.12)? Rasters
   are where students will hit it first.
3. **Syntax:** A (`stac:` key), B (`stac+https:` URL) or C (named catalogs)?
   The recommendation is A now and C later.
4. **Where does the course catalog live:** R2, Source Cooperative, or a
   university bucket? And is any of it private (Portolan can't do access
   control yet)?
5. **Pin dataset versions** (`version:`) in student maps, so a re-published
   collection doesn't change a graded map?
6. **Portolan churn:** CLI 0.8.0 on PyPI vs `main` (newer `geoparquet-io`,
   spec schema v0.2.0). Re-run this spike's matrix when CLI 0.9 or 1.0 ships;
   the harness is described below.

## Appendix: reproducing

- **Tooling:** a scratch venv with `portolan-cli==0.8.0`, `tippecanoe==2.72.0`.
- **Catalog:** synthetic inputs as in §2, then `portolan init --auto --license
  CC-BY-4.0`, `portolan add --pmtiles --thumbnails <collections>` (rasters
  under `collection/item/`, with `--datetime`), and `portolan check --fix`.
- **Server:** a 60-line Node server serving the catalog under `/full/`,
  `/noexpose/`, `/norange/` and `/nocors/` header profiles.
- **Harness:** a page loading `<ml-map src="cases/<name>.yaml">` from unpkg
  `@maplibre-yaml/core@0.9`, run by Playwright, which records `ml-map:*`
  events, the notice text, console output, request ranges and bytes, and a
  screenshot.
- Scratch files were removed after the spike. The case documents are plain
  maplibre-yaml (`type: map`, one source and one layer each), easy to
  recreate from the tables above.
