# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "numpy>=1.26",
#   "shapely>=2.0",
#   "geopandas>=1.0",
#   "pyogrio>=0.9",
#   "mapbox-vector-tile>=2.1",
#   "pmtiles>=3.4",
#   "pillow>=10",
#   "pyarrow>=16",
# ]
# ///
"""Generate the small, synthetic cloud-native fixtures (0.9, ml-cnv).

Everything is computed — no downloaded data — in a fictional study area in
the Tyrrhenian Sea (no real places), so the files are public domain (CC0)
and regenerate byte-for-byte from a fixed seed. The fixtures are committed;
CI never runs this script.

Run (from the repo root):

    uv run scripts/fixtures/cloud-native.py

Writes to docs/public/gallery-assets/cloud-native/, which the docs site
serves (gallery pages) and the e2e server serves at
/gallery-assets/cloud-native/ (browser tests):

    districts.pmtiles       vector PMTiles: layers `districts` (48 polygons)
                            and `points` (400 points), z0-11; no feature ids
    districts-ids.pmtiles   vector PMTiles: layer `districts` only, with
                            feature ids (1-48) in the tiles, z0-9
    imagery.pmtiles         raster PMTiles (PNG), z0-8
    districts.fgb           48 polygons, spatial index, EPSG:4326
    points.fgb              400 points, spatial index (viewport reads)
    points-noindex.fgb      the same points without an index
    districts-3857.fgb      the districts in Web Mercator (the wrong-CRS case)
    not-really.pmtiles      a web page saved under a .pmtiles name
    not-really.fgb          a web page saved under a .fgb name

GeoParquet (WKB geometry, the GeoParquet 1.1 `bbox` covering column):

    districts.parquet       48 polygons, snappy, one row group
    points.parquet          400 points, snappy, Hilbert-sorted into 8 row
                            groups of 50 (viewport reads skip row groups)
    points-zstd.parquet     the points, zstd
    points-brotli.parquet   the points, brotli (the separately loaded codec)
    points-geoarrow.parquet the points with GeoArrow-native geometry (refused)
    districts-3857.parquet  the districts in Web Mercator (the wrong-CRS case)
    districts-nobbox.parquet the districts without a bbox covering column
    plain.parquet           a Parquet file with no GeoParquet metadata
    not-really.parquet      a web page saved under a .parquet name

and copies districts.pmtiles, districts.fgb and districts.parquet into the
Astro example site (examples/astro/site/public/data/cloud-native/).

`--geoparquet` writes only the GeoParquet files (same data, same seed), so
the other fixtures stay byte-for-byte as committed; `--vector-ids` writes
only districts-ids.pmtiles.
"""
import gzip
import math
import os
import shutil
import sys

import numpy as np
import geopandas as gpd
import mapbox_vector_tile
from PIL import Image
from io import BytesIO
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer
import shapely
from shapely.geometry import Point, Polygon, box

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "docs", "public", "gallery-assets", "cloud-native")
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(42)

# A fictional study area (Tyrrhenian Sea: no real places).
W, S, E, N = 10.0, 42.0, 10.4, 42.3
R = 6378137.0


def districts():
    rows = []
    nx, ny = 8, 6
    dx, dy = (E - W) / nx, (N - S) / ny
    for i in range(nx):
        for j in range(ny):
            x0, y0 = W + i * dx, S + j * dy
            poly = Polygon([
                (x0, y0),
                (x0 + dx, y0 + dy * 0.05 * math.sin(i)),
                (x0 + dx, y0 + dy),
                (x0 + dx * 0.05 * math.cos(j), y0 + dy),
            ])
            rows.append({
                "name": f"District {chr(65 + i)}{j + 1}",
                "category": ["residential", "industrial", "park", "commercial"][(i * 3 + j) % 4],
                "population": int(rng.integers(500, 25000)),
                "geometry": poly,
            })
    return gpd.GeoDataFrame(rows, crs="EPSG:4326")


def points(n):
    xs = rng.uniform(W, E, n)
    ys = rng.uniform(S, N, n)
    return gpd.GeoDataFrame({
        "id": np.arange(n),
        "kind": rng.choice(["well", "station", "beacon"], n),
        "value": np.round(rng.uniform(0, 100, n), 2),
        "geometry": [Point(x, y) for x, y in zip(xs, ys)],
    }, crs="EPSG:4326")


def write_fgb(gdf, name, index=True):
    path = os.path.join(OUT, name)
    if os.path.exists(path):
        os.remove(path)
    gdf.to_file(path, driver="FlatGeobuf", engine="pyogrio",
                layer_options={"SPATIAL_INDEX": "YES" if index else "NO"})


