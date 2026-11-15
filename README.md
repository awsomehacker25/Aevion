<p align="center"><img src="apps/web/public/logo.png" alt="Aevion" width="640"></p>

# Aevion

A NISAR-powered Earth change twin. Built for NASA Space Apps 2026: Dancing with the SARs.

**Built by** Rui Sun, Aaryaman Chopra, Palash Desarda, Andrew Chen, Ethan de Guzman and Kaiyaan Faisal.

Live: https://tryaevion.vercel.app

**Why Upper Assam comes first.** Friends and family of our team have lived in Upper Assam, and the floods hit them hard. It is the first story you see, and the one we care most about getting right.

---

## Contents

1. [What it is](#what-it-is)
2. [The stories](#the-stories)
3. [How to use it](#how-to-use-it)
4. [Reading the map](#reading-the-map) (also: [the flood story](#flood-story), [languages](#languages))
5. [How the data is made](#how-the-data-is-made)
6. [Run it locally](#run-it-locally)
7. [Project structure](#project-structure)
8. [Adding a story](#adding-a-story)
9. [Design principles](#design-principles)
10. [Data sources and credits](#data-sources-and-credits)

## What it is

NISAR, the NASA-ISRO radar satellite, measures how the ground changes by comparing radar passes of the same place taken days apart. The raw products are hard to read. Aevion turns them into short, guided stories on a 3D satellite map, so a first-time viewer understands in seconds what moved, by how much and why it matters, without reading documentation.

The audience is judges and the curious public first. Scientists and analysts are served by Scientist mode, which is one click away and uses the same layout.

What it gives you:

- A **flagship flood story** (Upper Assam, July 2026): a before/after swipe between any two NISAR dates, a flood timeline with the rain above it, point charts, damage reports and the method behind the numbers.
- A **3D terrain map** with the measured change draped over it for the interferometry and volcano stories, and a Recenter button if you wander off.
- A **timeline of real satellite passes** (from NASA's CMR catalogue) with earthquakes or eruptions marked on it.
- **Story mode**: a headline, what happened, who was affected, a guided tour and a replay of the change building up.
- **Scientist mode**: exact values on click, cross-sections, other map views, per-pass tables, provenance and sources.
- **Charts for every story**: how much of the map moved how far, earthquakes through time, people by shaking level, strongest motion per period, sinking area, bright-ground area, and (for the flood) rain and flooded area.
- **HH/HV colour mix** for the stories that have both radar channels.
- **Each story in its own language** as well as English (see [Languages](#languages)).
- **Honest labelling**: every story shows its data status, and anything illustrative is marked as such.

## The stories

| Story | Kind | What it shows | Data status | Languages |
| --- | --- | --- | --- | --- |
| **Upper Assam floods, July 2026** (`upper-assam-floods`) **(flagship)** | Flood | How far floodwater spread across Sivasagar and Charaideo, from NISAR L-band radar on seven dates (16 Jun to 26 Oct), with rain, damage reports, people exposed and a validated water threshold. | Provisional (upper bounds) | English, Assamese, Hindi |
| **Venezuela earthquakes, June 2026** (`venezuela-2026`) | Earthquake | How far the ground moved after a magnitude 7.2 and a magnitude 7.5 quake within a minute of each other. Pair: 13 to 25 June 2026. | Provisional | English, Spanish |
| **Kilauea, Hawaii** (`kilauea-hawaii`) | Volcano | A volcano that breathes: ground motion and how the radar brightness of the surface changed. Pair: 18 to 30 August 2026. | Provisional (one pair) | English, Hawaiian |
| **Krasheninnikov, Kamchatka** (`krasheninnikov-kamchatka`) | Volcano | A volcano that woke up after about 500 years, shown in radar pictures. Fresh lava is bright against dark ground, and you can watch it from June to October. | Provisional (11 passes) | English, Russian |
| **Mexico City subsidence** (`mexico-city-subsidence`) | Subsidence | A city sinking slowly, measured across several pairs from October 2025 to January 2026. | Beta (6 pairs) | English, Spanish |

Kamchatka is a *radar picture* story: it shows how bright the radar echo is, not ground motion. The other three are *interferometry* stories that show motion along the satellite's line of sight.

## How to use it

### Story mode

- **Top bar:** choose a story, see the data status, and switch between Story and Scientist.
- **Side panel:** the main view (ground motion, or the radar picture), a **More layers** menu for the other views, and tabs for Overview, Impact (or Periods) and Learn. The panel collapses to a sheet on phones.
- **Start the story tour** walks through the story one scene at a time and can be stepped back and forward.
- **Replay** shows an *illustrative* build-up of the change on the map. NISAR only saw the end result, not the motion in between, and the map says so while it plays.
- **Before / after** adds a draggable divider so you can compare the two sides.
- **Click the map** to inspect a point. The card tells you the value there and, if the change has not appeared yet at the chosen date, offers a button to jump to the second pass.

### Timeline

- Diamonds are satellite passes; the larger ones are the pair that makes the map. Circles are earthquakes (or eruptions) from USGS.
- Press **Play** to run through time. Quiet stretches go by at twice the normal rate and playback slows down while the change builds up.
- Drag or click the timeline to move to any date. The map always shows the change measured between the two passes named in the status line, and the date in UTC is shown next to Play.
- Where a story has several periods, a period picker lets you step between them.

### Scientist mode

- All the map views as plain buttons: **Ground motion**, **Fringes**, **Confidence** and the radar brightness views (**HH** and **HV**).
- **Analysis** tab: statistics, cross-sections (click two points on the map to draw one) and the physics check where one exists.
- **Periods** tab: every acquisition pair with its dates.
- **Data** tab: product, maturity level, granule IDs, sign convention, geometry and wavelength.
- **Sources** tab: where each layer comes from.

Your mode is kept when you switch stories.

### Flood story

The Upper Assam story opens first. It is a different kind of map from the others: flat, two dates side by side, because floods are read by comparing a dry and a wet picture.

- **Swipe**: drag (or use the arrow keys on) the white divider to compare the left and right dates. The swipe button on the map turns it off.
- **Timeline**: bars show new water per NISAR date, placed by true date, with the daily rain above. Click a bar or use the arrow keys to set the right-hand date; Shift with the arrow keys sets the left-hand date. Play steps through the season.
- **Water view and Plant view** (HH and HV): open water is dark in HH. In Scientist mode there is also an HH/HV colour mix and three spots where the two channels disagree.
- **Layers**: permanent water, seasonal change along the rivers, district outlines, damage reports, people under the new water, an optical photo and, in Scientist mode, Sentinel-1 C-band radar on the left side.
- **Charts**: click the map to chart a spot's HH and HV over the season; daily rainfall with the NISAR passes marked.
- **Evidence**: damage reports with their sources, and the people exposed by district.
- **How this was made**: the processing steps, the -15 dB threshold check against an independent Assam University map, and the known limits. Every flooded area is an **upper bound**, because rice paddies flooded on purpose count too.
- The view (dates, radar view, tab, mode and map position) is kept in the address, so a copied link reopens the same view.

### Languages

Each story is offered in English and the language of the place it is about:

| Story | Languages |
| --- | --- |
| Upper Assam floods | English, Assamese (অসমীয়া), Hindi (हिन्दी) |
| Venezuela earthquakes | English, Spanish |
| Mexico City subsidence | English, Spanish |
| Krasheninnikov, Kamchatka | English, Russian |
| Kilauea, Hawaii | English, Hawaiian (ʻŌlelo Hawaiʻi) |

A language switcher appears in the top bar when a story has more than one. `?lang=es` opens a language directly and the choice is remembered.

**Every translation other than English is machine translated and has not been checked by a native speaker.** The app no longer shows a notice about this, so treat the English text as the reference. The Hawaiian text in particular needs review (vocabulary, ʻokina and kahakō). Scientist-mode technical notes (method summaries, limitations, table labels) are still in English.

## Reading the map

Colours on the map are data, never decoration:

- **Orange** is ground moving **away** from the satellite. **Blue** is ground moving **toward** it. Almost no motion is transparent so the imagery shows through.
- **Fringes** are the raw interferogram, one full colour cycle per half wavelength of motion. They are a way to see the pattern without the unwrapping.
- **Confidence** shows where the two radar passes agree well enough to trust the result. Low-confidence cells can be faded out.
- **Radar HH** shows how the surface brightness changed for ground-sensitive returns. **Radar HV** responds to rough ground and plants. In the radar-picture story the colours are greys for the picture and a blue-to-orange scale (in decibels) for what changed since the previous pass.

The motion is measured along the satellite's line of sight, not straight up or down, so a number is always "toward" or "away from the satellite". A short diagram in the Learn tab explains this.

## How the data is made

Each story is a folder of plain files under `apps/web/public/stories/<id>/`. The app has no hard-coded data.

| File | What it holds |
| --- | --- |
| `story.json` | The manifest: text, tour, dates, map camera, layer definitions and provenance |
| `deformation.grid.json` | Line-of-sight displacement in metres (`aevion-grid-v1`) |
| `coherence.grid.json` | Confidence from 0 to 1 |
| `backscatter-hh.grid.json`, `backscatter-hv.grid.json` | Radar brightness change (radar-picture stories and Kilauea) |
| `acquisitions.json` | Real NISAR passes from NASA CMR |
| `usgs-events.geojson`, `events.geojson` | Earthquakes or eruption events for the timeline |
| `epochs/` | The per-period grids behind the period picker |

The Python scripts in `processing/` build these:

| Script | Job |
| --- | --- |
| `search_nisar.py` | Find NISAR pairs for an area in NASA CMR |
| `download_granule.py` | Fetch a granule with your Earthdata login |
| `gunw_to_grid.py`, `chain_to_story.py` | Convert interferometry products to grids |
| `gcov_series_to_story.py`, `backscatter_to_story.py` | Convert radar brightness series to story data |
| `fetch_aria_displacement.py` | Get NASA JPL's public ARIA displacement map (used for Venezuela, no login) |
| `fetch_usgs_context.py` | Pull moment tensors, shaking, cities and fault models from USGS |
| `prep_story_data.py` | Collect a whole story's time span in one resumable run |
| `make_placeholder_stories.py` | Build a clearly labelled synthetic story while real data is pending |

The format and the rules for swapping data are in [docs/data-contract.md](docs/data-contract.md).

### Data status

| Status | Meaning |
| --- | --- |
| Placeholder | Synthetic data standing in for the real thing. Red badges are shown. |
| Beta | Real NISAR data at beta maturity |
| Provisional | Real NISAR data, not yet validated by NASA |
| Validated | Validated product |

Maturity levels are never mixed within one pair. The status stays visible in the top bar and in Scientist mode.

### A note on the physics check

For Venezuela, the app compares the measured motion with a USGS finite-fault model projected onto the radar line of sight. The pattern correlates (r about 0.53) and the sign is right, but the amplitude does not match. It is shown as a consistency check, not a validation. The reasons and numbers are in [docs/data-sources.md](docs/data-sources.md).

## Run it locally

You need Node.js 20 or newer.

```bash
cd apps/web
npm install
npm run dev      # http://localhost:5173
```

Other scripts:

```bash
npm run build    # type-check and production build into dist/
npm run preview  # serve the production build
npm run lint     # oxlint
```

Open a specific story with `?story=<id>`, for example `http://localhost:5173/?story=kilauea-hawaii`.

The processing scripts need Python 3 and, to download full NISAR granules, a free NASA Earthdata login. The app itself needs neither: all story data is already in the repository.

Deployment is configured for Vercel (`vercel.json`).

### Stack

React 19, TypeScript, Vite and MapLibre GL 6 (3D terrain from a raster-DEM, sky and fog, image overlays rendered on a canvas, markers). Linting with oxlint. Type is Inter and Geist.

## Project structure

```
Aevion/
  apps/web/              the web app
    public/stories/      one folder per story (story.json + grids)
    src/
      App.tsx            the interferometry viewer: state, tour, replay, layout, and the story router
      FloodViewer.tsx    the flood viewer: swipe, controls, tabs, shareable link
      FloodMap.tsx       two synced maps with a divider, image overlays and context layers
      FloodTimeline.tsx  rain and flooded area on one date axis
      FloodPanels.tsx    flood story, layers, charts, evidence and methods dialog
      MapView.tsx        the 3D map, overlays, swipe, annotations
      StoryCharts.tsx    charts for the interferometry and radar-picture stories
      charts/Chart.tsx   the one SVG chart every story uses (bars, lines, dots)
      i18n/              the language system and one dictionary per language
      Panels.tsx         top bar, side panel, layer menu, inspector
      Timeline.tsx       the timeline and playback
      Story.tsx          story text, tour card, replay button, change stat
      Scientist.tsx      Scientist-mode tabs and analysis
      Epochs.tsx         the period picker
      Impact.tsx         who was affected
      lib/               rendering, playback clock, analysis, physics, data loading, statistics, flood state, story text overlays
  processing/            Python scripts that build story data
    assam/               the Upper Assam flood pipeline (NISAR GCOV to water masks, rain, context layers, threshold validation)
  data/                  working data for processing (git-ignored stacks)
  docs/                  data contract, adding a story, data sources, master plan
  PRODUCT.md             audience, purpose and design principles
```

Notable pieces:

- `lib/render.ts` draws the change overlay: cubic upsampling of the grid, colour tables for diverging, fringe, confidence and grey views.
- `lib/progress.ts` holds the build-up window and the playback clock that eases around it.
- `lib/physics.ts` and `lib/beachball.ts` back the physics check and the earthquake mechanism symbols.
- `MapView.tsx` keeps the map lightweight: a capped pixel ratio, no hillshade layer, limited zoom-out, and small frames during the replay.

## Adding a story

Stories are data, not code, so a new one needs no app changes.

1. Copy an existing story folder and give it a new id.
2. Edit `story.json`: type, title, text, tour, map box, timeline, pair dates and sensor. Mark it `placeholder` until real data is in.
3. Make or process the grids (see the scripts above).
4. Add it to `apps/web/public/stories/index.json` with a short label and the languages it is offered in.
5. Validate it and open `?story=<id>`.

**Translations.** Put each language in `<story>/i18n/<lang>.json`: only the fields that change (title, subtitle, `storyText`, `why`, `tour` text, layer wording, period labels). Arrays of objects are matched by position, so a translated tour step keeps the English camera and date. Mark the file `"machine_translated": true` until a native speaker has reviewed it. Interface wording lives in `apps/web/src/i18n/<lang>.ts`; any key left out falls back to English.

**Flood stories** use `"kind": "flood"` in the index and a `flood.json` manifest (dates with their HH, HV, colour-mix and water images, context layers, rain and damage pins) instead of grids. See `public/stories/upper-assam-floods/`.

The full walkthrough, including how to swap placeholder data for real NISAR data, is in [docs/adding-a-story.md](docs/adding-a-story.md).

## Design principles

From [PRODUCT.md](PRODUCT.md):

1. **Understand in seconds:** plain words first, jargon one click away.
2. **Be honest** about what is measured versus illustrative.
3. **The map is the hero;** panels stay quiet and out of its way.
4. **Science colours are data,** never decoration.

The interface uses solid dark panels, one blue accent, and keeps the data colours (orange, blue and radar greys) fixed so they always mean the same thing.

## Data sources and credits

- **NISAR** (NASA-ISRO Synthetic Aperture Radar) products, found through **NASA CMR**.
- **Upper Assam flood pipeline** by Rui Sun (github.com/ruisbasement-code/Upper-Assam-India): NISAR L2 GCOV water masks, **GPM IMERG** rain (NASA GES DISC), **JRC Global Surface Water**, **WorldPop** 2025 population, **geoBoundaries** district outlines, **OPERA RTC-S1** Sentinel-1 C-band, Copernicus **Sentinel-2** optical and an independent flood map from Assam University for validation.
- **NASA JPL ARIA** displacement map for Venezuela, via the NASA Disasters Mapping Portal.
- **USGS** earthquake catalogue, moment tensors, PAGER, ShakeMap and finite-fault models.
- **Esri** World Imagery (and place labels on the flood map) for the satellite basemap and **Mapzen / AWS Terrain Tiles** for terrain.
- Built for the NASA Space Apps Challenge 2026, *Dancing with the SARs*.

The detailed table of what is real, derived or placeholder, and how to reach each source, is in [docs/data-sources.md](docs/data-sources.md).
