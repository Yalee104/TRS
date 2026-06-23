# TRS — project instructions for Claude

## Git workflow

- **Branch off `main` ONLY.** Create a new branch only when the current branch is `main`.
  **If the current branch is NOT `main`, do NOT create another branch** — continue the new
  work/fix on the existing branch. Start a fresh branch off `main` only after the current
  branch has been merged.
- Verify before merging: run `npm run test:strategy` (and `npm run test:puzzle` if the puzzle
  module changed) and `npm run build`; merge to `main` with `--no-ff` only after they pass.
- Pushing to `main` triggers the GitHub Pages deploy. Use a `--base=/TRS/` build to mirror CI.
- Commit + push per change with a clear, descriptive message (one logical change per commit).

## Tests / build

- `npm run test:strategy` — strategy game logic + i18n parity. `npm run test:puzzle` — the
  grid-path module. `npm run build` — Vite multi-page build. Use `npm install` (not `npm ci`).

## Conventions

- The strategy game is the active focus (`games/strategy/`). All tuning lives in
  `config/game.json`; user-facing text lives in the i18n catalogs (`i18n/en.js` + `i18n/zh-Hant.js`,
  key parity enforced by `tests/i18n.test.mjs`). Don't modify the shared puzzle `module/`.