def write_parquet(gdf, name, **kwargs):
    """GeoParquet 1.1 with WKB geometry and the `bbox` covering column."""
    path = os.path.join(OUT, name)
    if os.path.exists(path):
        os.remove(path)
    options = {"compression": "snappy", "write_covering_bbox": True, "schema_version": "1.1.0"}
    options.update(kwargs)
    gdf.to_parquet(path, index=False, **options)


def write_geoparquet_fixtures(d, p):
    # Spatially sorted (Hilbert) so row groups cover compact areas: what makes
    # `load: viewport` skip most of the file.
    order = p.geometry.hilbert_distance().sort_values(kind="stable").index
    sorted_points = p.loc[order].reset_index(drop=True)
    write_parquet(d, "districts.parquet")
    write_parquet(sorted_points, "points.parquet", row_group_size=50)
    write_parquet(sorted_points, "points-zstd.parquet", compression="zstd")
    write_parquet(sorted_points, "points-brotli.parquet", compression="brotli")
    write_parquet(sorted_points, "points-geoarrow.parquet", geometry_encoding="geoarrow")
    write_parquet(d.to_crs("EPSG:3857"), "districts-3857.parquet")
    write_parquet(d, "districts-nobbox.parquet", write_covering_bbox=False)
    # A Parquet file with no `geo` metadata: the geometry as plain WKB bytes.
    import pyarrow as pa
    import pyarrow.parquet as pq
    table = pa.table({
        "name": d["name"].tolist(),
        "wkb": [g.wkb for g in d.geometry],
    })
    pq.write_table(table, os.path.join(OUT, "plain.parquet"), compression="snappy")
    with open(os.path.join(OUT, "not-really.parquet"), "w") as f:
        f.write(NOT_A_FILE)


def tile_bounds_merc(z, x, y):
    size = 2 * math.pi * R / 2 ** z
    minx = -math.pi * R + x * size
    maxy = math.pi * R - y * size
    return minx, maxy - size, minx + size, maxy


def tile_range(z):
    n = 2 ** z

    def tx(lon):
        return int((lon + 180) / 360 * n)

    def ty(lat):
        r = math.radians(lat)
        return int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n)

    return tx(W), tx(E), ty(N), ty(S)


def header(tile_type, compression, maxzoom):
    return {
        "tile_type": tile_type,
        "tile_compression": compression,
        "min_zoom": 0,
        "max_zoom": maxzoom,
        "min_lon_e7": int(W * 1e7), "min_lat_e7": int(S * 1e7),
        "max_lon_e7": int(E * 1e7), "max_lat_e7": int(N * 1e7),
        "center_zoom": 10,
        "center_lon_e7": int((W + E) / 2 * 1e7),
        "center_lat_e7": int((S + N) / 2 * 1e7),
    }


def vector_pmtiles(path, layers, maxzoom, ids=False):
    merc = {name: gdf.to_crs("EPSG:3857") for name, gdf in layers.items()}
    with open(path, "wb") as f:
        writer = Writer(f)
        for z in range(0, maxzoom + 1):
            x0, x1, y0, y1 = tile_range(z)
            for x in range(x0, x1 + 1):
                for y in range(y0, y1 + 1):
                    minx, miny, maxx, maxy = tile_bounds_merc(z, x, y)
                    buf = (maxx - minx) * 64 / 4096
                    clip = box(minx - buf, miny - buf, maxx + buf, maxy + buf)
                    tile_layers = []
                    for name, gdf in merc.items():
                        feats = []
                        for index, row in gdf[gdf.intersects(clip)].iterrows():
                            g = row.geometry.intersection(clip)
                            if g.is_empty:
                                continue
                            scale = np.array([maxx - minx, maxy - miny])
                            g = shapely.transform(
                                g, lambda c: (c - np.array([minx, miny])) / scale * 4096)
                            props = {k: (v.item() if hasattr(v, "item") else v)
                                     for k, v in row.items() if k != "geometry"}
                            feat = {"geometry": g.wkt, "properties": props}
                            if ids:
                                feat["id"] = int(index) + 1  # tile feature ids, 1-based
                            feats.append(feat)
                        if feats:
                            tile_layers.append({"name": name, "features": feats})
                    if not tile_layers:
                        continue
                    data = mapbox_vector_tile.encode(
                        tile_layers, default_options={"y_coord_down": False, "extents": 4096})
                    writer.write_tile(zxy_to_tileid(z, x, y), gzip.compress(data, mtime=0))
        vector_layers = [
            {"id": n, "fields": {k: "String" for k in g.columns if k != "geometry"}}
            for n, g in layers.items()
        ]
        writer.finalize(
            header(TileType.MVT, Compression.GZIP, maxzoom),
            {"vector_layers": vector_layers, "attribution": "Synthetic data (CC0)",
             "name": "maplibre-yaml cloud-native fixture"},
        )


