"""Read the flagship GUNW straight from NASA and write Aevion grids, without saving the 2 GB file.   *** UNTESTED ***

Uses earthaccess.open (authenticated HTTPS range reads) and h5py to fetch only the three layers
Aevion needs (unwrapped phase, coherence, connected components), decimated on the way in.
How much data actually transfers depends on how the HDF5 file is chunked, so it may still be
several hundred MB, but it avoids the full 2.2 GB and never stores the raw file.

It also writes the file's layer tree (names, shapes, chunks) to data/raw/gunw_tree.txt, so the
dataset paths can be checked and fixed on the first real run.

Usage (same login options as download_granule.py):
  python processing/stream_gunw_to_grid.py apps/web/public/stories/venezuela-2026 --show-password

Credentials: never commit them. See docs/data-sources.md.
"""
import argparse
import json
import math
import os
from pathlib import Path

import earthaccess
import h5py
import numpy as np

from gunw_to_grid import LAMBDA, grid_json, resample  # same folder


def find(h, name_end, must=()):
    """First dataset whose path ends with name_end and contains every string in `must`."""
    hits = []
    h.visititems(lambda p, o: hits.append(p) if isinstance(o, h5py.Dataset) and p.endswith(name_end)
                 and all(m in p for m in must) else None)
    return hits[0] if hits else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("story_dir")
    ap.add_argument("--pol", default="HH")
    ap.add_argument("--width", type=int, default=280)
    ap.add_argument("--height", type=int, default=160)
    ap.add_argument("--show-password", action="store_true")
    a = ap.parse_args()

    sd = Path(a.story_dir)
    story = json.loads((sd / "story.json").read_text(encoding="utf-8"))
    acq = json.loads((sd / story["acquisitions"]).read_text(encoding="utf-8"))
    f = story["flagshipPair"]
    granule = next(p["granuleId"] for p in acq["pairs"]
                   if p["track"] == f["track"] and p["orbitDirection"] == f["orbitDirection"]
                   and p["reference"].startswith(f["reference"]) and p["secondary"].startswith(f["secondary"]))
    bbox = story["aoi"]["bbox"]

    if a.show_password:
        os.environ["EARTHDATA_USERNAME"] = input("Earthdata username: ").strip()
        os.environ["EARTHDATA_PASSWORD"] = input("Earthdata password (visible): ").strip()
        print("\033[2J\033[3J\033[H", end="", flush=True)
        print("credentials received, screen cleared", flush=True)
        earthaccess.login(strategy="environment")
    else:
        earthaccess.login()
    print("logged in:", bool(earthaccess.__auth__.authenticated), flush=True)

    res = earthaccess.search_data(short_name=acq["shortName"], readable_granule_name=granule)
    if not res:
        raise SystemExit("granule not found")
    print("opening remote file (no full download)...", flush=True)
    fobj = earthaccess.open(res[:1])[0]

    with h5py.File(fobj, "r") as h:
        lines = []
        h.visititems(lambda p, o: lines.append(
            f"{p}  shape={o.shape} dtype={o.dtype} chunks={o.chunks} comp={o.compression}")
            if isinstance(o, h5py.Dataset) else None)
        Path("data/raw").mkdir(parents=True, exist_ok=True)
        Path("data/raw/gunw_tree.txt").write_text("\n".join(lines), encoding="utf-8")
        print(f"saved layer tree ({len(lines)} datasets) to data/raw/gunw_tree.txt", flush=True)

        pol = [a.pol]
        p_phase = find(h, "unwrappedPhase", pol)
        p_coh = find(h, "coherenceMagnitude", pol)
        p_cc = find(h, "connectedComponents", pol)
        base = p_phase.rsplit("/", 2)[0] if p_phase else ""
        p_x = find(h, "xCoordinates", ["unwrappedInterferogram"]) or find(h, "xCoordinates")
        p_y = find(h, "yCoordinates", ["unwrappedInterferogram"]) or find(h, "yCoordinates")
        p_prj = find(h, "projection", ["unwrappedInterferogram"]) or find(h, "projection")
        print("paths:", dict(phase=p_phase, coh=p_coh, cc=p_cc, x=p_x, y=p_y, proj=p_prj), flush=True)
        if not all([p_phase, p_coh, p_cc, p_x, p_y, p_prj]):
            raise SystemExit("some layers were not found; open data/raw/gunw_tree.txt and fix the names in this script")

        xs_full, ys_full = h[p_x][:], h[p_y][:]
        epsg = int(np.array(h[p_prj][()]).item())
        sy = max(1, len(ys_full) // (a.height * 2))
        sx = max(1, len(xs_full) // (a.width * 2))
        print(f"reading every {sx}th column and {sy}th row of {len(xs_full)} x {len(ys_full)}", flush=True)
        xs, ys = xs_full[::sx], ys_full[::sy]
        phase = h[p_phase][::sy, ::sx].astype("float64")
        coh = h[p_coh][::sy, ::sx].astype("float64")
        cc = h[p_cc][::sy, ::sx]

    invalid = (cc == 0) | ~np.isfinite(phase)
    disp = phase * LAMBDA / (4 * math.pi)  # meters along the line of sight
    good = (~invalid) & (coh > 0.8)
    if good.any():  # placeholder reference choice: remove the median of high-coherence cells
        disp = disp - np.median(disp[good])
    d = resample(disp, xs, ys, epsg, bbox, a.width, a.height, invalid)
    c = resample(coh, xs, ys, epsg, bbox, a.width, a.height, invalid)
    print("displacement range (m):", np.nanmin(d), np.nanmax(d), "| valid cells:", int(np.isfinite(d).sum()), flush=True)

    (sd / "deformation.grid.json").write_text(json.dumps(grid_json(d, "m", "los_displacement", bbox)), encoding="utf-8")
    (sd / "coherence.grid.json").write_text(json.dumps(grid_json(c, "1", "coherence", bbox)), encoding="utf-8")
    print("wrote grids. Next: edit story.json (synthetic=false, provenance, dataStatus).")


if __name__ == "__main__":
    main()
