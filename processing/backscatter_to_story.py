"""Turn two saved GCOV dates (data/stacks/<story>/gcov_*.npz from prep_story_backscatter.py) into the story's
radar-brightness change grids, one for HH and one for HV.

Change = second pass minus reference pass, in dB (positive = brighter). Cells without a valid value on either
date stay empty. Nothing is smoothed or referenced to a background level, so a scene-wide shift (rain, soil
moisture, calibration) stays visible and is reported below.

Usage:
  python processing/backscatter_to_story.py apps/web/public/stories/kilauea-hawaii

Writes backscatter-hh.grid.json and backscatter-hv.grid.json next to story.json. Then add the two layers to
story.json (see the Kilauea story for the fields) and run validate_story.py.
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np


STEP = 0.1  # dB; the stored numbers are whole steps of this size (value = number * scale), which keeps the file small


def grid_json(a, name, bbox):
    h, w = a.shape
    vals = [None if not np.isfinite(v) else int(round(float(v) / STEP)) for v in a.ravel()]
    return {"format": "aevion-grid-v1", "name": name, "units": "dB", "width": w, "height": h,
            "bbox": list(bbox), "rowOrder": "north-up", "nodata": None, "scale": STEP, "values": vals}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("story_dir")
    ap.add_argument("--stacks", default="data/stacks")
    a = ap.parse_args()

    sd = Path(a.story_dir)
    story = json.loads((sd / "story.json").read_text(encoding="utf-8"))
    f = story["flagshipPair"]
    folder = Path(a.stacks) / story["id"]

    def load(date):
        hits = sorted(folder.glob(f"gcov_*_{date}.npz"))
        if not hits:
            raise SystemExit(f"no gcov file for {date} in {folder}")
        return np.load(hits[0], allow_pickle=True)

    r, s = load(f["reference"]), load(f["secondary"])
    bbox = [float(v) for v in r["bbox"]]
    print(f"reference {r['date']} ({r['granule']})\nsecond    {s['date']} ({s['granule']})")
    for pol, key in (("hh", "hh_db"), ("hv", "hv_db")):
        change = s[key].astype("float64") - r[key].astype("float64")
        v = change[np.isfinite(change)]
        print(f"{pol.upper()}: {len(v)} valid cells, scene-wide median shift {np.median(v):+.2f} dB, 1st to 99th percentile {np.percentile(v, 1):+.1f} to {np.percentile(v, 99):+.1f} dB")
        (sd / f"backscatter-{pol}.grid.json").write_text(
            json.dumps(grid_json(change, f"{pol}_backscatter_change", bbox), separators=(",", ":")), encoding="utf-8")
        # where the biggest local changes are, after a 5 by 5 average to ignore speckle
        pad = np.nan_to_num(change, nan=0.0)
        k = 5
        kernel = np.ones(k) / k
        sm = np.apply_along_axis(lambda x: np.convolve(x, kernel, mode="same"), 1, pad)
        sm = np.apply_along_axis(lambda x: np.convolve(x, kernel, mode="same"), 0, sm)
        h, w = change.shape
        for label, idx in (("largest brightening", int(np.argmax(sm))), ("largest darkening", int(np.argmin(sm)))):
            y, x = divmod(idx, w)
            lon = bbox[0] + (x + 0.5) / w * (bbox[2] - bbox[0])
            lat = bbox[3] - (y + 0.5) / h * (bbox[3] - bbox[1])
            print(f"   {label}: {sm.flat[idx]:+.1f} dB (smoothed) near {lat:.4f}, {lon:.4f}")
    print("wrote backscatter-hh.grid.json and backscatter-hv.grid.json")


if __name__ == "__main__":
    main()
