# Inventory: every control and piece of information

Rule one of the brief: the overhaul changes where things sit and how they look, never what the app shows or can do.
This list was built from the code and from a live scan of the old UI (commit `ec7a88b`), then checked against the new one.

**How it was checked.** `collect.mjs` (Playwright + Edge) loads Kilauea (interferometry), Upper Assam (flood) and Venezuela (earthquake)
in Story and Scientist mode, walks every side-panel tab with every disclosure open, opens the layers and period menus, and records every
visible text line plus every control's accessible name and tooltip. The old and new sets were diffed. Result: **nothing missing**;
the only entries that moved are the story and language options, which now live inside the dock's menus (verified open with `menus.mjs`).
Added in the new UI: theme switcher, "Machine translated" note, Scientist coordinate readout.

Legend: `[x]` present and reachable in the new UI. "Where" is the new place.

## Navigation (now the dock, bottom of the screen)
- [x] Logo (single colour, theme-aware): dock, left end
- [x] Story picker: dock, upward menu; hidden when there is one story; featured story marked with a diamond and "Featured" in the Steel accent
- [x] Data status badge (Placeholder / Beta / Provisional / Validated), always visible: dock, with its tooltip (status note + detail)
- [x] Scientist detail text after the badge: dock, in Scientist mode
- [x] Language picker, 7 languages as each story offers them, hidden when English only: dock, upward menu
- [x] "Machine translated" note and its explanation: next to the language menu, per language in the menu, and as the menu footer (the old UI never rendered it; the strings existed)
- [x] Story / Scientist switch: dock
- [x] Theme: System / Dark / Light, remembered: dock (new)
- [x] Coordinates readout: dock, right end, Scientist mode (shows the clicked point; the inspector and cross-section card still show their own coordinates)
- [x] Zoom in, zoom out, reset tilt: map controls, top right
- [x] Recenter: map controls, top right

## Side panel (left, glass at about 88% opacity, collapsible)
- [x] Title and place
- [x] Collapse / expand
- [x] Ground motion / More layers view switcher and the layers menu (and Radar HH / HV / New flood water / Colour mix in the flood viewer)
- [x] Colour scale with units, end values, "What do the colors mean?" disclosure
- [x] Overview / Periods / Charts / Learn tabs, plus Impact, Layers, Analysis, Data and Sources where a story has them
- [x] Story text, "Why we started here" note
- [x] "How big is the change?" box with away (orange) and toward (blue) values and the outlier note
- [x] Start the story tour, Before / after, Replay, How this was made, Method and processing, Limitations, How to use this
- [x] Scientist: cross-section tool, physics checks and offsets, Track and dates line, provenance tables, resource links
- [x] Team and challenge credits

## Flood viewer
- [x] Compare / Swipe divider and the "Compare with" picker
- [x] Radar view choice, water mask, Animate, 3D terrain, layer groups and legends with context notes
- [x] Charts tab (point chart, presets, rain chart), Evidence tab, "How this was made" methods dialog with tables and limits

## Map
- [x] Labels and markers, click inspector (motion, echo strength, confidence, flood state and history)
- [x] Tour card and "Press Esc to skip"
- [x] Imagery credits and attribution control

## Timeline bar (above the dock)
- [x] Play / Pause, previous / next, period picker (upward menu), current date
- [x] Satellite passes row, eruption or earthquake row with episode markers, rain and new-water series
- [x] Keyboard support (range input), "Map shows the change measured from ... to ..." caption

## Credits
- [x] Team and challenge: splash and Learn tab, unchanged

## Not added on purpose
- "Explore" and "About" from the mock are placeholders, not features.
