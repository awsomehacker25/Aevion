"""Collect NISAR radar brightness (HH and HV) over a story's map box, for the dates of its flagship pair.   *** UNTESTED on real files ***

Interferograms (GUNW) only contain HH, so the polarization comparison comes from NISAR's backscatter product,
GCOV (geocoded polarimetric covariance), which has both HH and HV when the satellite ran in dual-pol mode.

For each date this reads ONLY the map box of the HHHH and HVHV power layers (streamed from NASA, the 2.7 GB file is
never saved), averages them down to the story's grid size in linear power, converts to dB, and saves a small .npz
under data/stacks/<story-id>/. It is safe to stop and re-run: finished dates are skipped.

Setup (once):
  pip install earthaccess h5py numpy pyproj tqdm

Look before you download (no login, nothing downloaded):
  python processing/prep_story_backscatter.py apps/web/public/stories/kilauea-hawaii --dry-run

Fetch (asks for your Earthdata username and password in the terminal; never store them):
  python processing/prep_story_backscatter.py apps/web/public/stories/kilauea-hawaii

Options:
  --dates 2026-08-18 2026-08-30 2026-09-11    which acquisition dates (default: the flagship pair's two dates)
  --short-name NISAR_L2_GCOV_PROVISIONAL_V1   product (default); use NISAR_L2_GCOV_V1 once validated data exists

The layer tree of the first file is written to data/gcov_tree.txt so layer names can be checked and fixed.
Credentials: never put them in a file or commit them.
"""
import argparse
import json
import re
import sys
import time
from pathlib import Path

import numpy as np

PROCESSING = Path(__file__).resolve().parent
sys.path.insert(0, str(PROCESSING))

TITLE = re.compile(r"GCOV_(?P<cyc>\d+)_(?P<track>\d+)_(?P<dir>[AD])_(?P<frame>\d+)_\w+?_(?P<mode>[A-Z]+)_[A-Z]_(?P<t0>\d{8})T(?P<t1>\d{6})")


def out_name(track, orbit, date):
    return f"gcov_t{int(track):03d}{orbit}_{date}.npz"


def list_datasets(h):
    import h5py
    found = []
    h.visititems(lambda p, o: found.append((p, o.shape, o.chunks)) if isinstance(o, h5py.Dataset) else None)
    return found


def pick(found, name_end, must=()):
    for path, _, _ in found:
        if path.endswith(name_end) and all(m in path for m in must):
            return path
    return None


