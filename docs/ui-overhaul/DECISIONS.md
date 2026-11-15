# Decisions

One line each: what was chosen and why.

- Worked in a separate git worktree (`../Aevion-ui`, branch `ui-overhaul`) so the parallel session's working tree is untouched.
- Rebased on main at ec7a88b: the parallel session had already committed the flood-viewer merge, so step 3 is unblocked.
- Handoff folder was `ui handoff/` (untracked in main); copied into `docs/ui-overhaul/` on the branch as the brief expects.
- Derived surface tokens (`--raised`, `--sunken`, `--hover`, soft/ink accents) are computed with `color-mix` from `--surface`/`--ink`, so dark and light share one definition and no parallel token set is added.
