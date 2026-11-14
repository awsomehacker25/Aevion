"""Collect NISAR data for a story over its whole time span, as small per-pair grids.   *** UNTESTED ***

For every GUNW pair on the story's track (all dates in acquisitions.json), this reads ONLY the part
of each file inside the story's map box (unwrapped phase, coherence, connected components),
decimates it, and saves a small .npz (about 1 MB) under data/stacks/<story-id>/. The 2 GB files are
never kept: they are streamed from NASA, or if streaming fails, downloaded one at a time, read, and deleted.

There is no data limit: it fetches every selected pair. Pairs go in an order that spreads them evenly over
the whole span, so if you stop early you still have the full year covered. It never silently falls back to
full 2 GB downloads (see --allow-download).

It is safe to stop and re-run: finished pairs are skipped.

Setup (once):
  pip install earthaccess h5py numpy pyproj tqdm psutil

Look before you download (no login, nothing downloaded):
  python processing/prep_story_data.py apps/web/public/stories/kilauea-hawaii --dry-run

Fetch everything (asks for your Earthdata username and password in the terminal; never store them):
  python processing/prep_story_data.py apps/web/public/stories/kilauea-hawaii

Useful options:
  --tracks 72 151     use these tracks instead of the story's flagship track
  --start 2026-08-18 --end 2026-08-30     only pairs whose reference date is in this range
  --limit 1           stop after 1 pair (a quick test that also prints how much data one pair uses)
  --allow-download    if streaming a pair fails, download the whole file, read it and delete it (2+ GB each)

Credentials: never put them in a file or commit them. Login options: interactive prompt (default),
a ~/.netrc file you create, or EARTHDATA_USERNAME / EARTHDATA_PASSWORD in your own environment.
"""
import argparse
import json
import math
import shutil
import sys
import time
from pathlib import Path

import numpy as np

LAMBDA = 0.24196  # L-band wavelength in meters (center frequency 1.239 GHz, read from a real granule)
PROCESSING = Path(__file__).resolve().parent
sys.path.insert(0, str(PROCESSING))


def pick_pairs(story, acq, tracks, start, end):
    f = story["flagshipPair"]
    flagship_dir = f["orbitDirection"]
    tracks = tracks or [f["track"]]
    out = []
    for p in acq["pairs"]:
        if p["track"] not in tracks:
            continue
        if tracks == [f["track"]] and p["orbitDirection"] != flagship_dir:
            continue
        d = p["reference"][:10]
        if (start and d < start) or (end and d > end):
            continue
        out.append(p)
    return sorted(out, key=lambda p: (p["track"], p["reference"]))


def spread_order(n):
    """Indices 0..n-1 ordered so any prefix is spread evenly (bit-reversal order). Keeps short runs covering the whole span."""
    bits = max(1, (n - 1).bit_length())
    return sorted(range(n), key=lambda i: int(format(i, f"0{bits}b")[::-1], 2))


class Counting:
    """Wraps a remote file object and counts the bytes h5py reads (for the per-pair MB report)."""

    def __init__(self, f):
        self.f, self.bytes = f, 0

    def _add(self, n):
        self.bytes += n

    def read(self, n=-1):
        b = self.f.read(n)
        self._add(len(b))
        return b

    def readinto(self, buf):
        if hasattr(self.f, "readinto"):
            n = self.f.readinto(buf)
        else:
            b = self.f.read(len(buf))
            buf[: len(b)] = b
            n = len(b)
        self._add(n or 0)
        return n

    def seek(self, *a):
        return self.f.seek(*a)

    def tell(self):
        return self.f.tell()

    def __getattr__(self, name):
        return getattr(self.f, name)


def out_name(p):
    return f"t{p['track']:03d}{p['orbitDirection']}_{p['reference'][:10]}_{p['secondary'][:10]}.npz"


def find(h, name_end, must=()):
    import h5py
    hits = []
    h.visititems(lambda path, o: hits.append(path) if isinstance(o, h5py.Dataset) and path.endswith(name_end)
                 and all(m in path for m in must) else None)
    return hits[0] if hits else None


