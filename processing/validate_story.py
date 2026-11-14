"""Validate a story folder against docs/data-contract.md.

Usage: python processing/validate_story.py apps/web/public/stories/venezuela-2026
Exits non-zero if anything is wrong, so it can run in CI.
"""
import json
import sys
from pathlib import Path

errors, warnings = [], []


def err(m): errors.append(m)
def warn(m): warnings.append(m)


def main(folder: str):
    d = Path(folder)
    sp = d / "story.json"
    if not sp.exists():
        sys.exit(f"missing {sp}")
    s = json.loads(sp.read_text(encoding="utf-8"))

    for k in ("id", "title", "dataStatus", "aoi", "timeline", "flagshipPair", "layers"):  # "event" is optional
        if k not in s:
            err(f"story.json: missing '{k}'")
    if s.get("dataStatus") not in ("placeholder", "beta", "provisional", "validated"):
        err("story.json: dataStatus must be placeholder|beta|provisional|validated")

    roles = [l.get("role") for l in s.get("layers", [])]
    for r in ("displacement", "coherence"):
        if roles.count(r) != 1:
            err(f"story.json: need exactly one layer with role '{r}' (found {roles.count(r)})")

    shapes = {}
    any_synth = False
    for l in s.get("layers", []):
        any_synth |= bool(l.get("synthetic"))
        gp = d / l.get("grid", "")
        if not gp.exists():
            err(f"layer {l.get('id')}: grid file '{l.get('grid')}' not found")
            continue
        g = json.loads(gp.read_text(encoding="utf-8"))
        if g.get("format") != "aevion-grid-v1":
            err(f"{gp.name}: format must be 'aevion-grid-v1'")
        if g.get("rowOrder") != "north-up":
            err(f"{gp.name}: rowOrder must be 'north-up'")
        n = g.get("width", 0) * g.get("height", 0)
        if len(g.get("values", [])) != n:
            err(f"{gp.name}: values length {len(g.get('values', []))} != width*height {n}")
        b = g.get("bbox", [])
        if len(b) != 4 or not (b[0] < b[2] and b[1] < b[3]):
            err(f"{gp.name}: bbox must be [west, south, east, north]")
        shapes[l["id"]] = (g.get("width"), g.get("height"), tuple(b))
        vals = [v for v in g.get("values", []) if v is not None]
        if vals and l.get("role") == "coherence" and (min(vals) < 0 or max(vals) > 1):
            err(f"{gp.name}: coherence values must be within 0..1")
        if l.get("range") and vals and l.get("role") == "displacement":
            lim = max(abs(l["range"][0]), abs(l["range"][1]))
            if max(abs(min(vals)), abs(max(vals))) > 5 * lim:
                warn(f"{gp.name}: values far exceed layer range {l['range']}; check units (m vs cm vs rad)")
        prov = l.get("provenance", {})
        if not l.get("synthetic") and not prov.get("maturity"):
            err(f"layer {l.get('id')}: real data needs provenance.maturity")

    if len(set(shapes.values())) > 1:
        err(f"grids differ in shape or bbox: {shapes}")
    if s.get("dataStatus") == "placeholder" and not any_synth:
        warn("dataStatus is 'placeholder' but no layer is marked synthetic")
    if s.get("dataStatus") != "placeholder" and any_synth:
        err("a layer is still marked synthetic but dataStatus is not 'placeholder'")

    for k in ("acquisitions", "events"):
        if not (d / s.get(k, "")).exists():
            err(f"story.json: '{k}' file '{s.get(k)}' not found")

    for w in warnings:
        print("WARN ", w)
    for e in errors:
        print("ERROR", e)
    print("OK" if not errors else f"{len(errors)} error(s)")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main(sys.argv[1])
