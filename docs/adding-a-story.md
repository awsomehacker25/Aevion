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
| `upper-assam-floods` | flood (flagship, opens first) | NISAR (GCOV, water masks) | provisional, real (7 dates) |
| `venezuela-2026` | earthquake | NISAR (ARIA map) | provisional, real |
| `kilauea-hawaii` | volcano | NISAR | provisional, real (one pair) |
| `krasheninnikov-kamchatka` | volcano | NISAR (GCOV radar brightness) | provisional, real (11 passes) |
| `mexico-city-subsidence` | subsidence | NISAR (GUNW chain) | beta, real (6 pairs) |

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

To collect a story's whole time span in one go (small per-pair grids, resumable, never keeps the 2 GB files):

```
python processing/prep_story_data.py apps/web/public/stories/<story-id> --dry-run   # list only, no login
python processing/prep_story_data.py apps/web/public/stories/<story-id>             # asks for your Earthdata login
```

Results go to `data/stacks/<story-id>/` (git-ignored). Then convert them to the story's grids.

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

## More than one period, and radar brightness (Kilauea has both)

- **Periods (a real time series).** Collect several pairs with `prep_story_data.py` (use `--start` and `--end` to pick them),
  then run `python processing/stack_to_story.py <story-dir> --all`. It writes a tilt-corrected grid for every pair into
  `<story>/epochs/`. List them under `epochs` in `story.json` (pair dates, an optional `event`, and the two grid files). The
  app then shows a bar chart of motion near the vent (the annotation with `kind: "vent"`), and clicking a bar switches the map,
  timeline and event to that period.
- **Polarizations (HH and HV).** The interferogram files only contain HH, so brightness comes from NISAR's backscatter product
  (GCOV). Run `prep_story_backscatter.py <story-dir>` (it reads the flagship pair's two dates), then
  `backscatter_to_story.py <story-dir>`. Add two layers with roles `backscatterHH` and `backscatterHV` to `story.json`
  (see the Kilauea story). The app adds "Radar HH" and "Radar HV" view buttons and shows both values in the point inspector.

## Two more recipes (Krasheninnikov lava, Mexico City subsidence)

Stories that are not built yet keep a small stub in `processing/pending/<id>/story.json` (map box, grid size, track).
The prep scripts accept a stub in place of a story. Outputs go to `data/stacks/<id>/` and then to `<stub>/series/`.

- **Lava flow (radar brightness over time):** `prep_story_backscatter.py <stub> --all` collects every pass of the track,
  then `gcov_series_to_story.py <stub>` writes the brightness change of each date against the first date and a summary
  of the area changed.
- **Subsidence (cumulative motion):** `prep_story_data.py <stub>` collects the interferograms, then `chain_to_story.py <stub>`
  adds consecutive pairs into cumulative motion per date plus an average rate in cm per month.

Both stories set `copy.followTimeline`, so the period on screen follows the timeline cursor and the timeline keeps its full range.
`kind: "backscatter"` (Krasheninnikov) turns the main layer into a radar picture instead of ground motion: a layer with `colormap: "gray"`
is drawn weak to strong echo, and the fringes, confidence, cross-section and replay tools are hidden. `copy` holds the wording that
differs from story to story (period text, chart units, how-to lines). `chain_to_story.py --stable-above <m>` fits the atmospheric ramp
on the hills around a lake-bed city only (heights from the public AWS terrain tiles), and writes a steady-rate fit as well as the raw running totals.
`build_next_stories.py` turns the processed series into the files under `apps/web/public/stories/<id>/`.

## Flood stories and languages

A flood story uses `"kind": "flood"` in `index.json` and a `flood.json` manifest instead of grids: for each NISAR date the HH, HV, colour-mix and water-mask images, plus context layers, a time series, rain and damage pins. See `public/stories/upper-assam-floods/` and `processing/assam/` for the pipeline that builds it.

Each story lists its `languages` in `index.json`. For each language other than English add `<story>/i18n/<lang>.json` with only the fields that change; arrays of objects are matched by position. Mark it `"machine_translated": true` until a native speaker reviews it. Interface wording is in `apps/web/src/i18n/<lang>.ts`; missing keys fall back to English.
