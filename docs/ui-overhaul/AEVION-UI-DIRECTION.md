# Aevion UI overhaul: direction brief

A starting direction for the UI overhaul, to hand to Claude Code with this folder. It fixes the brand (logo and Steel theme), sets the look and the non-negotiables, and records the decisions Kai has already made (section 8). It is a direction, not a spec: plan the work first, then build. Ask Kai only about things this brief does not settle.

## The task (from Kai)

> Plan out a UI overhaul, which focuses on nav, menus, and themes. I've attached a design plan from Claude Design for the dashboard, mainly centered around clean, transparent effects, loading skeletons/clean loading animations for everything, smooth nav with universal, clean logos that apply to everything, bottom of screen nav.
>
> Take inspiration both from the existing dashboard/screenshot and the designed dashboard. Ask as many questions as needed to get the best output. We need to keep the info/insight that we have while making it look better, so don't drop info/analytics for a better/cleaner looking frontend.

Inputs to read alongside this brief:
- `design-reference/`: the designed dashboard from the concept board, as images, with notes on what to take from it. This is the "design plan from Claude Design" in Kai's prompt.
- A screenshot of the current app (Kilauea story, Story mode).
- The logo and theme concept board, whose app preview shows the intended feel: https://claude.ai/artifact/J2hWGvcufwTo3LgLKnB5mY
- `PRODUCT.md` and `apps/web/src/index.css` in the repo.

## 1. Rule one: keep every piece of information

The overhaul changes how things look and where they sit. It does not remove content. Before moving anything, make an inventory of every control and every piece of text or data on screen in both viewers and both modes, and check the new design against it at the end. A cleaner screen can put things behind a menu, tab or disclosure, but each item must still be reachable, and the key numbers must stay visible without a click.

What exists today. This list is a starting point, so confirm it against the code:

- **Top bar:** logo, story picker, data status badge (Placeholder, Beta, Provisional or Validated, which must stay visible), language picker (7 languages, with a "Machine translated" note), Story/Scientist switch, zoom in and out, reset tilt, Recenter.
- **Interferometry side panel (Kilauea and similar):** title and place, Ground motion / More layers, the colour scale with units and its "What do the colors mean?" disclosure, the Overview / Periods / Charts / Learn tabs (plus Impact, Analysis, Data and Sources where a story has them), the story text, the "How big is the change?" box with away and toward values and the outlier note, Start the story tour, Before/after, Replay, How to use this, Method and processing, and Limitations.
- **Flood viewer (Upper Assam):** the Compare/Swipe divider, the radar view (Water, Plant or RGB, which is HH, HV or RGB in Scientist mode), the water mask, Animate, 3D terrain, the layer groups (Radar, Water, People and places, Other satellites), legends with context notes, the Charts tab (point chart, presets, rain chart), the Evidence tab (reported damage, people under water), and the "How this was made" methods dialog with its tables and limits.
- **Map:** map labels and markers, the click inspector (motion, echo strength, confidence, flood state and history), the tour overlay with "Press Esc to skip", and the imagery credits.
- **Timeline:** Play, previous and next, the period picker, the current date, the satellite passes row, the eruption or earthquake row with episode markers, the rain and new-water series in the flood viewer, keyboard support, and the "Map shows the change measured from … to …" caption.
- **Credits:** the team and the challenge must stay in the app.

## 2. Brand

Use the logo files in `logo/` and replace `apps/web/public/logo*.svg`, `logo*.png` and the favicon.

| File | Use |
|---|---|
| `aevion-mark.svg` / `aevion-mark-dark.svg` | Mark only, light on dark or dark on light |
| `aevion-horizontal.svg` / `-dark.svg` | Nav bar, README header, slides |
| `aevion-stacked.svg` | Loading screen and splash |
| `aevion-app-icon.svg`, `aevion-app-icon-512.png`, `apple-touch-icon.png` | App icon and touch icon |
| `favicon.svg`, `favicon-32.png` | Browser tab |

