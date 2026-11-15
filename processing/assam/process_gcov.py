"""Step 3: turn the cropped GeoTIFFs into web-ready layers.

For every data/cropped/<date>.tif this writes:
  web/data/overlays/<date>_HH.jpg, <date>_HV.jpg   grayscale dB overlays
  web/data/overlays/<date>_water.png               new water vs. the dry reference (blue)
plus web/data/manifest.json (dates, labels, flooded km2) and
web/data/timeseries.json (coarse dB grid for the click-for-chart).

    python pipeline/process_gcov.py
"""
import json
import warnings

import numpy as np
import rasterio
from PIL import Image
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject

from config import (BBOX, CROP_DIR, DATES, DB_RANGE, JRC_PERMANENT_PCT, OUT_RES_DEG, OVERLAY_DIR, REFERENCE_DATE, ROOT,
                    TS_CELL_DEG, WATER_THRESHOLD_DB_HH, WEB_DATA)

X0, Y0, X1, Y1 = BBOX
W = int(round((X1 - X0) / OUT_RES_DEG))
H = int(round((Y1 - Y0) / OUT_RES_DEG))
DST_T = from_origin(X0, Y1, OUT_RES_DEG, OUT_RES_DEG)


def load_wgs84(path):
    out = np.full((2, H, W), np.nan, dtype="float32")
    with rasterio.open(path) as src:
        for i in range(2):
            reproject(rasterio.band(src, i + 1), out[i], dst_transform=DST_T,
                      dst_crs="EPSG:4326", dst_nodata=np.nan, resampling=Resampling.average)
    with np.errstate(divide="ignore", invalid="ignore"):
        return 10 * np.log10(out)  # dB


def save_gray(db, lo, hi, path):
    """Grayscale JPEG (no-data shows black; the study box is fully covered)."""
    v = np.clip((np.nan_to_num(db, nan=lo) - lo) / (hi - lo), 0, 1)
    Image.fromarray((v * 255).astype("uint8"), mode="L").save(path, quality=82, optimize=True)


def save_mask(perm, new, path):
    """Two classes that differ in lightness and texture, not only hue, so they
    read for colour-blind viewers and against the grey radar image:
      new water        solid dark blue  (Okabe-Ito blue, luminance ~0.15)
      reference water  light yellow diagonal hatch (Okabe-Ito yellow, ~0.75)
    """
    h, w = perm.shape
    yy, xx = np.mgrid[0:h, 0:w]
    stripe = ((xx + yy) % 6) < 3
    rgba = np.zeros((h, w, 4), dtype="uint8")
    rgba[perm & stripe] = (240, 228, 66, 230)   # water also present in the dry reference (hatched)
    rgba[new] = (0, 114, 178, 235)              # new water vs. the dry reference (solid)
    Image.fromarray(rgba).save(path, optimize=True)


def smooth(mask, k=1):
    """Cheap 3x3 majority filter to knock out speckle."""
    m = mask.astype("uint8")
    p = np.pad(m, k)
    s = sum(p[k + dy:k + dy + m.shape[0], k + dx:k + dx + m.shape[1]]
            for dy in (-1, 0, 1) for dx in (-1, 0, 1))
    return s >= 5


JRC_TILE = ROOT / "data" / "context" / "jrc_occurrence_90E_30N.tif"


def jrc_permanent():
    """JRC permanent water on the output grid, or all-False if the tile is missing."""
    if not JRC_TILE.exists():
        print("  (no JRC tile; permanent water not excluded)")
        return np.zeros((H, W), dtype=bool)
    occ = np.full((H, W), np.nan, dtype="float32")
    with rasterio.open(JRC_TILE) as src:
        reproject(rasterio.band(src, 1), occ, dst_transform=DST_T, dst_crs="EPSG:4326",
                  src_nodata=255, resampling=Resampling.average)
    return np.nan_to_num(occ) >= JRC_PERMANENT_PCT


def area_km2():
    lat = Y1 - (np.arange(H) + 0.5) * OUT_RES_DEG
    cell = (OUT_RES_DEG * 111.32) ** 2 * np.cos(np.radians(lat))
    return np.repeat(cell[:, None], W, axis=1)


def coarse(db, f):
    h, w = (db.shape[0] // f) * f, (db.shape[1] // f) * f
    lin = 10 ** (db[:h, :w] / 10)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        m = np.nanmean(lin.reshape(h // f, f, w // f, f), axis=(1, 3))
        return np.round(100 * np.log10(m))  # dB x 10, as integers


def main():
    OVERLAY_DIR.mkdir(parents=True, exist_ok=True)
    files = sorted(CROP_DIR.glob("*.tif"))
    if not files:
        raise SystemExit(f"No crops in {CROP_DIR}. Run fetch_gcov.py first.")
    cell = area_km2()
    f = max(1, int(round(TS_CELL_DEG / OUT_RES_DEG)))

    stacks = {p.stem: load_wgs84(p) for p in files}
    dates = sorted(stacks)
    if REFERENCE_DATE not in stacks:
        raise SystemExit(f"Reference date {REFERENCE_DATE} has no crop in {CROP_DIR}.")
    base = stacks[REFERENCE_DATE]
    # Reference water = water in the dry season reference OR JRC permanent water,
    # so rivers and permanent ponds are never counted as flood.
    perm = jrc_permanent()
    base_water = smooth(base[0] < WATER_THRESHOLD_DB_HH) | perm

    entries, ts = [], {"HH": [], "HV": []}
    for d in dates:
        hh, hv = stacks[d]
        layers = {}
        for pol, db in (("HH", hh), ("HV", hv)):
            name = f"{d}_{pol}.jpg"
            save_gray(db, *DB_RANGE[pol], OVERLAY_DIR / name)
            layers[pol] = f"data/overlays/{name}"
            c = coarse(db, f)
            ts[pol].append([[None if np.isnan(v) else int(v) for v in row] for row in c])
        water = smooth(hh < WATER_THRESHOLD_DB_HH)
        new = water & ~base_water
        save_mask(water & base_water, new, OVERLAY_DIR / f"{d}_water.png")
        layers["water"] = f"data/overlays/{d}_water.png"
        valid = ~np.isnan(hh)
        entries.append({
            "date": d, "label": DATES.get(d, ""), "layers": layers,
            "water_km2": round(float(cell[water & valid].sum()), 1),
            "new_water_km2": round(float(cell[new & valid].sum()), 1),
            "coverage": round(float(valid.mean()), 3),
        })
        print(d, entries[-1]["water_km2"], "km2 water,", entries[-1]["new_water_km2"], "km2 new")

    (WEB_DATA / "manifest.json").write_text(json.dumps(
        {"bbox": BBOX, "reference": REFERENCE_DATE,
         "peak_date": max(entries, key=lambda e: e["new_water_km2"])["date"], "threshold_db": WATER_THRESHOLD_DB_HH,
         "dates": entries}, indent=2))
    rows = len(ts["HH"][0]); cols = len(ts["HH"][0][0])
    (WEB_DATA / "timeseries.json").write_text(json.dumps(
        {"bbox": BBOX, "rows": rows, "cols": cols, "cell_deg": TS_CELL_DEG * 1.0,
         "dates": dates, "scale": 0.1, "values": ts}, separators=(",", ":")))
    print("wrote", WEB_DATA)


if __name__ == "__main__":
    main()
