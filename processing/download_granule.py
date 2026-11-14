"""Download the flagship NISAR GUNW granule for a story.   *** UNTESTED ***

NISAR files (including browse images) sit behind NASA Earthdata Login. This script never
stores or asks for your password in code. It uses the `earthaccess` library, which can:

  * prompt you interactively (default), or
  * read a ~/.netrc file you created, or
  * read EARTHDATA_USERNAME / EARTHDATA_PASSWORD from your own environment.

Create the free account yourself at https://urs.earthdata.nasa.gov/ . Never commit credentials.

Usage:
  pip install earthaccess
  python processing/download_granule.py apps/web/public/stories/venezuela-2026 --out data/raw

Then convert it:
  python processing/gunw_to_grid.py data/raw/<granule>.h5 apps/web/public/stories/venezuela-2026 \
      --bbox -69.4 9.6 -66.4 11.3
"""
import argparse
import json
from pathlib import Path

import earthaccess


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("story_dir")
    ap.add_argument("--out", default="data/raw")
    ap.add_argument("--strategy", default="interactive", choices=["interactive", "netrc", "environment"])
    ap.add_argument("--show-password", action="store_true", help="type the password visibly (screen is cleared after)")
    a = ap.parse_args()

    story = json.loads((Path(a.story_dir) / "story.json").read_text(encoding="utf-8"))
    acq = json.loads((Path(a.story_dir) / story["acquisitions"]).read_text(encoding="utf-8"))
    f = story["flagshipPair"]
    match = [p for p in acq["pairs"]
             if p["track"] == f["track"] and p["orbitDirection"] == f["orbitDirection"]
             and p["reference"].startswith(f["reference"]) and p["secondary"].startswith(f["secondary"])]
    if not match:
        raise SystemExit("flagshipPair not found in acquisitions.json; re-run search_nisar.py")
    granule = match[0]["granuleId"]
    print("granule:", granule)

    if a.show_password:
        # Visible typing, for terminals where hidden input is awkward. The screen and scrollback
        # are cleared right after, so the password is not left on screen.
        import os
        os.environ["EARTHDATA_USERNAME"] = input("Earthdata username: ").strip()
        os.environ["EARTHDATA_PASSWORD"] = input("Earthdata password (visible): ").strip()
        print("\033[2J\033[3J\033[H", end="", flush=True)
        print("credentials received, screen cleared")
        print("logging in to Earthdata...", flush=True)
        earthaccess.login(strategy="environment")
    else:
        earthaccess.login(strategy=a.strategy)
    auth = earthaccess.__auth__
    print("logged in:", bool(getattr(auth, "authenticated", False)), flush=True)
    print("searching for the granule...", flush=True)
    results = []
    try:  # CMR matches this against the producer granule id / granule UR
        results = earthaccess.search_data(short_name=acq["shortName"], readable_granule_name=granule)
    except Exception as e:  # noqa: BLE001
        print("name search failed, falling back to area + date search:", e)
    if not results:  # fallback: search the story area and reference date, then filter by id
        day = f["reference"]
        hits = earthaccess.search_data(short_name=acq["shortName"], bounding_box=tuple(acq["bbox"]),
                                       temporal=(day + "T00:00:00Z", day + "T23:59:59Z"))
        results = [g for g in hits if granule in str(g)]
        print(f"fallback: {len(hits)} granules that day, {len(results)} match the id")
    if not results:
        raise SystemExit("no granule found for that id (check short name / maturity)")
    print(f"found {len(results)} granule(s); downloading (the file can be large)...", flush=True)
    Path(a.out).mkdir(parents=True, exist_ok=True)
    links = results[0].data_links(access="external")
    if not links:
        raise SystemExit("granule has no downloadable https link")
    # Prefer the .h5 data file over any browse/metadata links
    url = next((l for l in links if l.lower().endswith((".h5", ".he5"))), links[0])
    path = stream_download(url, Path(a.out))
    print("downloaded:", path)


def stream_download(url, out_dir):
    """Download with a byte-level progress bar (speed + ETA). Resumes a partial .part file."""
    import requests

    try:
        from tqdm import tqdm
    except ImportError:
        tqdm = None
        print("(install tqdm for a nicer bar: pip install tqdm)")

    session = earthaccess.get_requests_https_session()
    dest = out_dir / url.split("/")[-1].split("?")[0]
    if dest.exists():
        print("already downloaded:", dest)
        return dest
    part = dest.with_name(dest.name + ".part")
    have = part.stat().st_size if part.exists() else 0
    headers = {"Range": f"bytes={have}-"} if have else {}

    with session.get(url, stream=True, headers=headers, timeout=60) as r:
        if r.status_code == 416:  # partial file is already complete
            part.rename(dest)
            return dest
        r.raise_for_status()
        if have and r.status_code != 206:  # server ignored Range; start over
            have = 0
        total = int(r.headers.get("Content-Length", 0)) + have
        mode = "ab" if have else "wb"
        bar = (tqdm(total=total or None, initial=have, unit="B", unit_scale=True,
                    unit_divisor=1024, desc=dest.name[:40], mininterval=0.5)
               if tqdm else None)
        done = have
        try:
            with open(part, mode) as f:
                for chunk in r.iter_content(chunk_size=1024 * 1024):
                    f.write(chunk)
                    done += len(chunk)
                    if bar:
                        bar.update(len(chunk))
                    else:
                        pct = f" ({done / total:.0%})" if total else ""
                        print(f"\r{done / 1e6:,.0f} MB{pct}", end="", flush=True)
        finally:
            if bar:
                bar.close()
    if total and done < total:
        raise SystemExit(f"download incomplete ({done}/{total} bytes); re-run to resume")
    part.rename(dest)
    return dest


if __name__ == "__main__":
    main()