def extract(fobj, bbox, w, h_px, pol="HH"):
    """Read the area inside bbox from an open GUNW file (path or file-like) and resample to a lon/lat grid."""
    import h5py
    from pyproj import Transformer
    from gunw_to_grid import resample  # same folder

    with h5py.File(fobj, "r") as h:
        paths = dict(
            phase=find(h, "unwrappedPhase", [pol]), coh=find(h, "coherenceMagnitude", [pol]),
            cc=find(h, "connectedComponents", [pol]),
            x=find(h, "xCoordinates", ["unwrappedInterferogram"]) or find(h, "xCoordinates"),
            y=find(h, "yCoordinates", ["unwrappedInterferogram"]) or find(h, "yCoordinates"),
            prj=find(h, "projection", ["unwrappedInterferogram"]) or find(h, "projection"),
        )
        missing = [k for k, v in paths.items() if not v]
        if missing:
            tree = [pp for pp in _tree(h)]
            Path("data").mkdir(exist_ok=True)
            Path("data/gunw_tree.txt").write_text("\n".join(tree), encoding="utf-8")
            raise RuntimeError(f"layers not found: {missing}. Layer tree saved to data/gunw_tree.txt; fix the names in find().")
        xs, ys = h[paths["x"]][:], h[paths["y"]][:]
        epsg = int(np.array(h[paths["prj"]][()]).item())

        # only the rows and columns inside the map box (plus a margin), decimated to about 2x the output grid
        to_proj = Transformer.from_crs(4326, epsg, always_xy=True)
        cx, cy = to_proj.transform([bbox[0], bbox[2], bbox[0], bbox[2]], [bbox[1], bbox[1], bbox[3], bbox[3]])
        mx, my = 0.02 * (max(cx) - min(cx)), 0.02 * (max(cy) - min(cy))
        xi = np.where((xs >= min(cx) - mx) & (xs <= max(cx) + mx))[0]
        yi = np.where((ys >= min(cy) - my) & (ys <= max(cy) + my))[0]
        if len(xi) < 2 or len(yi) < 2:
            raise RuntimeError("the map box is outside this granule")
        x0, x1, y0, y1 = xi[0], xi[-1] + 1, yi[0], yi[-1] + 1
        sx = max(1, (x1 - x0) // (w * 2))
        sy = max(1, (y1 - y0) // (h_px * 2))
        sl = (slice(y0, y1, sy), slice(x0, x1, sx))
        xs_s, ys_s = xs[x0:x1:sx], ys[y0:y1:sy]
        phase = h[paths["phase"]][sl].astype("float64")
        coh = h[paths["coh"]][sl].astype("float64")
        cc = h[paths["cc"]][sl]

    invalid = (cc == 0) | ~np.isfinite(phase)
    disp = phase * LAMBDA / (4 * math.pi)  # meters along the line of sight
    good = (~invalid) & (coh > 0.8)
    if good.any():  # reference: remove the median of high-coherence cells (placeholder choice, revisit when stacking)
        disp = disp - np.median(disp[good])
    d = resample(disp, xs_s, ys_s, epsg, bbox, w, h_px, invalid)
    c = resample(coh, xs_s, ys_s, epsg, bbox, w, h_px, invalid)
    return d.astype("float32"), c.astype("float32")


def _tree(h):
    import h5py
    lines = []
    h.visititems(lambda p, o: lines.append(f"{p} shape={o.shape} chunks={o.chunks}") if isinstance(o, h5py.Dataset) else None)
    return lines


def fetch_one(earthaccess, short_name, granule, bbox, w, h_px, allow_download, scratch):
    """Returns (displacement, coherence, bytes_read_by_h5py)."""
    res = earthaccess.search_data(short_name=short_name, readable_granule_name=granule)
    if not res:
        raise RuntimeError("granule not found in CMR")
    try:
        cf = Counting(earthaccess.open(res[:1])[0])
        d, c = extract(cf, bbox, w, h_px)
        return d, c, cf.bytes
    except Exception as e:  # noqa: BLE001
        if not allow_download:
            raise RuntimeError(f"streaming failed ({type(e).__name__}: {e}). Not downloading the whole file; "
                               f"re-run with --allow-download to do that.") from e
        print(f"    streaming failed ({type(e).__name__}: {e}); downloading this one instead", flush=True)
    scratch.mkdir(parents=True, exist_ok=True)
    paths = earthaccess.download(res[:1], str(scratch))
    try:
        d, c = extract(paths[0], bbox, w, h_px)
        return d, c, Path(paths[0]).stat().st_size
    finally:
        shutil.rmtree(scratch, ignore_errors=True)  # never keep the 2 GB file


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("story_dir")
    ap.add_argument("--tracks", nargs="+", type=int)
    ap.add_argument("--start")
    ap.add_argument("--end")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--allow-download", action="store_true")
    ap.add_argument("--out", default="data/stacks")
    ap.add_argument("--strategy", default="interactive", choices=["interactive", "netrc", "environment"])
    ap.add_argument("--dry-run", action="store_true", help="list what would be fetched; no login, no download")
    a = ap.parse_args()

    sd = Path(a.story_dir)
    story = json.loads((sd / "story.json").read_text(encoding="utf-8"))
    acq = json.loads((sd / story["acquisitions"]).read_text(encoding="utf-8"))
    bbox = story["aoi"]["bbox"]
    if story.get("layers"):
        g = json.loads((sd / story["layers"][0]["grid"]).read_text(encoding="utf-8"))
        w, h_px = g["width"], g["height"]  # match the story's current grid size
    else:  # a story that is not built yet: the stub lists its grid size
        w, h_px = story["gridSize"]

    pairs = pick_pairs(story, acq, a.tracks, a.start, a.end)
    pairs = [pairs[i] for i in spread_order(len(pairs))]  # an even spread over the span, whatever the cutoff
    if a.limit:
        pairs = pairs[: a.limit]
    out_dir = Path(a.out) / story["id"]
    done = [p for p in pairs if (out_dir / out_name(p)).exists()]
    todo = [p for p in pairs if p not in done]

    print(f"story {story['id']}: {len(pairs)} pairs ({len(done)} already done, {len(todo)} to fetch)")
    print(f"  product {acq['shortName']}, map box {bbox}, output grid {w}x{h_px}")
    if pairs:
        print(f"  span {min(q['reference'] for q in pairs)[:10]} to {max(q['secondary'] for q in pairs)[:10]}, tracks {sorted({p['track'] for p in pairs})}")
        print("  Only the map box of each 2.2 GB file is read. The run prints the MB used per pair.")
    if a.dry_run:
        for p in sorted(todo, key=lambda p: p["reference"]):
            print("   ", out_name(p), p["granuleId"][:70])
        print("  (real runs go in an evenly spread order, not date order)")
        return
    if not todo:
        print("nothing to do.")
        return

    import earthaccess
    earthaccess.login(strategy=a.strategy)
    if not earthaccess.__auth__.authenticated:
        raise SystemExit("login failed")
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        from tqdm import tqdm
        it = tqdm(todo, unit="pair")
    except ImportError:
        it = todo

    try:
        import psutil

        def net():
            return psutil.net_io_counters().bytes_recv
    except ImportError:
        net = None
        print("(install psutil for a measure of real network use: pip install psutil)")
    spent = 0.0
    failures = []
    t0 = time.time()
    for i, p in enumerate(it, 1):
        name = out_name(p)
        if not hasattr(it, "set_description"):
            print(f"[{i}/{len(todo)}] {name}", flush=True)
        else:
            it.set_description(name)
        n0 = net() if net else 0
        try:
            d, c, nbytes = fetch_one(earthaccess, acq["shortName"], p["granuleId"], bbox, w, h_px, a.allow_download,
                                     out_dir / "_scratch")
        except Exception as e:  # noqa: BLE001
            print(f"    FAILED {name}: {type(e).__name__}: {e}", flush=True)
            failures.append(name)
            continue
        tmp = out_dir / (name + ".tmp.npz")
        np.savez_compressed(tmp, disp=d, coh=c, bbox=np.array(bbox), reference=p["reference"], secondary=p["secondary"],
                            track=p["track"], orbit=p["orbitDirection"], granule=p["granuleId"], lam=LAMBDA)
        tmp.replace(out_dir / name)
        valid = int(np.isfinite(d).sum())
        used_bytes = max(nbytes, (net() - n0) if net else 0)  # the larger of what h5py read and what the network received
        spent += used_bytes
        print(f"    saved {name}: {valid}/{d.size} valid cells, range {np.nanmin(d):+.3f}..{np.nanmax(d):+.3f} m, "
              f"~{used_bytes / 1e6:.0f} MB used (total {spent / 1e6:.0f} MB)", flush=True)

    manifest = sorted(x.name for x in out_dir.glob("*.npz"))
    (out_dir / "manifest.json").write_text(json.dumps({
        "story": story["id"], "product": acq["shortName"], "bbox": bbox, "grid": [w, h_px], "files": manifest,
    }, indent=1), encoding="utf-8")
    print(f"\ndone in {(time.time() - t0) / 60:.1f} min: {len(manifest)} files in {out_dir}, {len(failures)} failed, "
          f"about {spent / 1e9:.2f} GB used")
    if failures:
        print("re-run the same command to retry:", ", ".join(failures))


if __name__ == "__main__":
    main()
