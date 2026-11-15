<p align="center"><img src="apps/web/public/logo.png" alt="Aevion" width="640"></p>

# Aevion

A NISAR-powered Earth change twin. Built for NASA Space Apps 2026: Dancing with the SARs.

**Built by** Rui Sun, Aaryaman Chopra, Palash Desarda, Andrew Chen, Ethan de Guzman and Kaiyaan Faisal.

Live: https://tryaevion.vercel.app

---

## Contents

1. [What it is](#what-it-is)
2. [The stories](#the-stories)
3. [How to use it](#how-to-use-it)
4. [Reading the map](#reading-the-map)
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

- A **3D terrain map** with the measured change draped over it, and a Recenter button if you wander off.
- A **timeline of real satellite passes** (from NASA's CMR catalogue) with earthquakes or eruptions marked on it.
- **Story mode**: a headline, what happened, who was affected, a guided tour and a replay of the change building up.
- **Scientist mode**: exact values on click, cross-sections, other map views, per-pass tables, provenance and sources.
- **Honest labelling**: every story shows its data status, and anything illustrative is marked as such.

## The stories

| Story | Kind | What it shows | Data status |
| --- | --- | --- | --- |
| **Venezuela earthquakes, June 2026** (`venezuela-2026`) | Earthquake | How far the ground moved after a magnitude 7.2 and a magnitude 7.5 quake within a minute of each other. Pair: 13 to 25 June 2026. | Provisional |
| **Kilauea, Hawaii** (`kilauea-hawaii`) | Volcano | A volcano that breathes: ground motion and how the radar brightness of the surface changed. Pair: 18 to 30 August 2026. | Provisional (one pair) |
| **Krasheninnikov, Kamchatka** (`krasheninnikov-kamchatka`) | Volcano | A volcano that woke up after about 500 years, shown in radar pictures. Fresh lava is bright against dark ground, and you can watch it from June to October. | Provisional (11 passes) |
| **Mexico City subsidence** (`mexico-city-subsidence`) | Subsidence | A city sinking slowly, measured across several pairs from October 2025 to January 2026. | Beta (6 pairs) |

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
      App.tsx            the viewer: state, tour, replay, layout
      MapView.tsx        the 3D map, overlays, swipe, annotations
      Panels.tsx         top bar, side panel, layer menu, inspector
      Timeline.tsx       the timeline and playback
      Story.tsx          story text, tour card, replay button, change stat
      Scientist.tsx      Scientist-mode tabs and analysis
      Epochs.tsx         the period picker
      Impact.tsx         who was affected
      lib/               rendering, playback clock, analysis, physics, data loading
  processing/            Python scripts that build story data
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
4. Add it to `apps/web/public/stories/index.json` with a short label.
5. Validate it and open `?story=<id>`.

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
- **NASA JPL ARIA** displacement map for Venezuela, via the NASA Disasters Mapping Portal.
- **USGS** earthquake catalogue, moment tensors, PAGER, ShakeMap and finite-fault models.
- **Esri** World Imagery for the satellite basemap and **Mapzen / AWS Terrain Tiles** for terrain.
- Built for the NASA Space Apps Challenge 2026, *Dancing with the SARs*.

The detailed table of what is real, derived or placeholder, and how to reach each source, is in [docs/data-sources.md](docs/data-sources.md).