def extract(fobj, bbox, w, h_px, tree_out=None):
    """Read HHHH and HVHV inside bbox, block-average to about (w, h_px), return (hh_db, hv_db) on the lon/lat grid."""
    import h5py
    from pyproj import Transformer
    from gunw_to_grid import resample  # same folder

    with h5py.File(fobj, "r") as h:
        found = list_datasets(h)
        if tree_out and not tree_out.exists():
            tree_out.parent.mkdir(parents=True, exist_ok=True)
            tree_out.write_text("\n".join(f"{p} shape={s} chunks={c}" for p, s, c in found), encoding="utf-8")
        paths = dict(
            hh=pick(found, "HHHH"), hv=pick(found, "HVHV"),
            x=pick(found, "xCoordinates", ["GCOV"]) or pick(found, "xCoordinates"),
            y=pick(found, "yCoordinates", ["GCOV"]) or pick(found, "yCoordinates"),
            prj=pick(found, "projection", ["GCOV"]) or pick(found, "projection"),
        )
        missing = [k for k, v in paths.items() if not v]
        if missing:
            raise RuntimeError(f"layers not found: {missing}. See data/gcov_tree.txt and fix the names in pick().")
        xs, ys = h[paths["x"]][:], h[paths["y"]][:]
        epsg = int(np.array(h[paths["prj"]][()]).item())

        to_proj = Transformer.from_crs(4326, epsg, always_xy=True)
        cx, cy = to_proj.transform([bbox[0], bbox[2], bbox[0], bbox[2]], [bbox[1], bbox[1], bbox[3], bbox[3]])
        mx, my = 0.02 * (max(cx) - min(cx)), 0.02 * (max(cy) - min(cy))
        xi = np.where((xs >= min(cx) - mx) & (xs <= max(cx) + mx))[0]
        yi = np.where((ys >= min(cy) - my) & (ys <= max(cy) + my))[0]
        if len(xi) < 2 or len(yi) < 2:
            raise RuntimeError("the map box is outside this granule")
        x0, x1, y0, y1 = xi[0], xi[-1] + 1, yi[0], yi[-1] + 1
        sl = (slice(y0, y1), slice(x0, x1))
        hh = h[paths["hh"]][sl].astype("float32")
        hv = h[paths["hv"]][sl].astype("float32")

    # block-average the linear power down to about twice the output grid, then resample to lon/lat
    fx = max(1, (x1 - x0) // (w * 2))
    fy = max(1, (y1 - y0) // (h_px * 2))
    ny, nx = (hh.shape[0] // fy) * fy, (hh.shape[1] // fx) * fx

    def block_mean(a):
        a = a[:ny, :nx].astype("float64")
        a = np.where(np.isfinite(a) & (a > 0), a, np.nan)
        return np.nanmean(a.reshape(ny // fy, fy, nx // fx, fx), axis=(1, 3))

    with np.errstate(all="ignore"):
        hh_b, hv_b = block_mean(hh), block_mean(hv)
    xs_b = xs[x0:x0 + nx].reshape(-1, fx).mean(1)
    ys_b = ys[y0:y0 + ny].reshape(-1, fy).mean(1)
    bad_hh, bad_hv = ~np.isfinite(hh_b), ~np.isfinite(hv_b)
    with np.errstate(all="ignore"):
        hh_db = 10 * np.log10(hh_b)
        hv_db = 10 * np.log10(hv_b)
    return (resample(np.nan_to_num(hh_db), xs_b, ys_b, epsg, bbox, w, h_px, bad_hh).astype("float32"),
            resample(np.nan_to_num(hv_db), xs_b, ys_b, epsg, bbox, w, h_px, bad_hv).astype("float32"))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("story_dir")
    ap.add_argument("--dates", nargs="+")
    ap.add_argument("--short-name", default="NISAR_L2_GCOV_PROVISIONAL_V1")
    ap.add_argument("--out", default="data/stacks")
    ap.add_argument("--strategy", default="interactive", choices=["interactive", "netrc", "environment"])
    ap.add_argument("--dry-run", action="store_true", help="list what would be fetched; no login, no download")
    a = ap.parse_args()

    sd = Path(a.story_dir)
    story = json.loads((sd / "story.json").read_text(encoding="utf-8"))
    f = story["flagshipPair"]
    dates = a.dates or [f["reference"], f["secondary"]]
    bbox = story["aoi"]["bbox"]
    g = json.loads((sd / story["layers"][0]["grid"]).read_text(encoding="utf-8"))
    w, h_px = g["width"], g["height"]
    out_dir = Path(a.out) / story["id"]

    # find the granules (public search, no login)
    import urllib.parse
    import urllib.request
    q = urllib.parse.urlencode({
        "short_name": a.short_name, "bounding_box": ",".join(map(str, bbox)),
        "temporal": f"{min(dates)}T00:00:00Z,{max(dates)}T23:59:59Z", "page_size": 200, "sort_key": "start_date",
    })
    entries = json.load(urllib.request.urlopen(f"https://cmr.earthdata.nasa.gov/search/granules.json?{q}", timeout=60))["feed"]["entry"]
    wanted = []
    for e in entries:
        m = TITLE.search(e["title"])
        if not m or int(m["track"]) != f["track"] or m["dir"] != f["orbitDirection"]:
            continue
        d = f"{m['t0'][:4]}-{m['t0'][4:6]}-{m['t0'][6:8]}"
        if d in dates and not any(x["date"] == d for x in wanted):
            wanted.append(dict(date=d, title=e["title"], mode=m["mode"], size=float(e.get("granule_size", 0)), track=m["track"], orbit=m["dir"]))
    todo = [x for x in wanted if not (out_dir / out_name(x["track"], x["orbit"], x["date"])).exists()]

    print(f"story {story['id']}: {len(wanted)} GCOV granules found for track {f['track']}{f['orbitDirection']} on {', '.join(dates)}")
    for x in wanted:
        done = "done" if x not in todo else "to fetch"
        print(f"   {x['date']}  polarization mode {x['mode']}  {x['size'] / 1000:.1f} GB in full  [{done}]  {x['title'][:60]}")
    missing = [d for d in dates if d not in {x["date"] for x in wanted}]
    if missing:
        print("   not found in the catalog:", ", ".join(missing))
    if a.dry_run or not todo:
        return

    import earthaccess
    earthaccess.login(strategy=a.strategy)
    if not earthaccess.__auth__.authenticated:
        raise SystemExit("login failed")
    from prep_story_data import Counting
    out_dir.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    for x in todo:
        print(f"{x['date']}: opening remote file...", flush=True)
        res = earthaccess.search_data(short_name=a.short_name, readable_granule_name=x["title"])
        if not res:
            print("   granule not found in CMR, skipping")
            continue
        try:
            cf = Counting(earthaccess.open(res[:1])[0])
            hh, hv = extract(cf, bbox, w, h_px, tree_out=Path("data/gcov_tree.txt"))
        except Exception as e:  # noqa: BLE001
            print(f"   FAILED: {type(e).__name__}: {e}", flush=True)
            continue
        name = out_name(x["track"], x["orbit"], x["date"])
        tmp = out_dir / (name + ".tmp.npz")
        np.savez_compressed(tmp, hh_db=hh, hv_db=hv, bbox=np.array(bbox), date=x["date"], track=int(x["track"]), orbit=x["orbit"], granule=x["title"])
        tmp.replace(out_dir / name)
        print(f"   saved {name}: HH {np.nanmedian(hh):.1f} dB median, HV {np.nanmedian(hv):.1f} dB median, ~{cf.bytes / 1e6:.0f} MB read", flush=True)
    print(f"done in {(time.time() - t0) / 60:.1f} min")


if __name__ == "__main__":
    main()
