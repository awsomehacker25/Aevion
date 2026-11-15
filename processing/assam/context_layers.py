"""Step 4: context layers for the web map.

    python pipeline/context_layers.py

Inputs (downloaded into data/context/, git-ignored; see README for URLs):
  ind_adm2.geojson               geoBoundaries gbOpen IND ADM2 (simplified), ODbL 1.0
  jrc_occurrence_90E_30N.tif     JRC Global Surface Water v1.4 Occurrence, tile 90E_30N
  worldpop_ind_2025.tif          WorldPop R2025A, India, 100 m constrained population counts
Sentinel-2 is read straight from the Element84 Earth Search COGs (no login).

Outputs in web/data/:
  districts.geojson              Sivasagar and Charaideo outlines
  overlays/permanent_water.png   JRC permanent water (occurrence >= 75%) as white outlines
  overlays/aftermath.png         HH change, pre-flood (Jun 16) to dry season (Oct 26)
  overlays/population.png        people per km2
  overlays/s2_<date>.jpg         Sentinel-2 true colour
and adds a "context" block to manifest.json.
"""
import json
import os

import numpy as np
import rasterio
import requests
from PIL import Image
from rasterio.warp import Resampling, reproject

from config import (AFTERMATH_PAIR, BBOX, CORRIDOR_KM, CORRIDOR_MIN_PCT, CROP_DIR, DATES, DISTRICTS, OUT_RES_DEG, JRC_PERMANENT_PCT,
                    ROOT, S2_DATE, STABLE_FOREST, TRIB_MIN_PCT, TRIB_SEEDS, WEB_DATA, OVERLAY_DIR)
from process_gcov import DST_T, H, W, area_km2, jrc_permanent, load_wgs84

CTX = ROOT / "data" / "context"
os.environ.setdefault("CURL_CA_BUNDLE", "/root/.ccr/ca-bundle.crt" if os.path.exists("/root/.ccr/ca-bundle.crt") else "")


def to_grid(path, resampling, band=1, dtype="float32", nodata=None):
    out = np.full((H, W), np.nan if dtype == "float32" else 0, dtype=dtype)
    with rasterio.open(path) as src:
        reproject(rasterio.band(src, band), out, dst_transform=DST_T, dst_crs="EPSG:4326",
                  src_nodata=nodata if nodata is not None else src.nodata, resampling=resampling)
    return out


def outline(mask):
    """Edge pixels of a mask (pixel in mask with a 4-neighbour outside it)."""
    p = np.pad(mask, 1)
    inner = p[1:-1, 1:-1] & p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]
    return mask & ~inner


def save_rgba(rgba, name):
    Image.fromarray(rgba).save(OVERLAY_DIR / name, optimize=True)
    return f"data/overlays/{name}"


def districts():
    gj = json.loads((CTX / "ind_adm2.geojson").read_text())
    keep = [f for f in gj["features"] if f["properties"]["shapeName"] in DISTRICTS]
    for f in keep:
        f["properties"] = {"name": f["properties"]["shapeName"]}
    out = {"type": "FeatureCollection", "features": keep}
    (WEB_DATA / "districts.geojson").write_text(json.dumps(out, separators=(",", ":")))
    return "data/districts.geojson", keep


def district_masks(features):
    from rasterio.features import geometry_mask
    return {f["properties"]["name"]: ~geometry_mask([f["geometry"]], (H, W), DST_T) for f in features}


def disk(r):
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def tributary_corridors():
    """Corridors of the Dikhow, Disang and Jhanji, with the Brahmaputra main channel cut out.

    The Brahmaputra is the largest JRC water body that survives a 9x9 opening (braided channel
    hundreds of metres wide); it and a ~2 km buffer are excluded, because its sandbars emerge every
    year as the river falls, which is seasonal and not flood aftermath. The tributaries are traced as
    the JRC water network (occurrence >= TRIB_MIN_PCT, gaps up to ~250 m bridged) connected to seed
    points on each river (TRIB_SEEDS), then widened by CORRIDOR_KM.
    Returns ({river: corridor mask}, brahmaputra exclusion mask)."""
    from scipy import ndimage as ndi
    occ = np.nan_to_num(to_grid(CTX / "jrc_occurrence_90E_30N.tif", Resampling.max, nodata=255))
    wide = ndi.binary_opening(occ >= CORRIDOR_MIN_PCT, structure=np.ones((9, 9)))
    lab, n = ndi.label(wide)
    sizes = ndi.sum(wide, lab, range(1, n + 1))
    brahma = ndi.binary_dilation(lab == 1 + int(np.argmax(sizes)), disk(10), iterations=5)
    water = (occ >= TRIB_MIN_PCT) & ~brahma
    lab, _ = ndi.label(ndi.binary_dilation(water, disk(6)))
    r = int(round(CORRIDOR_KM / (OUT_RES_DEG * 111.32)))
    inv = ~DST_T
    out = {}
    for river, pts in TRIB_SEEDS.items():
        ids = set()
        for lat, lon in pts:
            c, rr = inv * (lon, lat)
            win = lab[int(rr) - 15:int(rr) + 16, int(c) - 15:int(c) + 16]
            v = win[win > 0]
            if v.size:
                ids.add(int(np.bincount(v).argmax()))
        line = np.isin(lab, list(ids)) & water
        out[river] = ndi.binary_dilation(line, disk(r)) & ~brahma
    return out, brahma


