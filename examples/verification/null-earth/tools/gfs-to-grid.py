# /// script
# requires-python = ">=3.11"
# dependencies = ["cfgrib>=0.9.15", "eccodes>=2.40", "xarray>=2024.1", "numpy>=1.26", "pillow>=10"]
# ///
"""
GFS -> grid-encoded PNG frames for the null.earth replica (beads ml-nb1.6).

Pulls only the GRIB2 records it needs from NOAA's public GFS bucket on AWS
Open Data (byte ranges from the .idx file, the trick Herbie uses), decodes
them with cfgrib/eccodes, and writes, per forecast hour:

  <stamp>-wind-10m.png   u in R, v in G, both bytes 0..255 over VEL_RANGE m/s
                         (what mapbox-exif-layer's NewParticleMotion reads
                         with velocityRange + bounds and no EXIF); B = 255
                         (the particle shader reads B < 128 as no data),
                         A = 255
  <stamp>-temp-2m.png    2 m temperature in R over TEMP_RANGE kelvin
                         (SmoothRaster with scalarValueRange); G = 0, B = 0
                         (the raster shader reads B > 153 as no data)
  manifest.json          frames, encodings, ranges, bounds, provenance

Longitudes are rolled from GFS's 0..359 to -180..179 so the image is a plain
equirectangular picture of the world, north up, west left; pixel centres sit
on the grid nodes, hence the half-cell bounds in the manifest.

Run (uv resolves the dependencies; no system GDAL or wgrib2 needed):

  uv run tools/gfs-to-grid.py --date 20261114 --cycle 00 --hours 0 3 6 --res 1p00 --out data

Resolutions: 1p00 (360x181, ~120 KB a frame), 0p50 (720x361), 0p25 (1440x721).
Data: NOAA/NWS/NCEP Global Forecast System, public domain (US government work).
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
import urllib.request
from pathlib import Path

import numpy as np
import xarray as xr
from PIL import Image

BUCKET = "https://noaa-gfs-bdp-pds.s3.amazonaws.com"
# GRIB2 inventory lines are "n:offset:d=YYYYMMDDHH:VAR:level:fcst:"; match on VAR:level.
RECORDS = {
    "u10": "UGRD:10 m above ground",
    "v10": "VGRD:10 m above ground",
    "t2m": "TMP:2 m above ground",
}
VEL_RANGE = (-40.0, 40.0)   # m/s mapped onto bytes 0..255 for u and v
TEMP_RANGE = (193.0, 328.0) # kelvin, null.earth's temperature scale extent


def fetch(url: str, headers: dict | None = None) -> bytes:
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def grib_subset(date: str, cycle: str, hour: int, res: str) -> bytes:
    """The wanted records of one GRIB2 file, fetched by byte range and concatenated."""
    name = f"gfs.t{cycle}z.pgrb2.{res}.f{hour:03d}"
    base = f"{BUCKET}/gfs.{date}/{cycle}/atmos/{name}"
    idx = fetch(base + ".idx").decode().splitlines()
    offsets = [int(line.split(":")[1]) for line in idx]
    out = b""
    for key, needle in RECORDS.items():
        hits = [i for i, line in enumerate(idx) if f":{needle}:" in line]
        if not hits:
            sys.exit(f"{name}: record {needle!r} not in index")
        i = hits[0]
        start = offsets[i]
        end = offsets[i + 1] - 1 if i + 1 < len(offsets) else ""
        out += fetch(base, {"Range": f"bytes={start}-{end}"})
    return out


def to_bytes(values: np.ndarray, lo: float, hi: float) -> np.ndarray:
    scaled = (values - lo) / (hi - lo) * 255.0
    return np.clip(np.rint(scaled), 0, 255).astype(np.uint8)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--date", required=True, help="run date, YYYYMMDD (UTC)")
    ap.add_argument("--cycle", default="00", choices=["00", "06", "12", "18"])
    ap.add_argument("--hours", type=int, nargs="+", default=[0, 3, 6], help="forecast hours")
    ap.add_argument("--res", default="1p00", choices=["1p00", "0p50", "0p25"])
    ap.add_argument("--out", type=Path, default=Path("data"))
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    frames = []
    for hour in args.hours:
        raw = grib_subset(args.date, args.cycle, hour, args.res)
        with tempfile.NamedTemporaryFile(suffix=".grib2", delete=False) as tmp:
            tmp.write(raw)
            path = tmp.name
        # One dataset per level type; both share the lat/lon grid.
        wind = xr.open_dataset(path, engine="cfgrib", backend_kwargs={"filter_by_keys": {"typeOfLevel": "heightAboveGround", "level": 10}})
        temp = xr.open_dataset(path, engine="cfgrib", backend_kwargs={"filter_by_keys": {"typeOfLevel": "heightAboveGround", "level": 2}})
        lon = wind.longitude.values
        lat = wind.latitude.values
        assert lat[0] > lat[-1], "expected north-to-south rows (GRIB scan mode 0)"
        dlon = float(abs(lon[1] - lon[0]))
        dlat = float(abs(lat[0] - lat[1]))
        # Roll so the first column is -180 (GFS starts at 0 and runs east to 360 - dlon).
        shift = int(round(180.0 / dlon))
        u = np.roll(wind["u10"].values, shift, axis=1)
        v = np.roll(wind["v10"].values, shift, axis=1)
        t = np.roll(temp["t2m"].values, shift, axis=1)
        speed = np.hypot(u, v)

        ny, nx = u.shape
        rgba = np.zeros((ny, nx, 4), dtype=np.uint8)
        rgba[..., 0] = to_bytes(u, *VEL_RANGE)
        rgba[..., 1] = to_bytes(v, *VEL_RANGE)
        rgba[..., 2] = 255  # particle shader: B < 128 marks no data, so valid cells carry 255
        rgba[..., 3] = 255
        stamp = f"{args.date}{args.cycle}-f{hour:03d}"
        wind_name = f"{stamp}-wind-10m.png"
        temp_name = f"{stamp}-temp-2m.png"
        Image.fromarray(rgba, "RGBA").save(args.out / wind_name, optimize=True)
        tb = to_bytes(t, *TEMP_RANGE)
        zeros = np.zeros_like(tb)
        Image.fromarray(np.stack([tb, zeros, zeros], axis=-1), "RGB").save(args.out / temp_name, optimize=True)

        valid = str(np.datetime_as_string(wind["valid_time"].values, unit="m"))
        frames.append({"hour": hour, "valid": valid + "Z", "wind": wind_name, "temp": temp_name,
                       "stats": {"speed_max_mps": round(float(speed.max()), 1), "t2m_min_k": round(float(t.min()), 1), "t2m_max_k": round(float(t.max()), 1)}})
        print(f"{stamp}: {nx}x{ny}, speed max {speed.max():.1f} m/s, t2m {t.min():.0f}..{t.max():.0f} K", file=sys.stderr)

    # Pixel centres on grid nodes: the image spans half a cell beyond the outer nodes.
    bounds = [-180.0 - dlon / 2, 90.0 + dlat / 2, -180.0 - dlon / 2 + nx * dlon, 90.0 + dlat / 2 - ny * dlat]
    manifest = {
        "source": "NOAA/NWS/NCEP Global Forecast System (GFS), via AWS Open Data noaa-gfs-bdp-pds",
        "license": "US government work, public domain",
        "run": f"{args.date} {args.cycle}Z",
        "resolution_deg": dlon,
        "grid": {"nx": nx, "ny": ny, "lo1": -180.0, "la1": 90.0, "dx": dlon, "dy": dlat},
        "bounds": bounds,
        "encodings": {
            "wind": {"kind": "rg-uv", "r": "u", "g": "v", "b": "255 (< 128 = no data)", "velocityRange": list(VEL_RANGE), "unit": "m/s"},
            "temp": {"kind": "scalar-r", "g": "0", "b": "0 (> 153 = no data)", "scalarValueRange": list(TEMP_RANGE), "unit": "K"},
        },
        "frames": frames,
    }
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {len(frames)} frame(s) to {args.out}/", file=sys.stderr)


if __name__ == "__main__":
    main()
