"""Step 5: check the HH water threshold against two independent references.

    python pipeline/validate_threshold.py

1. Assam University (2026) NISAR flood map for 22 July (report Figure 14,
   HV + Otsu + refined Lee filter, ESA WorldCover permanent water removed).
   The report gives no flooded-area numbers, only the map, so we georeference
   the published figure from its graticule (93deg36' / 94deg24' / 95deg12' E,
   26deg24' / 27deg12' N) and compare pixel masks inside Sivasagar + Charaideo.
   Figure resolution is about 200 m, so this is a coarse check.
2. JRC Global Surface Water on the dry season reference (26 Oct): how well does
   "HH below threshold" match JRC permanent water?

Writes web/data/validation.json and prints a table for the README.
"""
import json

import numpy as np
from PIL import Image
from rasterio.features import geometry_mask

from config import CROP_DIR, REFERENCE_DATE, ROOT, WEB_DATA
from process_gcov import DST_T, H, W, X0, Y1, jrc_permanent, load_wgs84, smooth
from config import OUT_RES_DEG

FIG = ROOT / "data" / "context" / "aus_fig14.jpg"
PEAK = "2026-07-22"
# graticule ticks read off the figure (pixel x for lon, pixel y for lat)
LON_TICKS = [(381, 93.6), (792, 94.4), (1203, 95.2)]
LAT_TICKS = [(155, 27.2), (568, 26.4)]


def otsu(v):
    v = v[np.isfinite(v)]
    hist, edges = np.histogram(v, bins=256)
    c = (edges[:-1] + edges[1:]) / 2
    w0 = np.cumsum(hist); w1 = w0[-1] - w0
    m0 = np.cumsum(hist * c) / np.maximum(w0, 1)
    m1 = (np.sum(hist * c) - np.cumsum(hist * c)) / np.maximum(w1, 1)
    return float(c[np.argmax(w0 * w1 * (m0 - m1) ** 2)])


def figure_mask():
    img = np.asarray(Image.open(FIG).convert("RGB")).astype(int)
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    red = (r > 180) & (g < 130) & (b < 130)                       # "Flooded Areas"
    ax = np.polyfit([p for p, _ in LON_TICKS], [v for _, v in LON_TICKS], 1)
    ay = np.polyfit([p for p, _ in LAT_TICKS], [v for _, v in LAT_TICKS], 1)
    # sample the figure at each output-grid cell centre
    lon = X0 + (np.arange(W) + 0.5) * OUT_RES_DEG
    lat = Y1 - (np.arange(H) + 0.5) * OUT_RES_DEG
    px = np.round((lon - ax[1]) / ax[0]).astype(int)
    py = np.round((lat - ay[1]) / ay[0]).astype(int)
    ok_x = (px >= 0) & (px < img.shape[1]); ok_y = (py >= 0) & (py < img.shape[0])
    out = np.zeros((H, W), bool)
    out[np.ix_(ok_y, ok_x)] = red[np.ix_(py[ok_y], px[ok_x])]
    return out


def scores(pred, ref, aoi):
    p, r = pred & aoi, ref & aoi
    tp = (p & r).sum(); fp = (p & ~r).sum(); fn = (~p & r).sum()
    prec = tp / max(tp + fp, 1); rec = tp / max(tp + fn, 1)
    return {"precision": round(float(prec), 3), "recall": round(float(rec), 3),
            "f1": round(float(2 * prec * rec / max(prec + rec, 1e-9)), 3),
            "iou": round(float(tp / max(tp + fp + fn, 1)), 3),
            "pred_frac": round(float(p.sum() / aoi.sum()), 3), "ref_frac": round(float(r.sum() / aoi.sum()), 3)}


def coarsen(m, k=5):
    """Majority at ~200 m so our 40 m masks match the figure's resolution."""
    h, w = (m.shape[0] // k) * k, (m.shape[1] // k) * k
    c = m[:h, :w].reshape(h // k, k, w // k, k).mean(axis=(1, 3)) >= 0.5
    return np.repeat(np.repeat(c, k, 0), k, 1)[:m.shape[0], :m.shape[1]] if h == m.shape[0] else np.pad(
        np.repeat(np.repeat(c, k, 0), k, 1), ((0, m.shape[0] - h), (0, m.shape[1] - w)))


def main():
    gj = json.loads((WEB_DATA / "districts.geojson").read_text())
    aoi = ~geometry_mask([f["geometry"] for f in gj["features"]], (H, W), DST_T)
    hh, hv = load_wgs84(CROP_DIR / f"{PEAK}.tif")
    perm = jrc_permanent()
    ref_fig = figure_mask() & ~perm
    out = {"peak": PEAK, "aoi": "Sivasagar + Charaideo", "figure_flood_frac": round(float((ref_fig & aoi).sum() / aoi.sum()), 3),
           "otsu_hh_db": round(otsu(hh[aoi]), 1), "otsu_hv_db": round(otsu(hv[aoi]), 1), "vs_aus_fig14": {}, "vs_jrc_dry": {}}

    candidates = {f"HH < {t} dB": hh < t for t in (-13, -14, -15, -16, -17, -18)}
    candidates[f"HH < Otsu ({out['otsu_hh_db']} dB)"] = hh < out["otsu_hh_db"]
    candidates[f"HV < Otsu ({out['otsu_hv_db']} dB)"] = hv < out["otsu_hv_db"]
    for name, m in candidates.items():
        out["vs_aus_fig14"][name] = scores(coarsen(smooth(m) & ~perm), ref_fig, aoi)

    hh_dry = load_wgs84(CROP_DIR / f"{REFERENCE_DATE}.tif")[0]
    box = np.isfinite(hh_dry)
    for t in (-13, -15, -17, -19):
        out["vs_jrc_dry"][f"HH < {t} dB"] = scores(smooth(hh_dry < t), perm, box)

    (WEB_DATA / "validation.json").write_text(json.dumps(out, indent=2))
    print(f"AOI flooded fraction in Assam University figure: {out['figure_flood_frac']}")
    print(f"Otsu thresholds on 22 Jul inside AOI: HH {out['otsu_hh_db']} dB, HV {out['otsu_hv_db']} dB\n")
    print("| 22 Jul mask vs. Assam University Fig. 14 | Precision | Recall | F1 | IoU | Our flooded share | Their share |")
    print("|---|---|---|---|---|---|---|")
    for k, s in out["vs_aus_fig14"].items():
        print(f"| {k} | {s['precision']} | {s['recall']} | {s['f1']} | {s['iou']} | {s['pred_frac']} | {s['ref_frac']} |")
    print("\n| 26 Oct mask vs. JRC permanent water | Precision | Recall | F1 |")
    print("|---|---|---|---|")
    for k, s in out["vs_jrc_dry"].items():
        print(f"| {k} | {s['precision']} | {s['recall']} | {s['f1']} |")


if __name__ == "__main__":
    main()