def aftermath():
    a, b = AFTERMATH_PAIR
    hh_a = load_wgs84(CROP_DIR / f"{a}.tif")[0]
    hh_b = load_wgs84(CROP_DIR / f"{b}.tif")[0]
    d = hh_b - hh_a
    # Relative calibration: the dry-season date is a newer processing version (CRID) and reads ~1 dB
    # darker over stable forest in the Naga foothills. Remove the median forest difference first.
    forest = np.zeros((H, W), bool)
    f0, f1 = (~DST_T) * (STABLE_FOREST[2], STABLE_FOREST[1]), (~DST_T) * (STABLE_FOREST[3], STABLE_FOREST[0])
    forest[int(f0[1]):int(f1[1]), int(f0[0]):int(f1[0])] = True
    hv_ok = np.ones((H, W), bool)
    for dd in DATES:
        hv_ok &= load_wgs84(CROP_DIR / f"{dd}.tif")[1] > -14
    forest &= hv_ok
    offset = float(np.nanmedian(d[forest]))
    d = d - offset
    # 5x5 box mean in dB to suppress speckle before thresholding
    k = 2
    p = np.pad(np.nan_to_num(d), k, mode="edge")
    sm = sum(p[k + dy:k + dy + H, k + dx:k + dx + W] for dy in range(-k, k + 1) for dx in range(-k, k + 1)) / (2 * k + 1) ** 2
    rivers, brahma = tributary_corridors()
    corridor = np.zeros((H, W), bool)
    for m in rivers.values():
        corridor |= m
    from scipy import ndimage as ndi
    occ = np.nan_to_num(to_grid(CTX / "jrc_occurrence_90E_30N.tif", Resampling.max, nodata=255))
    chan = ndi.binary_dilation(occ >= TRIB_MIN_PCT, disk(2))
    brighter, darker = (sm > 3) & corridor, (sm < -3) & corridor
    rgba = np.zeros((H, W, 4), dtype="uint8")
    rgba[corridor] = (255, 255, 255, 40)    # faint corridor outline so "nothing changed" is visible
    rgba[brighter] = (213, 94, 0, 210)     # Okabe-Ito vermillion: rougher than before the flood
    rgba[darker] = (204, 121, 167, 210)    # Okabe-Ito reddish purple: smoother than before the flood
    cell = area_km2()
    km2 = lambda m: round(float(cell[m].sum()), 1)
    return save_rgba(rgba, "aftermath.png"), {
        "from": a, "to": b, "threshold_db": 3, "offset_db": round(offset, 2),
        "corridor_km": CORRIDOR_KM, "corridor_km2": km2(corridor),
        "brighter_km2": km2(brighter), "darker_km2": km2(darker),
        "brighter_pct": round(100 * float(cell[brighter].sum() / cell[corridor].sum()), 1),
        "darker_pct": round(100 * float(cell[darker].sum() / cell[corridor].sum()), 1),
        "excluded": "Brahmaputra main channel and ~2 km buffer",
        # "channel" = the river's own JRC water network plus ~90 m: where new sand bars, silt or a
        # shifted channel would show. The rest of each corridor is mostly farmland and wetland.
        "by_river": {n: {"corridor_km2": km2(m), "brighter_km2": km2(brighter & m), "darker_km2": km2(darker & m),
                         "channel_km2": km2(m & chan), "channel_brighter_km2": km2(brighter & m & chan),
                         "channel_darker_km2": km2(darker & m & chan)}
                     for n, m in rivers.items()}}


def new_water(date):
    """New-water mask of one date, read back from its overlay (solid class is (0, 114, 178))."""
    return np.array(Image.open(OVERLAY_DIR / f"{date}_water.png"))[..., 2] == 178


