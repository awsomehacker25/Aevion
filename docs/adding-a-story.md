# Adding a story, and swapping in real data

Aevion works in two stages, so the story can be built before any data is ready:

1. **Layout first.** A story folder with text, a guided tour, "why" cards and a map camera, plus
   clearly labeled **synthetic placeholder** grids. The app is fully usable and shows a PLACEHOLDER badge.
2. **Data later.** Overwrite two grid files and flip a few fields in `story.json`. No app code changes.

Everything below lives in `apps/web/public/stories/<story-id>/`. The data format is in
[data-contract.md](data-contract.md).

## Stories in the app

| Id | Type | Radar source | Data status |
|---|---|---|---|
| `venezuela-2026` | earthquake | NISAR (ARIA map) | provisional, real |
| `kilauea-hawaii` | volcano | NISAR | placeholder |
| `seattle-bellevue` | subsidence | NISAR time series, or Sentinel-1 / OPERA | placeholder |
| `oso-landslide` | landslide | not NISAR (2014): an archive SAR, still to be chosen | placeholder |

## Step 1: create the layout

1. Copy a placeholder story folder (for example `kilauea-hawaii`) to `<new-id>`.
2. Edit `story.json`:
   - `type`: `earthquake`, `volcano`, `landslide` or `subsidence` (shown in the story picker).
   - `title`, `subtitle`, `storyText`, `technical`, `why`, `tour`, `resources`.
   - `aoi`: the map box (`bbox` = west, south, east, north) and camera.
   - `timeline`, `flagshipPair` dates, and `event` (leave `event` out for slow processes).
   - `sensor`: the mission name shown on the timeline, for example `NISAR`.
   - `dataStatus: "placeholder"` and `statusDetail` that says what is not real yet.
3. Make placeholder grids. Add a recipe to `processing/make_placeholder_stories.py` (a simple shape at the
   real place), then run `python processing/make_placeholder_stories.py <new-id>`.
4. Add the story to `stories/index.json` with a short `label` and a `type`.
5. Check it: `python processing/validate_story.py apps/web/public/stories/<new-id>`.
6. Open the app and pick it from the menu, or go to `?story=<new-id>`.

## Step 2: swap in real data

For each story you need two grids, `deformation.grid.json` (line-of-sight motion, meters) and
`coherence.grid.json` (0 to 1), in the `aevion-grid-v1` format.

| Story | What to get | How |
|---|---|---|
| Kīlauea | NISAR GUNW pairs around an eruption (12-day repeat) | `search_nisar.py` to find pairs, `download_granule.py` to fetch, `gunw_to_grid.py` (or `stream_gunw_to_grid.py`) to convert |
| Seattle / Bellevue | A year or more of passes, fitted to a velocity (mm per year), not a single pair | Check NISAR coverage first. If it is thin, use Sentinel-1 or NASA OPERA displacement products and say so in `provenance` |
| Oso | A SAR archive that covers the slope before March 2014 (for example ALOS-1 PALSAR, TerraSAR-X or UAVSAR), plus NISAR for monitoring similar slopes today | Search ASF for 2014 coverage first. NISAR cannot observe the 2014 event |

Then, in `story.json`:

1. For each layer set `"synthetic": false` and fill in `provenance` (product, maturity, granule or scene IDs,
   sign convention, geometry, wavelength). The PLACEHOLDER badges disappear on their own.
2. Set `dataStatus` to `beta`, `provisional` or `validated`, and update `statusDetail` and `dataStatusNote`.
3. Replace `timeline`, `flagshipPair` and `event` dates with the real ones, and set `geometry` from the product.
4. Regenerate the pass list (`acquisitions.json`) with `search_nisar.py`, and the event list
   (`events.geojson`) with a USGS query, for example:
   `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=<date>&endtime=<date>&minmagnitude=2&minlatitude=<s>&maxlatitude=<n>&minlongitude=<w>&maxlongitude=<e>`
   The timeline hides the pass and event rows when these files are empty.
5. Reword the placeholder text in `why` and `tour` ("placeholder pattern", "placeholder date") to describe the real result.
6. Run the validator and reload.

Do not mix data maturity levels (BETA, PROVISIONAL, VALIDATED) in one pair.

## Optional USGS context (earthquakes)

A `context` file (fault model, PAGER, shaking contours, cities) turns on the Impact tab and the
physics check. Only the Venezuela story has one. Other story types simply skip those panels.
