"""Collect USGS context for the Venezuela earthquakes into one compact file for the app.

Public data, no login. Pulls, for the two big events:
  * moment tensor (fault mechanism)             -> events[].planes
  * PAGER alert, exposure, nearby cities        -> pager, cities
  * ShakeMap intensity contours                 -> shakingContours
  * finite-fault slip patches (M7.5)            -> fault
  * the finite-fault model's predicted surface displacement grid (E, N, U in meters) -> model

Usage:
  python processing/fetch_usgs_context.py apps/web/public/stories/venezuela-2026
"""
import argparse
import datetime
import json
import urllib.request
from pathlib import Path

import numpy as np

API = "https://earthquake.usgs.gov/fdsnws/event/1/query"
MAIN = "us6000t7zp"   # M7.5
OTHER = "us6000t7zc"  # M7.2


def get(url, raw=False):
    with urllib.request.urlopen(url, timeout=120) as r:
        b = r.read()
    return b if raw else json.loads(b)


def detail(eid):
    return get(f"{API}?eventid={eid}&format=geojson")


def content(ev, product, name):
    p = ev["properties"]["products"].get(product)
    if not p:
        return None
    c = p[0].get("contents", {}).get(name)
    return c["url"] if c else None


def kind(rake):
    r = abs(((rake + 180) % 360) - 180)  # fold to 0..180
    if r < 30:
        return "left-lateral strike-slip"
    if r > 150:
        return "right-lateral strike-slip"
    return "dip-slip (thrust or normal)"


def mechanism(ev):
    p = ev["properties"]["products"].get("moment-tensor")
    if not p:
        return None
    m = p[0]["properties"]
    planes = []
    for i in (1, 2):
        s, d, r = (float(m[f"nodal-plane-{i}-{k}"]) for k in ("strike", "dip", "rake"))
        planes.append({"strike": s, "dip": d, "rake": r, "kind": kind(r)})
    return {"planes": planes, "depthKm": float(m.get("derived-depth", 0) or 0), "scalarMoment": m.get("scalar-moment")}


def rnd(coords, n=4):
    if isinstance(coords, (int, float)):
        return round(coords, n)
    return [rnd(c, n) for c in coords]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("story_dir")
    a = ap.parse_args()
    sd = Path(a.story_dir)
    story = json.loads((sd / "story.json").read_text(encoding="utf-8"))
    w, s, e, n = story["aoi"]["bbox"]

    events = []
    main_ev = None
    for eid in (OTHER, MAIN):
        ev = detail(eid)
        pr = ev["properties"]
        if eid == MAIN:
            main_ev = ev
        c = ev["geometry"]["coordinates"]
        events.append({
            "id": eid, "mag": pr["mag"], "title": pr["title"], "time": pr["time"], "lon": c[0], "lat": c[1],
            "url": pr["url"], "mechanism": mechanism(ev),
        })

    # PAGER
    pager = {}
    lp = main_ev["properties"]["products"].get("losspager")
    if lp:
        cont = lp[0]["contents"]
        al = get(cont["json/alerts.json"]["url"])
        ex = get(cont["json/exposures.json"]["url"])["population_exposure"]
        mmi, agg = ex["mmi"], ex["aggregated_exposure"]
        pager = {
            "fatalityLevel": al.get("fatality", {}).get("level"),
            "economicLevel": al.get("economic", {}).get("level"),
            "exposureByMmi": {str(m): int(v) for m, v in zip(mmi, agg)},
            "exposedMmi7plus": int(sum(v for m, v in zip(mmi, agg) if m >= 7)),
            "maxMmi": main_ev["properties"].get("mmi"),
            "felt": main_ev["properties"].get("felt"),
        }
        cities = get(cont["json/cities.json"]["url"])["all_cities"]
        cities = [c for c in cities if w - 0.6 <= c["lon"] <= e + 0.6 and s - 0.6 <= c["lat"] <= n + 0.6]
        cities = sorted(cities, key=lambda c: -c["pop"])[:30]
        cities = [{"name": c["name"], "lon": round(c["lon"], 4), "lat": round(c["lat"], 4),
                   "pop": int(c["pop"]), "mmi": round(c["mmi"], 2)} for c in cities]
    else:
        cities = []

    # ShakeMap contours
    shaking = None
    u = content(main_ev, "shakemap", "download/cont_mmi.json")
    if u:
        g = get(u)
        for f in g["features"]:
            f["geometry"]["coordinates"] = rnd(f["geometry"]["coordinates"], 3)
        shaking = g

    # Finite-fault slip patches and predicted displacement
    fault = None
    u = content(main_ev, "finite-fault", "FFM.geojson")
    if u:
        g = get(u)
        for f in g["features"]:
            f["geometry"]["coordinates"] = rnd(f["geometry"]["coordinates"], 4)
            f["properties"] = {"slip": round(float(f["properties"].get("slip", 0)), 3),
                               "rake": round(float(f["properties"].get("rake", 0)), 1)}
        fault = g

    model = None
    u = content(main_ev, "finite-fault", "surface_deformation.disp")
    if u:
        rows = [[float(x) for x in l.split()] for l in get(u, raw=True).decode().splitlines()[1:] if l.strip()]
        arr = np.array(rows)
        arr[:, 0] = np.where(arr[:, 0] > 180, arr[:, 0] - 360, arr[:, 0])
        lons, lats = np.unique(np.round(arr[:, 0], 4)), np.unique(np.round(arr[:, 1], 4))
        li = np.where((lons >= w - 0.5) & (lons <= e + 0.5))[0]
        ai = np.where((lats >= s - 0.5) & (lats <= n + 0.5))[0]
        lons, lats = lons[li], lats[ai]
        grid = {k: np.full((len(lats), len(lons)), np.nan) for k in ("ue", "un", "uz")}
        for lon, lat, _, ue, un, uz in arr:
            i = np.searchsorted(lons, round(lon, 4))
            j = np.searchsorted(lats, round(lat, 4))
            if i < len(lons) and j < len(lats) and abs(lons[i] - round(lon, 4)) < 1e-3 and abs(lats[j] - round(lat, 4)) < 1e-3:
                grid["ue"][j, i], grid["un"][j, i], grid["uz"][j, i] = ue, un, uz
        model = {"lons": [float(x) for x in lons], "lats": [float(x) for x in lats],
                 **{k: [[None if np.isnan(v) else round(float(v), 4) for v in row] for row in grid[k]] for k in grid},
                 "note": "USGS finite-fault model of the M7.5 only; coarse (about 20 km) grid; meters, east/north/up."}

    out = {
        "source": "USGS ComCat, PAGER, ShakeMap and finite-fault products (public)",
        "fetchedAtUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "mainEventId": MAIN, "events": events, "pager": pager, "cities": cities,
        "shakingContours": shaking, "fault": fault, "model": model,
    }
    (sd / "usgs-context.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    size = (sd / "usgs-context.json").stat().st_size
    print(f"wrote usgs-context.json ({size / 1024:.0f} KB): {len(events)} events, {len(cities)} cities, "
          f"{len(fault['features']) if fault else 0} fault patches, model grid "
          f"{len(model['lons']) if model else 0}x{len(model['lats']) if model else 0}")
    for ev in events:
        m = ev["mechanism"]
        if m:
            print(f"  M{ev['mag']}: " + " | ".join(f"strike {p['strike']:.0f} dip {p['dip']:.0f} rake {p['rake']:.0f} = {p['kind']}" for p in m["planes"]))
    print("  PAGER:", {k: pager.get(k) for k in ("fatalityLevel", "economicLevel", "exposedMmi7plus", "felt")})


if __name__ == "__main__":
    main()
