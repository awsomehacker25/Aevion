"""Chain a story's saved interferograms (data/stacks/<story>/t*_*_*.npz from prep_story_data.py) end to end into
cumulative ground motion, for slow processes such as subsidence.

Each saved pair is a 12 day (or 24 day) change. Adding pairs that meet date to date gives the total motion since the
first date, which is what a subsidence story shows growing over time:  Oct 25 -> Nov 6 -> Nov 18 -> Dec 12 -> ...
Pairs that do not fit the chain (for example a second 12 day pair from the same reference date) are listed and left out.

For each date on the chain it writes, into the story folder:
  series/cum-<date>.deformation.grid.json   motion since the first date along the line of sight, meters (steps of 1 mm)
  series/cum-<date>.coherence.grid.json     the lowest coherence any pair in the chain had at that cell
  velocity.grid.json                        average rate over the whole chain, cm per month (steps of 0.05)
  series/summary.json                       per date: strongest cell, area moving more than 1 cm

Cells are masked (no data) where any pair in the chain had coherence below --min-coh. Every pair first gets a robust
plane removed (--deramp), because atmosphere and orbit errors put a ramp on each one and these add up along the chain.
The fit follows the ramp, not local sinking, but it can still take away a little broad motion: say so when quoting rates.
The numbers are motion relative to the typical ground in the map box, so check that this ground is stable.

Usage:
  python processing/chain_to_story.py processing/pending/mexico-city-subsidence
  python processing/chain_to_story.py processing/pending/mexico-city-subsidence --track 113 --min-coh 0.4 --preview data/mexico.png
"""
import argparse
import json
import math
from datetime import date
from pathlib import Path

import numpy as np

DISP_STEP = 0.001
COH_STEP = 0.01
VEL_STEP = 0.05


def grid_json(a, units, name, bbox, scale):
    h, w = a.shape
    vals = [None if not np.isfinite(v) else int(round(float(v) / scale)) for v in a.ravel()]
    return {"format": "aevion-grid-v1", "name": name, "units": units, "width": w, "height": h,
            "bbox": list(bbox), "rowOrder": "north-up", "nodata": None, "scale": scale, "values": vals}


def write(path, g):
    path.write_text(json.dumps(g, separators=(",", ":")), encoding="utf-8")


def elevation(bbox, shape, z=10):
    """Ground height in meters on the grid, from the public AWS terrain tiles (Terrarium PNG). Used to find stable hills."""
    import io
    import urllib.request

    from PIL import Image
    from scipy.ndimage import map_coordinates

    n = 2 ** z
    tx = lambda lon: (lon + 180) / 360 * n  # noqa: E731
    ty = lambda lat: (1 - np.log(np.tan(np.radians(lat)) + 1 / np.cos(np.radians(lat))) / np.pi) / 2 * n  # noqa: E731
    x0, x1, y0, y1 = int(tx(bbox[0])), int(tx(bbox[2])), int(ty(bbox[3])), int(ty(bbox[1]))
    big = np.zeros(((y1 - y0 + 1) * 256, (x1 - x0 + 1) * 256))
    for ix in range(x0, x1 + 1):
        for iy in range(y0, y1 + 1):
            url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{ix}/{iy}.png"
            a = np.array(Image.open(io.BytesIO(urllib.request.urlopen(url, timeout=60).read())).convert("RGB"), dtype="float64")
            big[(iy - y0) * 256:(iy - y0 + 1) * 256, (ix - x0) * 256:(ix - x0 + 1) * 256] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
    h, w = shape
    lon = bbox[0] + (np.arange(w) + .5) / w * (bbox[2] - bbox[0])
    lat = bbox[3] - (np.arange(h) + .5) / h * (bbox[3] - bbox[1])
    px = (tx(lon) - x0) * 256
    py = (ty(lat) - y0) * 256
    return map_coordinates(big, np.meshgrid(py, px, indexing="ij"), order=1)


def deramp(disp, coh, order, min_coh, stable=None):
    """Remove a smooth ramp (plane, or quadratic) fitted robustly to the whole box. Atmosphere and orbit errors put a
    ramp on every pair; subsidence is local, so the fit (outliers dropped) mostly follows the ramp."""
    h, w = disp.shape
    yy, xx = np.mgrid[0:h, 0:w]
    x, y = xx / w - 0.5, yy / h - 0.5
    cols = [np.ones_like(x), x, y] + ([x * x, x * y, y * y] if order == 2 else [])
    B = np.stack(cols, -1)
    use = np.isfinite(disp) & (coh >= max(min_coh, 0.5))
    if stable is not None:  # fit only on cells known to be stable (hills), so the sinking ground is not part of the reference
        use &= stable
    keep = use.copy()
    for _ in range(5):
        coef, *_ = np.linalg.lstsq(B[keep], disp[keep], rcond=None)
        res = disp - B @ coef
        mad = 1.4826 * np.median(np.abs(res[keep] - np.median(res[keep])))
        keep = use & (np.abs(res) < 2.0 * mad)
    return disp - B @ coef


