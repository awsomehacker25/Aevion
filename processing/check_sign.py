"""Find out what the sign of NISAR's unwrapped phase means, from the product's own metadata.

Aevion assumes positive unwrapped phase = the ground moved AWAY from the satellite (range increase). The GUNW file's own
description of the layer should say so. This opens ONE granule over the network (nothing big is downloaded: only the
layer descriptions and a few small attributes are read) and prints every description that mentions phase, sign,
interferogram or line of sight, so the convention can be read directly from NASA's wording.

Setup:   pip install earthaccess h5py
Run:     python processing/check_sign.py
         python processing/check_sign.py --download     # also saves the whole file under data/raw (about 2.2 GB)

It asks for your Earthdata login in the terminal. Credentials are never stored.
"""
import argparse
import re
from pathlib import Path

import earthaccess
import h5py

DEFAULT = "NISAR_L2_PR_GUNW_003_113_D_079_004_4000_SH_20251025T011329_20251025T011404_20251106T011330_20251106T011404_X05009_N_F_J_001"
SHORT = "NISAR_L2_GUNW_BETA_V1"
KEYS = re.compile(r"phase|sign|interferogram|line.of.sight|los|range|conj|reference|secondary", re.I)


def text(v):
    if isinstance(v, bytes):
        return v.decode("utf-8", "replace")
    if hasattr(v, "tolist"):
        v = v.tolist()
    if isinstance(v, list) and v and isinstance(v[0], bytes):
        return " ".join(x.decode("utf-8", "replace") for x in v)
    return str(v)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--granule", default=DEFAULT)
    ap.add_argument("--short-name", default=SHORT)
    ap.add_argument("--download", action="store_true")
    ap.add_argument("--out", default="data/raw")
    a = ap.parse_args()

    earthaccess.login(strategy="interactive")
    res = earthaccess.search_data(short_name=a.short_name, readable_granule_name=a.granule)
    if not res:
        raise SystemExit("granule not found")
    if a.download:
        Path(a.out).mkdir(parents=True, exist_ok=True)
        print("saved:", earthaccess.download(res[:1], a.out))
    f = earthaccess.open(res[:1])[0]
    with h5py.File(f, "r") as h:
        print("\n== layer descriptions that mention phase, sign or geometry ==")
        seen = set()

        def visit(path, obj):
            for k, v in obj.attrs.items():
                s = text(v)
                if k.lower() in ("description", "long_name", "units", "note") and KEYS.search(s) and (path, s) not in seen:
                    seen.add((path, s))
                    print(f"{path}  [{k}]\n    {s[:400]}")

        h.visititems(visit)
        print("\n== other things worth a look ==")
        for name in ("radarBand", "lookDirection", "orbitPassDirection", "centerFrequency", "referenceTime", "secondaryTime"):
            h.visititems(lambda p, o, name=name: print(f"{p} = {text(o[()])[:120]}") if p.endswith(name) and isinstance(o, h5py.Dataset) else None)
    print("\nRead the unwrappedPhase description above. If it says phase increases with range (or distance), positive means away.")
    print("If it says positive means motion toward the sensor (or uplift), Aevion's sign is reversed.")


if __name__ == "__main__":
    main()
