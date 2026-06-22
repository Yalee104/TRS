# TRS — Mini-Game Playground (a learning repo)

A personal learning playground for the **Tactical Routing System (TRS)** — a reusable
grid-path puzzle module and the games built on top of it. Each piece is a
self-contained, heavily-commented artifact. One repo, one Vite project, a menu page
that links to each game.

## Run it

```bash
npm install
npm run dev        # open the printed http://localhost:5173 — the menu links to each game
```

- `npm run build` — production build of all pages
- `npm run test:puzzle` — headless logic tests for the puzzle module
- `npm run test:strategy` — headless logic tests for the strategy game

## The games

### 🧩 `games/grid-path-puzzle/` — Grid Path Puzzle (DOM/CSS + SVG)
A reusable, **zero-dependency**, framework-agnostic module: drag a path from START to
GOAL weighing risk vs. reward. Configurable grid size (4×4–15×15) and developer-defined
node types. The playground adds a **data-driven combo system** with an Offensive/Defensive
mode toggle, runtime **status modifiers** (freeze/confuse/drain/shatter + a burning hazard),
an **objective gate**, a pre-start **GO** pause, and a **route-first "designer" generator**.
Teaches a DOM/SVG renderer, drag-to-draw interaction, pure rules/effects, procedural
generation with a solvability guarantee, and a generic config-driven engine. See
`games/grid-path-puzzle/README.md` + `COMBO_DESIGN_*.md`. Live-tinker via `window.__puzzle`.

### 🛰️ `games/strategy/` — TRS Command (DOM · turn-based strategy)
Two component-built aircraft duel in alternating **build → resolve** phases. Solve a
component's TRS route to queue attacks/defenses; enemy statuses are *felt* as routing
friction (freeze slows the cursor, drain decays your icons, etc.); condition feeds
firepower; a cascade rewards kills. All tuning lives in `games/strategy/config/game.json`.
See `games/strategy/DESIGN.md`. Live-tinker via `window.__strategy`.

## Layout

```
TRS/
  index.html            # the menu
  vite.config.js        # multi-page entry points
  games/
    grid-path-puzzle/   # reusable DOM/SVG module + playground + tests + shared TRS preset
    strategy/           # turn-based strategy game on the puzzle
```

Built with [Vite](https://vitejs.dev); no runtime dependencies (the puzzle module and
strategy game use no libraries).

> **Other branches:** the Canvas 2D **Hack & Blast** shmup lives on the `hack-and-blast`
> branch (it also embeds the puzzle); the Phaser/Yuka **Arcade Fighter** was retired.