def d(s):
    return date.fromisoformat(str(s)[:10])


def build_chain(pairs):
    """Follow pairs from the earliest reference date, always taking the longest pair that starts where the last ended."""
    chain, used = [], set()
    cur = min(p["ref"] for p in pairs)
    while True:
        nxt = [p for p in pairs if p["ref"] == cur and p["sec"] > cur]
        if not nxt:
            break
        p = max(nxt, key=lambda p: p["sec"])
        chain.append(p)
        used.add(id(p))
        cur = p["sec"]
    return chain, [p for p in pairs if id(p) not in used]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("story_dir")
    ap.add_argument("--stacks", default="data/stacks")
    ap.add_argument("--track", type=int, help="track number (default: the story's flagship track)")
    ap.add_argument("--min-coh", type=float, default=0.3)
    ap.add_argument("--stable-above", type=float, help="fit the ramp only on cells higher than this (meters), for example the hills around a lake-bed city")
    ap.add_argument("--deramp", choices=["plane", "quadratic", "none"], default="plane",
                    help="remove a smooth ramp from every pair before chaining (default plane)")
    ap.add_argument("--preview", help="write a contact sheet picture here")
    a = ap.parse_args()

    sd = Path(a.story_dir)
    story = json.loads((sd / "story.json").read_text(encoding="utf-8"))
    track = a.track or story["flagshipPair"]["track"]
    pairs = []
    for f in sorted(Path(a.stacks, story["id"]).glob(f"t{track:03d}*_*_*.npz")):
        z = np.load(f, allow_pickle=True)
        pairs.append(dict(file=f.name, ref=d(z["reference"]), sec=d(z["secondary"]), disp=z["disp"].astype("float64"),
                          coh=z["coh"].astype("float64"), bbox=[float(v) for v in z["bbox"]], granule=str(z["granule"])))
    if not pairs:
        raise SystemExit(f"no saved pairs for track {track} in {Path(a.stacks, story['id'])}")
    chain, left = build_chain(pairs)
    stable = None
    if a.stable_above is not None:
        elev = elevation(pairs[0]["bbox"], pairs[0]["disp"].shape)
        stable = elev > a.stable_above
        print(f"stable reference: {int(stable.sum())} cells above {a.stable_above:g} m (of {stable.size}); elevation range {elev.min():.0f} to {elev.max():.0f} m")
    print(f"track {track}: {len(pairs)} saved pairs, chain of {len(chain)}: " +
          " -> ".join([str(chain[0]["ref"])] + [str(p["sec"]) for p in chain]))
    for p in left:
        print(f"   not on the chain: {p['file']}")
    bbox = chain[0]["bbox"]
    h, w = chain[0]["disp"].shape
    km_x = (bbox[2] - bbox[0]) * 111.32 * math.cos(math.radians((bbox[1] + bbox[3]) / 2))
    km_y = (bbox[3] - bbox[1]) * 110.57
    cell_km2 = (km_x / w) * (km_y / h)

    out = sd / "series"
    out.mkdir(exist_ok=True)
    cum = np.zeros((h, w))
    mincoh = np.ones((h, w))
    bad = np.zeros((h, w), dtype=bool)
    summary, sheets = [], []
    for p in chain:
        bad |= ~np.isfinite(p["disp"]) | (p["coh"] < a.min_coh) | ~np.isfinite(p["coh"])
        dd = p["disp"] if a.deramp == "none" else deramp(p["disp"], p["coh"], 1 if a.deramp == "plane" else 2, a.min_coh, stable)
        cum = cum + np.nan_to_num(dd)
        mincoh = np.minimum(mincoh, np.nan_to_num(p["coh"], nan=0.0))
        shown = np.where(bad, np.nan, cum)
        name = str(p["sec"])
        write(out / f"cum-{name}.deformation.grid.json", grid_json(shown, "m", "cumulative_los_displacement", bbox, DISP_STEP))
        write(out / f"cum-{name}.coherence.grid.json", grid_json(np.where(bad, np.nan, mincoh), "1", "coherence", bbox, COH_STEP))
        v = shown[np.isfinite(shown)]
        days = (p["sec"] - chain[0]["ref"]).days
        row = {"date": name, "days_since_start": days, "valid_cells": int(v.size),
               "median_cm": round(float(np.median(v)) * 100, 2), "p2_cm": round(float(np.percentile(v, 2)) * 100, 2),
               "p98_cm": round(float(np.percentile(v, 98)) * 100, 2),
               "moving_over_1cm_km2": round(float(np.sum(np.abs(v) > 0.01)) * cell_km2, 1)}
        summary.append(row)
        sheets.append((name, shown))
        print(f"{name} ({days:3d} d): 2nd..98th percentile {row['p2_cm']:+.1f}..{row['p98_cm']:+.1f} cm, "
              f"{row['moving_over_1cm_km2']:.0f} km2 beyond 1 cm, {row['valid_cells']} valid cells")

    # Steady-rate fit: one rate per cell, fitted through zero to all the running totals. A single date's atmosphere is baked
    # into its total, so the totals jump around; the fit averages that out. fit-<date> files hold rate x days since the start.
    ts = np.array([(p["sec"] - chain[0]["ref"]).days for p in chain], dtype="float64")
    stack = []
    c2 = np.zeros((h, w))
    for p in chain:
        dd = p["disp"] if a.deramp == "none" else deramp(p["disp"], p["coh"], 1 if a.deramp == "plane" else 2, a.min_coh, stable)
        c2 = c2 + np.nan_to_num(dd)
        stack.append(c2.copy())
    stack = np.array(stack)
    rate = np.tensordot(ts, stack, axes=(0, 0)) / np.sum(ts * ts)  # meters per day
    resid = np.sqrt(np.mean((stack - rate[None] * ts[:, None, None]) ** 2, axis=0))
    fit_summary = []
    for p, t in zip(chain, ts):
        shown = np.where(bad, np.nan, rate * t)
        write(out / f"fit-{p['sec']}.deformation.grid.json", grid_json(shown, "m", "fitted_cumulative_los_displacement", bbox, DISP_STEP))
        fit_summary.append({"date": str(p["sec"]), "days": int(t)})
    rv = np.where(bad, np.nan, resid)
    print(f"steady-rate fit: median residual between the six totals and the fit {np.nanmedian(rv) * 100:.1f} cm, 98th percentile {np.nanpercentile(rv, 98) * 100:.1f} cm")
    total_days = (chain[-1]["sec"] - chain[0]["ref"]).days
    vel = np.where(bad, np.nan, rate) * 100 * 30.4  # cm per month, from the steady-rate fit
    write(sd / "velocity.grid.json", grid_json(vel, "cm/month", "los_velocity", bbox, VEL_STEP))
    vv = vel[np.isfinite(vel)]
    print(f"average rate: 2nd..98th percentile {np.percentile(vv, 2):+.2f}..{np.percentile(vv, 98):+.2f} cm/month along the line of sight")
    iy, ix = np.unravel_index(np.nanargmax(np.abs(np.where(np.isfinite(vel), vel, 0))), vel.shape)
    print(f"strongest cell: {vel[iy, ix]:+.2f} cm/month near {bbox[3] - (iy + .5) / h * (bbox[3] - bbox[1]):.4f}, "
          f"{bbox[0] + (ix + .5) / w * (bbox[2] - bbox[0]):.4f}")
    print("sign: positive is away from the satellite (ISCE3 convention: reference times conjugate of secondary). For ground that sinks the line-of-sight range gets longer.")
    (out / "summary.json").write_text(json.dumps({"track": track, "chain": [p["file"] for p in chain], "dates": summary}, indent=1), encoding="utf-8")
    print("wrote", out, "and velocity.grid.json")

    if a.preview:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        n = len(sheets) + 1
        cols = min(4, n)
        fig, ax = plt.subplots(math.ceil(n / cols), cols, figsize=(4 * cols, 3.6 * math.ceil(n / cols)), squeeze=False)
        for axx in ax.ravel():
            axx.axis("off")
        ext = (bbox[0], bbox[2], bbox[1], bbox[3])
        for axx, (nm, g) in zip(ax.ravel(), sheets):
            im = axx.imshow(g * 100, cmap="RdBu_r", vmin=-8, vmax=8, extent=ext, aspect="auto")
            axx.set_title(f"cumulative to {nm} (cm)", fontsize=9)
        im = ax.ravel()[len(sheets)].imshow(vel, cmap="RdBu_r", vmin=-4, vmax=4, extent=ext, aspect="auto")
        ax.ravel()[len(sheets)].set_title("rate (cm/month)", fontsize=9)
        plt.tight_layout()
        plt.savefig(a.preview, dpi=70)
        print("preview written to", a.preview)


if __name__ == "__main__":
    main()
