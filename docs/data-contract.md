# Aevion data contract

The web app contains no hardcoded data. Everything it shows comes from a **story folder**
under `apps/web/public/stories/<story-id>/`. To switch from placeholder to real NISAR data,
you replace files and edit one JSON manifest. You should not need to touch app code.

```
apps/web/public/stories/
  index.json                      list of stories (id + manifest path)
  venezuela-2026/
    story.json                    the manifest (text, dates, layers, provenance)
    deformation.grid.json         line-of-sight displacement grid   (SWAP THIS)
    coherence.grid.json           coherence grid                    (SWAP THIS)
    acquisitions.json             real NISAR passes from NASA CMR   (regenerate)
    usgs-events.geojson           real USGS earthquakes             (regenerate)
```

## How to swap placeholder data for real NISAR data

1. Get an Earthdata Login (free) and download the GUNW granule(s) for the pair
   listed in `story.json` -> `flagshipPair`. The granule ID is shown in Scientist mode.
2. Convert to the grid format (see below):
   ```
   python processing/gunw_to_grid.py <granule.h5> apps/web/public/stories/venezuela-2026
   ```
3. In `story.json`, for each layer set `"synthetic": false`, update `provenance`
   (maturity, granuleId, CRID, sign convention) and set `"dataStatus"` to
   `"provisional"` or `"validated"`. The red PLACEHOLDER badges disappear automatically.
4. Check it: `python processing/validate_story.py apps/web/public/stories/venezuela-2026`
5. Reload the app.

When validated products are released, re-run the CMR search with
`--short-name NISAR_L2_GUNW_V1` to refresh `acquisitions.json`.
**Do not mix maturity levels (BETA / PROVISIONAL / VALIDATED) in one pair.**

## Adding another story

See [adding-a-story.md](adding-a-story.md) for the full walkthrough (layout first, real data later).

1. Copy a story folder, give it a new id, replace the grids and edit `story.json`.
2. Add it to `stories/index.json`.
3. Open the app with `?story=<id>`.

## `aevion-grid-v1` (the raster format)

A plain JSON file. Small, easy to produce from any tool, and the app can also read it
in the browser for the click-to-inspect panel.

| field      | meaning |
|------------|---------|
| `format`   | must be `"aevion-grid-v1"` |
| `name`     | free text |
| `units`    | `"m"` for displacement, `"1"` for coherence |
| `width`, `height` | number of columns and rows |
| `bbox`     | `[west, south, east, north]` in degrees (WGS84, EPSG:4326) |
| `rowOrder` | must be `"north-up"` (first row is the northernmost) |
| `nodata`   | number used for missing cells, or `null` |
| `values`   | flat row-major array, length `width * height` |

All grids in one story must share the same `bbox`, `width` and `height`.
Keep grids under roughly 500 x 300 cells so the page stays fast. For larger areas,
tile or decimate in the converter.

## `story.json` fields

| field | notes |
|-------|-------|
| `dataStatus` | `placeholder`, `beta`, `provisional` or `validated`. Drives the status pill. |
| `aoi` | bbox, camera center, zoom, pitch, bearing |
| `timeline` | start, end and initial cursor dates (UTC) |
| `event` | name, shortLabel (timeline tag), datetime, source |
| `flagshipPair` | track, orbit direction, reference and secondary date. The app finds the granule ID in `acquisitions.json`. |
| `acquisitions`, `events` | file names of the passes list and the earthquake GeoJSON |
| `layers[]` | one `role: "displacement"` and one `role: "coherence"` layer |

Layer fields: `id`, `role`, `name`, `badge` (`OBSERVED`, `DERIVED`, `CONTEXT`, `WHAT-IF`),
`grid` (file name), `units`, `displayUnits`, `displayScale` (multiply units to get display,
for example 100 for m -> cm), `range` (color scale limits, in `units`), `appearsAfter`,
`synthetic`, and `provenance` (free key/value pairs shown in Scientist mode).

## What else can be swapped

| thing | where |
|-------|-------|
| Satellite imagery and terrain tiles | `apps/web/src/config.ts` |
| Default coherence threshold, play speed | `apps/web/src/config.ts` |
| Renderer (MapLibre -> Cesium) | replace `apps/web/src/MapView.tsx` only |
| Story text, dates, colors scales | `story.json` |
| NISAR product (GUNW, GCOV, ...) | `story.json` layers + a converter in `processing/` |

## Scripts

| script | purpose | status |
|--------|---------|--------|
| `processing/search_nisar.py` | Query NASA CMR for NISAR granules, write `acquisitions.json` | works, tested |
| `processing/make_placeholder_story.py` | Generate synthetic placeholder grids | works, tested |
| `processing/gunw_to_grid.py` | Convert a real GUNW HDF5 to `aevion-grid-v1` | **untested**, needs real data |
| `processing/validate_story.py` | Check a story folder against this contract | works |