def population(flood_mask, dmasks, date_masks=None):
    src_path = CTX / "worldpop_ind_2025.tif"
    pop = to_grid(src_path, Resampling.sum)      # people per output cell (counts are summed)
    pop = np.where(np.isfinite(pop) & (pop > 0), pop, 0)
    cell = area_km2()
    dens = pop / cell
    v = np.clip(np.log10(np.maximum(dens, 1)) / 4, 0, 1)   # 1 to 10,000 people per km2
    rgba = np.zeros((H, W, 4), dtype="uint8")
    m = dens >= 10
    # light-to-dark magenta ramp, dark = dense
    rgba[..., 0] = (255 - 120 * v).astype("uint8"); rgba[..., 1] = (230 - 210 * v).astype("uint8")
    rgba[..., 2] = (255 - 60 * v).astype("uint8"); rgba[..., 3] = np.where(m, 200, 0)
    url = save_rgba(rgba, "population.png")
    # Per date: the same colours, but only where that date shows new water. The web map uses these,
    # so the layer answers "who lives under the new water" and leaves the rest of the map clear.
    by_date = {}
    for d, fm in (date_masks or {}).items():
        one = rgba.copy()
        one[~(fm & m)] = 0
        by_date[d] = {"url": save_rgba(one, f"population_{d}.png"), "in_flood": int(pop[fm].sum())}
    stats = {"total": int(pop.sum()), "in_flood": int(pop[flood_mask].sum()), "by_date": by_date,
             "by_district": {n: {"total": int(pop[mk].sum()), "in_flood": int(pop[mk & flood_mask].sum())}
                             for n, mk in dmasks.items()}}
    return url, stats


def sentinel2():
    r = requests.post("https://earth-search.aws.element84.com/v1/search", json={
        "collections": ["sentinel-2-l2a"], "bbox": list(BBOX),
        "datetime": f"{S2_DATE}T00:00:00Z/{S2_DATE}T23:59:59Z", "limit": 50}, timeout=60)
    r.raise_for_status()
    best = {}
    for f in r.json()["features"]:
        g = f["properties"]["grid:code"]
        if g not in best or f["properties"]["eo:cloud_cover"] < best[g]["properties"]["eo:cloud_cover"]:
            best[g] = f
    rgb = np.zeros((3, H, W), dtype="float32")
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MULTIRANGE="YES"):
        for f in best.values():
            href = f["assets"]["visual"]["href"]
            print("  S2", f["id"], round(f["properties"]["eo:cloud_cover"], 1))
            with rasterio.open(href) as src:
                tile = np.zeros((3, H, W), dtype="float32")
                for i in range(3):
                    reproject(rasterio.band(src, i + 1), tile[i], dst_transform=DST_T, dst_crs="EPSG:4326",
                              src_nodata=0, dst_nodata=0, resampling=Resampling.average)
            rgb = np.where(rgb == 0, tile, rgb)
    img = np.clip(rgb.transpose(1, 2, 0) * 1.15, 0, 255).astype("uint8")
    name = f"s2_{S2_DATE}.jpg"
    Image.fromarray(img).save(OVERLAY_DIR / name, quality=82, optimize=True)
    return f"data/overlays/{name}", {"date": S2_DATE, "scenes": sorted(f["id"] for f in best.values())}


def main():
    manifest = json.loads((WEB_DATA / "manifest.json").read_text())
    ctx = manifest.get("context", {})  # keep layers added by other scripts (e.g. sentinel1)

    durl, feats = districts()
    manifest["districts"] = durl
    dmasks = district_masks(feats)
    print("districts:", list(dmasks))

    perm = jrc_permanent()
    rgba = np.zeros((H, W, 4), dtype="uint8")
    rgba[outline(perm)] = (255, 255, 255, 235)
    ctx["permanent_water"] = {"url": save_rgba(rgba, "permanent_water.png"), "pct": JRC_PERMANENT_PCT,
                              "km2": round(float(area_km2()[perm].sum()), 1)}
    print("JRC permanent water km2:", ctx["permanent_water"]["km2"])

    url, stats = aftermath()
    ctx["aftermath"] = {"url": url, **stats}
    print("aftermath:", stats)

    flood = new_water(manifest["peak_date"])
    if (CTX / "worldpop_ind_2025.tif").exists():
        masks = {d["date"]: new_water(d["date"]) for d in manifest["dates"]}
        url, stats = population(flood, dmasks, masks)
        ctx["population"] = {"url": url, "date": manifest["peak_date"], "source_year": 2025, **stats}
        print("population:", stats)

    try:
        url, s2 = sentinel2()
        ctx["sentinel2"] = {"url": url, **s2}
    except Exception as e:  # optional
        print("Sentinel-2 skipped:", e)

    manifest["context"] = ctx
    (WEB_DATA / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print("updated manifest.json")


if __name__ == "__main__":
    main()