def imagery(mx, my):
    """Synthetic 'imagery' as a pure function of Web Mercator position (seamless)."""
    t = 2 * math.pi
    u = (mx / (2 * math.pi * R)) + 0.5
    v = 0.5 - (my / (2 * math.pi * R))
    h = np.sin(u * t * 900) * np.cos(v * t * 700) + 0.5 * np.sin(u * t * 2300 + v * t * 1700)
    r = (90 + 60 * h).clip(0, 255)
    g = (130 + 70 * np.cos(h * 2)).clip(0, 255)
    b = (80 + 40 * h).clip(0, 255)
    return (np.stack([r, g, b], axis=-1) // 48 * 48).astype("uint8")


def raster_pmtiles(path, maxzoom):
    with open(path, "wb") as f:
        writer = Writer(f)
        for z in range(0, maxzoom + 1):
            x0, x1, y0, y1 = tile_range(z)
            for x in range(x0, x1 + 1):
                for y in range(y0, y1 + 1):
                    minx, miny, maxx, maxy = tile_bounds_merc(z, x, y)
                    xs = np.linspace(minx, maxx, 256, endpoint=False) + (maxx - minx) / 512
                    ys = np.linspace(maxy, miny, 256, endpoint=False) - (maxy - miny) / 512
                    gx, gy = np.meshgrid(xs, ys)
                    png = BytesIO()
                    Image.fromarray(imagery(gx, gy), "RGB").save(png, format="PNG", optimize=True)
                    writer.write_tile(zxy_to_tileid(z, x, y), png.getvalue())
        writer.finalize(
            header(TileType.PNG, Compression.NONE, maxzoom),
            {"attribution": "Synthetic imagery (CC0)", "name": "maplibre-yaml raster fixture"},
        )


NOT_A_FILE = (
    "<!doctype html><html><head><title>Not found</title></head>"
    "<body><h1>Page not found</h1><p>A web server's fallback page, "
    "saved under a data file's name.</p></body></html>\n"
)

if __name__ == "__main__":
    d = districts()
    p = points(400)
    if "--vector-ids" in sys.argv:
        path = os.path.join(OUT, "districts-ids.pmtiles")
        vector_pmtiles(path, {"districts": d}, maxzoom=9, ids=True)
        print(f"{os.path.getsize(path) / 1024:8.1f} KB  districts-ids.pmtiles")
        sys.exit(0)
    if "--geoparquet" in sys.argv:
        write_geoparquet_fixtures(d, p)
        astro = os.path.join(ROOT, "examples", "astro", "site", "public", "data", "cloud-native")
        shutil.copyfile(os.path.join(OUT, "districts.parquet"), os.path.join(astro, "districts.parquet"))
        for name in sorted(os.listdir(OUT)):
            if "parquet" in name:
                print(f"{os.path.getsize(os.path.join(OUT, name)) / 1024:8.1f} KB  {name}")
        sys.exit(0)
    write_fgb(d, "districts.fgb")
    write_fgb(p, "points.fgb")
    write_fgb(p, "points-noindex.fgb", index=False)
    write_fgb(d.to_crs("EPSG:3857"), "districts-3857.fgb")
    vector_pmtiles(os.path.join(OUT, "districts.pmtiles"), {"districts": d, "points": p}, maxzoom=11)
    vector_pmtiles(os.path.join(OUT, "districts-ids.pmtiles"), {"districts": d}, maxzoom=9, ids=True)
    raster_pmtiles(os.path.join(OUT, "imagery.pmtiles"), maxzoom=8)
    write_geoparquet_fixtures(d, p)
    for name in ("not-really.pmtiles", "not-really.fgb"):
        with open(os.path.join(OUT, name), "w") as f:
            f.write(NOT_A_FILE)
    # The Astro example site serves its own copies (its public/ folder).
    astro = os.path.join(ROOT, "examples", "astro", "site", "public", "data", "cloud-native")
    os.makedirs(astro, exist_ok=True)
    for name in ("districts.pmtiles", "districts.fgb", "districts.parquet"):
        shutil.copyfile(os.path.join(OUT, name), os.path.join(astro, name))
    total = 0
    for name in sorted(os.listdir(OUT)):
        size = os.path.getsize(os.path.join(OUT, name))
        total += size
        print(f"{size / 1024:8.1f} KB  {name}")
    print(f"{total / 1024:8.1f} KB  total")
