# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "numpy>=1.26",
#   "rasterio>=1.4",
# ]
# ///
"""Generate the small, synthetic Cloud Optimized GeoTIFF fixtures (0.9, ml-cnv.2).

Everything is computed (no downloaded data) over the same fictional island in
the Tyrrhenian Sea as scripts/fixtures/cloud-native.py, so the files are
public domain (CC0) and regenerate the same way from the same code. The
fixtures are committed; CI never runs this script. rasterio's wheels bundle
GDAL (with its COG driver), so no system GDAL is needed:

    uv run scripts/fixtures/cog.py

Writes to docs/public/gallery-assets/cloud-native/ (served by the docs site
at /gallery-assets/cloud-native/ and by e2e/server.mjs for the browser tests):

    imagery.cog.tif        RGB imagery, EPSG:3857, 512 px, DEFLATE, 256 px
                           tiles, one overview (a COG as `gdalwarp -of COG`
                           writes it)
    elevation.cog.tif      elevation in metres (Float32), EPSG:3857, 384 px:
                           hillshade and 3D terrain
    ndvi.cog.tif           a vegetation index (Float32, -0.1 to 0.85), EPSG:3857, 256 px,
                           NaN over the sea: one band for a colour ramp
    imagery-4326.cog.tif   the imagery as a COG in EPSG:4326 (longitude/
                           latitude): the wrong-projection case
    imagery-plain.tif      the imagery as an ordinary GeoTIFF in EPSG:3857,
                           in strips, no overviews: the not-cloud-optimized
                           case
    not-really.tif         a web page saved under a .tif name

and copies imagery.cog.tif and elevation.cog.tif into the Astro example site
(examples/astro/site/public/data/cloud-native/).

The GDAL options used match the commands the docs give
(`gdalwarp -t_srs EPSG:3857 -of COG -co COMPRESS=DEFLATE in.tif out.tif`).
"""
import math
import os
import shutil
import tempfile

import numpy as np
import rasterio
from rasterio.shutil import copy as rio_copy
from rasterio.transform import from_bounds

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "docs", "public", "gallery-assets", "cloud-native")
os.makedirs(OUT, exist_ok=True)

# The study area of the other cloud-native fixtures (no real places).
W, S, E, N = 10.0, 42.0, 10.4, 42.3
R = 6378137.0


def merc(lon, lat):
    x = math.radians(lon) * R
    y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R
    return x, y


def lonlat(x, y):
    return np.degrees(x / R), np.degrees(2 * np.arctan(np.exp(y / R)) - math.pi / 2)


def elevation(lon, lat):
    """An island: two summits and a ridge, sea below 0 m (pure function of lon/lat)."""
    u = (lon - W) / (E - W)
    v = (lat - S) / (N - S)
    h = (
        1150 * np.exp(-(((u - 0.38) / 0.16) ** 2 + ((v - 0.55) / 0.2) ** 2))
        + 780 * np.exp(-(((u - 0.66) / 0.12) ** 2 + ((v - 0.4) / 0.14) ** 2))
        + 260 * np.exp(-(((u - 0.52) / 0.3) ** 2 + ((v - 0.48) / 0.28) ** 2))
        + 45 * np.sin(u * 37) * np.cos(v * 29)
    )
    coast = np.sqrt(((u - 0.5) / 0.42) ** 2 + ((v - 0.48) / 0.4) ** 2)
    return h - 30 - 900 * np.clip(coast - 0.8, 0, None)


def hillshade(z, cell):
    gy, gx = np.gradient(z, cell)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az, alt = math.radians(315), math.radians(45)
    return np.clip(
        np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect), 0, 1
    )


def imagery(z, cell):
    """'Imagery': hypsometric colours with baked-in shading, posterized so it compresses."""
    stops = [  # (metres, rgb)
        (-200, (38, 84, 124)),
        (0, (74, 132, 168)),
        (1, (214, 202, 160)),
        (60, (120, 156, 92)),
        (400, (88, 124, 70)),
        (800, (146, 120, 88)),
        (1200, (228, 226, 220)),
    ]
    hs = hillshade(np.maximum(z, 0) * 3, cell)
    out = np.zeros(z.shape + (3,))
    for c in range(3):
        out[..., c] = np.interp(z, [s[0] for s in stops], [s[1][c] for s in stops])
    land = z > 0
    out[land] *= (0.55 + 0.6 * hs[land])[:, None]
    return (np.clip(out, 0, 255) // 8 * 8).astype("uint8")


def ndvi(z):
    """A vegetation index: high in the green lowlands, low on the summits, none at sea."""
    v = np.interp(z, [0, 40, 300, 700, 1200], [0.15, 0.55, 0.85, 0.45, -0.1])
    return np.where(z > 0, np.round(v, 2), np.nan).astype("float32")


def grid_3857(size):
    (x0, y0), (x1, y1) = merc(W, S), merc(E, N)
    xs = x0 + (np.arange(size) + 0.5) * (x1 - x0) / size
    ys = y1 - (np.arange(size) + 0.5) * (y1 - y0) / size
    gx, gy = np.meshgrid(xs, ys)
    lon, lat = lonlat(gx, gy)
    return lon, lat, from_bounds(x0, y0, x1, y1, size, size), (x1 - x0) / size


def write(path, data, crs, transform, driver="COG", **options):
    """Write a dataset (bands first) via a temporary GTiff, as `gdal_translate -of <driver>`."""
    if os.path.exists(path):
        os.remove(path)
    bands = data if data.ndim == 3 else data[None]
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "src.tif")
        profile = dict(
            driver="GTiff",
            width=bands.shape[2],
            height=bands.shape[1],
            count=bands.shape[0],
            dtype=bands.dtype,
            crs=crs,
            transform=transform,
        )
        if "nodata" in options:
            profile["nodata"] = options.pop("nodata")
        if bands.shape[0] == 3:
            profile["photometric"] = "RGB"
        with rasterio.open(src, "w", **profile) as dst:
            dst.write(bands)
        rio_copy(src, path, driver=driver, **options)


