"""Turn one saved pair (data/stacks/<story>/*.npz from prep_story_data.py) into the story's grid files.

It removes the smooth long-wavelength tilt that atmosphere, ionosphere and orbit errors put on every
interferogram: a quadratic surface is fitted to cells far from the event and subtracted, so what is left
is local motion. The fit area, the fit coefficients and the pair used are printed so they can be written
into story.json provenance.

Usage:
  python processing/stack_to_story.py apps/web/public/stories/kilauea-hawaii            # the story's flagship pair
  python processing/stack_to_story.py apps/web/public/stories/kilauea-hawaii --pair 2026-08-30
  python processing/stack_to_story.py apps/web/public/stories/kilauea-hawaii --preview out.png   # picture, no files written
  python processing/stack_to_story.py apps/web/public/stories/kilauea-hawaii --exclude-km 12      # keep more area out of the fit

Writes deformation.grid.json and coherence.grid.json next to story.json. Then edit story.json
(synthetic=false, provenance, dataStatus) and run validate_story.py.
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np


def km_grid(bbox, shape, center):
    h, w = shape
    lons = np.linspace(bbox[0], bbox[2], w)
    lats = np.linspace(bbox[3], bbox[1], h)
    lon, lat = np.meshgrid(lons, lats)
    kx = 111.32 * math.cos(math.radians(center[1]))
    return (lon - center[0]) * kx, (lat - center[1]) * 110.57


def deramp(disp, coh, x, y, exclude_km, min_coh):
    """Subtract a robust quadratic surface fitted outside exclude_km of the center. Returns (result, coeffs, n_fit)."""
    basis = lambda xx, yy: np.stack([np.ones_like(xx), xx, yy, xx * xx, xx * yy, yy * yy], -1)  # noqa: E731
    scale = max(np.abs(x).max(), np.abs(y).max())
    B = basis(x / scale, y / scale)
    use = np.isfinite(disp) & (coh >= min_coh) & (np.hypot(x, y) > exclude_km)
    if use.sum() < 200:
        raise SystemExit(f"only {int(use.sum())} cells are usable for the fit; lower --exclude-km or --min-coh")
    keep = use.copy()
    for _ in range(4):  # drop outliers (unwrapping errors, lava fields) and refit
        coef, *_ = np.linalg.lstsq(B[keep], disp[keep], rcond=None)
        res = disp - B @ coef
        mad = 1.4826 * np.median(np.abs(res[keep] - np.median(res[keep])))
        keep = use & (np.abs(res) < 2.5 * mad)
    return disp - B @ coef, coef, int(keep.sum()), float(mad)


def grid_json(a, units, name, bbox, nd=4):
    h, w = a.shape
    vals = [None if not np.isfinite(v) else round(float(v), nd) for v in a.ravel()]
    return {"format": "aevion-grid-v1", "name": name, "units": units, "width": w, "height": h,
            "bbox": list(bbox), "rowOrder": "north-up", "nodata": None, "values": vals}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("story_dir")
    ap.add_argument("--stacks", default="data/stacks")
    ap.add_argument("--pair", help="reference date (YYYY-MM-DD) of the pair to use; default is the story's flagship pair")
    ap.add_argument("--exclude-km", type=float, default=9.0, help="keep cells this close to the event center out of the tilt fit")
    ap.add_argument("--min-coh", type=float, default=0.3, help="only fit cells with at least this coherence")
    ap.add_argument("--preview", help="write a before/after picture here and do not write grids")
    a = ap.parse_args()

    sd = Path(a.story_dir)
    story = json.loads((sd / "story.json").read_text(encoding="utf-8"))
    ref = a.pair or story["flagshipPair"]["reference"]
    files = sorted((Path(a.stacks) / story["id"]).glob(f"*_{ref}_*.npz"))
    if not files:
        raise SystemExit(f"no saved pair with reference {ref} in {Path(a.stacks) / story['id']}")
    z = np.load(files[0], allow_pickle=True)
    disp, coh, bbox = z["disp"].astype("float64"), z["coh"].astype("float64"), [float(v) for v in z["bbox"]]
    print(f"pair {z['reference']} -> {z['secondary']}  track {z['track']}{z['orbit']}  {disp.shape[1]}x{disp.shape[0]} cells")

    x, y = km_grid(bbox, disp.shape, story["aoi"]["center"])
    out, coef, n, mad = deramp(disp, coh, x, y, a.exclude_km, a.min_coh)
    print(f"tilt removed: quadratic fit to {n} cells beyond {a.exclude_km:g} km (scatter {mad * 1000:.1f} mm); "
          f"before std {np.nanstd(disp) * 1000:.0f} mm, after {np.nanstd(out) * 1000:.0f} mm")

    if a.preview:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig, ax = plt.subplots(1, 3, figsize=(15, 4.6))
        ext = (bbox[0], bbox[2], bbox[1], bbox[3])
        for axx, arr, title, lim in ((ax[0], disp * 1000, "before (mm)", 100), (ax[1], out * 1000, "after tilt removal (mm)", 60)):
            im = axx.imshow(arr, cmap="RdBu_r", vmin=-lim, vmax=lim, extent=ext, aspect="auto")
            axx.set_title(title)
            plt.colorbar(im, ax=axx, shrink=0.8)
        im = ax[2].imshow(coh, cmap="viridis", vmin=0, vmax=1, extent=ext, aspect="auto")
        ax[2].set_title("coherence")
        plt.colorbar(im, ax=ax[2], shrink=0.8)
        plt.tight_layout()
        plt.savefig(a.preview, dpi=70)
        print("preview written to", a.preview)
        return

    (sd / "deformation.grid.json").write_text(json.dumps(grid_json(out, "m", "los_displacement", bbox)), encoding="utf-8")
    (sd / "coherence.grid.json").write_text(json.dumps(grid_json(coh, "1", "coherence", bbox, 3)), encoding="utf-8")
    print("wrote deformation.grid.json and coherence.grid.json")
    print("fit coefficients (normalized km):", [round(float(c), 5) for c in coef])


if __name__ == "__main__":
    main()
