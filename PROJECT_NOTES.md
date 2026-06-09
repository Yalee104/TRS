# TRS — Project Notes & Continuation Guide

> A self-contained log of what this repo is, what's built, how to run/verify it, and
> what to do next. Read `README.md` for the quick start; read **this** for the *why*,
> the *state*, and the *next steps*.

---

## 1. What this repo is

A **learning playground** (not a product) for the workflow behind **rich HTML animation**,
for a separate work project. It now holds **two** self-contained mini-games, each
**heavily commented as a tutorial** (comments explain the *why*). One repo, one Vite
project, multi-page, with a menu `index.html`.

```
TRS/
  index.html            # menu linking to each game
  vite.config.js        # multi-page entry points (menu / fighting / puzzle)
  games/
    fighting/           # 🥊 Phaser 3 + Yuka fighting game
    grid-path-puzzle/    # 🧩 reusable, zero-dependency DOM/SVG puzzle module
```

---

## 2. Current state — DONE & VERIFIED

### 🥊 Arcade Fighter (`games/fighting/`)
Phaser 3 + Yuka. Sprite/atlas pipeline, animation state machine (idle/walk/jump/
punch/kick/block/hitstun/ko with frame data + hit/hurtboxes), Yuka enemy AI
(approach→attack→retreat→block + steering), full game loop. Verified in a headless
browser (renders, tints, hits, AI transitions). Still runs unchanged after being
relocated into `games/fighting/`.

### 🧩 Grid Path Puzzle (`games/grid-path-puzzle/`)
Reusable DOM/CSS+SVG module, **zero dependencies** (~8 KB gzipped). Drag a path
START→GOAL; node effects accumulate; reach goal to "execute". **Verified:**
- `npm run test:puzzle` — **all headless logic tests pass** (generator solvability across
  sizes 4–15 × many seeds; path rules; effect ordering).
- Headless browser: real mouse-drag to goal completes with correct result + HUD; backtrack
  shrinks the path; trap-fail, **block** mode, **move-budget** cap, and **timeout** all behave;
  no runtime errors (only the cosmetic `favicon.ico` 404).
- `npm run build` compiles all three pages.

---

## 3. How to run

```bash
npm install
npm run dev          # open http://localhost:5173 — menu links to each game
npm run build        # production build of all pages
npm run build:sprites  # regenerate the fighting atlas (games/fighting/assets/sprites/*)
npm run test:puzzle    # headless logic tests for the puzzle
```

**Live tinkering (DevTools):**
- Fighting: `__game.scene.getScene('FightScene').brain.opts.aggression = 1`
- Puzzle: `__puzzle.loadLevel({ size: 12, difficulty: 0.8, seed: 42 })`

---

## 4. File maps & key tunables

### 🥊 Fighting (`games/fighting/`)
| File | Teaches | Poke |
|---|---|---|
| `tools/build-spritesheet.mjs` | asset pipeline (atlas from scratch) | `ANIMATIONS` table |
| `scenes/FightScene.js` | the game loop | `ANIM_FRAMES` / `ANIM_FPS` |
| `fighter/states.js` + `Fighter.js` | FSM, frame data, hit/hurtboxes | `STATES`, `MOVE_SPEED`, `JUMP_SPEED` |
| `ai/EnemyBrain.js` | Yuka FSM + steering | `opts` (aggression/preferredRange/reactionDelay) |
| `main.js` | booting Phaser | `config` (gravity/size) |

### 🧩 Puzzle (`games/grid-path-puzzle/`)
| File | Teaches |
|---|---|
| `module/core/pathRules.js` | path-validity rules (one source of truth for pointer + keyboard) |
| `module/core/generator.js` | seeded PCG + BFS solvability guarantee (no AI, no deps, NOT Yuka) |
| `module/core/effects.js` | apply `onPass` in path order |
| `module/view/Renderer.js` | DOM grid + SVG path overlay (viewBox = cell units → exact centers) |
| `module/input/PointerController.js` | drag-to-draw + backtrack |
| `module/GridPathPuzzle.js` | the facade (rules orchestration, timer, events) |
| `demo.js` | a host embedding the module |

Tunables: `nodeTypes` catalog (host-defined power-ups/obstacles), `generate` opts
(size/difficulty/seed/weights), `moveBudget`, `timeLimitMs`, `trapEntryMode`
(`'commitFail'`|`'block'`). Full API in `games/grid-path-puzzle/README.md`.

---

## 5. Roadmap — what to build next

### 🥊 Fighting
- **Game-feel:** SFX (Phaser audio + jsfxr), hit-spark particles, hit-stop, screen flash.
- **Combos:** cancel windows in the state machine (`punch → punch → kick`).
- **Rounds/score:** best-of-3, timer, a `MenuScene`.
- **AI depth:** difficulty tiers; a **Utility AI** variant (score each action); whiff-punish.
- **Assets:** swap in CC0 art (kenney.nl/itch.io) keeping frame names; author in Aseprite; Tiled stage.
- **(Stretch)** learned AI via self-play (TensorFlow.js) — honestly overkill; experiment only.

### 🧩 Puzzle
- **More effect types** in the demo catalog (Confuse/Drain/Chain/Multihack from the PDF) and a
  "skill chain" combo readout, matching the Pragmata "path combination" idea.
- **Theming hook:** the module already uses `nodeType.color` + scoped CSS; add a documented
  CSS-variable theme so hosts restyle without touching the module.
- **Non-square grids** (`{cols, rows}`) — `gridModel` already uses (x,y); generalize generator/loader.
- **Undo/Hint buttons** (deferred from v1) — undo = truncate path by one; hint = reveal next spine cell.
- **Animated path draw / particle on execute** — the "juice" that transfers to the work project.
- **Embed it in a real game loop** (e.g. as the fighting game's "special move" minigame) to prove reuse.

### Bridge to the work project
Transferable core: pick a renderer, the asset pipeline (author→pack→load→manage), and
**state-machine-driven animation**. For UI-style rich animation, look at **GSAP** (timelines)
and **Rive** (designer-authored animations with a built-in state machine — same model as
`fighter/states.js`). Next session, describe what the work animation must *do* and we'll pick
the right subset.

---

## 6. Notes for a future session

- **Branch:** this work lives on the `grid-path-puzzle` git branch (commits: restructure → puzzle
  core+tests → puzzle view/input/facade/demo). `main` still has the fighting game at the old root
  layout — merge the branch to adopt the new `games/*` layout.
- **Repo hygiene done here:** added `.gitignore`; untracked `node_modules` and `dist` (they were
  committed by mistake in the original repo).
- **Verification approach:** headless logic tests for the puzzle's pure core (`npm run test:puzzle`);
  everything else is visual/manual in the browser. **Puppeteer** was used transiently for browser
  verification and removed from deps again — re-add with
  `npm i -D puppeteer && npx puppeteer browsers install chrome` if needed.
- **Known cosmetic item:** `favicon.ico` 404 — harmless.
- **Architecture intent:** keep code teaching-oriented (clarity over cleverness, explain the *why*).
  The puzzle `module/` must stay **import-pure** (nothing under `module/` imports outside it) so it
  remains copy-pasteable.
- **Design source:** `TRS-MiniGame-Workflow-Detail.pdf` (Pragmata hacking-node breakdown) and
  `TRS-MiniGame-Rule-Sample.png` (the drag control) are the puzzle's reference; currently untracked.