- **The mark is the pixel twin.** Half the globe is solid (the real Earth). The other half is pixels that shrink toward the edge (the radar measurement of it).
- **The wordmark** is lowercase "aevion" in Geist SemiBold, outlined to paths, so no font is needed.
- **Use one logo everywhere.** That covers the nav, splash, favicon, README, the share image and the tour, in a single colour (`--ink` on dark or `--bg` on light). Never recolour the logo with the data colours.

## 3. Theme: Steel

The tokens are in `steel-tokens.css`. Map them onto the existing token names in `index.css` and don't add a parallel set.

| Token | Hex | Role |
|---|---|---|
| `--bg` | `#080c10` | App background |
| `--surface` | `#121820` | Panels, which become glass in nav and menus |
| `--ink` | `#edf2f7` | Text |
| `--muted` | `#8f9cab` | Secondary text |
| `--accent` | `#b9c8d8` | Selected state, primary button (dark text on it) |
| `--glow` | `#a3b8cc` | Soft glow, always at low opacity |

- **The data colours don't change.** Orange `#f39237` means away from the satellite, blue `#3b8fd4` means toward it, and the radar greys stay as they are. The accent is a muted blue-grey on purpose, so that a button never reads as a measurement.
- **The blue primary button changes.** "Start the story tour" is bright blue today. It becomes the Steel accent with dark text, which is distinct from the "toward" blue.
- **Keep the existing text colours that show data.** Where text carries a value, such as the orange and blue numbers in "How big is the change?", keep those colours.

**Light theme (Kai wants a switcher).** `steel-tokens.css` includes a light Steel set:
- Background `#eef2f6`, panel `#ffffff`, text `#0e141b`, muted text `#5b6876`.
- Accent `#3e5468`, a dark steel with white text on it. Glow `#6d859c`, used even more lightly than in dark.

How the switcher works:
- It offers System, Dark and Light, lives in the dock, and remembers the choice.
- The satellite map itself doesn't change. Only the UI chrome changes, so light glass floats over the same imagery.
- Check the orange, blue and status colours for contrast on the light panels, and give each one a darker text version where needed, as `--away-ink` and `--toward-ink` already do in dark.

## 4. Surfaces: clean transparency

This is not full liquid glass: just transparency, a blur and a hairline border.

```css
background: color-mix(in srgb, var(--surface) 58%, transparent);
backdrop-filter: blur(18px) saturate(150%);
border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
box-shadow: inset 0 1px 0 color-mix(in srgb, var(--ink) 10%, transparent);
```

- **Use glass for things that float over the map:** the bottom nav, menus and dropdowns, popovers, the inspector card, the tour card and map controls.
- **Make reading panels more opaque.** The side panel has long text and charts, so it should sit at about 85 to 92% opacity, so text stays readable over busy imagery. Check contrast over the brightest map areas.
- **Keep glow soft and rare.** Use it only on the primary action, the active nav item and the timeline playhead, at about 20% opacity or less.
- **Corner radius (decided):** 10px on floating glass containers (the dock, the timeline bar, menus, the inspector and tour cards, the side panel). 6px on controls inside them (buttons, segmented switches, inputs). 4px stays on small chips and badges. This fits glass better than 4px everywhere while staying tight and technical.
- **Update `PRODUCT.md`.** It says "solid dark panels, 3 to 4px radius, no floating shadows". Rewrite those lines to match this brief: glass for floating elements, the radius scale above, soft glow only.

## 5. Navigation: bottom of the screen (decided)

The main navigation moves to the bottom. Both viewers, flood and interferometry, use this one shell and fill its slots, so navigation never jumps when you switch stories.

