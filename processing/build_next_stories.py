"""Build the data files of the Krasheninnikov and Mexico City stories from the processed series.

Reads   processing/pending/<id>/series/*.json   (from gcov_series_to_story.py and chain_to_story.py)
Writes  apps/web/public/stories/<id>/            grids (resized to about 220 cells wide), epochs/, acquisitions.json, events.geojson

story.json is written by hand and is not touched. Re-run this any time the series change.

Usage:
  python processing/build_next_stories.py            # both
  python processing/build_next_stories.py krasheninnikov-kamchatka
"""
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
from scipy.ndimage import zoom

ROOT = Path(__file__).resolve().parent.parent
PENDING = ROOT / "processing" / "pending"
PUBLIC = ROOT / "apps" / "web" / "public" / "stories"
WIDTH = 300


def load_grid(path):
    g = json.loads(Path(path).read_text(encoding="utf-8"))
    k = g.get("scale") or 1
    v = np.array([np.nan if x is None else x * k for x in g["values"]], dtype="float64").reshape(g["height"], g["width"])
    return v, g["bbox"]


def resize(a, w):
    """Resize to w columns keeping the aspect ratio. Cells without data stay without data."""
    h = round(a.shape[0] * w / a.shape[1])
    ok = np.isfinite(a).astype("float64")
    zv = zoom(np.nan_to_num(a) * ok, (h / a.shape[0], w / a.shape[1]), order=1)
    zm = zoom(ok, (h / a.shape[0], w / a.shape[1]), order=1)
    with np.errstate(all="ignore"):
        out = zv / zm
    out[zm < 0.6] = np.nan
    return out


def blur(a, sigma):
    """Light smoothing that ignores gaps (radar speckle is noisy cell to cell). Gaps stay gaps."""
    from scipy.ndimage import gaussian_filter
    ok = np.isfinite(a).astype("float64")
    num = gaussian_filter(np.nan_to_num(a) * ok, sigma)
    den = gaussian_filter(ok, sigma)
    with np.errstate(all="ignore"):
        out = num / den
    out[ok == 0] = np.nan
    return out


def write_grid(path, a, bbox, units, name, step):
    h, w = a.shape
    vals = [None if not np.isfinite(v) else int(round(float(v) / step)) for v in a.ravel()]
    g = {"format": "aevion-grid-v1", "name": name, "units": units, "width": w, "height": h, "bbox": list(bbox),
         "rowOrder": "north-up", "nodata": None, "scale": step, "values": vals}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(g, separators=(",", ":")), encoding="utf-8")


def declutter(fc, days):
    """Keep only the biggest earthquake of any cluster: an event is dropped if a larger one happened within `days` days of it."""
    keep = []
    for f in sorted(fc["features"], key=lambda f: -f["properties"]["mag"]):
        t = f["properties"]["time"]
        if all(abs(t - k["properties"]["time"]) > days * 86400000 for k in keep):
            keep.append(f)
    fc["features"] = sorted(keep, key=lambda f: f["properties"]["time"])
    return fc


def usgs(bbox, start, end, minmag):
    q = urllib.parse.urlencode({"format": "geojson", "starttime": start, "endtime": end, "minmagnitude": minmag,
                                "minlongitude": bbox[0], "minlatitude": bbox[1], "maxlongitude": bbox[2], "maxlatitude": bbox[3],
                                "orderby": "time-asc"})
    try:
        r = json.load(urllib.request.urlopen(f"https://earthquake.usgs.gov/fdsnws/event/1/query?{q}", timeout=60))
    except Exception as e:  # noqa: BLE001
        print("   USGS query failed, writing an empty earthquake list:", e)
        return {"type": "FeatureCollection", "features": []}
    keep = []
    for f in r["features"]:
        p = f["properties"]
        keep.append({"type": "Feature", "id": f["id"], "geometry": f["geometry"],
                     "properties": {"mag": p["mag"], "time": p["time"], "place": p["place"], "url": p["url"]}})
    return {"type": "FeatureCollection", "features": keep}


