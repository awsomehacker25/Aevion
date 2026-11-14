"""Generate PLACEHOLDER deformation + coherence grids for the Venezuela story.

These are synthetic: a simple strike-slip-like quadrupole pattern around the two real
USGS epicenters. They exist only so the app can be built and demoed before the real
NISAR interferogram is processed. They are NOT NISAR measurements.

Output format is "aevion-grid-v1" (see docs/data-contract.md), identical to what the
real pipeline (processing/gunw_to_grid.py) must produce, so swapping is a file replace.

Usage: python processing/make_placeholder_story.py apps/web/public/stories/venezuela-2026
"""
import json
import math
import sys
from pathlib import Path

import numpy as np

BBOX = (-69.4, 9.6, -66.4, 11.3)  # W, S, E, N
W, H = 280, 160
rng = np.random.default_rng(2026)

lons = np.linspace(BBOX[0], BBOX[2], W)
lats = np.linspace(BBOX[3], BBOX[1], H)  # north-up rows
LON, LAT = np.meshgrid(lons, lats)


def km_xy(lon0, lat0):
    x = (LON - lon0) * 111.32 * math.cos(math.radians(lat0))
    y = (LAT - lat0) * 110.57
    return x, y


def quadrupole(lon0, lat0, strike_deg, a_km, b_km, peak_m):
    """Strike-slip-like LOS pattern: four lobes, alternating sign."""
    x, y = km_xy(lon0, lat0)
    th = math.radians(90 - strike_deg)  # strike measured from north
    u = x * math.cos(th) + y * math.sin(th)   # along strike
    v = -x * math.sin(th) + y * math.cos(th)  # across strike
    f = (u / a_km) * (v / b_km) * np.exp(-0.5 * ((u / a_km) ** 2 + (v / b_km) ** 2))
    return f / np.abs(f).max() * peak_m


def smooth_noise(sigma_px):
    n = rng.standard_normal((H, W))
    fy = np.fft.fftfreq(H)[:, None]
    fx = np.fft.fftfreq(W)[None, :]
    k = np.exp(-2 * (math.pi * sigma_px) ** 2 * (fx ** 2 + fy ** 2))
    s = np.real(np.fft.ifft2(np.fft.fft2(n) * k))
    return s / s.std()


# Real USGS epicenters (M7.2 and M7.5, 2026-06-24). Fault geometry here is invented.
defo = (
    quadrupole(-68.556, 10.371, 85, 38, 16, 0.42)
    + quadrupole(-67.220, 10.596, 80, 46, 18, 0.55)
    + 0.012 * smooth_noise(35)  # stand-in for atmosphere / ionosphere residual
    + 0.003 * rng.standard_normal((H, W))
)

# coherence: mostly high, patchy decorrelation, collapse near the ruptures
coh = 0.86 + 0.07 * smooth_noise(18) + 0.03 * smooth_noise(4)
for lon0, lat0, r in [(-68.556, 10.371, 14), (-67.220, 10.596, 16)]:
    x, y = km_xy(lon0, lat0)
    coh -= 0.62 * np.exp(-0.5 * (np.hypot(x, y) / r) ** 2)
blob = smooth_noise(22)
coh -= 0.45 * np.clip(blob - 1.1, 0, None)  # vegetated / steep patches
coh = np.clip(coh, 0.03, 0.99)


def grid(values, units, name):
    return {
        "format": "aevion-grid-v1",
        "name": name,
        "units": units,
        "width": W, "height": H,
        "bbox": list(BBOX),
        "rowOrder": "north-up",
        "nodata": None,
        "values": [round(float(v), 4) for v in values.ravel()],
    }


out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
(out / "deformation.grid.json").write_text(
    json.dumps(grid(defo, "m", "los_displacement_placeholder")), encoding="utf-8")
(out / "coherence.grid.json").write_text(
    json.dumps(grid(coh, "1", "coherence_placeholder")), encoding="utf-8")
print("deformation range (m):", round(float(defo.min()), 3), round(float(defo.max()), 3))
print("coherence range:", round(float(coh.min()), 3), round(float(coh.max()), 3))
