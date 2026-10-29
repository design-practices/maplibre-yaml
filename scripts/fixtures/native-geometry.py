# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "geopandas>=1.0",
#   "pyproj>=3.6",
#   "pyarrow>=16",
#   "geoparquet-io==1.7.0",
# ]
# ///
"""Generate the native-GEOMETRY Parquet fixtures (0.10.1, ml-37r.8).

Parquet's own GEOMETRY logical type carries WKB and its CRS in the schema,
with no `geo` key in the footer (GeoParquet 2.x; geoparquet-io's
`parquet-geo-only`). These are the committed districts.parquet
(scripts/fixtures/cloud-native.py: 48 polygons, CC0) rewritten that way:

    districts-native.parquet       lon/lat: the logical type's CRS is
                                   EPSG:4326 as inline PROJJSON
    districts-native-2272.parquet  the districts in EPSG:2272 (a US state
                                   plane, feet), inline PROJJSON: refused,
                                   as the same data with a `geo` key is

Run (from the repo root):

    uv run scripts/fixtures/native-geometry.py

Writes to docs/public/gallery-assets/cloud-native/.
"""
import os
import tempfile

import geopandas as gpd
import geoparquet_io
import pyarrow.parquet as pq

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "docs", "public", "gallery-assets", "cloud-native")

districts = gpd.read_parquet(os.path.join(OUT, "districts.parquet"))
tmp = tempfile.mkdtemp()
for crs, name in [("EPSG:4326", "districts-native.parquet"), ("EPSG:2272", "districts-native-2272.parquet")]:
    src = os.path.join(tmp, name)
    districts.to_crs(crs).to_parquet(src, index=False)
    out = os.path.join(OUT, name)
    geoparquet_io.read(src).write(out, geoparquet_version="parquet-geo-only", compression="SNAPPY", overwrite=True)
    meta = pq.ParquetFile(out).metadata
    assert b"geo" not in (meta.metadata or {}), "a native GEOMETRY file has no geo key"
    print(f"{os.path.getsize(out) / 1024:6.1f} KB  {name} ({meta.num_rows} rows) {meta.schema.column(meta.schema.names.index('geometry')).logical_type}"[:160])
