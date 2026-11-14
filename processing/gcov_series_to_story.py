"""Turn a story's saved GCOV passes (data/stacks/<story>/gcov_*.npz from prep_story_backscatter.py --all) into a
radar-brightness time series: how much brighter or darker each date is than the first date, in dB, for HH and HV.

This is the "lava flow" recipe: fresh lava is rougher or smoother than the ground it covers, so it shows up as a
patch of changed brightness that grows from pass to pass. Nothing here is interferometry.

For every date after the first it writes, next to the story's pending stub or story.json:
  series/bs-<date>.hh.grid.json and series/bs-<date>.hv.grid.json    (change vs the first date, dB, steps of 0.1)
  series/summary.json    per date: scene-wide shift removed, and the area changed by more than the threshold

The scene-wide median shift of each date is removed first (--no-normalize to keep it), because season, rain and
snow move the whole scene by a decibel or two and would otherwise look like change. The shift is printed and saved.

Usage:
  python processing/gcov_series_to_story.py processing/pending/krasheninnikov-kamchatka
  python processing/gcov_series_to_story.py processing/pending/krasheninnikov-kamchatka --threshold 3 --preview data/krash.png
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np

STEP = 0.1  # dB per stored step


def grid_json(a, name, bbox):
    h, w = a.shape
    vals = [None if not np.isfinite(v) else int(round(float(v) / STEP)) for v in a.ravel()]
    return {"format": "aevion-grid-v1", "name": name, "units": "dB", "width": w, "height": h,
            "bbox": list(bbox), "rowOrder": "north-up", "nodata": None, "scale": STEP, "values": vals}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("story_dir")
    ap.add_argument("--stacks", default="data/stacks")
    ap.add_argument("--threshold", type=float, default=3.0, help="dB change that counts as 'changed' in the area summary")
    ap.add_argument("--no-normalize", action="store_true")
    ap.add_argument("--preview", help="write a contact sheet picture here")
    a = ap.parse_args()

    sd = Path(a.story_dir)
    story = json.loads((sd / "story.json").read_text(encoding="utf-8"))
    files = sorted(Path(a.stacks, story["id"]).glob("gcov_*.npz"), key=lambda p: str(np.load(p, allow_pickle=True)["date"]))
    if len(files) < 2:
        raise SystemExit(f"need at least 2 passes in {Path(a.stacks, story['id'])}, found {len(files)}")
    z = [np.load(f, allow_pickle=True) for f in files]
    bbox = [float(v) for v in z[0]["bbox"]]
    h, w = z[0]["hh_db"].shape
    km_x = (bbox[2] - bbox[0]) * 111.32 * math.cos(math.radians((bbox[1] + bbox[3]) / 2))
    km_y = (bbox[3] - bbox[1]) * 110.57
    cell_km2 = (km_x / w) * (km_y / h)
    out = sd / "series"
    out.mkdir(exist_ok=True)
    base = {"hh": z[0]["hh_db"].astype("float64"), "hv": z[0]["hv_db"].astype("float64")}
    products = sorted({str(x["product"]) if "product" in x.files else "?" for x in z})
    print(f"{len(z)} passes, {z[0]['date']} to {z[-1]['date']}, grid {w}x{h}, {cell_km2 * 1e6:.0f} m2 per cell, products: {products}")
    if len(products) > 1:
        print("   NOTE: passes come from different product maturities; say so in the story's provenance.")

    summary = []
    sheets = []
    for x in z[1:]:
        row = {"date": str(x["date"]), "reference": str(z[0]["date"]), "granule": str(x["granule"])}
        for pol in ("hh", "hv"):
            ch = x[f"{pol}_db"].astype("float64") - base[pol]
            ok = np.isfinite(ch)
            shift = float(np.median(ch[ok])) if ok.any() else 0.0
            if not a.no_normalize:
                ch = ch - shift
            row[f"{pol}_scene_shift_db"] = round(shift, 2)
            row[f"{pol}_brighter_km2"] = round(float(np.nansum(ch > a.threshold)) * cell_km2, 2)
            row[f"{pol}_darker_km2"] = round(float(np.nansum(ch < -a.threshold)) * cell_km2, 2)
            (out / f"bs-{row['date']}.{pol}.grid.json").write_text(
                json.dumps(grid_json(ch, f"{pol}_backscatter_change", bbox), separators=(",", ":")), encoding="utf-8")
            if pol == "hh":
                sheets.append((row["date"], ch))
        summary.append(row)
        print(f"{row['date']}  HH: scene shift {row['hh_scene_shift_db']:+.2f} dB, brighter {row['hh_brighter_km2']:.1f} km2, "
              f"darker {row['hh_darker_km2']:.1f} km2   HV: brighter {row['hv_brighter_km2']:.1f} km2, darker {row['hv_darker_km2']:.1f} km2")
    (out / "summary.json").write_text(json.dumps({"threshold_db": a.threshold, "cell_km2": cell_km2, "dates": summary}, indent=1), encoding="utf-8")
    print("wrote", out)

    if a.preview:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        n = len(sheets)
        cols = min(5, n)
        rows = math.ceil(n / cols)
        fig, ax = plt.subplots(rows, cols, figsize=(3 * cols, 3 * rows), squeeze=False)
        for axx in ax.ravel():
            axx.axis("off")
        for axx, (d, ch) in zip(ax.ravel(), sheets):
            axx.imshow(ch, cmap="RdBu_r", vmin=-8, vmax=8, extent=(bbox[0], bbox[2], bbox[1], bbox[3]), aspect="auto")
            axx.set_title(d, fontsize=9)
        plt.tight_layout()
        plt.savefig(a.preview, dpi=70)
        print("preview written to", a.preview)


if __name__ == "__main__":
    main()
