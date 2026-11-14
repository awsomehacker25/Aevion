# Aevion data sources

Where each piece of data in the app comes from, whether it is real or placeholder, and what you
need to access it. Last checked 2026-11-13.

## What is real today

| Data | Source | In the app | Access |
|------|--------|------------|--------|
| Earthquake locations and magnitudes | USGS FDSN event API | Real, cached in `usgs-events.geojson` | Public |
| NISAR pass dates and granule IDs | NASA CMR search | Real, in `acquisitions.json` | Public |
| Satellite imagery | Esri World Imagery tiles | Real | Public (check terms before launch) |
| Terrain | AWS Terrain Tiles (Mapzen) | Real | Public |
| **Ground motion (LOS displacement)** | NASA JPL ARIA map made from the NISAR 2026-06-13 to 06-25 pair, via the NASA Disasters Mapping Portal image service | **Real** (provisional, not yet validated by NASA), in `deformation.grid.json` | **Public, no login.** Fetch with `processing/fetch_aria_displacement.py` |
| Measurement coverage | Derived by Aevion from the displacement map's valid cells (7 by 7 window) | Real, derived, in `coverage.grid.json`. **Not** interferometric coherence | Same script |
| Raw interferometric coherence and unwrapped phase | NISAR L2 GUNW granule | Not used yet | Earthdata Login required, 2.2 GB |

## USGS context (public, no login)

`processing/fetch_usgs_context.py` writes `usgs-context.json` (about 90 KB) from the USGS event API and
product files for the M7.5 (`us6000t7zp`) and M7.2 (`us6000t7zc`):

| Content | Used for |
|---------|----------|
| Moment tensors (both right-lateral strike-slip on roughly east-west planes) | Beach balls, mechanism text, the sign check |
| PAGER alert (red), exposure by shaking intensity, felt reports (972) | "Who was affected" panel |
| PAGER nearby cities with population and shaking intensity | City table and map markers |
| ShakeMap intensity contours | Shaking overlay |
| Finite-fault slip patches (130, up to 1.8 m) | Fault overlay |
| Finite-fault predicted surface displacement (about 20 km grid, east/north/up) | Physics check against the NISAR-derived map |

