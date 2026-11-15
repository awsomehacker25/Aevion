"""Step 2: stream just the study box out of each GCOV file.

GCOV files are ~7 GB each, so instead of downloading them we read only the
HDF5 chunks that cover BBOX over HTTP range requests, average to 40 m, and
save a small 2-band GeoTIFF (HH, HV linear gamma0) per date.

    export EARTHDATA_TOKEN=...   # from urs.earthdata.nasa.gov
    python pipeline/fetch_gcov.py            # all DATES in config.py
    python pipeline/fetch_gcov.py 2026-07-22 # one date
"""
import sys
import time

import fsspec
import h5py
import numpy as np
import rasterio
import requests
from rasterio.transform import from_origin
from rasterio.warp import transform_bounds

from config import BBOX, CROP_DIR, DATES, DOWNSAMPLE, FRAME, TRACK, earthdata_token
from search_nisar import pick, search

GRID = "science/LSAR/GCOV/grids/frequencyA"


def signed_url(url, token):
    r = requests.get(url, headers={"Authorization": f"Bearer {token}"},
                     allow_redirects=False, stream=True, timeout=60)
    r.close()
    if r.status_code in (301, 302, 303, 307):
        return r.headers["location"]
    r.raise_for_status()
    return url


def block_mean(a, k):
    h, w = (a.shape[0] // k) * k, (a.shape[1] // k) * k
    a = a[:h, :w].reshape(h // k, k, w // k, k)
    with np.errstate(invalid="ignore"):
        return np.nanmean(a, axis=(1, 3)).astype("float32")


def crop(url, out_path, token):
    fs = fsspec.filesystem("http", client_kwargs={"trust_env": True})
    with fs.open(signed_url(url, token), block_size=8 * 2**20) as fobj, h5py.File(fobj, "r") as f:
        g = f[GRID]
        x = g["xCoordinates"][()]
        y = g["yCoordinates"][()]
        epsg = int(g["projection"][()])
        x0, y0, x1, y1 = transform_bounds("EPSG:4326", f"EPSG:{epsg}", *BBOX, densify_pts=21)
        c0, c1 = np.searchsorted(x, x0), np.searchsorted(x, x1)
        r0, r1 = np.searchsorted(-y, -y1), np.searchsorted(-y, -y0)  # y descends
        bands = []
        for name in ("HHHH", "HVHV"):
            t = time.time()
            a = g[name][r0:r1, c0:c1].astype("float32")
            a[(a <= 0) | ~np.isfinite(a)] = np.nan
            bands.append(block_mean(a, DOWNSAMPLE))
            print(f"  {name} {a.shape} in {time.time() - t:.0f}s", flush=True)
        dx, dy = x[1] - x[0], y[1] - y[0]
        transform = from_origin(x[c0] - dx / 2, y[r0] - dy / 2, dx * DOWNSAMPLE, -dy * DOWNSAMPLE)
    profile = dict(driver="GTiff", dtype="float32", count=2, width=bands[0].shape[1],
                   height=bands[0].shape[0], crs=f"EPSG:{epsg}", transform=transform,
                   nodata=np.nan, compress="deflate", predictor=3, tiled=True)
    with rasterio.open(out_path, "w", **profile) as dst:
        dst.write(np.stack(bands))
        dst.set_band_description(1, "HH")
        dst.set_band_description(2, "HV")


def main():
    token = earthdata_token()
    dates = sys.argv[1:] or list(DATES)
    rows = search()
    CROP_DIR.mkdir(parents=True, exist_ok=True)
    for d in dates:
        out = CROP_DIR / f"{d}.tif"
        if out.exists():
            print(d, "already cropped")
            continue
        g = pick(rows, TRACK, FRAME, d)
        if not g:
            print(d, "no granule on this track/frame, skipping")
            continue
        print(d, g["Granule Name"], flush=True)
        crop(g["URL"], out, token)


if __name__ == "__main__":
    main()
