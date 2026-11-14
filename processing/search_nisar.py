"""Search NASA CMR for NISAR interferogram granules over an area and time window.

No login needed (CMR search is public). Writes acquisitions.json in the format the
web app reads, so the timeline's coverage rail shows REAL NISAR acquisition dates.

Usage:
  python processing/search_nisar.py \
      --short-name NISAR_L2_GUNW_PROVISIONAL_V1 \
      --bbox -69.4 9.6 -66.4 11.3 --start 2026-06-01 --end 2026-07-14 \
      --out apps/web/public/stories/venezuela-2026/acquisitions.json

When validated products are released, re-run with --short-name NISAR_L2_GUNW_V1.
"""
import argparse
import json
import re
import urllib.parse
import urllib.request

CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"
# NISAR_L2_<PR|...>_GUNW_<cycle>_<track>_<A|D>_<frame>_<cycle2>_<mode>_<pol>_<refStart>_<refEnd>_<secStart>_<secEnd>_...
TITLE = re.compile(
    r"GUNW_(?P<cyc>\d+)_(?P<track>\d+)_(?P<dir>[AD])_(?P<frame>\d+)_\d+_\d+_\w+_"
    r"(?P<r0>\d{8}T\d{6})_\d{8}T\d{6}_(?P<s0>\d{8}T\d{6})_"
)


def iso(s: str) -> str:
    return f"{s[0:4]}-{s[4:6]}-{s[6:8]}T{s[9:11]}:{s[11:13]}:{s[13:15]}Z"


def fetch(short_name, bbox, start, end):
    out, page = [], 1
    while True:
        q = urllib.parse.urlencode({
            "short_name": short_name,
            "bounding_box": ",".join(map(str, bbox)),
            "temporal": f"{start}T00:00:00Z,{end}T00:00:00Z",
            "page_size": 200, "page_num": page, "sort_key": "start_date",
        })
        with urllib.request.urlopen(f"{CMR}?{q}", timeout=60) as r:
            entries = json.load(r)["feed"]["entry"]
        out += entries
        if len(entries) < 200:
            return out
        page += 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--short-name", required=True)
    ap.add_argument("--bbox", nargs=4, type=float, required=True, metavar=("W", "S", "E", "N"))
    ap.add_argument("--start", required=True)
    ap.add_argument("--end", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    pairs, seen = [], set()
    for e in fetch(a.short_name, a.bbox, a.start, a.end):
        m = TITLE.search(e["title"])
        if not m:
            continue
        key = (m["track"], m["dir"], m["r0"][:8], m["s0"][:8])
        if key in seen:  # frames of the same pair: keep the first
            continue
        seen.add(key)
        pairs.append({
            "track": int(m["track"]), "orbitDirection": m["dir"],
            "reference": iso(m["r0"]), "secondary": iso(m["s0"]),
            "granuleId": e["title"],
        })
    res = {"source": "NASA CMR", "shortName": a.short_name, "bbox": a.bbox,
           "window": [a.start, a.end], "pairs": pairs}
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(res, f, indent=1)
    print(f"{len(pairs)} unique pairs -> {a.out}")


if __name__ == "__main__":
    main()
