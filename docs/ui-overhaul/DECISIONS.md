# Decisions

One line each: what was chosen and why.

- Worked in a separate git worktree (`../Aevion-ui`, branch `ui-overhaul`) so the parallel session's working tree is untouched.
- Rebased on main at ec7a88b: the parallel session had already committed the flood-viewer merge, so step 3 is unblocked.
- Handoff folder was `ui handoff/` (untracked in main); copied into `docs/ui-overhaul/` on the branch as the brief expects.
- Derived surface tokens (`--raised`, `--sunken`, `--hover`, soft/ink accents) are computed with `color-mix` from `--surface`/`--ink`, so dark and light share one definition and no parallel token set is added.
- Logo is drawn as a CSS mask over currentColor (Logo.tsx) rather than <img>, so one set of single-colour SVGs follows the theme (ink on dark, dark ink on light) and is never tinted with data colours. README uses a <picture> for light/dark.
- Dev server for checks runs on port 5210 (5173 and 5199 belong to other sessions). Playwright MCP could not find Chrome, so screenshots use playwright-core with the installed Edge, kept in the scratchpad (not a repo dependency).
