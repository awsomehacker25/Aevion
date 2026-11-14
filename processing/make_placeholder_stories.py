"""Generate PLACEHOLDER story folders: Kilauea, Seattle/Bellevue and Oso.

These grids are SYNTHETIC. They exist so each story's layout, text and tour can be built and
demoed before real radar data is processed. They are not measurements, and the patterns are
simplified shapes placed at real places, not real faults, vents or slide geometry.

Each story folder gets the files the app expects (see docs/data-contract.md):
  deformation.grid.json, coherence.grid.json, acquisitions.json (no passes yet), events.geojson (empty)

story.json is NOT touched, so you can run this again without losing text. To replace a
placeholder with real data, overwrite the two grid files (see docs/adding-a-story.md).

Usage:
  python processing/make_placeholder_stories.py            # all three
  python processing/make_placeholder_stories.py kilauea    # one
"""
import json
import math
import sys
from pathlib import Path

import numpy as np

STORIES = Path(__file__).resolve().parent.parent / "apps" / "web" / "public" / "stories"


def km_per_deg(lat):
    return 111.32 * math.cos(math.radians(lat)), 110.57


class Frame:
    """A north-up grid over a bounding box, with kilometer coordinates around a center."""

    def __init__(self, bbox, w, h, seed):
        self.bbox, self.w, self.h = bbox, w, h
        self.rng = np.random.default_rng(seed)
        lons = np.linspace(bbox[0], bbox[2], w)
        lats = np.linspace(bbox[3], bbox[1], h)  # north-up rows
        self.lon, self.lat = np.meshgrid(lons, lats)

    def xy(self, lon0, lat0):
        kx, ky = km_per_deg(lat0)
        return (self.lon - lon0) * kx, (self.lat - lat0) * ky

    def noise(self, sigma_px):
        n = self.rng.standard_normal((self.h, self.w))
        fy = np.fft.fftfreq(self.h)[:, None]
        fx = np.fft.fftfreq(self.w)[None, :]
        k = np.exp(-2 * (math.pi * sigma_px) ** 2 * (fx ** 2 + fy ** 2))
        s = np.real(np.fft.ifft2(np.fft.fft2(n) * k))
        return s / s.std()

    def gauss(self, lon0, lat0, sx_km, sy_km, rot_deg=0.0):
        x, y = self.xy(lon0, lat0)
        t = math.radians(rot_deg)
        u = x * math.cos(t) + y * math.sin(t)
        v = -x * math.sin(t) + y * math.cos(t)
        return np.exp(-0.5 * ((u / sx_km) ** 2 + (v / sy_km) ** 2))


def los_away(ue, un, uz, incidence_deg, look_az_deg):
    """Line-of-sight motion AWAY from the satellite (positive = range increase)."""
    inc, az = math.radians(incidence_deg), math.radians(look_az_deg)
    return ue * math.sin(inc) * math.sin(az) + un * math.sin(inc) * math.cos(az) - uz * math.cos(inc)


def grid(f, values, units, name):
    return {
        "format": "aevion-grid-v1", "name": name, "units": units, "width": f.w, "height": f.h,
        "bbox": list(f.bbox), "rowOrder": "north-up", "nodata": None,
        "values": [round(float(v), 4) for v in values.ravel()],
    }


# ---------------------------------------------------------------- Kilauea
def kilauea():
    f = Frame((-155.42, 19.32, -155.14, 19.53), 220, 200, 101)
    inc, az = 39, 260
    # Mogi-style deflation source under the summit caldera (Halemaumau): the ground sinks and moves inward.
    lon0, lat0, depth = -155.2834, 19.4069, 1.8
    x, y = f.xy(lon0, lat0)
    r2 = x ** 2 + y ** 2
    uz_unit = depth / (r2 + depth ** 2) ** 1.5
    ur_unit = np.sqrt(r2) / (r2 + depth ** 2) ** 1.5
    scale = 0.34 / uz_unit.max()
    uz = -uz_unit * scale
    rr = np.sqrt(r2) + 1e-9
    ue, un = -ur_unit * scale * x / rr, -ur_unit * scale * y / rr
    defo = los_away(ue, un, uz, inc, az) + 0.006 * f.noise(30) + 0.002 * f.rng.standard_normal((f.h, f.w))

    coh = 0.82 + 0.07 * f.noise(16) + 0.03 * f.noise(4)
    coh -= 0.55 * f.gauss(lon0, lat0, 1.6, 1.4)        # fresh ash and fallen rock near the vent
    coh -= 0.18 * np.clip(f.noise(24) - 0.4, 0, None)  # dense rainforest patches
    return f, defo, np.clip(coh, 0.03, 0.99)


