"""Step 1: list NISAR GCOV acquisitions over the study box (the go/no-go check).

    python pipeline/search_nisar.py

No login needed for searching. Prints each track/frame with its dates.
"""
import csv
import io
from collections import defaultdict

import requests

from config import BBOX, SEARCH_START

API = "https://api.daac.asf.alaska.edu/services/search/param"


def bbox_wkt(b):
    x0, y0, x1, y1 = b
    return f"POLYGON(({x0} {y0},{x1} {y0},{x1} {y1},{x0} {y1},{x0} {y0}))"


def search(start=SEARCH_START):
    r = requests.get(API, params={
        "dataset": "NISAR", "processingLevel": "GCOV",
        "intersectsWith": bbox_wkt(BBOX), "start": f"{start}T00:00:00Z",
        "output": "csv", "maxResults": 1000}, timeout=120)
    r.raise_for_status()
    return list(csv.DictReader(io.StringIO(r.text)))


def pick(rows, track, frame, date):
    """Latest-processed granule for a track/frame/date."""
    cands = [r for r in rows if int(r["Path Number"]) == track and int(r["Frame Number"]) == frame
             and r["Start Time"].startswith(date)]
    return max(cands, key=lambda r: r["Processing Date"]) if cands else None


def main():
    rows = search()
    print(f"{len(rows)} GCOV products found")
    groups = defaultdict(set)
    for r in rows:
        groups[(r["Path Number"], r["Frame Number"], r["Ascending or Descending?"])].add(r["Start Time"][:10])
    for (t, f, d), dates in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        print(f"track {t} frame {f} {d}: {len(dates)} dates -> {', '.join(sorted(dates))}")
    print("\nGo/no-go: need >=1 pre-flood date and >=3 later dates on ONE track+frame.")


if __name__ == "__main__":
    main()
