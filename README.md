# TRS — Mini-Game Playground (a learning repo)

A personal learning playground for the workflow behind **rich HTML animation**.
Each mini-game is a self-contained, heavily-commented artifact that teaches a
different slice of game/animation development. One repo, one Vite project, a
menu page that links to each game.

## Run it

```bash
npm install
npm run dev        # open the printed http://localhost:5173 — the menu links to each game
```

- `npm run build` — production build of all pages
- `npm run build:sprites` — regenerate the fighting game's sprite atlas
- `npm run test:puzzle` — headless logic tests for the puzzle module

## The games

### 🥊 `games/fighting/` — Arcade Fighter (Phaser 3 + Yuka)
A 1-v-1 fighting game vs. a Yuka-driven AI. Teaches the **sprite/atlas pipeline**,
**animation state machines**, the **game loop**, and **enemy AI** (state machine +
steering). Controls: **← →** move · **↑** jump · **A** punch · **S** kick ·
**D** block · **H** hitboxes · **R** reset. Live-tinker via `window.__game`.

| File | Teaches |
|---|---|
| `games/fighting/tools/build-spritesheet.mjs` | the asset pipeline (sprite sheet from scratch) |
| `games/fighting/scenes/FightScene.js` | the game loop (`preload → create → update`) |
| `games/fighting/fighter/states.js` + `Fighter.js` | animation state machine, frame data, hit/hurtboxes |
| `games/fighting/ai/EnemyBrain.js` | enemy AI with Yuka (FSM + steering) |

### 🧩 `games/grid-path-puzzle/` — Grid Path Puzzle (DOM/CSS + SVG)
A reusable, **zero-dependency**, framework-agnostic module: drag a path from
START to GOAL weighing risk vs. reward. Configurable grid size (4×4–15×15) and
developer-defined node types. The demo adds a **data-driven combo system** with an
**Offensive/Defensive mode toggle** (skills combine by order — Freeze/Confuse/Drain
+ Chain/Multihack, the Beam; Shield/Cleanse/Overclock + Prolong/Amplify, the
Fortress) and a **route-first "designer" generator**. Teaches a **DOM/SVG renderer**,
a **drag-to-draw interaction**, **pure rules/effects**, **procedural generation with
a solvability guarantee**, and a **generic config-driven engine**. See
`games/grid-path-puzzle/README.md` + `COMBO_DESIGN_*.md`. Live-tinker via
`window.__puzzle` / `window.__combo`.

## Layout

```
TRS/
  index.html            # the menu
  vite.config.js        # multi-page entry points
  games/
    fighting/           # Phaser game
    grid-path-puzzle/    # reusable DOM/SVG module + demo + tests
```

Built with [Vite](https://vitejs.dev). The fighting game uses
[Phaser 3](https://phaser.io) + [Yuka](https://mugen87.github.io/yuka/); the
puzzle module uses no libraries at all.