```
┌──────────────────────────────────────────────────────────────┐
│ ┌side panel────┐                              [+][−][tilt]   │
│ │ title, place │                              [Recenter]     │
│ │ legend       │                                             │
│ │ tabs + body  │              MAP                            │
│ │ change box   │                                             │
│ │ actions      │                                             │
│ └──────────────┘                                             │
│ ┌ timeline bar (glass) ────────────────────────────────────┐ │
│ │ ▶ ‹ Aug 18–Aug 30 › Sep 2    passes ◆  ◆   eruptions ●   │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌ dock (glass) ────────────────────────────────────────────┐ │
│ │ [logo] Story ▾ │ ● Provisional │ Story/Scientist │ EN ▾ │ ◐ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

- **The dock** is one compact row at the very bottom. It holds the logo, the story picker, the data status badge (always visible), the Story/Scientist switch, the language picker with its "Machine translated" note, and the theme switcher. The old top bar goes away, so the top of the map is clear.
- **The timeline stays its own bar, just above the dock.** It is not merged into the dock. It already holds Play, the period picker, the date, two or three data rows (passes and eruptions, or rain and new water), episode markers and the caption, so merging would crowd both. The two bars share width and edges, so they read as one bottom stack.
- **The side panel stays on the left**, as a full-height glass column that ends above the bottom stack. It holds long text, legends and charts, which need a column rather than the bottom area. It is collapsible as it is today.
- **Map controls stay on the right edge**, clear of the bottom stack.
- **Overlays:** menus and dropdowns from the dock open upward. The click inspector and the tour card float over the map as glass cards.
- **Desktop only for now.** Don't build phone or tablet layouts, but don't break wide or short desktop windows.

**Scientist mode keeps the same layout** and keeps everything it changes today. That means expert labels and legends, axes on charts, the HH, HV and RGB views, the Sentinel-1 layer, the presets, the Analysis, Data and Sources tabs, the cross-section tool, offset and physics checks, and coordinates. Only the content of the slots changes:
- The status badge in the dock shows its scientist detail text, which today appears after the badge in the top bar.
- The coordinates readout moves to the right end of the dock.
- Scientist tools such as the cross-section stay in the side panel, where they are now.

## 6. Loading

- **Skeletons everywhere data loads.** That covers the side panel text, the change box, charts, the timeline rows, layer thumbnails and the methods tables. Match each skeleton to the real layout so nothing jumps when data arrives.
- **Fade map overlays in** when their tiles or images are ready, instead of popping in.
- **The splash is the brand moment.** The stacked logo, with the pixel half filling in column by column from the split outward, then a cross-fade into the app. It should run once and stay short (under about 1.2 seconds after data is ready).
- Respect `prefers-reduced-motion` by turning off the pixel build and the fades, and showing static skeletons.

## 7. Motion and feel

The app already has soft glows, 3D terrain and smooth transitions. Keep that calm:
- Use short ease-out transitions (150 to 250ms) on panels, menus and tabs.
- Avoid bouncy springs.
- Add no motion that the person didn't trigger, apart from the splash and the tour.
- Keep the map as the hero, with the UI quiet and out of its way.

## 8. Decisions from Kai (Nov 15)

1. **The design plan (`design-reference/`):** nothing in it is fixed. Take its cleanliness and transparency, but keep all functionality, because making it that clean would otherwise cut a lot out.
2. **Side panel:** stays on the left on desktop (see section 5).
3. **Corner radius:** 10px containers, 6px controls, 4px chips (see section 4).
4. **Timeline:** its own bar above the dock, not merged (see section 5).
5. **Scientist mode:** same layout, with everything it changes today kept (see section 5).
6. **Shared layout:** yes, one shell for the flood and interferometry viewers.
7. **Light theme:** yes, with a System, Dark and Light switcher in the dock (see section 3).
8. **Devices:** desktop only for now.

## 9. How to proceed

1. Write the inventory (section 1) and a short plan. Show the plan to Kai before writing code.
2. Do the themes and tokens first (Steel dark and light, the switcher and the glass utilities), then the logo swap, then the shared shell and bottom navigation, then loading, then polish.
3. After each step, check the inventory and compare screenshots of both viewers, in both modes and both themes, against the current app.