Physics check result: projecting the M7.5 model onto the radar line of sight (incidence 40 degrees, look
azimuth 260 degrees) gives a pattern correlation of r = 0.53 over 106 cells and the correct sign, but the
amplitude does not match (model peaks near 135 cm, the radar map near 21 cm). Likely causes: the ARIA map
is deramped, near-fault cells have no data, and the model is coarse and not fit to this data. Treat it as a
consistency check, not a validation. Geometry values are approximate (from NASA's description) and live in
`story.json` under `geometry`. NASA's Sentinel-1 displacement product (OPERA DISP-S1) had no scenes over
the area in June to July 2026, so there is no second-radar cross-check.

## The ground motion source (what the app shows now)

NASA JPL / Caltech's ARIA team publishes line-of-sight displacement maps made from NISAR
interferograms as a public image service: item `1d972eab2bbd4098af71c0c61db083fc` on the
NASA Disasters Mapping Portal. Raster 1 is the 2026-06-13 to 2026-06-25 pair
(`NISAR_GUNW_20260613_20260625_unw_deIon_deRamp_maskWater_cm-crop2`). Rasters 2 and 3 are
June 18 to 30 (track 61 ascending) and June 17 to 29 (track 54 descending).

What NASA says about it (service description):
- Relative LOS displacement; the reference level is unknown and it is not calibrated to a ground location.
- Not yet validated; guidance for finding significant displacement; less reliable over snow and vegetation.
- Look direction about 40 degrees from vertical, slightly south of due west. Mostly horizontal motion, small vertical motion.
- Red means motion toward the west, blue toward the east. Source resolution 30 m.
- **Sign (our inference, not verified):** the granule is ascending and left-looking, so the satellite looks
  west-southwest. Westward motion is therefore away from the satellite, so positive = away. This agrees with
  right-lateral slip on an east-west fault (south side west, north side east), which matches the map.
- Credit: NASA-JPL/Caltech Team, NISAR Operations Science Team.

Refresh or switch pairs: `python processing/fetch_aria_displacement.py apps/web/public/stories/venezuela-2026`
(`--list` shows the rasters, `--raster-id N` picks one). The script records what it fetched in `aria-source.json`.

## What we learned from the raw granule (downloaded 2026-11-13)

The 2.2 GB GUNW granule opened correctly and confirms: track 162, ascending, left-looking, frame 006,
HH, 80 m posting, EPSG:32619, center frequency 1.239 GHz (wavelength 0.24196 m), product version 1.0.11.
Layers: unwrappedPhase, coherenceMagnitude, connectedComponents, ionospherePhaseScreen (large, 11 to 40 rad),
plus pixel offsets and a 20 m wrapped interferogram.

- **Footprint:** frame 006 spans about 7.6 to 10.2 N, which is mostly south of the ruptures (10.4 to 10.6 N).
  The earthquake area is in frame 007, which we do not have.
- **Validation attempt:** comparing displacement computed from this granule with NASA's ARIA map over the same
  pixels was inconclusive. The ARIA map has only about 0.8 cm of variation in that overlap, so there is no
  signal to compare. Amplitude and sign were not independently confirmed.
- **Next, if wanted:** download frame 007 (the same pair, the next granule north) for real coherence and a
  proper comparison near the ruptures.
- `data/raw/partial_*` files are leftovers from earlier attempts and can be deleted.

## The raw granule (optional)

Collection: `NISAR_L2_GUNW_PROVISIONAL_V1` (Earthdata Search concept `C2854335566-ASF`).
Pair: track 162 ascending, reference 2026-06-13, secondary 2026-06-25 (12-day baseline,
spanning the 2026-06-24 earthquakes).

Granule ID:
```
NISAR_L2_PR_GUNW_022_162_A_006_023_4000_SH_20260613T100623_20260613T100657_20260625T100622_20260625T100656_P05023_N_F_J_001
```

Checked on 2026-11-13: the product file, the browse image, the KML footprint and the QA
summary all redirect to Earthdata Login (HTTP 303). Nothing from the granule can be downloaded
without an account. A second, adjacent granule (frame 007) exists for the same pair.

## Getting the real data (you do this part)

1. Create a free Earthdata Login account at urs.earthdata.nasa.gov (never share the password).
2. Download with the script, or manually from ASF Vertex or Earthdata Search:
   `python processing/download_granule.py apps/web/public/stories/venezuela-2026 --out data/raw`
3. Convert and swap in: see `docs/data-contract.md` ("How to swap placeholder data for real NISAR data").

`data/raw/` and `*.h5` are git-ignored. Never commit NISAR files or credentials.

## Resources from the challenge (shown in the app's "Learn more" and "Data and documentation" lists)

**NASA**
- NASA Earthdata Search: discover, compare and access NASA Earth science data.
- ASF Data Search (Vertex): the NASA SAR archive.
- NISAR Data User Guide: product specs, known issues, access.
- Intro to Remote Sensing and Intro to SAR (Earthdata learning pages).
- NASA ARSET trainings, including SAR and NISAR (English and Spanish).
- NISAR StoryMaps: floods, wildfires, subsidence, oil slicks, glacier motion.
- NISAR applications white papers.
- UAVSAR postcards (airborne radar examples).

**Partner agencies (optional, not used in the prototype)**
- CSA: RADARSAT Constellation Mission data, RADARSAT-1 data, SAR Python tutorial.
- CONAE: SAOCOM catalogue and registration.

These could add C-band (RCM) or L-band (SAOCOM) context for the same event or a second story.
The challenge note applies: NASA does not endorse non-US Government sites, and participants
must follow each site's data use terms.

## Where the links live in the code

`apps/web/public/stories/venezuela-2026/story.json` -> `resources`. Each entry has a `group`
(`learn`, `data`, `partner`) and an `audience` (`story`, `scientist`, `both`). Edit the JSON to add
or remove links; no code changes needed.
