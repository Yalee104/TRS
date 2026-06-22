# TRS — Project Notes & Continuation Guide

> A self-contained log of what this repo is, what's built, how to run/verify it, and
> what to do next. Read `README.md` for the quick start; read **this** for the *why*,
> the *state*, and the *next steps*.

---

## 1. What this repo is

A **learning playground** (not a product) for the **Tactical Routing System (TRS)** — a
reusable grid-path puzzle module and the games built on it. Everything is **heavily
commented as a tutorial** (comments explain the *why*). One repo, one Vite project,
multi-page, with a menu `index.html`.

```
TRS/
  index.html            # menu linking to each game
  vite.config.js        # multi-page entry points (menu / puzzle / strategy)
  games/
    grid-path-puzzle/   # 🧩 reusable, zero-dependency DOM/SVG puzzle module + playground
    strategy/           # 🛰️ turn-based strategy game on the puzzle
```

**Other branches:** the Canvas 2D **Hack & Blast** shmup (which also embeds the puzzle)
lives on the **`hack-and-blast`** branch, preserved for future work. The Phaser 3 + Yuka
**Arcade Fighter** was retired (it's in git history before its removal commit).

---

## 2. Current state — DONE & VERIFIED

### 🧩 Grid Path Puzzle (`games/grid-path-puzzle/`)
Reusable DOM/CSS+SVG module, **zero dependencies**. Drag a path START→GOAL; the **order**
you cross skill nodes builds a combo; reach goal to "execute". Has a **data-driven combo
system** (Offensive/Defensive modes via `combo/ComboEngine.js`), a **route-first generator**,
and — added on the puzzle-playground line — runtime **status modifiers** (freeze=slow,
confuse=veer, drain=decay, shatter=wander), a **burning hazard** generation node, an
**objective gate** ("collect N to unlock the goal"), a pre-start **GO** pause, a **fail
banner**, and **failFast** hazards. A shared **`presets/trs.js`** builds the per-component
TRS palettes (consumed by both the playground and the strategy game, so they never drift).
- **Verified:** `npm run test:puzzle` — all headless tests pass (path rules, effect ordering,
  generator solvability + route-first invariants, the ComboEngine, and the new
  status/objective/lifecycle suites).
- The `module/` stays generic and import-pure; combo configs + the TRS preset live in the
  host layer (`combo/`, `presets/`).

### 🛰️ TRS Command (`games/strategy/`)
A DOM, turn-based strategy game: two component-built aircraft duel in alternating
**build → resolve** phases. You solve a component's TRS route to queue attacks/defenses;
**enemy statuses on your component are felt as routing friction** (freeze slows the cursor,
drain decays your payload icons, shatter scatters them, confuse veers, burning seeds 🔥
hazards). A **condition → firepower** loop ties offense to component health, a hybrid
**cascade** (gradient while damaged, cliff on destruction) rewards kills, and enemy
**archetypes** + a Tower-gated **telegraph** drive the AI. All tuning is in
`config/game.json`.
- **Verified:** `npm run test:strategy` — 150 headless tests (phase/credit transitions,
  firepower, cascade, the status/combo engine, defense mitigation order, the puzzle bridge
  via the REAL ComboEngine, win/lose on Core, multi-enemy). `npm run build` clean.
- Design lives in `games/strategy/DESIGN.md`; debug via `window.__strategy`.

---

## 3. How to run

```bash
npm install
npm run dev          # open http://localhost:5173 — menu links to each game
npm run build        # production build of all pages
npm run test:puzzle    # headless logic tests for the puzzle module
npm run test:strategy  # headless logic tests for the strategy game
```

**Live tinkering (DevTools):**
- Puzzle playground: `__puzzle.loadLevel({ size: 12, seed: 42 })`
- Strategy: inspect `__strategy.state.player.components` (HP/statuses), tune `config/game.json`

---

## 4. File maps & key tunables

### 🧩 Puzzle (`games/grid-path-puzzle/`)
| File | Teaches |
|---|---|
| `module/core/pathRules.js` | path-validity rules (one source of truth for pointer + keyboard) |
| `module/core/generator.js` | seeded PCG: simple spine + route-first designer (primary+safe routes, constrained placement, channeling hazards, second burning hazard). No AI/deps. |
| `module/view/Renderer.js` | DOM grid + SVG path overlay; objective badge, GO/fail overlays, status animations |
| `module/input/PointerController.js` | drag-to-draw + backtrack + resume |
| `module/GridPathPuzzle.js` | the facade (rules, timer, modifiers, objective gate, events) |
| `module/util/rng.js` | shared seeded RNG (mulberry32) for the runtime modifiers |
| `combo/ComboEngine.js` | generic combo evaluation, branches on config rule toggles |
| `presets/trs.js` | shared TRS palettes/genPlan (one source of truth for puzzle + strategy) |
| `demo.js` | the playground host (phase/component pickers, live knobs, status toggles) |

### 🛰️ Strategy (`games/strategy/`)
| File | Teaches |
|---|---|
| `core/state.js` `phases.js` `firepower.js` `cascade.js` | the loop, condition→firepower, hybrid cascade |
| `combat/statuses.js` `combos.js` `attack.js` `defense.js` `enemyAI.js` | status engine + FCFS combo chain, resolve, archetype AI |
| `puzzle/bridge.js` | mounts a component's TRS, maps statuses→route friction, queues on solve |
| `puzzle/palettes.js` | thin adapter over `grid-path-puzzle/presets/trs.js` |
| `config/game.json` | ALL tuning (firepower curve, cascade, effects/defense, archetypes, puzzle knobs) |

---

## 5. Roadmap — what to build next

### 🧩 Puzzle
- **Two boards at once** — a dual-board host (offense + defense side-by-side sharing the engine).
- **Theming hook:** document a CSS-variable theme so hosts restyle without touching the module.
- **Non-square grids** (`{cols, rows}`) — `gridModel` already uses (x,y); generalize generator/loader.
- **Undo/Hint buttons** — undo = truncate by one; hint = reveal the next primary-route cell.

### 🛰️ Strategy (see `DESIGN.md` §10 for the deferred list)
- **Balance pass** on the status/combo tables, the condition→firepower curve, and cascade magnitudes.
- **Roguelike meta** (§8): Slay-the-Spire map, Salvage economy, Modify/Develop/Rest nodes, Trophies.
- **v2 power-ups:** multi-target Focus, the Boss archetype, the "Status Ward" defensive combo.

### Bridge to the work project
Transferable core: a config-driven renderer, pure rules/effects, and a host "bridge" that
queues during build and applies at resolve. The puzzle `module/` stays copy-pasteable.

---

## 6. Notes for a future session

- **Branches:** `main` holds the puzzle module + strategy game. The **`hack-and-blast`** branch
  preserves the Canvas 2D shmup for future work. Feature work follows: new branch → verify →
  merge to the playtest branch → `main`.
- **Verification approach:** headless logic tests for the pure cores (`npm run test:puzzle`,
  `npm run test:strategy`); the rest is visual/manual in the browser (`npm run dev`).
- **Architecture intent:** keep code teaching-oriented (clarity over cleverness, explain the *why*).
  The puzzle `module/` must stay **import-pure** (nothing under `module/` imports outside it) so it
  remains copy-pasteable; `presets/trs.js` is the shared (non-module) TRS source of truth.
- **CI:** `.github/workflows/deploy.yml` builds the Vite multi-page site and publishes to GitHub
  Pages on push to `main`; the root URL serves the menu.
