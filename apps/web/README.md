# Aevion web app

Interactive 3D viewer for NISAR ground-motion data. React + TypeScript + Vite, with MapLibre GL for the map.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check and production build
npm run lint     # oxlint
```

## Modes

- **Story**: a plain-language walkthrough with a guided tour, an impact panel and an illustrative replay.
- **Scientist**: cross-sections, a physics check against a USGS fault model, raw fringes and a coherence threshold.

## Where things live

| Path | What it does |
|---|---|
| `src/App.tsx` | App state and layout |
| `src/MapView.tsx` | MapLibre map, overlays, terrain |
| `src/Panels.tsx`, `Story.tsx`, `Scientist.tsx`, `Impact.tsx` | Side panels for each mode |
| `src/Timeline.tsx` | Date slider, NISAR passes, earthquakes |
| `src/lib/` | Data loading, rendering, profile analysis, physics model |
| `public/stories/<id>/` | All data for one story. Swap this folder to show a different event |

The app reads everything about an event from `public/stories/<id>/story.json`. Open `?story=<id>` to pick a story.
Data processing scripts are in `../../processing`. Sources are listed in `../../docs/data-sources.md`.
