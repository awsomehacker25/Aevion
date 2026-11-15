"""Step 3b: HH/HV false-colour composites and "where HH and HV disagree" presets.

    python pipeline/false_colour.py        (after process_gcov.py)

For every date writes web/data/overlays/<date>_RGB.jpg with
  R = HH        (RGB_RANGE["R"] dB)
  G = HV        (RGB_RANGE["G"] dB)
  B = HH - HV   (RGB_RANGE["B"] dB, the co-/cross-pol ratio)
and adds to manifest.json:
  dates[].layers.RGB      the composite
  rgb                     the stretch and the median colour of four sample classes (for the legend)
  presets                 2-3 points on PRESET_DATE where HH and HV tell different stories
"""
import json

import numpy as np

from config import CROP_DIR, OVERLAY_DIR, PRESET_DATE, REFERENCE_DATE, RGB_RANGE, WEB_DATA
from process_gcov import DST_T, W, load_wgs84
from PIL import Image


def box(x, k):
    """(2k+1)^2 box mean, NaN-safe (NaN counts as 0), edges left NaN."""
    c = np.pad(np.nan_to_num(x).astype("float64"), ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    n = 2 * k + 1
    out = np.full(x.shape, np.nan)
    out[k:-k, k:-k] = (c[n:, n:] - c[:-n, n:] - c[n:, :-n] + c[:-n, :-n]) / n ** 2
    return out


def smooth_db(db, k):
    """Box mean in linear power, back to dB."""
    with np.errstate(divide="ignore", invalid="ignore"):
        return 10 * np.log10(box(10 ** (db / 10), k))


def composite(hh, hv):
    chans = []
    for v, key in ((hh, "R"), (hv, "G"), (hh - hv, "B")):
        lo, hi = RGB_RANGE[key]
        chans.append(np.clip((np.nan_to_num(v, nan=lo) - lo) / (hi - lo), 0, 1))
    return (np.stack(chans, -1) * 255).astype("uint8")


def best_spot(cond, k=12):
    """Densest (2k+1)^2 patch where cond holds. Returns the patch's cond pixels (rows, cols),
    their centroid and the fraction of the patch they cover."""
    f = box(cond, k)
    i = int(np.nanargmax(f))
    y, x = divmod(i, W)
    win = np.zeros_like(cond)
    win[y - k:y + k + 1, x - k:x + k + 1] = True
    rows, cols = np.nonzero(cond & win)
    lon, lat = DST_T * (cols.mean() + 0.5, rows.mean() + 0.5)
    return (rows, cols), round(float(lat), 4), round(float(lon), 4), round(float(f.flat[i]), 2)


def main():
    manifest = json.loads((WEB_DATA / "manifest.json").read_text())
    stacks = {}
    for d in manifest["dates"]:
        hh, hv = load_wgs84(CROP_DIR / f"{d['date']}.tif")
        hh, hv = smooth_db(hh, 1), smooth_db(hv, 1)   # 3x3 to calm speckle in the colour mix
        name = f"{d['date']}_RGB.jpg"
        rgb = composite(hh, hv)
        Image.fromarray(rgb).save(OVERLAY_DIR / name, quality=85, optimize=True)
        d["layers"]["RGB"] = f"data/overlays/{name}"
        stacks[d["date"]] = (hh, hv, rgb)
        print("wrote", name)

    # ---- presets on PRESET_DATE, compared with the dry reference ----
    hh, hv, rgb = stacks[PRESET_DATE]
    hb, hvb, _ = stacks[REFERENCE_DATE]
    # 5x5 means so a preset sits in a real patch, not on a speckle
    hh5, hv5, hb5, hvb5 = (smooth_db(x, 1) for x in (hh, hv, hb, hvb))
    ratio = hh5 - hv5
    kinds = {
        # Both channels go dark: smooth open water. Shown for comparison.
        "agree_water": (hh5 < -15) & (hb5 > -10) & (hv5 - hvb5 < -6),
        # HV drops to the noise floor but HH stays land-bright: water roughened by wind or rain,
        # or water under short plants. An HH-only threshold misses it.
        "hv_only_water": (hv5 < -22) & (hh5 > -11),
        # HH much brighter than in the dry season while HV barely changes: double bounce between
        # standing water and stems or trunks. A dark-water threshold misses this flood too.
        "hh_double_bounce": (ratio > 9) & (hh5 - hb5 > 3) & (hv5 - hvb5 < 1),
    }
    presets = []
    for kind, cond in kinds.items():
        px, lat, lon, frac = best_spot(cond)
        med = lambda a: round(float(np.nanmedian(a[px])), 1)  # median over the matching pixels in the patch
        presets.append({"id": kind, "date": PRESET_DATE, "lat": lat, "lng": lon, "patch_fraction": frac,
                        "hh_db": med(hh5), "hv_db": med(hv5), "hh_ref_db": med(hb5), "hv_ref_db": med(hvb5)})
        print(kind, presets[-1])

    # ---- legend: median colour of sample classes on PRESET_DATE ----
    stable = np.abs(hh5 - hb5) < 1.5
    classes = {
        "water": (hh5 < -18) & (hv5 < -23),
        "floodveg": kinds["hh_double_bounce"],
        "forest": (hv5 > -11) & (hh5 > -9) & (hh5 < -5) & stable,
        "built": (hh5 > -2) & (hb5 > -2) & (ratio > 9),
    }
    swatches = {k: [int(v) for v in np.median(rgb[m], axis=0)] for k, m in classes.items() if m.sum() > 50}
    print("swatches", swatches)

    manifest["rgb"] = {"R": "HH", "G": "HV", "B": "HH-HV", "range_db": RGB_RANGE, "swatches": swatches,
                       "swatch_date": PRESET_DATE}
    manifest["presets"] = presets
    (WEB_DATA / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print("updated manifest.json")


if __name__ == "__main__":
    main()
