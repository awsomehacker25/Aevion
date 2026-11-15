"""Shared settings for the pipeline. Edit these, not the scripts."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CROP_DIR = ROOT / "data" / "cropped"      # cropped GeoTIFFs per date (git-ignored)
WEB_DATA = ROOT / "web" / "data"           # everything the web app reads
OVERLAY_DIR = WEB_DATA / "overlays"

# Study box around Sivasagar / Charaideo (lon_min, lat_min, lon_max, lat_max)
BBOX = (94.3, 26.6, 95.1, 27.3)
SEARCH_START = "2026-06-01"

# Chosen from the Vertex search (search_nisar.py): ascending track 40, frame 15
# has the densest series and catches the July 22 flood peak.
TRACK, FRAME = 40, 15
DATES = {
    "2026-06-16": "Before the first wave",
    "2026-06-28": "First flood wave",
    "2026-07-10": "Between waves",
    "2026-07-22": "Near the flood peak",
    "2026-08-15": "Retreat",
    "2026-09-20": "Late monsoon",
    "2026-10-26": "Dry season reference",
}

# Dry reference for "new water". June 28 was already the first flood wave, so
# using the earliest date undercounts. Oct 26 has the least water of the series.
REFERENCE_DATE = "2026-10-26"

# ---- context layers (context_layers.py) ----
DISTRICTS = ["Sivasagar", "Charaideo"]
# JRC Global Surface Water occurrence (% of months with water, 1984-2021) at or
# above this is "permanent" water: shown separately and never counted as flood.
# 50, not 75: the braided Brahmaputra moves its channels, so only 0.4% of the box
# reaches 75% while 2.7% reaches 50%.
JRC_PERMANENT_PCT = 50
# Aftermath change is only shown along the Dikhow, Disang and Jhanji (context_layers.tributary_corridors):
# the JRC water network (occurrence >= TRIB_MIN_PCT) connected to the seed points below, widened by
# CORRIDOR_KM. The Brahmaputra main channel (JRC >= CORRIDOR_MIN_PCT, the widest water body) and a
# ~2 km buffer are excluded: its sandbars emerge every year as the river falls, which is seasonal.
# Outside the corridors, Jun->Oct change is mostly crops.
CORRIDOR_MIN_PCT = 25
TRIB_MIN_PCT = 5
CORRIDOR_KM = 1.0
TRIB_SEEDS = {   # (lat, lon) points on each river, read off the EOX/OSM river labels and the JRC network
    "Dikhow": [(26.918, 94.7514), (26.97, 94.60)],
    "Disang": [(27.06, 94.96), (27.03, 94.75)],
    "Jhanji": [(26.8829, 94.4127), (26.8308, 94.4883), (26.7711, 94.5168)],
}
# Aftermath: pre-flood date vs. dry season date. 16 Jun was checked against the other dates over stable
# targets (README, "16 June check") and is within 0.3 dB of 28 Jun to 20 Sep, so it is kept.
AFTERMATH_PAIR = ("2026-06-16", "2026-10-26")
# Stable forest in the Naga foothills (lat0, lat1, lon0, lon1) used for the relative calibration
STABLE_FOREST = (26.60, 26.72, 94.95, 95.10)
# Clear Sentinel-2 day for the optical comparison
S2_DATE = "2026-10-11"

# GCOV is 10 m. Average DOWNSAMPLE x DOWNSAMPLE blocks when cropping (4 -> 40 m).
DOWNSAMPLE = 4
# Web overlay resolution in degrees (~40 m)
OUT_RES_DEG = 0.0004

# Display stretch in dB for the PNG overlays
DB_RANGE = {"HH": (-25.0, 0.0), "HV": (-32.0, -8.0)}

# Open water is dark in HH. -15 dB sits in the valley between the water and
# land peaks of the July 22 HH histogram. Check it against JRC water and the
# Assam University July 22 map.
WATER_THRESHOLD_DB_HH = -15.0

# Grid used for click-for-chart time series (degrees). Coarse keeps JSON small.
TS_CELL_DEG = 0.006


def earthdata_token():
    """Earthdata bearer token from $EARTHDATA_TOKEN or ~/.edl_token. Never commit it."""
    import os
    tok = os.environ.get("EARTHDATA_TOKEN")
    if tok:
        return tok.strip()
    for p in (Path.home() / ".edl_token", Path("/root/.secrets/edl_token")):
        if p.exists():
            return p.read_text().strip()
    raise SystemExit("Set EARTHDATA_TOKEN (generate one at urs.earthdata.nasa.gov > Generate Token).")

# ---- rainfall (rainfall_imerg.py) ----
# Naga Hills catchment upstream of the study area
RAIN_BOX = (93.5, 25.5, 96.0, 27.5)
RAIN_START, RAIN_END = "2026-06-10", "2026-10-26"   # the whole NISAR season, to the last pass

# False-colour HH/HV composite (false_colour.py): stretch per channel, in dB
RGB_RANGE = {"R": (-22.0, 0.0), "G": (-27.0, -7.0), "B": (2.0, 14.0)}
PRESET_DATE = "2026-07-22"   # presets where HH and HV disagree are picked on this date

# Optional Sentinel-1 C-band comparison (sentinel1_rtc.py): OPERA RTC-S1 VV, ascending track 70
S1_DATE = "2026-07-22"
S1_DB_RANGE = (-25.0, 0.0)