def hotspot(a, bbox, center=None, radius_km=None, sign=1):
    """Location of the largest smoothed value (times sign), optionally within radius_km of center."""
    from scipy.ndimage import uniform_filter
    h, w = a.shape
    sm = uniform_filter(np.nan_to_num(a) * sign, 7)
    sm[~np.isfinite(a)] = -1e9
    if center and radius_km:
        lon = bbox[0] + (np.arange(w) + .5) / w * (bbox[2] - bbox[0])
        lat = bbox[3] - (np.arange(h) + .5) / h * (bbox[3] - bbox[1])
        LON, LAT = np.meshgrid(lon, lat)
        d = np.hypot((LON - center[0]) * 111.32 * np.cos(np.radians(center[1])), (LAT - center[1]) * 110.57)
        sm[d > radius_km] = -1e9
    iy, ix = np.unravel_index(np.argmax(sm), sm.shape)
    return round(bbox[0] + (ix + .5) / w * (bbox[2] - bbox[0]), 4), round(bbox[3] - (iy + .5) / h * (bbox[3] - bbox[1]), 4), float(a[iy, ix])


# ---------------------------------------------------------------- Krasheninnikov
def krasheninnikov():
    """The story shows the radar picture itself (HH brightness in dB) for every pass: lava is bright against dark ground."""
    sid = "krasheninnikov-kamchatka"
    out = PUBLIC / sid
    featured = "2026-08-17"
    files = sorted((ROOT / "data" / "stacks" / sid).glob("gcov_*.npz"))
    prev = None
    for f in files:
        z = np.load(f, allow_pickle=True)
        d, bbox = str(z["date"]), [float(v) for v in z["bbox"]]
        # what changed since the previous pass: HH brightness difference in dB, with the scene-wide shift removed
        cur_hh = z["hh_db"].astype("float64")
        if prev is None:
            chg = np.full(cur_hh.shape, np.nan)
        else:
            chg = cur_hh - prev
            chg = chg - np.nanmedian(chg)
        prev = cur_hh
        chg = resize(chg, 220)
        if d == featured:
            write_grid(out / "backscatter-hh.grid.json", chg, bbox, "dB", "hh_change", 0.1)
        else:
            write_grid(out / "epochs" / f"ep-{d}.hh.grid.json", chg, bbox, "dB", "hh_change", 0.1)
        hh = blur(resize(z["hh_db"].astype("float64"), WIDTH), 0.8)
        hv = blur(resize(z["hv_db"].astype("float64"), WIDTH), 0.8)
        if d != featured:
            write_grid(out / "epochs" / f"ep-{d}.hv.grid.json", hv, bbox, "dB", "hv_backscatter", 0.1)
        if d == featured:
            write_grid(out / "deformation.grid.json", hh, bbox, "dB", "hh_backscatter", 0.1)
            write_grid(out / "backscatter-hv.grid.json", hv, bbox, "dB", "hv_backscatter", 0.1)
            write_grid(out / "coherence.grid.json", np.where(np.isfinite(hh), 1.0, np.nan), bbox, "1", "coverage", 0.01)
            x, y, v = hotspot(hh, bbox, center=(160.27, 54.585), radius_km=8)
            print(f"   brightest smoothed spot within 8 km of the summit on {d}: {v:.1f} dB at {y}, {x}")
        else:
            write_grid(out / "epochs" / f"ep-{d}.deformation.grid.json", hh, bbox, "dB", "hh_backscatter", 0.1)
        print(f"   {d}: HH median {np.nanmedian(hh):.1f} dB, 2nd..98th percentile {np.nanpercentile(hh, 2):.1f}..{np.nanpercentile(hh, 98):.1f}")

    # passes: consecutive dates as "pairs", so the timeline shows the real acquisition dates
    cat = {}
    for f in sorted((ROOT / "data" / "stacks" / sid).glob("gcov_*.npz")):
        z = np.load(f, allow_pickle=True)
        cat[str(z["date"])] = str(z["granule"])
    ds = sorted(cat)
    pairs = [{"track": 60, "orbitDirection": "D", "reference": f"{a}T08:49:26Z", "secondary": f"{b}T08:49:26Z", "granuleId": cat[b]}
             for a, b in zip(ds, ds[1:])]
    (out / "acquisitions.json").write_text(json.dumps({
        "source": "NASA CMR", "shortName": "NISAR_L2_GCOV (provisional, plus one validated pass)", "bbox": [160.09, 54.47, 160.45, 54.70],
        "window": ["2026-06-01", "2026-11-10"], "note": "GCOV backscatter passes on track 60 descending; each entry joins two consecutive passes.",
        "pairs": pairs}, indent=1), encoding="utf-8")
    (out / "events.geojson").write_text(json.dumps(declutter(usgs([156, 50, 166, 57.5], "2026-06-01", "2026-11-10", 5.0), 6)), encoding="utf-8")
    print("   wrote", out)


