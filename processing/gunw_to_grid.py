"""Convert a NISAR L2 GUNW HDF5 granule to Aevion grids.   *** UNTESTED ***

Written before real granules were downloaded. The HDF5 dataset paths below follow the
NISAR GUNW product spec as I understand it, but MUST be checked against a real file:

  python -c "import h5py,sys; h5py.File(sys.argv[1]).visit(print)" granule.h5

Things to confirm on the first real file:
  * dataset paths (frequency, polarization, layer names)
  * whether the unwrapped layer is phase in radians (assumed here) or already meters
  * the CRS (the code expects a projected CRS with x/y coordinate vectors, e.g. UTM)
  * the sign convention of line-of-sight displacement
  * which cells are valid (connected components == 0 is treated as invalid here)

Usage:
  pip install h5py numpy pyproj
  python processing/gunw_to_grid.py granule.h5 apps/web/public/stories/venezuela-2026 \
      --bbox -69.4 9.6 -66.4 11.3 --width 280 --height 160

Then edit story.json (synthetic=false, provenance, dataStatus) and run validate_story.py.
"""
import argparse
import json
import math
from pathlib import Path

import h5py
import numpy as np
from pyproj import Transformer

LAMBDA = 0.2384  # L-band wavelength in meters (verify against the product metadata)
BASE = "/science/LSAR/GUNW/grids/frequencyA"
PHASE = f"{BASE}/unwrappedInterferogram/HH/unwrappedPhase"
COH = f"{BASE}/unwrappedInterferogram/HH/coherenceMagnitude"
CC = f"{BASE}/unwrappedInterferogram/HH/connectedComponents"


def resample(src, xs, ys, epsg, bbox, w, h, nodata_mask):
    """Nearest-neighbor resample of a projected raster onto a lon/lat grid."""
    lons = np.linspace(bbox[0], bbox[2], w)
    lats = np.linspace(bbox[3], bbox[1], h)
    LON, LAT = np.meshgrid(lons, lats)
    X, Y = Transformer.from_crs(4326, epsg, always_xy=True).transform(LON, LAT)
    dx, dy = xs[1] - xs[0], ys[1] - ys[0]
    ix = np.round((X - xs[0]) / dx).astype(int)
    iy = np.round((Y - ys[0]) / dy).astype(int)
    ok = (ix >= 0) & (ix < len(xs)) & (iy >= 0) & (iy < len(ys))
    out = np.full((h, w), np.nan, dtype="float64")
    out[ok] = src[iy[ok], ix[ok]]
    bad = np.ones((h, w), bool)
    bad[ok] = nodata_mask[iy[ok], ix[ok]]
    out[bad] = np.nan
    return out


def grid_json(a, units, name, bbox):
    h, w = a.shape
    vals = [None if math.isnan(v) else round(float(v), 4) for v in a.ravel()]
    return {"format": "aevion-grid-v1", "name": name, "units": units, "width": w, "height": h,
            "bbox": list(bbox), "rowOrder": "north-up", "nodata": None, "values": vals}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("granule")
    ap.add_argument("out_dir")
    ap.add_argument("--bbox", nargs=4, type=float, required=True, metavar=("W", "S", "E", "N"))
    ap.add_argument("--width", type=int, default=280)
    ap.add_argument("--height", type=int, default=160)
    a = ap.parse_args()

    with h5py.File(a.granule, "r") as f:
        xs = f[f"{BASE}/xCoordinates"][:]
        ys = f[f"{BASE}/yCoordinates"][:]
        epsg = int(f[f"{BASE}/projection"][()])
        phase = f[PHASE][:]
        coh = f[COH][:]
        cc = f[CC][:]

    invalid = (cc == 0) | ~np.isfinite(phase)
    disp = phase * LAMBDA / (4 * math.pi)  # meters along line of sight
    # TODO: choose and subtract a stable reference area; check sign convention.

    d = resample(disp, xs, ys, epsg, a.bbox, a.width, a.height, invalid)
    c = resample(coh, xs, ys, epsg, a.bbox, a.width, a.height, invalid)

    out = Path(a.out_dir)
    (out / "deformation.grid.json").write_text(
        json.dumps(grid_json(d, "m", "los_displacement", a.bbox)), encoding="utf-8")
    (out / "coherence.grid.json").write_text(
        json.dumps(grid_json(c, "1", "coherence", a.bbox)), encoding="utf-8")
    print("wrote grids. Now update story.json (synthetic=false, provenance, dataStatus).")


if __name__ == "__main__":
    main()
