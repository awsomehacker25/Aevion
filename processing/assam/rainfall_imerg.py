"""Step 6: daily rainfall over the Naga Hills catchment from GPM IMERG.

    export EARTHDATA_TOKEN=...
    python pipeline/rainfall_imerg.py

Downloads GPM_3IMERGDL v07 (daily, 0.1 deg, Late run; the Final run is not out
yet for 2026) for RAIN_START..RAIN_END, averages precipitation over RAIN_BOX and
writes web/data/rainfall.json. GES DISC requires a one-time EULA approval on the
Earthdata account ("NASA GESDISC DATA ARCHIVE" under Applications > Authorized Apps).
"""
import datetime as dt
import json

import h5py
import numpy as np
import requests

from config import RAIN_BOX, RAIN_END, RAIN_START, ROOT, WEB_DATA, earthdata_token

OUT = ROOT / "data" / "context" / "imerg"
URL = ("https://data.gesdisc.earthdata.nasa.gov/data/GPM_L3/GPM_3IMERGDL.07/{y}/{m:02d}/"
       "3B-DAY-L.MS.MRG.3IMERG.{ymd}-S000000-E235959.V07C.nc4")


def fetch(day, token):
    p = OUT / f"{day:%Y%m%d}.nc4"
    if p.exists() and p.stat().st_size > 10000:
        return p
    r = requests.get(URL.format(y=day.year, m=day.month, ymd=f"{day:%Y%m%d}"),
                     headers={"Authorization": f"Bearer {token}"}, timeout=300)
    if r.status_code == 403 and "EULA" in r.text:
        raise SystemExit("GES DISC EULA not accepted for this Earthdata account. Approve it at "
                         "https://urs.earthdata.nasa.gov/approve_app?client_id=e2WVk8Pw6weeLUKZYOxvTQ and rerun.")
    r.raise_for_status()
    p.write_bytes(r.content)
    return p


def box_mean(path):
    with h5py.File(path, "r") as f:
        lat = f["lat"][()]; lon = f["lon"][()]
        x0, y0, x1, y1 = RAIN_BOX
        i = np.where((lon >= x0) & (lon <= x1))[0]; j = np.where((lat >= y0) & (lat <= y1))[0]
        pr = f["precipitation"][0, i.min():i.max() + 1, j.min():j.max() + 1].astype(float)  # (lon, lat), mm/day
        pr[pr < 0] = np.nan
        latw = np.cos(np.radians(lat[j]))[None, :] * np.ones_like(pr)
        ok = np.isfinite(pr)
        return float((pr[ok] * latw[ok]).sum() / latw[ok].sum()), float(np.nanmax(pr))


def main():
    token = earthdata_token()
    OUT.mkdir(parents=True, exist_ok=True)
    d0, d1 = dt.date.fromisoformat(RAIN_START), dt.date.fromisoformat(RAIN_END)
    days, mean, peak = [], [], []
    d = d0
    while d <= d1:
        m, mx = box_mean(fetch(d, token))
        days.append(d.isoformat()); mean.append(round(m, 1)); peak.append(round(mx, 1))
        print(d, f"{m:6.1f} mm box mean, {mx:6.1f} mm max cell")
        d += dt.timedelta(days=1)
    (WEB_DATA / "rainfall.json").write_text(json.dumps({
        "source": "GPM IMERG Late Run daily V07 (GPM_3IMERGDL)", "box": RAIN_BOX,
        "dates": days, "mean_mm": mean, "max_cell_mm": peak}, indent=1))
    manifest = json.loads((WEB_DATA / "manifest.json").read_text())
    manifest["rainfall"] = "data/rainfall.json"   # the web app shows the rain chart only when this is set
    (WEB_DATA / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print("wrote rainfall.json and updated manifest.json")


if __name__ == "__main__":
    main()