# ---------------------------------------------------------------- Seattle / Bellevue
def seattle():
    f = Frame((-122.55, 47.35, -122.0, 47.80), 220, 240, 202)
    inc = 39
    # Slow settling in soft, filled ground (placeholder): Duwamish/SODO, Kent valley, a little under Bellevue.
    sink = (
        -0.014 * f.gauss(-122.335, 47.575, 2.6, 3.4, 10)
        - 0.011 * f.gauss(-122.235, 47.39, 4.5, 3.0)
        - 0.005 * f.gauss(-122.19, 47.615, 1.8, 1.8)
    )
    sink += 0.0006 * f.noise(28) + 0.0004 * f.rng.standard_normal((f.h, f.w))
    defo = los_away(0, 0, sink, inc, 100)

    coh = 0.88 + 0.05 * f.noise(14) + 0.02 * f.noise(4)
    sound = f.lon < (-122.385 - 0.04 * np.clip(f.lat - 47.6, 0, None))               # Puget Sound (rough)
    lake_w = f.gauss(-122.255, 47.62, 1.9, 13.0)                                      # Lake Washington (rough)
    lake_s = f.gauss(-122.09, 47.60, 1.0, 6.0)                                        # Lake Sammamish (rough)
    water = sound | (lake_w > 0.5) | (lake_s > 0.5)
    coh = np.where(water, 0.04, coh)
    coh -= 0.3 * np.clip((f.lon + 122.07) * 14, 0, None)                             # forest toward the Cascade foothills
    coh -= 0.2 * np.clip(f.noise(18) - 0.8, 0, None)
    defo = np.where(water, np.nan, defo)
    return f, defo, np.clip(coh, 0.03, 0.99)


# ---------------------------------------------------------------- Oso
def oso():
    f = Frame((-121.95, 48.22, -121.75, 48.35), 200, 150, 303)
    inc, az = 39, 260
    # Slow creep on the hillside before it failed (placeholder), a few cm toward the valley.
    creep = 0.07 * f.gauss(-121.846, 48.272, 0.7, 0.55, 20)
    ue, un, uz = 0.0 * creep, 0.7 * creep, -0.5 * creep
    defo = los_away(ue, un, uz, inc, az) + 0.004 * f.noise(20) + 0.002 * f.rng.standard_normal((f.h, f.w))

    coh = 0.62 + 0.10 * f.noise(10) + 0.05 * f.noise(3)                              # forested slopes: moderate
    river = f.gauss(-121.85, 48.286, 6.0, 0.35, -8)                                  # farmland on the valley floor
    coh += 0.28 * river
    coh -= 0.55 * f.gauss(-121.8465, 48.2825, 0.55, 0.75, -15)                       # the slide footprint
    return f, defo, np.clip(coh, 0.03, 0.99)


RECIPES = {"kilauea-hawaii": kilauea, "seattle-bellevue": seattle, "oso-landslide": oso}
ALIASES = {"kilauea": "kilauea-hawaii", "seattle": "seattle-bellevue", "oso": "oso-landslide"}


def write(story_id):
    f, defo, coh = RECIPES[story_id]()
    d = STORIES / story_id
    d.mkdir(parents=True, exist_ok=True)
    bad = np.isnan(defo)
    dgrid = grid(f, np.where(bad, 0, defo), "m", "Synthetic placeholder: line-of-sight displacement")
    if bad.any():
        dgrid["values"] = [None if b else v for b, v in zip(bad.ravel(), dgrid["values"])]
    (d / "deformation.grid.json").write_text(json.dumps(dgrid), encoding="utf-8")
    (d / "coherence.grid.json").write_text(json.dumps(grid(f, coh, "1", "Synthetic placeholder: coherence")), encoding="utf-8")
    if not (d / "acquisitions.json").exists():
        (d / "acquisitions.json").write_text(json.dumps({
            "source": "none yet", "shortName": "", "bbox": list(f.bbox), "window": [], "pairs": [],
        }, indent=1), encoding="utf-8")
    if not (d / "events.geojson").exists():
        (d / "events.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": []}), encoding="utf-8")
    print(f"{story_id}: {f.w}x{f.h}, displacement range {np.nanmin(defo):+.3f}..{np.nanmax(defo):+.3f} m")


if __name__ == "__main__":
    names = [ALIASES.get(a, a) for a in sys.argv[1:]] or list(RECIPES)
    for n in names:
        if n not in RECIPES:
            sys.exit(f"unknown story '{n}'. Choose from: {', '.join(RECIPES)}")
        write(n)
