# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "numpy>=1.26",
#   "shapely>=2.0",
#   "geopandas>=1.0",
#   "pyarrow>=16",
#   "tylertoo==0.8.0",
# ]
# ///
"""Generate the `geo:overviews` GeoParquet fixture (0.9.2, ml-cnv.21).

A tylertoo overview file stores a generalised copy of the data per zoom
level as extra row groups (draft spec 0.2.0, `duplicating` mode), listed in
the `geo:overviews` footer key; a reader that ignores the key sees every
level's rows. This writes a small one, from computed data in the same
fictional study area as scripts/fixtures/cloud-native.py (CC0):

    lots-overviews.parquet  tylertoo 0.8.0 `overview(min_zoom=10,
                            max_zoom=14, row_group_size=200)` of 600 small
                            "lots" (a 30 × 20 grid of ~90 m squares,
                            Hilbert-sorted, with a bbox column): the 600
                            lots at zoom 14 (the canonical level, 3 row
                            groups) plus coarser copies at zooms 10-13

Run (from the repo root):

    uv run scripts/fixtures/overviews.py

Writes to docs/public/gallery-assets/cloud-native/ (served at
/gallery-assets/cloud-native/ by the docs site and the e2e server).
"""
import json
import os
import tempfile

import geopandas as gpd
import numpy as np
import pyarrow.parquet as pq
import tylertoo
from shapely.geometry import box

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "docs", "public", "gallery-assets", "cloud-native")
rng = np.random.default_rng(7)

W, S = 10.10, 42.05
NX, NY = 30, 20
D = 0.0011  # degrees per lot (about 90 m)

rows = []
for i in range(NX):
    for j in range(NY):
        x0, y0 = W + i * D, S + j * D * 0.75
        rows.append({
            "lot": i * NY + j + 1,
            "floors": int(rng.integers(1, 12)),
            "geometry": box(x0 + D * 0.05, y0 + D * 0.04, x0 + D * 0.95, y0 + D * 0.71),
        })
lots = gpd.GeoDataFrame(rows, crs="EPSG:4326")
order = lots.geometry.hilbert_distance().sort_values(kind="stable").index
lots = lots.loc[order].reset_index(drop=True)

src = os.path.join(tempfile.mkdtemp(), "lots.parquet")
out = os.path.join(OUT, "lots-overviews.parquet")
if os.path.exists(out):
    os.remove(out)
lots.to_parquet(src, index=False, compression="zstd", write_covering_bbox=True, schema_version="1.1.0", row_group_size=200)
tylertoo.overview(src, out, min_zoom=10, max_zoom=14, row_group_size=200)

meta = pq.ParquetFile(out).metadata
key = meta.metadata[b"geo:overviews"].decode()
print(f"{os.path.getsize(out) / 1024:6.1f} KB  lots-overviews.parquet ({meta.num_rows} rows, {meta.num_row_groups} row groups)")
overviews = json.loads(key)
overviews.pop("generalization", None)
print(json.dumps(overviews))
