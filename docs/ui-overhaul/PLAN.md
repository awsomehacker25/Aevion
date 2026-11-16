# UI overhaul plan

Source of truth: AEVION-UI-DIRECTION.md. Branch `ui-overhaul`, worktree `../Aevion-ui`, based on main at ec7a88b (flood viewer already merged into the shared components).

1. **Tokens + theme.** Steel dark and light mapped onto the existing token names in `index.css` (derived tokens use `color-mix`, so both themes share one set). `.glass` utilities, radius scale 10/6/4, `theme.ts` (System/Dark/Light, remembered), switcher, PRODUCT.md rewrite. Light-theme contrast inks for away/toward/status.
2. **Logo swap.** Replace `public/logo*`, favicon, touch icon; one single-colour logo (theme-aware) everywhere.
3. **Shared shell + bottom nav.** Dock (logo, story menu, status badge, mode switch, language, theme, scientist coords), timeline bar above it, left glass side panel, right map controls; custom upward story menu. Both viewers use it.
4. **Loading.** Skeleton components matched to real layouts, overlay fades, stacked-logo splash with pixel build, reduced-motion.
5. **Polish + verification.** Playwright screenshots (both viewers x Story/Scientist x dark/light), INVENTORY.md ticked, build/lint/types green.

Each step ends with: run app, screenshots, fix, build + lint, review/simplify, commit.
