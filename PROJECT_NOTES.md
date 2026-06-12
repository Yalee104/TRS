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
    shmup/              # ✈️ Canvas 2D shooter that embeds the puzzle as a "hack"
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
Reusable DOM/CSS+SVG module, **zero dependencies**. Drag a path START→GOAL; the
**order** you cross skill nodes builds a combo; reach goal to "execute". Now has a
**data-driven combo system** with an **Offensive/Defensive mode toggle** and a
**route-first "designer" generator**. **Verified:**
- `npm run test:puzzle` — **all headless tests pass**: path rules, effect ordering,
  generator solvability (4–15 × seeds), the **ComboEngine** (offensive lock-to-first /
  Beam / near-miss; defensive layered buffs / Fortress), and the **route-first generator**
  (two distinct routes, exact node counts, achievable ordering, reproducible, fallback).
- Headless browser: mode toggle swaps catalog+config; offensive board has exactly one 🔗 +
  one 💥; driving the primary route yields **Deep Freeze ×6.75 · 🎯 all · Shatter**; defensive
  layers Plating/Purge/Boost and raises the **Fortress** banner. No runtime errors (favicon only).
- The combo engine + configs live in the **host layer** `combo/` (JSON, no YAML/parser dep);
  `module/` stays generic and only emits the ordered path. The combo-focused board dropped the
  old +DMG/upgrade/penalty multiplier nodes.

### ✈️ Hack & Blast (`games/shmup/`)
Vanilla **Canvas 2D** vertical shooter that **embeds the puzzle as the hack mechanic**. Player
auto-fires at a boss (cycles aimed/spread/radial patterns) + 3 smalls; **Hack** opens the offensive
puzzle (effects hit enemies), **Protect** the defensive (buffs the player). The puzzle opens as a
**right-side panel** (never overlaps the game) with a big **countdown timer** (one-decimal, flashes
red <5s, starts on open so idling times out); **fail/timeout doubles** that side's cooldown
(`cooldowns.failCooldownMult`). Fixed-timestep loop with `timeScale` → **slow-mo while a puzzle is
open**; one puzzle at a time; per-side cooldowns.
Everything in `config/game.json`; effects are a data-driven handler registry; the puzzle/combo modules
are imported, never modified. **Enemy shields:** each enemy has a shield = `tuning.enemyShieldMult`×HP
(default 5×, chips/no-regen) that absorbs fire; a winning **offensive** puzzle disables ALL enemy shields
for `tuning.shieldDisableMs` (5s) — the strategic payoff — and **Drain** bypasses shields
(`tuning.shieldBypassSkills`). Shields render as enemy rings (+break/restore flashes) and a boss shield bar.
**Verified:** `npm run test:shmup` (51 tests: patterns, fire cadence, collision, status, win/lose,
`damageEnemy` shield routing, drain bypass, shield-disable scope, doubled fail cooldown, countdown
wiring, effect application via REAL combo results, bridge gating) + headless browser (move/fire,
Hack→slow-mo, solve→boss effect + cooldown). Debug: `window.__shmup`.

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
| `module/core/generator.js` | seeded PCG: `generate` (simple spine) + `generateRouteFirst` (designer: primary+safe routes, constrained placement, channeling hazards). No AI/deps. |
| `module/view/Renderer.js` | DOM grid + SVG path overlay (viewBox = cell units → exact centers) |
| `module/input/PointerController.js` | drag-to-draw + backtrack + resume |
| `module/GridPathPuzzle.js` | the facade (rules orchestration, timer, events) |
| `combo/ComboEngine.js` | **generic combo evaluation**, branches on config rule toggles |
| `combo/configs/*.json` | offensive/defensive data: skills, curve, tiers, rules, `generation` plan |
| `demo.js` | host: mode toggle, builds catalog from config, runs the engine, combo readout |

Tunables: the **active JSON config** (`combo/configs/offensive|defensive.json`) drives
skills/tiers/curve/rules + the `generation` routePlan; per-game `nodeTypes`, `generate`
opts (size/seed/`routePlan`), `moveBudget`, `timeLimitMs`, `trapEntryMode`. Full API +
combo design in `games/grid-path-puzzle/README.md` and the two `COMBO_DESIGN_*.md` docs.

---

## 5. Roadmap — what to build next

### 🥊 Fighting
- **Game-feel:** SFX (Phaser audio + jsfxr), hit-spark particles, hit-stop, screen flash.
- **Combos:** cancel windows in the state machine (`punch → punch → kick`).
- **Rounds/score:** best-of-3, timer, a `MenuScene`.
- **AI depth:** difficulty tiers; a **Utility AI** variant (score each action); whiff-punish.
- **Assets:** swap in CC0 art (kenney.nl/itch.io) keeping frame names; author in Aseprite; Tiled stage.
- **(Stretch)** learned AI via self-play (TensorFlow.js) — honestly overkill; experiment only.

### 🧩 Puzzle  *(DONE: combo engine offensive+defensive, mode toggle, route-first generator, resume-drag, sprite icons)*
- **Two boards at once** — the defensive doc envisions offense + defense side-by-side sharing the
  engine; we shipped a single-board toggle. A dual-board host is the natural next step.
- **Real effect handlers** — `combo/effects.js` returns HUD badges only; wire actual gameplay
  (mock targets that freeze/shatter/shield) if we ever add combat.
- **Theming hook:** document a CSS-variable theme so hosts restyle without touching the module.
- **Non-square grids** (`{cols, rows}`) — `gridModel` already uses (x,y); generalize generator/loader.
- **Undo/Hint buttons** (deferred) — undo = truncate by one; hint = reveal the next primary-route cell.
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
