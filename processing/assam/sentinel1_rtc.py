"""Optional: Sentinel-1 C-band (OPERA RTC-S1, VV) near the flood peak, for an L-band vs C-band comparison.

    python pipeline/sentinel1_rtc.py

Finds the OPERA L2 RTC-S1 bursts over the study box on S1_DATE through the ASF search API,
downloads their VV GeoTIFFs (Earthdata token) into data/context/s1/, mosaics them on the
NISAR output grid and writes web/data/overlays/s1_<date>_VV.jpg plus a coverage mask
(alpha) as PNG, then adds manifest["context"]["sentinel1"].
"""
import json

import numpy as np
import rasterio
import requests
from PIL import Image
from rasterio.warp import Resampling, reproject

from config import BBOX, OVERLAY_DIR, ROOT, S1_DATE, S1_DB_RANGE, WEB_DATA, earthdata_token
from process_gcov import DST_T, H, W, area_km2

S1_DIR = ROOT / "data" / "context" / "s1"


def search():
    d0 = f"{S1_DATE}T00:00:00Z"; d1 = f"{S1_DATE}T23:59:59Z"
    r = requests.get("https://api.daac.asf.alaska.edu/services/search/param", params={
        "dataset": "OPERA-S1", "processingLevel": "RTC", "bbox": ",".join(map(str, BBOX)),
        "start": d0, "end": d1, "output": "geojson"}, timeout=60)
    r.raise_for_status()
    out = []
    for f in r.json()["features"]:
        p = f["properties"]
        urls = [p["url"]] + p.get("additionalUrls", [])
        vv = next((u for u in urls if u.endswith("_VV.tif")), None)
        if vv:
            out.append((p["fileID"], vv, p.get("flightDirection")))
    return out


def download(url):
    S1_DIR.mkdir(parents=True, exist_ok=True)
    dst = S1_DIR / url.rsplit("/", 1)[1]
    if dst.exists():
        return dst
    s = requests.Session()
    s.headers["Authorization"] = f"Bearer {earthdata_token()}"
    r = s.get(url, allow_redirects=False, timeout=60)
    if r.status_code == 403 and "EULA" in r.text:
        raise SystemExit("Earthdata EULA for ASF OPERA products not accepted. Approve it at "
                         + r.json().get("resolution_url", "https://urs.earthdata.nasa.gov") + " and rerun.")
    if r.status_code in (301, 302, 303, 307):
        r = requests.get(r.headers["Location"], timeout=300)
    r.raise_for_status()
    dst.write_bytes(r.content)
    return dst


def main():
    bursts = search()
    if not bursts:
        raise SystemExit(f"No OPERA RTC-S1 bursts over the box on {S1_DATE}")
    acc = np.zeros((H, W)); n = np.zeros((H, W))
    for fid, url, direction in bursts:
        print(" ", fid, direction)
        tile = np.full((H, W), np.nan, dtype="float32")
        with rasterio.open(download(url)) as src:
            reproject(rasterio.band(src, 1), tile, dst_transform=DST_T, dst_crs="EPSG:4326",
                      dst_nodata=np.nan, resampling=Resampling.average)   # linear gamma0, averaged
        ok = np.isfinite(tile) & (tile > 0)
        acc[ok] += tile[ok]; n[ok] += 1
    with np.errstate(divide="ignore", invalid="ignore"):
        db = 10 * np.log10(acc / n)
    cover = n > 0
    lo, hi = S1_DB_RANGE
    v = np.clip((np.nan_to_num(db, nan=lo) - lo) / (hi - lo), 0, 1)
    la = np.stack([(v * 255).astype("uint8"), np.where(cover, 255, 0).astype("uint8")], -1)  # grey + alpha
    name = f"s1_{S1_DATE}_VV.png"
    Image.fromarray(la, mode="LA").save(OVERLAY_DIR / name, optimize=True)
    cell = area_km2()
    manifest = json.loads((WEB_DATA / "manifest.json").read_text())
    manifest.setdefault("context", {})["sentinel1"] = {
        "url": f"data/overlays/{name}", "date": S1_DATE, "pol": "VV", "product": "OPERA L2 RTC-S1",
        "coverage": round(float(cover.mean()), 3), "covered_km2": round(float(cell[cover].sum()), 1),
        "water_km2_vv_below_-18": round(float(cell[cover & (db < -18)].sum()), 1),
        "bursts": sorted(b[0] for b in bursts)}
    (WEB_DATA / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print("coverage", manifest["context"]["sentinel1"]["coverage"], "->", name)


if __name__ == "__main__":
    main()
