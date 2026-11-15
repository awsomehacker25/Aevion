"""Fetch NASA JPL's ARIA line-of-sight displacement map for a story area and write Aevion grids.

The ARIA team publishes displacement maps made from NISAR interferograms for the June 2026
Venezuela earthquakes as a PUBLIC image service on NASA's Disasters Mapping Portal. No login.
This exports just our area (under 1 MB) instead of the 2 GB granule.

Output (in the story folder):
  deformation.grid.json   LOS displacement in meters (cm in the service, divided by 100)
  coverage.grid.json      share of valid cells in a 7x7 window (0..1), derived by Aevion
  aria-source.json        where and when the data was fetched, and the exact parameters

Usage:
  python processing/fetch_aria_displacement.py apps/web/public/stories/venezuela-2026
  python processing/fetch_aria_displacement.py --list        # show the rasters in the service
  python processing/fetch_aria_displacement.py <story> --raster-id 3   # another pair

Notes:
  * Values are relative to an unknown reference level (per the service description).
  * Cells outside the service's published value range (plus 1 cm), or nodata, are written as null.
"""
import argparse
import datetime
import io
import json
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

SERVICE = ("https://gis.earthdata.nasa.gov/portal/rest/services/"
           "DISASTERS_202606_EARTHQUAKE_VENEZUELA/202611_nisar_LOSDisplacement/ImageServer")
LIMIT_MARGIN_CM = 1.0  # allowed slack beyond the service's published min/max; anything outside is edge junk
COVERAGE_WINDOW = 7


def get(url, params):
    q = urllib.parse.urlencode(params)
    with urllib.request.urlopen(f"{url}?{q}", timeout=120) as r:
        return r.read()


def catalog():
    d = json.loads(get(f"{SERVICE}/query", {"where": "1=1", "outFields": "objectid,name,category",
                                           "returnGeometry": "false", "f": "json"}))
    return [f["attributes"] for f in d["features"] if f["attributes"]["category"] == 1]


def published_limits():
    """The service reports the true value range of the displacement raster (cm)."""
    d = json.loads(get(SERVICE, {"f": "json"}))
    return d["minValues"][0] - LIMIT_MARGIN_CM, d["maxValues"][0] + LIMIT_MARGIN_CM


def export(bbox, w, h, raster_id):
    mosaic = {"mosaicMethod": "esriMosaicLockRaster", "lockRasterIds": [raster_id]}
    raw = get(f"{SERVICE}/exportImage", {
        "bbox": ",".join(map(str, bbox)), "bboxSR": 4326, "imageSR": 4326, "size": f"{w},{h}",
        "format": "tiff", "pixelType": "F32", "interpolation": "RSP_NearestNeighbor",
        "mosaicRule": json.dumps(mosaic), "f": "image",
    })
    return np.array(Image.open(io.BytesIO(raw)), dtype="float64")


def window_mean(mask, k):
    """Mean of a 0/1 mask over a k x k window (box filter via an integral image)."""
    pad = k // 2
    m = np.pad(mask.astype("float64"), pad, mode="edge")
    ii = np.pad(m.cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    h, w = mask.shape
    s = ii[k:k + h, k:k + w] - ii[:h, k:k + w] - ii[k:k + h, :w] + ii[:h, :w]
    return s / (k * k)


def grid(values, units, name, bbox, step):
    """Values are stored as whole numbers in steps of `step` (value = number * step), which keeps the file small."""
    h, w = values.shape
    flat = [None if not np.isfinite(v) else int(round(float(v) / step)) for v in values.ravel()]
    return {"format": "aevion-grid-v1", "name": name, "units": units, "width": w, "height": h,
            "bbox": list(bbox), "rowOrder": "north-up", "nodata": None, "scale": step, "values": flat}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("story_dir", nargs="?")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--raster-id", type=int, default=1, help="1 = 2026-06-13 to 06-25 (default)")
    ap.add_argument("--width", type=int, default=1120)
    ap.add_argument("--height", type=int, default=640)
    ap.add_argument("--window", type=int, default=13, help="coverage window in cells (about 7 per 560 cells of width)")
    a = ap.parse_args()

    cat = catalog()
    if a.list or not a.story_dir:
        for c in cat:
            print(c["objectid"], c["name"])
        return
    name = next((c["name"] for c in cat if c["objectid"] == a.raster_id), None)
    if name is None:
        raise SystemExit(f"raster id {a.raster_id} not in the catalog; use --list")

    sd = Path(a.story_dir)
    story = json.loads((sd / "story.json").read_text(encoding="utf-8"))
    bbox = story["aoi"]["bbox"]

    cm = export(bbox, a.width, a.height, a.raster_id)
    lo, hi = published_limits()
    valid = np.isfinite(cm) & (cm >= lo) & (cm <= hi)
    defo_m = np.where(valid, cm / 100.0, np.nan)
    cover = window_mean(valid, a.window)

    (sd / "deformation.grid.json").write_text(
        json.dumps(grid(defo_m, "m", "los_displacement_aria", bbox, 0.001), separators=(",", ":")), encoding="utf-8")
    (sd / "coverage.grid.json").write_text(
        json.dumps(grid(cover, "1", "measurement_coverage", bbox, 0.01), separators=(",", ":")), encoding="utf-8")
    (sd / "aria-source.json").write_text(json.dumps({
        "service": SERVICE, "rasterId": a.raster_id, "rasterName": name,
        "fetchedAtUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "bbox": bbox, "size": [a.width, a.height], "interpolation": "nearest",
        "limitsCm": [round(lo, 2), round(hi, 2)], "coverageWindow": a.window,
        "validFraction": round(float(valid.mean()), 4),
        "cmRange": [round(float(cm[valid].min()), 2), round(float(cm[valid].max()), 2)],
        "credit": "NASA-JPL/Caltech ARIA team, NISAR Operations Science Team",
    }, indent=2), encoding="utf-8")
    print(f"raster: {name}")
    print(f"valid cells: {valid.mean():.1%} | cm range: {cm[valid].min():.1f} to {cm[valid].max():.1f}")
    print(f"wrote deformation.grid.json, coverage.grid.json, aria-source.json in {sd}")


if __name__ == "__main__":
    main()