# ---------------------------------------------------------------- Mexico City
def mexico():
    sid = "mexico-city-subsidence"
    src, out = PENDING / sid / "series", PUBLIC / sid
    summary = json.loads((src / "summary.json").read_text(encoding="utf-8"))
    dates = [d["date"] for d in summary["dates"]]
    last = dates[-1]
    for d in dates:
        v, bbox = load_grid(src / f"fit-{d}.deformation.grid.json")  # the steady-rate fit; the raw running totals are cum-*.json
        v = resize(v, WIDTH)
        if d == last:
            write_grid(out / "deformation.grid.json", v, bbox, "m", "los_displacement", 0.001)
            c, _ = load_grid(src / f"cum-{d}.coherence.grid.json")
            write_grid(out / "coherence.grid.json", resize(c, WIDTH), bbox, "1", "coherence", 0.01)
            x, y, m = hotspot(v, bbox, sign=1)
            print(f"   strongest smoothed positive (away) motion: {m * 100:+.1f} cm at {y}, {x}")
            x, y, m = hotspot(v, bbox, sign=-1)
            print(f"   strongest smoothed negative (toward) motion: {m * 100:+.1f} cm at {y}, {x}")
        else:
            write_grid(out / "epochs" / f"ep-{d}.deformation.grid.json", v, bbox, "m", "los_displacement", 0.001)
    # acquisitions: every BETA pair found (both tracks) plus one entry that stands for the whole chain
    acq = json.loads((PENDING / sid / "acquisitions.json").read_text(encoding="utf-8"))
    chain = summary["chain"]
    ids = {f"{p['reference'][:10]}_{p['secondary'][:10]}": p["granuleId"] for p in acq["pairs"] if p["track"] == 113}
    chain_ids = []
    for name in chain:
        m = re.search(r"(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})", name)
        chain_ids.append(ids.get(f"{m[1]}_{m[2]}", name))
    first = [p for p in acq["pairs"] if p["track"] == 113 and p["reference"].startswith("2025-10-25")][0]
    lastp = [p for p in acq["pairs"] if p["track"] == 113 and p["secondary"].startswith("2026-01-17")][0]
    acq["pairs"].append({"track": 113, "orbitDirection": "D", "reference": first["reference"], "secondary": lastp["secondary"],
                         "granuleId": "Chain of " + str(len(chain_ids)) + " NISAR GUNW pairs added end to end: " + ", ".join(chain_ids)})
    for d in dates[:-1]:  # one entry per intermediate end date, so each period shows its own source
        n = dates.index(d) + 1
        lastp_d = [p for p in acq["pairs"] if p["track"] == 113 and p["secondary"].startswith(d)][0]
        acq["pairs"].append({"track": 113, "orbitDirection": "D", "reference": first["reference"], "secondary": lastp_d["secondary"],
                             "granuleId": "Chain of " + str(n) + " NISAR GUNW pairs added end to end: " + ", ".join(chain_ids[:n])})
    (out / "acquisitions.json").write_text(json.dumps(acq, indent=1), encoding="utf-8")
    (out / "events.geojson").write_text(json.dumps(declutter(usgs([-104.5, 15, -94.5, 22.5], "2025-10-20", "2026-01-25", 4.5), 5)), encoding="utf-8")
    print("   wrote", out)


if __name__ == "__main__":
    which = sys.argv[1:] or ["krasheninnikov-kamchatka", "mexico-city-subsidence"]
    for w in which:
        print(w)
        {"krasheninnikov-kamchatka": krasheninnikov, "mexico-city-subsidence": mexico}[w]()