def describe(path):
    with rasterio.open(path) as ds:
        tiled = ds.profile.get("tiled", False)
        print(
            f"{os.path.getsize(path) / 1024:7.1f} KB  {os.path.basename(path):24s} "
            f"{ds.crs.to_string():10s} {ds.width}x{ds.height} {ds.dtypes[0]:8s} "
            f"{'tiled ' + str(ds.block_shapes[0]) if tiled else 'strips'} "
            f"overviews={ds.overviews(1)}"
        )


NOT_A_FILE = (
    "<!doctype html><html><head><title>Not found</title></head>"
    "<body><h1>Page not found</h1><p>A web server's fallback page, "
    "saved under a data file's name.</p></body></html>\n"
)

if __name__ == "__main__":
    cog = dict(BLOCKSIZE=256, COMPRESS="DEFLATE", PREDICTOR="YES", OVERVIEWS="AUTO")

    lon, lat, transform, cell = grid_3857(512)
    z = elevation(lon, lat)
    rgb = np.moveaxis(imagery(z, cell), -1, 0)
    write(os.path.join(OUT, "imagery.cog.tif"), rgb, "EPSG:3857", transform, **cog)

    lon, lat, transform, cell = grid_3857(384)
    z = elevation(lon, lat)
    write(
        os.path.join(OUT, "elevation.cog.tif"),
        # Float32, to 0.1 m: whole metres terrace visibly in a hillshade.
        np.round(np.maximum(z, -50), 1).astype("float32"),
        "EPSG:3857",
        transform,
        **cog,
    )
    lon, lat, transform, cell = grid_3857(256)
    write(
        os.path.join(OUT, "ndvi.cog.tif"),
        ndvi(elevation(lon, lat)),
        "EPSG:3857",
        transform,
        nodata=float("nan"),
        **cog,
    )

    # The wrong projection: the same island, in longitude/latitude.
    size = (192, 144)
    xs = W + (np.arange(size[0]) + 0.5) * (E - W) / size[0]
    ys = N - (np.arange(size[1]) + 0.5) * (N - S) / size[1]
    glon, glat = np.meshgrid(xs, ys)
    z = elevation(glon, glat)
    rgb = np.moveaxis(imagery(z, 300.0), -1, 0)
    write(
        os.path.join(OUT, "imagery-4326.cog.tif"),
        rgb,
        "EPSG:4326",
        from_bounds(W, S, E, N, size[0], size[1]),
        BLOCKSIZE=128,
        COMPRESS="DEFLATE",
    )

    # Not cloud-optimized: an ordinary GeoTIFF in strips, without overviews.
    lon, lat, transform, cell = grid_3857(384)
    z = elevation(lon, lat)
    rgb = np.moveaxis(imagery(z, cell), -1, 0)
    write(
        os.path.join(OUT, "imagery-plain.tif"),
        rgb,
        "EPSG:3857",
        transform,
        driver="GTiff",
        TILED="NO",
        COMPRESS="DEFLATE",
    )

    with open(os.path.join(OUT, "not-really.tif"), "w") as f:
        f.write(NOT_A_FILE)

    # The Astro example site serves its own copies (its public/ folder).
    astro = os.path.join(ROOT, "examples", "astro", "site", "public", "data", "cloud-native")
    os.makedirs(astro, exist_ok=True)
    for name in ("imagery.cog.tif", "elevation.cog.tif"):
        shutil.copyfile(os.path.join(OUT, name), os.path.join(astro, name))

    for name in (
        "imagery.cog.tif",
        "elevation.cog.tif",
        "ndvi.cog.tif",
        "imagery-4326.cog.tif",
        "imagery-plain.tif",
    ):
        describe(os.path.join(OUT, name))
