# Decisions

One line each: what was chosen and why.

- Worked in a separate git worktree (`../Aevion-ui`, branch `ui-overhaul`) so the parallel session's working tree is untouched.
- Rebased on main at ec7a88b: the parallel session had already committed the flood-viewer merge, so step 3 is unblocked.
- Handoff folder was `ui handoff/` (untracked in main); copied into `docs/ui-overhaul/` on the branch as the brief expects.
- Derived surface tokens (`--raised`, `--sunken`, `--hover`, soft/ink accents) are computed with `color-mix` from `--surface`/`--ink`, so dark and light share one definition and no parallel token set is added.
- Logo is drawn as a CSS mask over currentColor (Logo.tsx) rather than <img>, so one set of single-colour SVGs follows the theme (ink on dark, dark ink on light) and is never tinted with data colours. README uses a <picture> for light/dark.
- Dev server for checks runs on port 5210 (5173 and 5199 belong to other sessions). Playwright MCP could not find Chrome, so screenshots use playwright-core with the installed Edge, kept in the scratchpad (not a repo dependency).
- The old top bar's phone layout was dropped, not rebuilt: the brief says desktop only for now. The dock shortens its status text below 1400px and hides the coordinate hint and the machine-translation chip on narrower windows.
- The dock's glass is a pseudo-element, because a backdrop-filter on the dock would stop the menus inside it from blurring the map behind them.
- The "Machine translated" note was in the brief but the old UI never rendered it (only the strings and a context flag existed), so it is now shown as a chip next to the language menu, per language in the menu and as the menu footer.
- The old UI had no live coordinates readout, only coordinates on the clicked point. The dock readout shows the clicked point in Scientist mode, with a hint when nothing is picked.
- Story and language menus are one custom Menu component (listbox pattern, keyboard and screen-reader accessible) rather than a new dependency.
- The timeline uses the near-opaque panel background rather than clear glass, because its small labels failed contrast over bright imagery in light mode.
- Loading: the app only renders once a story is fully loaded, so skeletons appear where data actually loads: a story switch (full shell skeleton: side panel text, change box, tabs, timeline rows, dock). The brief's layer thumbnails and methods tables are not loaded asynchronously today (no thumbnails exist; the methods data arrives with the story), so no skeleton is faked for them.
- The opening splash is one overlay mounted by App: it holds at least 1.0s so the pixel half finishes, fades for 0.35s once the first story is ready, and never replays. Reduced motion shows the finished logo for 0.3s and removes it with no fade.
- The map fades in on its first idle, with a 2.5s fallback so a slow or failing tile never leaves it hidden. A data attribute is used because React's className updates would remove a class.
- Extra map overlays already fade with the timeline cursor (their opacity is driven per frame), so no separate overlay fade was added; changing it would touch MapView's replay logic.
- The /code-review skill returned no findings in 11s (it appeared not to run against the worktree), so I reviewed the new files by hand instead: menu keyboard and focus handling, splash/ready wiring, theme persistence, i18n fallback to English for the new keys, and nested backdrop-filter limits. That review found and fixed the see-through period and layers menus and the thin reading cards.
- Screenshots in docs/ui-overhaul/screenshots: before/ (old UI, dark), after/ (new UI, both themes), states/ (tour, period menu, inspector, layers, charts, methods dialog, both themes), loading/ (splash frames, skeleton, reduced motion), checks/ (menu, language and 1280px window).
- Light panels use their own contrast inks (away #a8470a, toward #1d62a8, status inks) checked by eye on white; the map and the colour swatches keep the fixed data colours.
